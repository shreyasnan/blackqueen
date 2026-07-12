// RoomCore — transport-agnostic room logic: lobby lifecycle (PLATFORM_SPEC §3–§4),
// apply loop + versioning + idempotency (ARCHITECTURE §1–§3), emission rules
// (MESSAGE_PROTOCOL §3–§5). The Durable Object is a thin adapter around this class.

import {
  initGame, applyAction, playerView, GameState, Action, Event as EngineEvent, Suit, Card,
  autoPlayCard, canonicalDeck, cardEq, SUITS, calledCardCount, rankIndex, minHandSize, maxHandSize,
} from "@blackqueen/engine";

export type RoomPhase = "OPEN" | "IN_GAME" | "ENDED";

export interface Member {
  accountId: string;
  displayName: string; // per-game nickname, snapshotted at seat claim (§3.4)
  avatar: string; // chosen face from AVATAR_FACES (validated), snapshotted like the name
  connected: boolean;
  isBot?: boolean; // practice bots: server-driven seats, no socket, no account
}

/** The face roster — ids rendered by the client's bust-avatar SVG component.
 *  Server-validated so views only ever carry known faces. Legacy flat-face ids stay valid. */
export const AVATAR_FACES = [
  "classic", "scout", "aviator", "sunny", "dj", "captain", "bun", "spike", "curls",
  "ninja", "saint", "dreamer", "gasp", "cheeky", "scholar", "racer", "frost", "rebel",
  // legacy ids (older saved profiles) — client maps them to bust equivalents
  "smile", "grin", "wink", "cool", "beanie", "fringe", "wow", "sleepy", "grr", "tongue", "mask", "halo",
];
const DEFAULT_FACE = "classic";
const BOT_FACE = "bot";
export const sanitizeAvatar = (a: unknown): string => (typeof a === "string" && AVATAR_FACES.includes(a) ? a : DEFAULT_FACE);

export interface RoomConfig {
  N: number;
  seatAssignment: "random" | "host-arranged";
  turnTimerMs: number;
  graceMs: number;
  deckCount: number; // 1 | 2 (GAME_SPEC §16); 2 only for 6–7 players
  calledCount?: number; // 2-deck only: creator-selected C (1–3, default 2)
  handSize?: number; // v2.1 (§3.2/§16): cards per player; clamped at start to the legal range for the actual player count
}

export interface Outbound {
  /** Deliver a message to one account (all its live sockets). */
  send(accountId: string, msg: unknown): void;
  /** Cryptographically strong bytes (DO: crypto.getRandomValues). */
  randomBytes(n: number): Uint8Array;
  /** Persist a snapshot (DO: ctx.storage). */
  persist(key: string, value: unknown): void;
  /** Append an audit record (DO: R2). */
  audit(record: Record<string, unknown>): void;
}

export type CoreAction =
  | { type: "EMOTE"; payload: { emote: string } }
  | { type: "HOST_NEXT_ROUND"; payload: Record<string, never> }
  | { type: "BID"; payload: { value: number } }
  | { type: "PASS"; payload: Record<string, never> }
  | { type: "CHOOSE_TRUMP"; payload: { suit: Suit } }
  | { type: "CALL_CARDS"; payload: { cards: Card[] } }
  | { type: "PLAY_CARD"; payload: { card: Card } }
  | { type: "HOST_END_GAME"; payload: Record<string, never> }
  | { type: "HOST_RESTART_ROUND"; payload: Record<string, never> }
  | { type: "HOST_RESOLVE_PAUSE"; payload: { action: "resume" | "end" } };

const MAX_MEMBERS = 7;
const MIN_MEMBERS = 4;
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford, no I L O U (§3.3)

export class RoomCore {
  phase: RoomPhase = "OPEN";
  members: Member[] = [];
  hostAccountId = "";
  inviteCode = "";
  config: RoomConfig = { N: 8, seatAssignment: "random", turnTimerMs: 30000, graceMs: 15000, deckCount: 1 };
  seatOf = new Map<string, number>(); // accountId -> seat (immutable once IN_GAME, §3.4)
  accountOfSeat: string[] = [];
  seatNames: string[] = [];
  seatAvatars: string[] = [];
  game: GameState | null = null;
  stateVersion = 0;
  seq = 0;
  appliedActionIds = new Map<string, { reject?: string }>(); // idempotency (ARCH §3)
  wasConnectedThisRound: boolean[] = [];
  endedAt: number | null = null;
  lastEmoteAt = new Map<string, number>();

