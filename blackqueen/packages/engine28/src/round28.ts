// 28 round state machine — pure, zero-I/O. One reducer: applyAction(state, action) -> { state, events }.
// Phases: BIDDING -> CONCEAL -> RAISE -> PLAY -> DONE (or REDEAL). The signature mechanic is the
// face-down trump: during PLAY it has NO power until a void player (or the bidder) exposes it, and
// trump-suit cards played BEFORE the reveal never count as trumps (tagged per play).

import {
  Card, Suit, cardEq, cardKey, pointValue, strength, teamOf, partnerOf, nextSeat, PLAYER_COUNT,
} from "./cards28.js";
import { deal } from "./deal28.js";

export type Phase = "BIDDING" | "CONCEAL" | "RAISE" | "PLAY" | "DONE" | "REDEAL";

export interface Play {
  seat: number;
  card: Card;
  revealedWhenPlayed: boolean; // was the trump already exposed when this card hit the table?
}
export interface CompletedTrick {
  plays: Play[];
  winner: number;
  points: number;
}

export interface State {
  phase: Phase;
  dealer: number;
  dealt: Card[][];   // the immutable 8-card deal per seat (hands[s][0..3] = stage-1)
  hands: Card[][];   // current playable cards (trump card removed while concealed)
  // bidding
  turn: number;
  bid: number;
  bidder: number;    // -1 until the auction resolves
  passes: boolean[];
  consecutivePasses: number;
  // raise
  raiseTurn: number;
  // trump
  trumpSuit: Suit | null;
  trumpCard: Card | null;   // the concealed card — NOT in hand until revealed
  trumpRevealed: boolean;
  justRevealed: number | null; // seat that just exposed the trump and must now trump-if-able
  // play
  leader: number;
  trick: Play[];
  completed: CompletedTrick[];
  captured: [number, number]; // card points captured, by team
  // result
  result: { success: boolean; gamePoints: number; bidderTeam: 0 | 1; captured: [number, number] } | null;
  redealReason: string | null;
}

export type Action =
  | { type: "BID"; seat: number; value: number }
  | { type: "PASS"; seat: number }
  | { type: "DEMAND_REDEAL"; seat: number }
  | { type: "SET_TRUMP"; seat: number; card: Card }
  | { type: "RAISE"; seat: number; value: number }
  | { type: "DECLINE_RAISE"; seat: number }
  | { type: "REVEAL_TRUMP"; seat: number }
  | { type: "PLAY"; seat: number; card: Card };

export interface Event { kind: string; [k: string]: unknown }
export type Result =
  | { ok: true; state: State; events: Event[] }
  | { ok: false; error: string };

export const MIN_OPEN = 14;
export const MIN_OVER_PARTNER = 20;
export const MIN_RAISE = 24;
export const MAX_BID = 28;

const clone = (s: State): State => JSON.parse(JSON.stringify(s));
const hasAllFourJacks = (hand: Card[]): boolean => (["C", "D", "H", "S"] as Suit[]).every((su) => hand.some((c) => c.suit === su && c.rank === "J"));
export const pointCards = (hand: Card[]): number => hand.filter((c) => pointValue(c) > 0).length;

/** Fresh round: deal, put each seat's first four in play, opener is to the dealer's right. */
export function initRound(dealer: number, seed: number): State {
  const d = deal(dealer, seed);
  return {
    phase: "BIDDING", dealer, dealt: d.hands, hands: d.hands.map((h) => h.slice(0, 4)),
    turn: d.firstReceiver, bid: 0, bidder: -1, passes: [false, false, false, false], consecutivePasses: 0,
    raiseTurn: -1, trumpSuit: null, trumpCard: null, trumpRevealed: false, justRevealed: null,
    leader: d.firstReceiver, trick: [], completed: [], captured: [0, 0], result: null, redealReason: null,
  };
}

