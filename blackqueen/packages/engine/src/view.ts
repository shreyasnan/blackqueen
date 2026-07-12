// GAME_SPEC.md §14.2 — playerView(authoritativeState, viewerSeat) -> ClientView.
// THE single choke point: the server sends clients nothing but this function's output.

import { Card, Suit } from "./cards.js";
import { GameState, Phase, allPartnersRevealed } from "./round.js";
import { BidHistoryEntry } from "./bidding.js";

/** Non-declarer clients see TRUMP_SELECTION/CALLING_PARTNERS as one phase (§9.2). */
export type WirePhase = Exclude<Phase, "TRUMP_SELECTION" | "CALLING_PARTNERS"> | "DECLARER_SETUP";

export interface ClientView {
  viewerSeat: number;
  playerCount: number;
  N: number;
  deckCount: number; // 1 | 2 (§16) — public
  handSize: number; // cards per player (§3.2/§16, v2.1) — public
  totalPoints: number; // 150 × deckCount (§5) — public
  calledCount: number; // C (§9.2/§16) — public
  roundNumber: number;
  phase: WirePhase;
  ownHand: Card[];
  handCounts: number[];
  bidHistory: BidHistoryEntry[];
  currentHighBid: number | null;
  currentHighBidderSeat: number | null;
  turnSeat: number | null;
  declarerSeat: number | null;
  Y: number | null;
  trump: Suit | null; // null for non-declarer viewers until CALL_CARDS accepted (§9.2)
  calledCards: Card[]; // public identities (§9.2); holders NOT included
  revealedTeamMembers: number[]; // authoritative revealed set (+ viewer's own membership)
  allPartnersRevealed: boolean;
  perPlayerCapturedPoints: number[]; // public/derivable — permitted at all times (§14.2)
  currentTrick: { seat: number; card: Card }[];
  completedTricks: { plays: { seat: number; card: Card }[]; winnerSeat: number }[];
  totalScore: number[];
  // ROUND_END / GAME_END only (§14.2: first disclosed in ROUND_SCORED):
  lastRoundDelta: number[] | null;
  lastRoundSuccess: boolean | null;
}

export function playerView(state: GameState, viewerSeat: number): ClientView {
  const r = state.round;
  const isDeclarer = r !== null && viewerSeat === r.declarerSeat;

  // §9.2 phase collapse for non-declarer viewers (and PAUSED never reveals its sub-state)
  // One wire value for everyone (even the declarer — their client echoes the staged choice locally,
  // so the wire stream is bit-identical across sub-states for every viewer).
  const phase: WirePhase =
    state.phase === "TRUMP_SELECTION" || state.phase === "CALLING_PARTNERS" ? "DECLARER_SETUP" : state.phase;
  void isDeclarer;

  // CLAIM model (§9.3): membership IS the public claim record — nothing viewer-specific to add.
  // (A 1-deck holder's private "I will be the partner" knowledge is client-derivable from ownHand.)
  const revealed = r ? [...r.revealedTeamMembers] : [];

  const roundEnded = state.phase === "ROUND_END" || state.phase === "GAME_END";

  return {
    viewerSeat,
    playerCount: state.playerCount,
    N: state.N,
    deckCount: state.deckCount,
    handSize: state.handSize,
    totalPoints: state.totalPoints,
    calledCount: state.calledCount,
    roundNumber: state.roundNumber,
    phase,
    ownHand: r ? r.hands[viewerSeat]!.slice() : [],
    handCounts: r ? r.hands.map((h) => h.length) : Array(state.playerCount).fill(0),
    bidHistory: r ? r.bidding.history.slice() : [],
    currentHighBid: r ? r.bidding.currentHighBid : null,
    currentHighBidderSeat: r ? r.bidding.currentHighBidderSeat : null,
    turnSeat: state.phase === "PAUSED" ? null : r?.turnSeat ?? null,
    declarerSeat: r && r.declarerSeat >= 0 ? r.declarerSeat : null,
    Y: r && r.declarerSeat >= 0 ? r.Y : null,
    // §9.2 disclosure gating: staged trump visible to nobody via view (declarer echoes locally);
    // committed trump public to all once CALL_CARDS accepted.
    trump: r?.trump ?? null,
    calledCards: r ? r.calledCards.slice() : [],
    revealedTeamMembers: revealed.sort((a, b) => a - b),
    allPartnersRevealed: r ? allPartnersRevealed(r) : false,
    perPlayerCapturedPoints: r ? r.capturedPoints.slice() : Array(state.playerCount).fill(0),
    currentTrick: r ? r.currentTrick.map((p) => ({ seat: p.seat, card: p.card })) : [],
    completedTricks: r ? r.completedTricks.map((t) => ({ plays: t.plays.slice(), winnerSeat: t.winnerSeat })) : [],
    totalScore: state.totalScore.slice(),
    lastRoundDelta: roundEnded && state.lastRoundResult ? state.lastRoundResult.roundDelta.slice() : null,
    lastRoundSuccess: roundEnded && state.lastRoundResult ? state.lastRoundResult.success : null,
  };
}

/** Event filter: PARTNER_REVEALED etc. are already safe; this strips nothing today but is the
 *  normative hook — every outbound event MUST pass through it (MESSAGE_PROTOCOL §5.3). */
export function isEventSafeForBroadcast(): boolean {
  return true;
}
