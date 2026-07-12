// RoomDO — Cloudflare Durable Object adapter around RoomCore (PLATFORM_SPEC §7).
// The DO's serialized event loop IS the single writer (ARCHITECTURE §1).
/// <reference types="@cloudflare/workers-types" />
import { RoomCore, Outbound, CoreAction } from "./core.js";
import { ClientActionSchema } from "@blackqueen/protocol";

export interface Env {
  ROOMS: DurableObjectNamespace;
  CODES: KVNamespace;
  AUDIT: R2Bucket;
  DEV_AUTH?: string;
}

interface Attachment {
  accountId: string;
}

const ENDED_TTL_MS = 15 * 60 * 1000; // PLATFORM_SPEC §3.1
const LOBBY_TTL_MS = 60 * 60 * 1000;

export class RoomDO implements DurableObject {
  private core!: RoomCore;
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ready = this.init();
  }

  private out(): Outbound {
    return {
      send: (accountId, msg) => {
        const data = JSON.stringify(msg);
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as Attachment | null;
          if (att?.accountId === accountId) {
            try { ws.send(data); } catch { /* dead socket; hibernation close handles it */ }
          }
        }
      },
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      persist: (key, value) => { void this.ctx.storage.put(key, value); },
      audit: (record) => {
        const key = `audit/${this.core.roomId}/${Date.now()}-${record.roundNumber}.json`;
        void this.env.AUDIT.put(key, JSON.stringify(record)); // R2 lifecycle rule purges at 30d
      },
    };
  }

  private async init(): Promise<void> {
    const saved = await this.ctx.storage.get("snap:latest");
    this.core = saved
      ? RoomCore.restore(this.ctx.id.toString(), this.out(), saved as never)
      : new RoomCore(this.ctx.id.toString(), this.out());
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const accountId = req.headers.get("x-account-id")!; // set by the Worker after JWT verification
    const displayName = decodeURIComponent(req.headers.get("x-display-name") ?? "Player");
    const avatar = decodeURIComponent(req.headers.get("x-avatar") ?? ""); // validated in core (whitelist)

    switch (url.pathname) {
      case "/create": {
        const cfg = await req.json() as Record<string, unknown>;
        this.core.create(accountId, displayName, cfg, avatar);
        await this.env.CODES.put(`code:${this.core.inviteCode}`, this.ctx.id.toString(), { expirationTtl: 24 * 3600 });
        await this.ctx.storage.setAlarm(Date.now() + LOBBY_TTL_MS);
        return json({ roomId: this.ctx.id.toString(), code: this.core.inviteCode, members: this.core.members });
      }
      case "/join": {
        const { code } = await req.json() as { code: string };
        const r = this.core.join(code, accountId, displayName, avatar);
        if (!r.ok) return json({ error: "invalid or expired code" }, 404); // uniform (§3.3)
        return json({ roomId: this.ctx.id.toString(), members: this.core.members, host: this.core.hostAccountId, phase: this.core.phase });
      }
      case "/start": {
        const body = await req.json().catch(() => ({})) as { seatOrder?: string[] };
        const r = this.core.startGame(accountId, body.seatOrder);
        if (!r.ok) return json({ error: r.error }, 400);
        await this.env.CODES.delete(`code:${this.core.inviteCode}`);
        this.armTurnAlarm();
        return json({ ok: true });
      }
      case "/addbot": {
        const r = this.core.addBot(accountId);
        if (!r.ok) return json({ error: r.error }, 400);
        return json({ members: this.core.members });
      }
      case "/removebot": {
        const r = this.core.removeBot(accountId);
        if (!r.ok) return json({ error: "no bot to remove" }, 400);
        return json({ members: this.core.members });
      }
      case "/state":
        return json({
          phase: this.core.phase, members: this.core.members, host: this.core.hostAccountId,
          code: this.core.phase === "OPEN" ? this.core.inviteCode : null,
          seatNames: this.core.seatNames, mySeat: this.core.seatOf.get(accountId) ?? null,
          deckCount: this.core.config.deckCount, calledCount: this.core.config.calledCount ?? null, N: this.core.config.N,
        });
      case "/ws": {
        if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
        if (!this.core.members.some((m) => m.accountId === accountId)) return new Response("not a member", { status: 403 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ accountId } satisfies Attachment);
        this.core.setConnected(accountId, true);
        // reconnect snapshot: full personal projection at current version (MESSAGE_PROTOCOL §6)
        const view = this.core.viewFor(accountId);
        if (view) pair[1].send(JSON.stringify(view));
        this.core.pushViews(); // everyone sees the "away" badge clear
        this.armTurnAlarm(); // restore full budget if they were being fast-forwarded
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
    try {
      parsed = ClientActionSchema.parse(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)));
    } catch {
      ws.send(JSON.stringify({ t: "Reject", reason: "ILLEGAL", actionId: null, currentStateVersion: this.core.stateVersion }));
      return;
    }
    // PLAT-001 anti-hijack: playerId must match the socket's bound account
    if (parsed.playerId !== att.accountId) {
      ws.send(JSON.stringify({ t: "Reject", reason: "ILLEGAL", actionId: parsed.actionId, currentStateVersion: this.core.stateVersion }));
      return;
    }
    this.core.handleAction(att.accountId, parsed.actionId, parsed.stateVersion, { type: parsed.type, payload: parsed.payload } as CoreAction);
    this.armTurnAlarm();
    if (this.core.phase === "ENDED") await this.ctx.storage.setAlarm(Date.now() + ENDED_TTL_MS);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ready;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) {
      this.core.setConnected(att.accountId, false);
      this.core.pushViews(); // surface the "away" badge
      this.armTurnAlarm(); // if it's their turn, switch to the 12s fast-forward budget
    }
  }

  async alarm(): Promise<void> {
    await this.ready;
    if (this.core.phase === "OPEN") {
      await this.destroyRoom(); // lobby idle timeout
      return;
    }
    if (this.core.phase === "ENDED") {
      await this.destroyRoom(); // ephemeral teardown (§4)
      return;
    }
    // Bot pacing: if a bot is on turn, this alarm is a bot beat — apply exactly one bot action.
    if (this.core.isBotTurn()) this.core.botActOnce();
    else this.core.onTimeout(); // §6 escalation: auto-pass / auto-play / PAUSED
    this.armTurnAlarm();
    if ((this.core.phase as string) === "ENDED") await this.ctx.storage.setAlarm(Date.now() + ENDED_TTL_MS);
  }

  /** One alarm, two meanings: a short "thinking" beat when a bot is on turn,
   *  else the human turn deadline (ARCH §6). Bots therefore pace the whole table naturally. */
  private armTurnAlarm(): void {
    if (this.core.phase !== "IN_GAME") return;
    if (this.core.isBotTurn()) {
      void this.ctx.storage.setAlarm(Date.now() + RoomDO.BOT_BEAT_MS);
      return;
    }
    const delay = this.core.nextDeadlineDelay();
    if (delay !== null) void this.ctx.storage.setAlarm(Date.now() + delay);
    else void this.ctx.storage.deleteAlarm(); // PAUSED: no timer runs
  }

  private static BOT_BEAT_MS = 800;

  private async destroyRoom(): Promise<void> {
    await this.env.CODES.delete(`code:${this.core.inviteCode}`);
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "room destroyed");
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