  constructor(public roomId: string, private out: Outbound) {}

  // ---------- lobby ----------
  create(hostAccountId: string, hostName: string, config: Partial<RoomConfig>, avatar?: string): void {
    this.hostAccountId = hostAccountId;
    this.members = [{ accountId: hostAccountId, displayName: hostName, avatar: sanitizeAvatar(avatar), connected: true }];
    this.config = { ...this.config, ...config };
    this.regenCode();
  }

  regenCode(): string {
    const bytes = this.out.randomBytes(6);
    this.inviteCode = [...bytes].map((b) => CODE_ALPHABET[b % 32]).join("");
    return this.inviteCode;
  }

  join(code: string, accountId: string, displayName: string, avatar?: string): { ok: boolean } {
    // Uniform failure — never distinguish wrong/expired/full/in-game (§3.3)
    if (this.phase !== "OPEN" || code !== this.inviteCode) return { ok: false };
    if (this.members.some((m) => m.accountId === accountId)) return { ok: true };
    if (this.members.length >= MAX_MEMBERS) return { ok: false };
    this.members.push({ accountId, displayName, avatar: sanitizeAvatar(avatar), connected: true });
    return { ok: true };
  }

  leave(accountId: string): void {
    if (this.phase !== "OPEN") return; // mid-game leave = disconnect, handled by engine timers
    this.members = this.members.filter((m) => m.accountId !== accountId);
    if (accountId === this.hostAccountId && this.members.length > 0) {
      this.hostAccountId = this.members[0]!.accountId; // pre-game migration (§3.2)
    }
  }

  // ---------- practice bots ----------
  private static BOT_NAMES = ["Botrick 🤖", "Robotta 🤖", "Beep 🤖", "Chip 🤖", "Servo 🤖", "Gizmo 🤖"];

  addBot(byAccountId: string): { ok: boolean; error?: string } {
    if (this.phase !== "OPEN" || byAccountId !== this.hostAccountId) return { ok: false, error: "not host / not open" };
    if (this.members.length >= MAX_MEMBERS) return { ok: false, error: "table full" };
    const n = this.members.filter((m) => m.isBot).length;
    this.members.push({
      accountId: `bot_${n + 1}_${this.roomId.slice(0, 6)}`,
      displayName: RoomCore.BOT_NAMES[n % RoomCore.BOT_NAMES.length]!,
      avatar: BOT_FACE,
      connected: true,
      isBot: true,
    });
    return { ok: true };
  }

  removeBot(byAccountId: string): { ok: boolean } {
    if (this.phase !== "OPEN" || byAccountId !== this.hostAccountId) return { ok: false };
    const last = [...this.members].reverse().find((m) => m.isBot);
    if (!last) return { ok: false };
    this.members = this.members.filter((m) => m.accountId !== last.accountId);
    return { ok: true };
  }

  private isBotSeat(seat: number): boolean {
    const acct = this.accountOfSeat[seat];
    return this.members.find((m) => m.accountId === acct)?.isBot === true;
  }

