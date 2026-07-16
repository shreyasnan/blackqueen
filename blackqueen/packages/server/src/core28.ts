// RoomCore28 — transport-agnostic room logic for a 28 table. Isolated from Black Queen's RoomCore:
// it only borrows the shared Member/Outbound types. A 28 "game" is a series of deals (default 8),
// accumulating game points per team; the Durable Object is a thin adapter around this class.

import {
  State, Action as EngineAction, Card, initRound, applyAction, playerView, botAction,
  currentActor, nextSeat, legalPlay, MIN_OPEN,
} from "@twentyeight/engine";
import type { Action28 } from "@twentyeight/protocol";
import { Member, Outbound, sanitizeAvatar } from "./core.js";

export type RoomPhase = "OPEN" | "IN_GAME" | "ENDED";
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford (no I L O U)
const SEATS = 4;

export class RoomCore28 {
  phase: RoomPhase = "OPEN";
  members: Member[] = [];
  hostAccountId = "";
  inviteCode = "";
  N = 8;                 // deals per match
  turnTimerMs = 30000;
  graceMs = 15000;
  seatOf = new Map<string, number>();
  accountOfSeat: string[] = [];
  seatNames: string[] = [];
  seatAvatars: string[] = [];
  game: State | null = null;
  dealNumber = 0;
  dealer = 0;
  teamScores: [number, number] = [0, 0];
  stateVersion = 0;
  seq = 0;
  applied = new Map<string, boolean>();
  endedAt: number | null = null;
  private lastEvents: unknown[] = [];

  constructor(public roomId: string, private out: Outbound) {}

  // ---------- lobby ----------
  create(hostAccountId: string, hostName: string, avatar?: string, N?: number): void {
    this.hostAccountId = hostAccountId;
    this.members = [{ accountId: hostAccountId, displayName: hostName, avatar: sanitizeAvatar(avatar), connected: true }];
    this.inviteCode = this.newCode();
    if (N && N >= 2 && N <= 20) this.N = N;
  }
  private newCode(): string {
    const b = this.out.randomBytes(6);
    return [...b].map((x) => CODE_ALPHABET[x % 32]).join("");
  }
  join(code: string, accountId: string, displayName: string, avatar?: string): { ok: boolean } {
    if (this.phase !== "OPEN" || code !== this.inviteCode) return { ok: false };
    if (this.members.some((m) => m.accountId === accountId)) return { ok: true };
    if (this.members.length >= SEATS) return { ok: false };
    this.members.push({ accountId, displayName, avatar: sanitizeAvatar(avatar), connected: true });
    return { ok: true };
  }
  leave(accountId: string): void {
    if (this.phase !== "OPEN") return; // seats are immutable once the match starts
    this.members = this.members.filter((m) => m.accountId !== accountId);
    if (accountId === this.hostAccountId && this.members.length > 0) this.hostAccountId = this.members.find((m) => !m.isBot)?.accountId ?? this.members[0]!.accountId;
  }
  addBot(byAccountId: string): { ok: boolean; error?: string } {
    if (this.phase !== "OPEN") return { ok: false, error: "already started" };
    if (byAccountId !== this.hostAccountId) return { ok: false, error: "host only" };
    if (this.members.length >= SEATS) return { ok: false, error: "table full" };
    const n = this.members.filter((m) => m.isBot).length + 1;
    this.members.push({ accountId: `bot:${this.roomId}:${n}`, displayName: `Bot ${n}`, avatar: "bot", connected: true, isBot: true });
    return { ok: true };
  }
  removeBot(byAccountId: string): { ok: boolean } {
    if (this.phase !== "OPEN" || byAccountId !== this.hostAccountId) return { ok: false };
    const i = [...this.members].reverse().findIndex((m) => m.isBot);
    if (i < 0) return { ok: false };
    this.members.splice(this.members.length - 1 - i, 1);
    return { ok: true };
  }