const opener = (s: State): number => nextSeat(s.dealer);
const ledSuit = (s: State): Suit | null => (s.trick.length > 0 ? s.trick[0]!.card.suit : null);
const nextActive = (s: State, from: number): number => {
  let n = nextSeat(from);
  for (let i = 0; i < PLAYER_COUNT && s.passes[n]; i++) n = nextSeat(n); // bounded: the high bidder is never passed
  return n;
};

/** Whose action the engine is waiting on (or -1 in terminal phases). */
export function currentActor(s: State): number {
  if (s.phase === "BIDDING") return s.turn;
  if (s.phase === "CONCEAL") return s.bidder;
  if (s.phase === "RAISE") return s.raiseTurn;
  if (s.phase === "PLAY") return s.turn;
  return -1;
}

/** Minimum legal bid for `seat` right now (null if this seat can't bid). */
export function minBid(s: State, seat: number): number | null {
  if (s.phase !== "BIDDING" || seat !== s.turn || s.passes[seat]) return null;
  if (s.bidder === -1) return MIN_OPEN;
  let m = s.bid + 1;
  if (teamOf(s.bidder) === teamOf(seat)) m = Math.max(m, MIN_OVER_PARTNER);
  return m > MAX_BID ? null : m;
}

/** Legal play info for `seat` during PLAY: which cards may be played, and whether/why a reveal applies. */
export function legalPlay(s: State, seat: number): { play: Card[]; canReveal: boolean; mustReveal: boolean } {
  const hand = s.hands[seat]!;
  const led = ledSuit(s);
  const concealed = s.trumpSuit !== null && !s.trumpRevealed;
  const isBidder = seat === s.bidder;
  const t = s.trumpSuit;

  // Last-trick rule: once the bidder has played all seven in-hand cards, only the face-down trump
  // is left — they must reveal it and play it (whether leading or following).
  if (isBidder && concealed && hand.length === 0) return { play: [], canReveal: true, mustReveal: true };

  if (led === null) { // leading
    if (isBidder && concealed) {
      const nonTrump = hand.filter((c) => c.suit !== t);
      return { play: nonTrump.length > 0 ? nonTrump : hand, canReveal: false, mustReveal: false };
    }
    return { play: hand.slice(), canReveal: false, mustReveal: false };
  }

  const follow = hand.filter((c) => c.suit === led);
  if (follow.length > 0) return { play: follow, canReveal: false, mustReveal: false };

  // void of the led suit
  if (!concealed) {
    if (s.justRevealed === seat) { // the caller who exposed the trump must trump if able
      const trumps = hand.filter((c) => c.suit === t);
      if (trumps.length > 0) return { play: trumps, canReveal: false, mustReveal: false };
    }
    return { play: hand.slice(), canReveal: false, mustReveal: false };
  }
  // void while trump is still concealed
  if (isBidder) {
    if (led === t) return { play: hand.filter((c) => c.suit !== t), canReveal: false, mustReveal: false }; // can't reveal on the trump lead
    const nonTrump = hand.filter((c) => c.suit !== t);
    return { play: nonTrump, canReveal: true, mustReveal: nonTrump.length === 0 };
  }
  return { play: hand.slice(), canReveal: true, mustReveal: false };
}

/** §Play resolution: highest EXPOSED trump wins, else highest of the led suit. 32-card deck ⇒ no ties. */
export function trickWinner(plays: Play[], trump: Suit | null): number {
  const led = plays[0]!.card.suit;
  const trumps = trump ? plays.filter((p) => p.card.suit === trump && p.revealedWhenPlayed) : [];
  const pool = trumps.length > 0 ? trumps : plays.filter((p) => p.card.suit === led);
  let best = pool[0]!;
  for (const p of pool) if (strength(p.card.rank) > strength(best.card.rank)) best = p;
  return best.seat;
}
export const trickPoints = (plays: Play[]): number => plays.reduce((n, p) => n + pointValue(p.card), 0);

/** Game points for a bid, from the bidding team's perspective: made => +, failed => −. */
export function gamePointsFor(bid: number, success: boolean): number {
  if (bid <= 19) return success ? 1 : -2;
  if (bid <= 24) return success ? 2 : -3;
  return success ? 3 : -4;
}

