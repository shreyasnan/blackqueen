// RoomCoreTP — transport-agnostic room logic for a Teen Patti table. Isolated from the other games;
// borrows only the shared Member/Outbound types. A "game" is a series of hands played for virtual chips
// until one player holds them all (elimination). The Durable Object is a thin adapter around this class.

import {
  State, Action as EngineAction, initRound, applyAction, playerView, botAction, currentActor,
} from "@teenpatti/engine";
import type { ActionTP } from "@teenpatti/protocol";
import { Member, Outbound, sanitizeAvatar } from "./core.js";

export type RoomPhase = "OPEN" | "IN_GAME" | "ENDED";
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SEATS_MIN = 3;
const SEATS_MAX = 6;

export class RoomCoreTP {
  phase: RoomPhase = "OPEN";
  members: Member[] = [];
  hostAccountId = "";
  inviteCode = "";
  startingChips = 1000;
  boot = 10;
  maxStake = 1280;       // raise cap (a blind-equivalent ceiling); keeps escalation bounded
  turnTimerMs = 30000;
  graceMs = 15000;
  seatOf = new Map<string, number>();
  accountOfSeat: string[] = [];
  seatNames: string[] = [];
  seatAvatars: string[] = [];
  stacks: number[] = [];
  game: State | null = null;
  handNumber = 0;
  dealer = 0;
  winnerSeat: number | null = null;
  stateVersion = 0;
  applied = new Map<string, boolean>();
  endedAt: number | null = null;
  private lastEvents: unknown[] = [];

  constructor(public roomId: string, private out: Outbound) {}

  // ---------- lobby ----------
  create(hostAccountId: string, hostName: string, avatar?: string, opts?: { chips?: number; boot?: number; cap?: number }): void {
    this.hostAccountId = hostAccountId;
    this.members = [{ accountId: hostAccountId, displayName: hostName, avatar: sanitizeAvatar(avatar), connected: true }];
    this.inviteCode = this.newCode();
    if (opts?.chips && opts.chips >= 100 && opts.chips <= 1000000) this.startingChips = Math.round(opts.chips);
    if (opts?.boot && opts.boot >= 1 && opts.boot <= this.startingChips / 5) this.boot = Math.round(opts.boot);
    // cap = max blind-equivalent stake (0 / omitted → generous default of 128× the boot)
    this.maxStake = opts?.cap && opts.cap >= this.boot * 2 ? Math.min(Math.round(opts.cap), this.startingChips) : this.boot * 128;
  }
  private newCode(): string {
    const b = this.out.randomBytes(6);
    return [...b].map((x) => CODE_ALPHABET[x % 32]).join("");
  }
  join(code: string, accountId: string, displayName: string, avatar?: string): { ok: boolean } {
    if (this.phase !== "OPEN" || code !== this.inviteCode) return { ok: false };
    if (this.members.some((m) => m.accountId === accountId)) return { ok: true };
    if (this.members.length >= SEATS_MAX) return { ok: false };
    this.members.push({ accountId, displayName, avatar: sanitizeAvatar(avatar), connected: true });
    return { ok: true };
  }
  leave(accountId: string): void {
    if (this.phase !== "OPEN") return;
    this.members = this.members.filter((m) => m.accountId !== accountId);
    if (accountId === this.hostAccountId && this.members.length > 0) this.hostAccountId = this.members.find((m) => !m.isBot)?.accountId ?? this.members[0]!.accountId;
  }
  addBot(byAccountId: string): { ok: boolean; error?: string } {
    if (this.phase !== "OPEN") return { ok: false, error: "already started" };
    if (byAccountId !== this.hostAccountId) return { ok: false, error: "host only" };
    if (this.members.length >= SEATS_MAX) return { ok: false, error: "table full" };
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
    if (this.members.length < SEATS_MIN || this.members.length > SEATS_MAX) return { ok: false, error: `Teen Patti needs ${SEATS_MIN}–${SEATS_MAX} players (bots count)` };
    this.members.forEach((m, seat) => {
      this.seatOf.set(m.accountId, seat);
      this.accountOfSeat[seat] = m.accountId;
      this.seatNames[seat] = m.displayName;
      this.seatAvatars[seat] = m.avatar;
    });
    this.stacks = this.members.map(() => this.startingChips);
    this.phase = "IN_GAME";
    this.dealer = 0;
    this.handNumber = 1;
    this.newHand();
    return { ok: true };
  }

  private seed(): number {
    const b = this.out.randomBytes(4);
    return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  }
  private nextDealer(): number {
    const n = this.stacks.length;
    let d = (this.dealer + 1) % n;
    for (let i = 0; i < n; i++) { if (this.stacks[d]! > 0) return d; d = (d + 1) % n; }
    return this.dealer;
  }
  private newHand(): void {
    const withChips = this.stacks.filter((c) => c > 0).length;
    if (withChips <= 1) { this.phase = "ENDED"; this.winnerSeat = this.stacks.findIndex((c) => c > 0); this.endedAt = Date.now(); this.stateVersion++; return; }
    this.game = initRound(this.dealer, this.seed(), this.stacks.slice(), this.boot, this.maxStake);
    this.stateVersion++;
  }