  startGame(byAccountId: string): { ok: boolean; error?: string } {
    if (this.phase !== "OPEN") return { ok: false, error: "already started" };
    if (byAccountId !== this.hostAccountId) return { ok: false, error: "host only" };
    if (this.members.length !== SEATS) return { ok: false, error: "28 needs exactly 4 players (bots count)" };
    this.members.forEach((m, seat) => {
      this.seatOf.set(m.accountId, seat);
      this.accountOfSeat[seat] = m.accountId;
      this.seatNames[seat] = m.displayName;
      this.seatAvatars[seat] = m.avatar;
    });
    this.phase = "IN_GAME";
    this.dealer = 0;
    this.dealNumber = 1;
    this.teamScores = [0, 0];
    this.newDeal();
    return { ok: true };
  }

  private seed(): number {
    const b = this.out.randomBytes(4);
    return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  }
  private newDeal(): void {
    this.game = initRound(this.dealer, this.seed());
    this.stateVersion++;
  }

  // ---------- game loop ----------
  private seatIsBot(seat: number): boolean {
    return this.members.find((m) => m.accountId === this.accountOfSeat[seat])?.isBot === true;
  }
  isBotTurn(): boolean {
    if (this.phase !== "IN_GAME" || !this.game) return false;
    if (this.game.phase === "DONE" || this.game.phase === "REDEAL") return false;
    const a = currentActor(this.game);
    return a >= 0 && this.seatIsBot(a);
  }
  /** Resolve every consecutive bot turn inline (bounded). Bots therefore NEVER depend on a fragile
   *  timer chain — one stuck move can't freeze the table. Called after every state-changing entry. */
  runBots(): void {
    let guard = 0;
    while (this.isBotTurn() && guard++ < 80) if (!this.botActOnce()) break;
  }
  botActOnce(): boolean {
    if (!this.game) return false;
    const seat = currentActor(this.game);
    if (seat < 0) return false;
    const before = this.stateVersion;
    const a = botAction(this.game, seat);
    if (a) this.applyEngine(a);
    if (this.stateVersion === before) { const fb = this.safeFallback(seat); if (fb) this.applyEngine(fb); } // guarantee progress
    return this.stateVersion !== before;
  }
  /** A guaranteed-legal action for `seat` in the current phase — the anti-stall backstop. */
  private safeFallback(seat: number): EngineAction | null {
    const g = this.game!;
    switch (g.phase) {
      case "BIDDING": return g.bidder === -1 && seat === (g.dealer + 1) % 4 ? { type: "BID", seat, value: MIN_OPEN } : { type: "PASS", seat };
      case "CONCEAL": return { type: "SET_TRUMP", seat, card: g.hands[seat]![0]! };
      case "RAISE": return { type: "DECLINE_RAISE", seat };
      case "PLAY": {
        const info = legalPlay(g, seat);
        if (info.mustReveal) return { type: "REVEAL_TRUMP", seat };
        if (info.play.length > 0) return { type: "PLAY", seat, card: info.play[0]! };
        if (info.canReveal) return { type: "REVEAL_TRUMP", seat };
        return null;
      }
      default: return null;
    }
  }
  /** A human whose deadline elapsed: auto-play them, then let any following bots resolve. */
  onTimeout(): void {
    if (!this.game || this.game.phase === "DONE" || this.game.phase === "REDEAL") return;
    this.botActOnce();
    this.runBots();
  }
  /** Only a HUMAN turn needs a wall-clock deadline — bots resolve inline. */
  nextDeadlineDelay(): number | null {
    if (this.phase !== "IN_GAME" || !this.game) return null;
    if (this.game.phase === "DONE" || this.game.phase === "REDEAL") return null;
    const a = currentActor(this.game);
    if (a < 0 || this.seatIsBot(a)) return null;
    return this.turnTimerMs + this.graceMs;
  }

  handleAction(accountId: string, actionId: string, action: Action28): void {
    if (this.phase !== "IN_GAME") return;
    if (this.applied.has(actionId)) return;
    this.applied.set(actionId, true);

    if (action.type === "HOST_NEXT_DEAL") { if (accountId === this.hostAccountId) this.advanceDeal(); return; }
    if (action.type === "HOST_END_GAME") { if (accountId === this.hostAccountId) { this.phase = "ENDED"; this.endedAt = Date.now(); this.pushViews(); } return; }
    if (action.type === "EMOTE") { this.lastEvents = [{ kind: "EMOTE", seat: this.seatOf.get(accountId) ?? -1, emote: action.payload.emote }]; this.pushViews(); return; }

    const seat = this.seatOf.get(accountId);
    if (seat === undefined || !this.game) return;
    if (currentActor(this.game) !== seat) return; // not your turn (silent — client is optimistic)
    const eng = toEngine(action, seat);
    if (!eng) return;
    this.applyEngine(eng);
  }