function fail(error: string): Result { return { ok: false, error }; }
const inHand = (hand: Card[], card: Card): boolean => hand.some((c) => cardEq(c, card));
const removeCard = (hand: Card[], card: Card): void => { const i = hand.findIndex((c) => cardEq(c, card)); if (i >= 0) hand.splice(i, 1); };

export function applyAction(prev: State, action: Action): Result {
  const s = clone(prev);
  const ev: Event[] = [];

  switch (action.type) {
    case "BID": {
      if (s.phase !== "BIDDING") return fail("not bidding");
      if (action.seat !== s.turn) return fail("not your turn");
      const m = minBid(s, action.seat);
      if (m === null) return fail("cannot bid");
      if (!Number.isInteger(action.value) || action.value < m || action.value > MAX_BID) return fail(`bid must be ${m}–${MAX_BID}`);
      s.bid = action.value; s.bidder = action.seat; s.consecutivePasses = 0;
      ev.push({ kind: "BID", seat: action.seat, value: action.value });
      s.turn = nextActive(s, action.seat);
      return { ok: true, state: s, events: ev };
    }
    case "PASS": {
      if (s.phase !== "BIDDING") return fail("not bidding");
      if (action.seat !== s.turn) return fail("not your turn");
      if (s.bidder === -1 && action.seat === opener(s)) return fail("the opener must bid at least 14 (or demand a redeal)");
      s.passes[action.seat] = true; s.consecutivePasses++; // a pass is final — that seat is out of the auction
      ev.push({ kind: "PASS", seat: action.seat });
      // The auction ends when everyone but the high bidder has passed (the lone survivor won it).
      const remaining = s.passes.filter((p) => !p).length;
      if (s.bidder >= 0 && remaining === 1) { s.phase = "CONCEAL"; s.turn = s.bidder; ev.push({ kind: "BIDDING_WON", seat: s.bidder, value: s.bid }); }
      else s.turn = nextActive(s, action.seat);
      return { ok: true, state: s, events: ev };
    }
    case "DEMAND_REDEAL": {
      if (s.phase !== "BIDDING") return fail("not bidding");
      if (s.bidder !== -1 || action.seat !== opener(s) || action.seat !== s.turn) return fail("only the opener may demand a redeal, before any bid");
      if (pointCards(s.hands[action.seat]!) > 0) return fail("you hold a point card — you must bid");
      s.phase = "REDEAL"; s.redealReason = "opener-no-points";
      ev.push({ kind: "REDEAL", reason: s.redealReason });
      return { ok: true, state: s, events: ev };
    }
    case "SET_TRUMP": {
      if (s.phase !== "CONCEAL") return fail("not choosing trump");
      if (action.seat !== s.bidder) return fail("only the bidder sets trump");
      if (!inHand(s.hands[s.bidder]!, action.card)) return fail("that card isn't in your hand");
      s.trumpSuit = action.card.suit; s.trumpCard = action.card;
      removeCard(s.hands[s.bidder]!, action.card); // held face-down, apart from the hand
      for (let seat = 0; seat < PLAYER_COUNT; seat++) s.hands[seat]!.push(...s.dealt[seat]!.slice(4)); // second deal
      ev.push({ kind: "TRUMP_CONCEALED", seat: s.bidder });
      // mandatory redeals, now that everyone holds eight
      const jackSeat = s.dealt.findIndex(hasAllFourJacks);
      const teamTrumpCount = s.dealt.reduce((n, hand, seat) => n + (teamOf(seat) === teamOf(s.bidder) ? hand.filter((c) => c.suit === s.trumpSuit).length : 0), 0);
      if (jackSeat >= 0) { s.phase = "REDEAL"; s.redealReason = "four-jacks"; ev.push({ kind: "REDEAL", reason: s.redealReason, seat: jackSeat }); return { ok: true, state: s, events: ev }; }
      if (teamTrumpCount === 8) { s.phase = "REDEAL"; s.redealReason = "all-trumps"; ev.push({ kind: "REDEAL", reason: s.redealReason }); return { ok: true, state: s, events: ev }; }
      s.phase = "RAISE"; s.raiseTurn = s.bidder;
      ev.push({ kind: "SECOND_DEAL" });
      return { ok: true, state: s, events: ev };
    }
    case "RAISE": {
      if (s.phase !== "RAISE") return fail("not the raise step");
      if (action.seat !== s.raiseTurn) return fail("not your decision");
      const m = Math.max(s.bid + 1, MIN_RAISE);
      if (!Number.isInteger(action.value) || action.value < m || action.value > MAX_BID) return fail(`raise must be ${m}–${MAX_BID}`);
      s.bid = action.value;
      ev.push({ kind: "RAISED", seat: action.seat, value: action.value });
      startPlay(s, ev);
      return { ok: true, state: s, events: ev };
    }
    case "DECLINE_RAISE": {
      if (s.phase !== "RAISE") return fail("not the raise step");
      if (action.seat !== s.raiseTurn) return fail("not your decision");
      if (s.raiseTurn === s.bidder) { s.raiseTurn = partnerOf(s.bidder); ev.push({ kind: "RAISE_PASSED", seat: action.seat }); }
      else { ev.push({ kind: "RAISE_PASSED", seat: action.seat }); startPlay(s, ev); }
      return { ok: true, state: s, events: ev };
    }
    case "REVEAL_TRUMP": {
      if (s.phase !== "PLAY") return fail("not in play");
      if (action.seat !== s.turn) return fail("not your turn");
      const info = legalPlay(s, action.seat);
      if (!info.canReveal) return fail("you can't call for trump now");
      s.trumpRevealed = true; s.justRevealed = action.seat;
      s.hands[s.bidder]!.push(s.trumpCard!); // the exposed card joins the bidder's hand
      ev.push({ kind: "TRUMP_REVEALED", seat: action.seat, suit: s.trumpSuit });
      return { ok: true, state: s, events: ev };
    }
    case "PLAY": {
      if (s.phase !== "PLAY") return fail("not in play");
      if (action.seat !== s.turn) return fail("not your turn");
      const info = legalPlay(s, action.seat);
      if (info.mustReveal) return fail("you must call for trump before playing");
      if (!info.play.some((c) => cardEq(c, action.card))) return fail("illegal card");
      removeCard(s.hands[action.seat]!, action.card);
      s.trick.push({ seat: action.seat, card: action.card, revealedWhenPlayed: s.trumpRevealed });
      if (s.justRevealed === action.seat) s.justRevealed = null;
      ev.push({ kind: "PLAY", seat: action.seat, card: action.card });
      if (s.trick.length === PLAYER_COUNT) {
        const winner = trickWinner(s.trick, s.trumpSuit);
        const pts = trickPoints(s.trick);
        s.captured[teamOf(winner)] += pts;
        s.completed.push({ plays: s.trick, winner, points: pts });
        ev.push({ kind: "TRICK_WON", winner, points: pts });
        s.trick = []; s.leader = winner; s.turn = winner;
        if (s.completed.length === 8) score(s, ev);
      } else {
        s.turn = nextSeat(action.seat);
      }
      return { ok: true, state: s, events: ev };
    }
  }
}

function startPlay(s: State, ev: Event[]): void {
  s.phase = "PLAY";
  s.leader = nextSeat(s.dealer); // the player to the dealer's right leads the first trick
  s.turn = s.leader;
  s.trick = []; s.completed = []; s.captured = [0, 0];
  ev.push({ kind: "PLAY_BEGAN", leader: s.leader, bid: s.bid });
}

function score(s: State, ev: Event[]): void {
  const bidderTeam = teamOf(s.bidder);
  const success = s.captured[bidderTeam] >= s.bid;
  const gamePoints = gamePointsFor(s.bid, success);
  s.result = { success, gamePoints, bidderTeam, captured: [...s.captured] as [number, number] };
  s.phase = "DONE";
  ev.push({ kind: "ROUND_SCORED", success, gamePoints, bidderTeam, captured: [...s.captured] });
}