  /** Simple, legal, deterministic bot policy. Uses only the bot's own seat data. */
  private botDecide(seat: number): Action {
    const g = this.game!;
    const r = g.round!;
    const hand = r.hands[seat]!;
    switch (g.phase) {
      case "BIDDING":
        return { type: "PASS", seat }; // bots never bid; the auction stays a human affair
      case "TRUMP_SELECTION": {
        // longest suit in hand
        const best = SUITS.reduce((a, b) =>
          hand.filter((c) => c.suit === a).length >= hand.filter((c) => c.suit === b).length ? a : b);
        return { type: "CHOOSE_TRUMP", seat, suit: best };
      }
      case "CALLING_PARTNERS": {
        // classic: call the highest in-play cards of the trump suit not held; extend to other suits if needed
        const trump = r.stagedTrump!;
        const C = g.calledCount;
        // DISTINCT identities only — 2-deck canonicalDeck lists both copies consecutively, and
        // CALL_CARDS rejects duplicate identities. Calling A♠ twice wedged the bot in an
        // 800ms reject-retry loop ("bot gets stuck"): dedupe BEFORE slicing.
        const seen = new Set<string>();
        const inPlay = canonicalDeck(g.playerCount, g.deckCount, g.handSize).filter((c) => {
          const k = `${c.rank}${c.suit}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const notHeld = (c: Card) => !hand.some((h) => cardEq(h, c));
        const bySuit = (s: Suit) => inPlay.filter((c) => c.suit === s && notHeld(c)).sort((a, b) => rankIndex(b.rank) - rankIndex(a.rank));
        // 2-deck: "not held" is no longer required (the other copy is claimable) — but preferring
        // unheld cards keeps the classic feel; fall back to held identities if the pool runs short.
        const pool = [...bySuit(trump), ...SUITS.filter((s) => s !== trump).flatMap(bySuit)];
        if (pool.length < C) {
          const held = inPlay.filter((c) => !pool.some((p) => cardEq(p, c)));
          pool.push(...held);
        }
        return { type: "CALL_CARDS", seat, cards: pool.slice(0, C) };
      }
      case "TRICK_PLAY": {
        const led = r.currentTrick.length === 0 ? null : r.currentTrick[0]!.card.suit;
        return { type: "PLAY_CARD", seat, card: autoPlayCard(hand, led) };
      }
      default:
        throw new Error(`bot asked to act in ${g.phase}`);
    }
  }

  /** Whose turn is it, in the phases where someone is on turn? */
  private awaitedSeat(): number | null {
    const g = this.game;
    if (this.phase !== "IN_GAME" || !g) return null;
    if (g.phase === "BIDDING" || g.phase === "TRICK_PLAY") return g.round?.turnSeat ?? null;
    if (g.phase === "TRUMP_SELECTION" || g.phase === "CALLING_PARTNERS") return g.round?.declarerSeat ?? null;
    return null;
  }

  /** True when the room is waiting on a bot seat. The SHELL owns pacing (one act per tick). */
  isBotTurn(): boolean {
    const seat = this.awaitedSeat();
    return seat !== null && this.isBotSeat(seat);
  }

  /** Apply exactly ONE bot action. Returns whether a bot acted. Pacing lives in the DO (alarms),
   *  so every client sees bots "think" for a beat instead of the whole table resolving instantly. */
  botActOnce(): boolean {
    const seat = this.awaitedSeat();
    if (seat === null || !this.isBotSeat(seat) || !this.game) return false;
    let res = applyAction(this.game, this.botDecide(seat));
    if (!res.ok) {
      // Defensive (v2.2): a rejected bot decision must NEVER wedge the room in a reject-retry
      // loop. Fall back to the normative timeout default (auto-pass / auto-play / PAUSED),
      // which is always legal, and record the anomaly for post-game audit.
      this.out.audit({ roomId: this.roomId, anomaly: "bot_decision_rejected", seat, phase: this.game.phase });
      res = applyAction(this.game, { type: "TIMEOUT" });
      if (!res.ok) return false;
    }
    this.game = res.state;
    if (res.versionBump) this.afterAccepted(res.events);
    else this.persistSnapshot(); // bot's staged CHOOSE_TRUMP: silent, snapshotted (§9.2)
    this.maybeAdvanceOrEnd();
    return true;
  }

  /** Test/synchronous helper: drain all pending bot turns at once. */
  botTurnLoop(): void {
    let guard = 0;
    while (guard++ < 800 && this.botActOnce()) { /* drain */ }
  }

  kick(byAccountId: string, target: string): boolean {
    if (this.phase !== "OPEN" || byAccountId !== this.hostAccountId || target === this.hostAccountId) return false;
    this.leave(target);
    return true;
  }

  startGame(byAccountId: string, hostOrder?: string[]): { ok: boolean; error?: string } {
    if (this.phase !== "OPEN" || byAccountId !== this.hostAccountId) return { ok: false, error: "not host / not open" };
    const n = this.members.length;
    if (n < MIN_MEMBERS || n > MAX_MEMBERS) return { ok: false, error: "need 4-7 players" };
    if (!Number.isInteger(this.config.N) || this.config.N < 1 || this.config.N > 10 * n) return { ok: false, error: "N out of bounds" };
    if (this.config.turnTimerMs + this.config.graceMs < 10000) return { ok: false, error: "timer too small" };
    if (this.config.deckCount !== 1 && this.config.deckCount !== 2) return { ok: false, error: "deckCount must be 1 or 2" };
    if (this.config.deckCount === 2 && n < 6) return { ok: false, error: "2-deck games need 6-7 players" };
    if (this.config.deckCount === 2 && this.config.calledCount !== undefined &&
        (!Number.isInteger(this.config.calledCount) || this.config.calledCount < 1 || this.config.calledCount > 3)) {
      return { ok: false, error: "calledCount must be 1-3" };
    }
    // v2.1 hand size: creator picks before the table fills, so CLAMP to the legal
    // range for the actual player count rather than reject (§3.2; lobby shows the effective value).
    let handSize: number | undefined = this.config.handSize;
    if (handSize !== undefined) {
      if (!Number.isInteger(handSize)) return { ok: false, error: "handSize must be an integer" };
      handSize = Math.max(minHandSize(n, this.config.deckCount), Math.min(maxHandSize(n, this.config.deckCount), handSize));
    }

    // Seat assignment (§3.4 / GAME_SPEC §2): random CSPRNG permutation or host-arranged
    let order: string[];
    if (this.config.seatAssignment === "host-arranged" && hostOrder) {
      const ids = new Set(this.members.map((m) => m.accountId));
      if (hostOrder.length !== n || !hostOrder.every((id) => ids.has(id))) return { ok: false, error: "bad seat order" };
      order = hostOrder;
    } else {
      order = this.members.map((m) => m.accountId);
      for (let i = order.length - 1; i >= 1; i--) {
        const j = this.uniform(i);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
    }
    this.accountOfSeat = order;
    this.seatNames = order.map((id) => this.members.find((m) => m.accountId === id)!.displayName);
    this.seatAvatars = order.map((id) => this.members.find((m) => m.accountId === id)!.avatar);
    order.forEach((id, seat) => this.seatOf.set(id, seat));

    const round1Seat = this.uniform(n - 1); // round1DefaultDeclarerSelection: random (§16)
    this.game = initGame(n, this.config.N, round1Seat, this.config.deckCount, this.config.calledCount, handSize);
    this.phase = "IN_GAME";
    this.wasConnectedThisRound = Array(n).fill(true);
    this.broadcastEvent("SEATING", { seats: this.seatNames, avatars: this.seatAvatars, hostSeat: this.seatOf.get(this.hostAccountId) });
    const res = applyAction(this.game, { type: "START_ROUND", seed: this.out.randomBytes(32), abandonedSeats: [] });
    if (!res.ok) return { ok: false, error: "engine start failed" };
    this.game = res.state;
    this.out.audit({ roomId: this.roomId, roundNumber: 1, playerCount: n, defaultDeclarerSeat: this.game.round!.defaultDeclarerSeat });
    this.afterAccepted(res.events);
    // NOTE: bots do NOT act synchronously here — the DO paces them via alarms (one act per beat)
    return { ok: true };
  }

  private uniform(maxInclusive: number): number {
    // rejection sampling over CSPRNG bytes (ARCH §5 style)
    const n = maxInclusive + 1;
    for (;;) {
      const b = this.out.randomBytes(4);
      const v = ((b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0);
      const bound = Math.floor(2 ** 32 / n) * n;
      if (v < bound) return v % n;
    }
  }

  // ---------- game actions (WS) ----------
  handleAction(accountId: string, actionId: string, stateVersion: number, action: CoreAction): void {
    const rejectPrivate = (reason: string) => {
      this.appliedActionIds.set(actionId, { reject: reason });
      this.out.send(accountId, { t: "Reject", roomId: this.roomId, actionId, reason, currentStateVersion: this.stateVersion });
    };
    // Idempotency (ARCH §3): repeat actionId re-returns original outcome, never re-applies
    const prior = this.appliedActionIds.get(actionId);
    if (prior) {
      if (prior.reject) this.out.send(accountId, { t: "Reject", roomId: this.roomId, actionId, reason: prior.reject, currentStateVersion: this.stateVersion });
      else this.out.send(accountId, { t: "Ack", roomId: this.roomId, actionId });
      return;
    }
    if (this.phase !== "IN_GAME" || !this.game) return rejectPrivate("ILLEGAL");
    const seat = this.seatOf.get(accountId);
    if (seat === undefined) return rejectPrivate("ILLEGAL");
    // Emotes: not order-sensitive (no stale guard, no version bump); rate-limited 1/10s (UI_SPEC §8)
    if (action.type === "EMOTE") {
      const last = this.lastEmoteAt.get(accountId) ?? 0;
      const now = Date.now();
      if (now - last < 10_000) return rejectPrivate("RATE_LIMITED");
      this.lastEmoteAt.set(accountId, now);
      this.appliedActionIds.set(actionId, {});
      this.broadcastEvent("EMOTE", { seat, emote: action.payload.emote });
      this.out.send(accountId, { t: "Ack", roomId: this.roomId, actionId });
      return;
    }
    // Stale guard (ARCH §2)
    if (stateVersion !== this.stateVersion) return rejectPrivate("STALE_VERSION");
    // Host-only actions
    if (action.type.startsWith("HOST_") && accountId !== this.currentHostAccountId()) return rejectPrivate("ILLEGAL");

    // Explicit next-round start (host): handled shell-side, not an engine action
    if (action.type === "HOST_NEXT_ROUND") {
      if (!this.startNextRound()) return rejectPrivate("ILLEGAL");
      this.appliedActionIds.set(actionId, {});
      return;
    }

    const engineAction = this.toEngineAction(seat, action);
    const res = applyAction(this.game, engineAction);
    if (!res.ok) return rejectPrivate(res.reject);

    this.appliedActionIds.set(actionId, {});
    this.game = res.state;
    if (res.versionBump) {
      this.afterAccepted(res.events);
    } else {
      // Staged CHOOSE_TRUMP (§9.2): no version bump, no emission — private ack only
      this.out.send(accountId, { t: "Ack", roomId: this.roomId, actionId });
      this.persistSnapshot(); // staged value IS snapshotted (ARCH §2/§8)
    }
    this.maybeAdvanceOrEnd();
  }

  /** Host migration (ARCH §8a): lowest connected seat, excluding the awaited actor. */
  currentHostAccountId(): string {
    const host = this.members.find((m) => m.accountId === this.hostAccountId);
    if (host?.connected || this.phase !== "IN_GAME" || !this.game) return this.hostAccountId;
    if (this.game.phase !== "PAUSED" && this.game.phase !== "ABORTED") return this.hostAccountId;
    const awaited = this.game.round?.declarerSeat ?? -1;
    for (let seat = 0; seat < this.accountOfSeat.length; seat++) {
      if (seat === awaited) continue;
      const acct = this.accountOfSeat[seat]!;
      if (this.members.find((m) => m.accountId === acct)?.connected) return acct;
    }
    return this.hostAccountId; // nobody eligible: frozen
  }

  onTimeout(): void {
    if (this.phase !== "IN_GAME" || !this.game) return;
    if (this.game.phase === "ROUND_END") { // fallback: AFK host can't stall the table between rounds
      this.startNextRound();
      return;
    }
    const res = applyAction(this.game, { type: "TIMEOUT" });
    if (!res.ok) return;
    this.game = res.state;
    this.afterAccepted(res.events);
    this.maybeAdvanceOrEnd();
  }

  private toEngineAction(seat: number, a: CoreAction): Action {
    switch (a.type) {
      case "EMOTE": throw new Error("emotes are handled before the engine"); // unreachable
      case "HOST_NEXT_ROUND": throw new Error("next-round is handled before the engine"); // unreachable
      case "BID": return { type: "BID", seat, value: a.payload.value };
      case "PASS": return { type: "PASS", seat };
      case "CHOOSE_TRUMP": return { type: "CHOOSE_TRUMP", seat, suit: a.payload.suit };
      case "CALL_CARDS": return { type: "CALL_CARDS", seat, cards: a.payload.cards };
      case "PLAY_CARD": return { type: "PLAY_CARD", seat, card: a.payload.card };
      case "HOST_END_GAME": return { type: "HOST_END_GAME" };
      case "HOST_RESTART_ROUND": return { type: "HOST_RESTART_ROUND", seed: this.out.randomBytes(32) };
      case "HOST_RESOLVE_PAUSE": return { type: "HOST_RESOLVE_PAUSE", resolution: a.payload.action };
    }
  }

  private afterAccepted(events: EngineEvent[]): void {
    this.stateVersion++;
    for (const e of events) {
      this.seq++;
      this.broadcastRaw({ t: "Event", roomId: this.roomId, stateVersion: this.stateVersion, seq: this.seq, kind: e.kind, data: e });
    }
    this.pushViews();
    this.persistSnapshot();
  }

  private broadcastEvent(kind: string, data: unknown): void {
    this.seq++;
    this.broadcastRaw({ t: "Event", roomId: this.roomId, stateVersion: this.stateVersion, seq: this.seq, kind, data });
  }

  private broadcastRaw(msg: unknown): void {
    for (const m of this.members) this.out.send(m.accountId, msg);
  }

  pushViews(): void {
    if (!this.game) return;
    for (const [accountId] of this.seatOf) {
      const v = this.viewFor(accountId);
      if (v) this.out.send(accountId, v);
    }
  }

  viewFor(accountId: string): unknown {
    const seat = this.seatOf.get(accountId);
    if (seat === undefined || !this.game) return null;
    // §14.2: playerView is the ONLY gameplay payload; seatNames/hostSeat are public platform facts.
    const view = {
      ...playerView(this.game, seat),
      seatNames: this.seatNames,
      seatAvatars: this.seatAvatars, // chosen faces — public platform facts like names
      hostSeat: this.seatOf.get(this.currentHostAccountId()) ?? null,
      turnBudgetMs: this.config.turnTimerMs + this.config.graceMs, // public config — lets clients render an honest timer ring
      // §9.2: staged trump is hidden from OTHERS; the declarer's own view may carry it —
      // without this, a declarer who reconnects mid-setup sees a stuck trump chooser.
      stagedTrumpOwn: this.game.round && seat === this.game.round.declarerSeat ? this.game.round.stagedTrump : null,
      // connection status is a public table fact (who's "away") + the fast-forward budget for honest rings
      seatConnected: this.accountOfSeat.map((acct) => this.members.find((m) => m.accountId === acct)?.connected ?? false),
      awayBudgetMs: RoomCore.AWAY_BUDGET_MS,
      setupBudgetMs: this.config.turnTimerMs + this.config.graceMs + RoomCore.SETUP_EXTRA_MS, // v2.2: honest ring during DECLARER_SETUP
    };
    return { t: "ViewUpdate", roomId: this.roomId, stateVersion: this.stateVersion, phase: view.phase, view };
  }

  private maybeAdvanceOrEnd(): void {
    if (!this.game) return;
    // ROUND_END no longer auto-advances: the host explicitly starts the next round (HOST_NEXT_ROUND),
    // with a shell-timed fallback (onTimeout) so an AFK host cannot hold the table hostage.
    if (this.game.phase === "GAME_END" && this.phase === "IN_GAME") {
      this.phase = "ENDED";
      this.endedAt = Date.now();
    }
  }

  /** Start the next round (host action or timeout fallback). Returns false if not startable. */
  startNextRound(): boolean {
    if (this.phase !== "IN_GAME" || !this.game) return false;
    if (this.game.phase !== "ROUND_END" || this.game.roundNumber >= this.game.N) return false;
    const abandoned = this.wasConnectedThisRound.map((c, i) => (!c ? i : -1)).filter((i) => i >= 0); // §7 v1.9
    const res = applyAction(this.game, { type: "START_ROUND", seed: this.out.randomBytes(32), abandonedSeats: abandoned });
    if (!res.ok) return false;
    this.game = res.state;
    this.out.audit({
      roomId: this.roomId,
      roundNumber: this.game.roundNumber,
      playerCount: this.game.playerCount,
      defaultDeclarerSeat: this.game.round!.defaultDeclarerSeat,
    });
    this.accountOfSeat.forEach((acct, seat) => {
      this.wasConnectedThisRound[seat] = this.members.find((m) => m.accountId === acct)?.connected ?? false;
    });
    this.afterAccepted(res.events);
    return true;
  }

  setConnected(accountId: string, connected: boolean): void {
    const m = this.members.find((x) => x.accountId === accountId);
    if (m) m.connected = connected;
    const seat = this.seatOf.get(accountId);
    if (connected && seat !== undefined && seat < this.wasConnectedThisRound.length) {
      this.wasConnectedThisRound[seat] = true;
    }
  }

  static AWAY_BUDGET_MS = 12_000; // fast-forward for visibly-disconnected actors (playtest: 45s × every turn = agony)
  static SETUP_EXTRA_MS = 45_000; // v2.2: extra declarer-setup runway before the table PAUSEs (playtest G3)

  /** Is the awaited actor a disconnected human? (Bots are always "connected".) */
  private awaitedActorAway(): boolean {
    const seat = this.awaitedSeat();
    if (seat === null) return false;
    const m = this.members.find((x) => x.accountId === this.accountOfSeat[seat]);
    return m !== undefined && !m.isBot && !m.connected;
  }

  /** ms until the current turn's deadline, or null when no timer runs (PAUSED/ENDED/lobby). */
  nextDeadlineDelay(): number | null {
    if (this.phase !== "IN_GAME" || !this.game) return null;
    const p = this.game.phase;
    if (p === "PAUSED" || p === "ABORTED" || p === "GAME_END") return null;
    if (p === "ROUND_END") return this.game.roundNumber < this.game.N ? this.config.turnTimerMs + this.config.graceMs : null; // host next-round window
    // Away fast-forward (ARCH §6 amendment): a disconnected actor's turns resolve in 12s, not 45s —
    // the table shouldn't crawl because someone closed a tab. Reconnecting restores the full budget.
    if (this.awaitedActorAway()) return Math.min(RoomCore.AWAY_BUDGET_MS, this.config.turnTimerMs + this.config.graceMs);
    // v2.2 (playtest G3): declarer setup is a bigger decision than a normal turn — trump + a
    // partner-card grid (52 identities in 2-deck games). Give it extra runway before PAUSED.
    if (p === "TRUMP_SELECTION" || p === "CALLING_PARTNERS") {
      return this.config.turnTimerMs + this.config.graceMs + RoomCore.SETUP_EXTRA_MS;
    }
    return this.config.turnTimerMs + this.config.graceMs; // single combined budget (ARCH §6)
  }

  private persistSnapshot(): void {
    this.out.persist(`snap:${this.stateVersion}`, this.serialize());
    this.out.persist("snap:latest", this.serialize()); // staged-trump supersede rule (ARCH §8)
  }

  serialize(): unknown {
    return {
      roomId: this.roomId, phase: this.phase, members: this.members, hostAccountId: this.hostAccountId,
      inviteCode: this.inviteCode, config: this.config, accountOfSeat: this.accountOfSeat, seatNames: this.seatNames, seatAvatars: this.seatAvatars,
      game: this.game ? serializeGame(this.game) : null,
      stateVersion: this.stateVersion, seq: this.seq, wasConnectedThisRound: this.wasConnectedThisRound, endedAt: this.endedAt,
    };
  }

  static restore(roomId: string, out: Outbound, data: ReturnType<RoomCore["serialize"]>): RoomCore {
    const d = data as Record<string, unknown> & { members: Member[]; accountOfSeat: string[] };
    const core = new RoomCore(roomId, out);
    Object.assign(core, {
      ...d,
      game: d.game ? deserializeGame(d.game as Record<string, unknown>) : null,
      seatOf: new Map(d.accountOfSeat.map((acct: string, seat: number) => [acct, seat])),
      appliedActionIds: new Map(),
    });
    return core;
  }
}

// Uint8Array-safe (de)serialization for GameState (seeds never stored in state; hands are plain)
function serializeGame(g: GameState): unknown { return JSON.parse(JSON.stringify(g)); }
function deserializeGame(o: Record<string, unknown>): GameState { return o as unknown as GameState; }