  // ---------- game loop ----------
  private seatIsBot(seat: number): boolean {
    return this.members.find((m) => m.accountId === this.accountOfSeat[seat])?.isBot === true;
  }
  isBotTurn(): boolean {
    if (this.phase !== "IN_GAME" || !this.game || this.game.phase === "DONE") return false;
    const a = currentActor(this.game);
    return a >= 0 && this.seatIsBot(a);
  }
  runBots(): void {
    let guard = 0;
    while (this.isBotTurn() && guard++ < 200) if (!this.botActOnce()) break;
  }
  botActOnce(): boolean {
    if (!this.game) return false;
    const seat = currentActor(this.game);
    if (seat < 0) return false;
    const before = this.stateVersion;
    const a = botAction(this.game, seat);
    if (a) this.applyEngine(a);
    if (this.stateVersion === before) { const fb = this.safeFallback(seat); if (fb) this.applyEngine(fb); }
    return this.stateVersion !== before;
  }
  /** A guaranteed-legal action for `seat` — PACK / decline always resolve a turn, so a table can't hang. */
  private safeFallback(seat: number): EngineAction | null {
    const g = this.game!;
    if (g.phase === "SIDESHOW") return { type: "SIDESHOW_RESPONSE", seat, accept: false };
    if (g.phase === "BETTING") return { type: "PACK", seat };
    return null;
  }
  onTimeout(): void {
    if (!this.game || this.game.phase === "DONE") return;
    this.botActOnce(); // auto-fold/decline the dawdler
    this.runBots();
  }
  nextDeadlineDelay(): number | null {
    if (this.phase !== "IN_GAME" || !this.game || this.game.phase === "DONE") return null;
    const a = currentActor(this.game);
    if (a < 0 || this.seatIsBot(a)) return null;
    return this.turnTimerMs + this.graceMs;
  }

  handleAction(accountId: string, actionId: string, action: ActionTP): void {
    if (this.phase !== "IN_GAME") return;
    if (this.applied.has(actionId)) return;
    this.applied.set(actionId, true);

    if (action.type === "HOST_NEXT_HAND") { if (accountId === this.hostAccountId) this.advanceHand(); return; }
    if (action.type === "HOST_END_GAME") { if (accountId === this.hostAccountId) { this.phase = "ENDED"; this.endedAt = Date.now(); this.pushViews(); } return; }
    if (action.type === "EMOTE") { this.lastEvents = [{ kind: "EMOTE", seat: this.seatOf.get(accountId) ?? -1, emote: action.payload.emote }]; this.stateVersion++; this.pushViews(); return; }

    const seat = this.seatOf.get(accountId);
    if (seat === undefined || !this.game) return;
    if (currentActor(this.game) !== seat) return; // not your turn
    const eng = toEngine(action, seat);
    if (!eng) return;
    this.applyEngine(eng);
  }

  private applyEngine(a: EngineAction): void {
    if (!this.game) return;
    const r = applyAction(this.game, a);
    if (!r.ok) return;
    this.game = r.state;
    this.lastEvents = r.events;
    this.stateVersion++;
    if (this.game.phase === "DONE" && this.game.result) {
      const d = this.game.result.deltas;
      this.stacks = this.stacks.map((c, i) => c + (d[i] ?? 0)); // apply chip changes (winner up, others down)
      const withChips = this.stacks.filter((c) => c > 0).length;
      if (withChips <= 1) { this.phase = "ENDED"; this.winnerSeat = this.stacks.findIndex((c) => c > 0); this.endedAt = Date.now(); }
    }
    this.pushViews();
  }

  private advanceHand(): void {
    if (!this.game || this.game.phase !== "DONE" || this.phase !== "IN_GAME") return;
    this.handNumber++;
    this.dealer = this.nextDealer();
    this.newHand();
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
        game: "tp",
        phase: this.phase,
        handNumber: this.handNumber,
        dealer: this.dealer,
        seatNames: this.seatNames,
        seatAvatars: this.seatAvatars,
        stacks: this.stacks,
        startingChips: this.startingChips,
        boot: this.boot,
        mySeat: seat ?? null,
        hostSeat: this.seatOf.get(this.hostAccountId) ?? null,
        seatConnected: this.accountOfSeat.map((acct) => this.members.find((m) => m.accountId === acct)?.connected ?? false),
        winnerSeat: this.winnerSeat,
        endedAt: this.endedAt,
        turnMs: this.turnTimerMs + this.graceMs,
        round: base,
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
      startingChips: this.startingChips, boot: this.boot, maxStake: this.maxStake, seatOf: [...this.seatOf], accountOfSeat: this.accountOfSeat,
      seatNames: this.seatNames, seatAvatars: this.seatAvatars, stacks: this.stacks, game: this.game,
      handNumber: this.handNumber, dealer: this.dealer, winnerSeat: this.winnerSeat, stateVersion: this.stateVersion, endedAt: this.endedAt,
    };
  }
  static restore(roomId: string, out: Outbound, data: unknown): RoomCoreTP {
    const d = data as Record<string, unknown>;
    const core = new RoomCoreTP(roomId, out);
    Object.assign(core, d, { seatOf: new Map((d.seatOf as [string, number][]) ?? []), applied: new Map() });
    return core;
  }
}

function toEngine(a: ActionTP, seat: number): EngineAction | null {
  switch (a.type) {
    case "SEE": return { type: "SEE", seat };
    case "BET": return { type: "BET", seat, amount: a.payload.amount };
    case "PACK": return { type: "PACK", seat };
    case "SHOW": return { type: "SHOW", seat };
    case "SIDESHOW": return { type: "SIDESHOW", seat };
    case "SIDESHOW_RESPONSE": return { type: "SIDESHOW_RESPONSE", seat, accept: a.payload.accept };
    default: return null;
  }
}
