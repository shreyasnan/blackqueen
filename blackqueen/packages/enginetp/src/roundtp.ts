// Teen Patti hand — a pure betting state machine. One reducer: applyAction(state, action) -> {state, events}.
// Phases: BETTING -> (SIDESHOW sub-decision) -> DONE. Classic rules: boot ante, blind vs seen (chaal),
// raise, pack, show at two players, and sideshow (private compare with the previous seen player).
// Chips are per-seat within the hand; the room turns the DONE result into stack changes + elimination.

import {
  Card, HandRank, evaluate, compareHands, nextSeat, cardEq,
} from "./cardstp.js";
import { deal } from "./dealtp.js";

export type Phase = "BETTING" | "SIDESHOW" | "DONE";

export interface Player {
  active: boolean;   // dealt into this hand
  packed: boolean;   // folded
  seen: boolean;     // has looked at their cards (blind until then)
  allIn: boolean;    // has committed their whole stack
  cards: Card[];     // 3 cards
  bet: number;       // chips committed this hand
  stack: number;     // chips at the START of the hand (bet is drawn from this)
}

export interface Reveal { seat: number; cards: Card[]; rank: HandRank }
export interface Result {
  winner: number;
  pot: number;
  byFold: boolean;                 // won because everyone else packed (no showdown)
  tie: boolean;
  winners: number[];               // one, or several on a split
  reveal: Reveal[] | null;         // shown hands (null on a fold win)
  deltas: number[];                // per-seat chip change (sum = 0)
}

export interface State {
  phase: Phase;
  dealer: number;
  players: Player[];
  pot: number;
  stake: number;                   // the blind unit; seen players pay double
  boot: number;
  maxStake: number;                // raise cap (keeps escalation bounded)
  turn: number;                    // seat to act during BETTING
  sideshow: { requester: number; target: number } | null;
  result: Result | null;
}

export type Action =
  | { type: "SEE"; seat: number }
  | { type: "BET"; seat: number; amount: number }
  | { type: "PACK"; seat: number }
  | { type: "SHOW"; seat: number }
  | { type: "SIDESHOW"; seat: number }
  | { type: "SIDESHOW_RESPONSE"; seat: number; accept: boolean };

export interface Event { kind: string; [k: string]: unknown }
export type ApplyResult = { ok: true; state: State; events: Event[] } | { ok: false; error: string };

const clone = (s: State): State => JSON.parse(JSON.stringify(s));
const N = (s: State) => s.players.length;
const live = (s: State, seat: number) => s.players[seat]!.active && !s.players[seat]!.packed;
const liveSeats = (s: State) => s.players.map((_, i) => i).filter((i) => live(s, i));
const countLive = (s: State) => liveSeats(s).length;

/** Next live seat after `from` (wraps). */
function nextLive(s: State, from: number): number {
  let n = nextSeat(from, N(s));
  for (let i = 0; i < N(s); i++) { if (live(s, n)) return n; n = nextSeat(n, N(s)); }
  return from;
}
/** Previous live seat before `from`. */
function prevLive(s: State, from: number): number {
  let n = (from - 1 + N(s)) % N(s);
  for (let i = 0; i < N(s); i++) { if (live(s, n) && n !== from) return n; n = (n - 1 + N(s)) % N(s); }
  return from;
}
/** Next seat eligible to ACT (live and not all-in) — all-in players stay in the hand but never act. */
function nextEligible(s: State, from: number): number {
  let n = nextSeat(from, N(s));
  for (let i = 0; i < N(s); i++) { if (live(s, n) && !s.players[n]!.allIn) return n; n = nextSeat(n, N(s)); }
  return -1;
}
const remaining = (p: Player) => p.stack - p.bet;

export function currentActor(s: State): number {
  if (s.phase === "SIDESHOW") return s.sideshow!.target;
  if (s.phase === "BETTING") return s.turn;
  return -1;
}