  private applyEngine(a: EngineAction): void {
    if (!this.game) return;
    const r = applyAction(this.game, a);
    if (!r.ok) return; // illegal — ignore (validated actor/turn already)
    this.game = r.state;
    this.lastEvents = r.events;
    this.stateVersion++;
    if (this.game.phase === "REDEAL") { this.newDeal(); this.pushViews(); return; } // redeals don't count
    if (this.game.phase === "DONE" && this.game.result) {
      const res = this.game.result;
      this.teamScores[res.bidderTeam] += res.gamePoints; // signed: made +, failed −
    }
    this.pushViews();
  }

  private advanceDeal(): void {
    if (!this.game || this.game.phase !== "DONE") return;
    if (this.dealNumber >= this.N) { this.phase = "ENDED"; this.endedAt = Date.now(); this.pushViews(); return; }
    this.dealNumber++;
    this.dealer = nextSeat(this.dealer);
    this.newDeal();
    this.pushViews();
  }

  // ---------- views ----------
  viewFor(accountId: string): unknown {
    const seat = this.seatOf.get(accountId);
    const base = this.game && seat !== undefined ? playerView(this.game, seat) : null;
    return {
      t: "ViewUpdate",
      stateVersion: this.stateVersion,
      view: {
        game: "28",
        phase: this.phase,
        dealNumber: this.dealNumber,
        totalDeals: this.N,
        dealer: this.dealer,
        teamScores: this.teamScores,
        seatNames: this.seatNames,
        seatAvatars: this.seatAvatars,
        mySeat: seat ?? null,
        hostSeat: this.seatOf.get(this.hostAccountId) ?? null,
        seatConnected: this.accountOfSeat.map((acct) => this.members.find((m) => m.accountId === acct)?.connected ?? false),
        endedAt: this.endedAt,
        turnMs: this.turnTimerMs + this.graceMs, // client countdown budget for the current actor
        round: base,          // the engine's per-seat projection (null in lobby)
        events: this.lastEvents,
      },
    };
  }
  pushViews(): void {
    for (const m of this.members) if (!m.isBot) this.out.send(m.accountId, this.viewFor(m.accountId));
    this.out.persist("snap:latest", this.serialize());
  }
  setConnected(accountId: string, connected: boolean): void {
    const m = this.members.find((x) => x.accountId === accountId);
    if (m) m.connected = connected;
  }

  // ---------- persistence ----------
  serialize(): unknown {
    return {
      phase: this.phase, members: this.members, hostAccountId: this.hostAccountId, inviteCode: this.inviteCode,
      N: this.N, seatOf: [...this.seatOf], accountOfSeat: this.accountOfSeat, seatNames: this.seatNames,
      seatAvatars: this.seatAvatars, game: this.game, dealNumber: this.dealNumber, dealer: this.dealer,
      teamScores: this.teamScores, stateVersion: this.stateVersion, endedAt: this.endedAt,
    };
  }
  static restore(roomId: string, out: Outbound, data: unknown): RoomCore28 {
    const d = data as Record<string, unknown>;
    const core = new RoomCore28(roomId, out);
    Object.assign(core, d, { seatOf: new Map((d.seatOf as [string, number][]) ?? []), applied: new Map() });
    return core;
  }
}

function toEngine(a: Action28, seat: number): EngineAction | null {
  switch (a.type) {
    case "BID": return { type: "BID", seat, value: a.payload.value };
    case "PASS": return { type: "PASS", seat };
    case "DEMAND_REDEAL": return { type: "DEMAND_REDEAL", seat };
    case "SET_TRUMP": return { type: "SET_TRUMP", seat, card: a.payload.card as Card };
    case "RAISE": return { type: "RAISE", seat, value: a.payload.value };
    case "DECLINE_RAISE": return { type: "DECLINE_RAISE", seat };
    case "REVEAL_TRUMP": return { type: "REVEAL_TRUMP", seat };
    case "PLAY": return { type: "PLAY", seat, card: a.payload.card as Card };
    default: return null;
  }
}
