// Room28DO — Cloudflare Durable Object adapter around RoomCore28. Isolated from RoomDO (Black Queen):
// its own class, its own storage, its own invite-code namespace ("c28:"). Same serialized-writer model.
/// <reference types="@cloudflare/workers-types" />
import { RoomCore28 } from "./core28.js";
import { parseAction28 } from "@twentyeight/protocol";

export interface Env28 {
  ROOMS28: DurableObjectNamespace;
  CODES: KVNamespace;
}
interface Attachment { accountId: string }

const ENDED_TTL_MS = 15 * 60 * 1000;
const LOBBY_TTL_MS = 60 * 60 * 1000;
const BOT_BEAT_MS = 800;

export class Room28DO implements DurableObject {
  private core!: RoomCore28;
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: Env28) {
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
      audit: () => { /* 28 keeps no audit log in v1 */ },
    };
  }

  private async init(): Promise<void> {
    const saved = await this.ctx.storage.get("snap:latest");
    this.core = saved ? RoomCore28.restore(this.ctx.id.toString(), this.out(), saved) : new RoomCore28(this.ctx.id.toString(), this.out());
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const accountId = req.headers.get("x-account-id")!;
    const displayName = decodeURIComponent(req.headers.get("x-display-name") ?? "Player");
    const avatar = decodeURIComponent(req.headers.get("x-avatar") ?? "");

    switch (url.pathname) {
      case "/create": {
        const cfg = await req.json().catch(() => ({})) as { N?: number };
        this.core.create(accountId, displayName, avatar, cfg.N);
        await this.env.CODES.put(`c28:${this.core.inviteCode}`, this.ctx.id.toString(), { expirationTtl: 24 * 3600 });
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
        this.armAlarm();
        await this.snap();
        return json({ ok: true });
      }
      case "/config": {
        const body = await req.json().catch(() => ({})) as { N?: number };
        if (accountId === this.core.hostAccountId && this.core.phase === "OPEN" && body.N && body.N >= 2 && body.N <= 20) this.core.N = body.N;
        await this.snap();
        return json({ N: this.core.N });
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
          code: this.core.phase === "OPEN" ? this.core.inviteCode : null, N: this.core.N,
          mySeat: this.core.seatOf.get(accountId) ?? null,
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
    try { parsed = parseAction28(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message))); }
    catch { return; }
    if (parsed.playerId !== att.accountId) return; // anti-hijack
    this.core.handleAction(att.accountId, parsed.actionId, parsed);
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
    if (this.core.isBotTurn()) this.core.botActOnce();
    else this.core.onTimeout();
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
    await this.env.CODES.delete(`c28:${this.core.inviteCode}`);
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "room destroyed");
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