/** The legal betting amounts for a seat right now (call, optional raise, optional all-in). */
export function legalBets(s: State, seat: number): number[] {
  const p = s.players[seat]!;
  const rem = remaining(p);
  if (rem <= 0) return [];
  const call = p.seen ? 2 * s.stake : s.stake;
  const raise = p.seen ? Math.min(4 * s.stake, 2 * s.maxStake) : Math.min(2 * s.stake, s.maxStake);
  const out = new Set<number>();
  if (rem < call) { out.add(rem); return [...out]; } // can only go all-in
  out.add(call);
  if (raise > call && rem >= raise) out.add(raise);
  if (rem > call && rem < raise) out.add(rem);        // all-in between call and a full raise
  return [...out].sort((a, b) => a - b);
}

/** What `seat` may do right now during play (used by the view + bots). */
export function legalActions(s: State, seat: number): {
  canSee: boolean; bets: number[]; canPack: boolean; canShow: boolean; showCost: number; canSideshow: boolean;
} {
  if (s.phase !== "BETTING" || s.turn !== seat || !live(s, seat) || s.players[seat]!.allIn) {
    return { canSee: false, bets: [], canPack: false, canShow: false, showCost: 0, canSideshow: false };
  }
  const p = s.players[seat]!;
  const two = countLive(s) === 2;
  const showCost = Math.min(p.seen ? 2 * s.stake : s.stake, remaining(p));
  const prev = prevLive(s, seat);
  return {
    canSee: !p.seen,
    bets: legalBets(s, seat),
    canPack: true,
    canShow: two,
    showCost,
    canSideshow: !two && countLive(s) >= 3 && p.seen && s.players[prev]!.seen && remaining(p) > 0,
  };
}

function fail(error: string): ApplyResult { return { ok: false, error }; }

export function initRound(dealer: number, seed: number, stacks: number[], boot: number, maxStake?: number): State {
  const participants = stacks.map((c) => c > 0);
  const d = deal(dealer, seed, participants);
  const players: Player[] = stacks.map((stack, seat) => ({
    active: participants[seat]!, packed: false, seen: false, allIn: false,
    cards: d.hands[seat]!, bet: 0, stack,
  }));
  const s: State = {
    phase: "BETTING", dealer, players, pot: 0, stake: boot, boot,
    maxStake: maxStake ?? boot * 128, turn: d.firstReceiver, sideshow: null, result: null,
  };
  // post the boot ante from every participant (all-in if they somehow hold less)
  for (const p of players) if (p.active) { const post = Math.min(boot, p.stack); p.bet = post; s.pot += post; if (post >= p.stack) p.allIn = true; }
  s.turn = firstEligibleOrResolve(s, d.firstReceiver);
  return s;
}

function firstEligibleOrResolve(s: State, from: number): number {
  if (countLive(s) <= 1) return -1;
  if (live(s, from) && !s.players[from]!.allIn) return from;
  const e = nextEligible(s, from);
  return e;
}

