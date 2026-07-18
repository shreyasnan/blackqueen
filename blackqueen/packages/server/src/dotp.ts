// RoomTPDO — Cloudflare Durable Object adapter around RoomCoreTP. Isolated from the other games:
// its own class, its own storage, its own invite-code namespace ("ctp:"). Same serialized-writer model.
/// <reference types="@cloudflare/workers-types" />
import { RoomCoreTP } from "./coretp.js";
import { parseActionTP } from "@teenpatti/protocol";

export interface EnvTP {
  ROOMSTP: DurableObjectNamespace;
  CODES: KVNamespace;
}
interface Attachment { accountId: string }

const ENDED_TTL_MS = 15 * 60 * 1000;
const LOBBY_TTL_MS = 60 * 60 * 1000;
const BOT_BEAT_MS = 900;

export class RoomTPDO implements DurableObject {
  private core!: RoomCoreTP;
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: EnvTP) {
    this.ready = this.init();
  }

  private out() {
    return {
      send: (accountId: string, msg: unknown) => {
        const data = JSON.stringify(msg);
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as Attachment | null;
          if (att?.accountId === accountId) { try { ws.send(data); } catch { /* dead socket */ } }
        }
      },
      randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
      persist: (key: string, value: unknown) => { void this.ctx.storage.put(key, value); },
      audit: () => { /* TP keeps no audit log in v1 */ },
    };
  }

  private async init(): Promise<void> {
    const saved = await this.ctx.storage.get("snap:latest");
    this.core = saved ? RoomCoreTP.restore(this.ctx.id.toString(), this.out(), saved) : new RoomCoreTP(this.ctx.id.toString(), this.out());
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const accountId = req.headers.get("x-account-id")!;
    const displayName = decodeURIComponent(req.headers.get("x-display-name") ?? "Player");
    const avatar = decodeURIComponent(req.headers.get("x-avatar") ?? "");

    switch (url.pathname) {
      case "/create": {
        const cfg = await req.json().catch(() => ({})) as { chips?: number; boot?: number; cap?: number };
        this.core.create(accountId, displayName, avatar, cfg);
        await this.env.CODES.put(`ctp:${this.core.inviteCode}`, this.ctx.id.toString(), { expirationTtl: 24 * 3600 });
        await this.ctx.storage.setAlarm(Date.now() + LOBBY_TTL_MS);
        await this.snap();
        return json({ roomId: this.ctx.id.toString(), code: this.core.inviteCode, members: this.core.members });
      }
      case "/join": {
        const { code } = await req.json() as { code: string };
        const r = this.core.join(code, accountId, displayName, avatar);
        if (r.ok) { await this.snap(); return json({ roomId: this.ctx.id.toString(), members: this.core.members, host: this.core.hostAccountId, phase: this.core.phase }); }
        if (code === this.core.inviteCode) {
          if (this.core.members.some((m) => m.accountId === accountId)) return json({ roomId: this.ctx.id.toString(), reconnect: true });
          if (this.core.phase !== "OPEN") return json({ error: "this game has already started" }, 409);
        }
        return json({ error: "invalid or expired code" }, 404);
      }
      case "/start": {
        const r = this.core.startGame(accountId);
        if (!r.ok) return json({ error: r.error }, 400);
        this.core.runBots();
        this.armAlarm();
        await this.snap();
        return json({ ok: true });
      }
      case "/addbot": { const r = this.core.addBot(accountId); if (!r.ok) return json({ error: r.error }, 400); await this.snap(); return json({ members: this.core.members }); }
      case "/removebot": { const r = this.core.removeBot(accountId); if (!r.ok) return json({ error: "no bot" }, 400); await this.snap(); return json({ members: this.core.members }); }
      case "/leave": {
        this.core.leave(accountId); this.core.setConnected(accountId, false);
        for (const ws of this.ctx.getWebSockets()) { try { if ((ws.deserializeAttachment() as Attachment)?.accountId === accountId) ws.close(1000, "left"); } catch { /* ignore */ } }
        this.core.pushViews(); await this.snap();
        return json({ ok: true });
      }
      case "/state":
        return json({
          phase: this.core.phase, members: this.core.members, host: this.core.hostAccountId,
          code: this.core.phase === "OPEN" ? this.core.inviteCode : null,
          mySeat: this.core.seatOf.get(accountId) ?? null,
          chips: this.core.startingChips, boot: this.core.boot, cap: this.core.maxStake,
        });
      case "/ws": {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
        if (!this.core.members.some((m) => m.accountId === accountId)) return new Response("not a member", { status: 403 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ accountId } satisfies Attachment);
        this.core.setConnected(accountId, true);
        pair[1].send(JSON.stringify(this.core.viewFor(accountId)));
        this.core.pushViews();
        this.armAlarm();
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const att = ws.deserializeAttachment() as Attachment;
    let parsed;
    try { parsed = parseActionTP(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message))); }
    catch { return; }
    if (parsed.playerId !== att.accountId) return;
    this.core.handleAction(att.accountId, parsed.actionId, parsed);
    this.core.runBots();
    this.armAlarm();
    if (this.core.phase === "ENDED") await this.ctx.storage.setAlarm(Date.now() + ENDED_TTL_MS);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ready;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) { this.core.setConnected(att.accountId, false); this.core.pushViews(); this.armAlarm(); }
  }

  async alarm(): Promise<void> {
    await this.ready;
    if (this.core.phase === "OPEN" || this.core.phase === "ENDED") { await this.destroy(); return; }
    try {
      if (this.core.isBotTurn()) this.core.runBots();
      else this.core.onTimeout();
    } catch { /* never let one bad move freeze the alarm */ }
    this.armAlarm();
    if ((this.core.phase as string) === "ENDED") await this.ctx.storage.setAlarm(Date.now() + ENDED_TTL_MS);
  }

  private armAlarm(): void {
    if (this.core.phase !== "IN_GAME") return;
    if (this.core.isBotTurn()) { void this.ctx.storage.setAlarm(Date.now() + BOT_BEAT_MS); return; }
    const delay = this.core.nextDeadlineDelay();
    if (delay !== null) void this.ctx.storage.setAlarm(Date.now() + delay);
    else void this.ctx.storage.deleteAlarm();
  }

  private async snap(): Promise<void> { await this.ctx.storage.put("snap:latest", this.core.serialize()); }
  private async destroy(): Promise<void> {
    await this.env.CODES.delete(`ctp:${this.core.inviteCode}`);
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "room destroyed");
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