export function applyAction(prev: State, action: Action): ApplyResult {
  const s = clone(prev);
  const ev: Event[] = [];
  const seat = action.seat;

  if (s.phase === "DONE") return fail("hand is over");

  // ---- sideshow sub-decision ----
  if (s.phase === "SIDESHOW") {
    if (action.type !== "SIDESHOW_RESPONSE") return fail("resolve the sideshow first");
    if (seat !== s.sideshow!.target) return fail("not your sideshow to answer");
    const { requester, target } = s.sideshow!;
    if (action.accept) {
      const rq = evaluate(s.players[requester]!.cards);
      const tg = evaluate(s.players[target]!.cards);
      const cmp = compareHands(rq, tg);
      const loser = cmp > 0 ? target : cmp < 0 ? requester : requester; // tie: the requester loses
      s.players[loser]!.packed = true;
      ev.push({ kind: "SIDESHOW_RESULT", requester, target, loser });
      s.sideshow = null;
      return afterTurn(s, ev, requester);
    }
    ev.push({ kind: "SIDESHOW_DECLINED", requester, target });
    s.sideshow = null;
    return afterTurn(s, ev, requester);
  }

  // ---- normal betting ----
  if (seat !== s.turn) return fail("not your turn");
  if (!live(s, seat)) return fail("you're not in this hand");
  const p = s.players[seat]!;

  switch (action.type) {
    case "SEE": {
      if (p.seen) return fail("already seen");
      p.seen = true;
      ev.push({ kind: "SEEN", seat });
      return { ok: true, state: s, events: ev }; // still your turn — now bet or pack
    }
    case "BET": {
      const legal = legalBets(s, seat);
      if (!legal.includes(action.amount)) return fail(`illegal bet (allowed: ${legal.join(", ")})`);
      p.bet += action.amount; s.pot += action.amount;
      if (remaining(p) <= 0) p.allIn = true;
      const effStake = p.seen ? Math.floor(action.amount / 2) : action.amount;
      if (effStake > s.stake) s.stake = Math.min(effStake, s.maxStake);
      ev.push({ kind: "BET", seat, amount: action.amount, seen: p.seen, allIn: p.allIn });
      return afterTurn(s, ev, seat);
    }
    case "PACK": {
      p.packed = true;
      ev.push({ kind: "PACK", seat });
      return afterTurn(s, ev, seat);
    }
    case "SHOW": {
      if (countLive(s) !== 2) return fail("show is only for the final two");
      const cost = Math.min(p.seen ? 2 * s.stake : s.stake, remaining(p));
      p.bet += cost; s.pot += cost; if (remaining(p) <= 0) p.allIn = true;
      ev.push({ kind: "SHOW", seat });
      return resolveShowdown(s, ev, liveSeats(s), false);
    }
    case "SIDESHOW": {
      const info = legalActions(s, seat);
      if (!info.canSideshow) return fail("you can't ask for a sideshow now");
      const target = prevLive(s, seat);
      const cost = Math.min(2 * s.stake, remaining(p)); // pay a seen chaal to ask
      p.bet += cost; s.pot += cost; if (remaining(p) <= 0) p.allIn = true;
      s.phase = "SIDESHOW"; s.sideshow = { requester: seat, target };
      ev.push({ kind: "SIDESHOW_REQUEST", requester: seat, target });
      return { ok: true, state: s, events: ev };
    }
    default: return fail("illegal action");
  }
}

/** Advance the turn after an action, resolving fold-wins and all-in showdowns. */
function afterTurn(s: State, ev: Event[], from: number): ApplyResult {
  if (countLive(s) === 1) return resolveFold(s, ev);
  const next = nextEligible(s, from);
  if (next === -1) return resolveShowdown(s, ev, liveSeats(s), false); // everyone left is all-in
  s.turn = next; s.phase = "BETTING";
  return { ok: true, state: s, events: ev };
}

function resolveFold(s: State, ev: Event[]): ApplyResult {
  const winner = liveSeats(s)[0]!;
  finish(s, [winner], null, true);
  ev.push({ kind: "HAND_WON", winner, pot: s.pot, byFold: true });
  return { ok: true, state: s, events: ev };
}

function resolveShowdown(s: State, ev: Event[], contenders: number[], _autoAllIn: boolean): ApplyResult {
  const reveal: Reveal[] = contenders.map((seat) => ({ seat, cards: s.players[seat]!.cards, rank: evaluate(s.players[seat]!.cards) }));
  let best = reveal[0]!;
  for (const r of reveal) if (compareHands(r.rank, best.rank) > 0) best = r;
  const winners = reveal.filter((r) => compareHands(r.rank, best.rank) === 0).map((r) => r.seat);
  finish(s, winners, reveal, false);
  ev.push({ kind: "SHOWDOWN", reveal: reveal.map((r) => ({ seat: r.seat, cards: r.cards, rank: r.rank })), winners });
  ev.push({ kind: "HAND_WON", winner: winners[0], pot: s.pot, byFold: false, tie: winners.length > 1 });
  return { ok: true, state: s, events: ev };
}

function finish(s: State, winners: number[], reveal: Reveal[] | null, byFold: boolean): void {
  const deltas = s.players.map((p) => -p.bet);
  const share = Math.floor(s.pot / winners.length);
  let rem = s.pot - share * winners.length;
  for (const w of winners) { deltas[w]! += share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  s.result = { winner: winners[0]!, pot: s.pot, byFold, tie: winners.length > 1, winners, reveal, deltas };
  s.phase = "DONE"; s.turn = -1; s.sideshow = null;
}
