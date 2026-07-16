// Per-seat projection: reveal only what a given player may legally see. Opponents' cards stay hidden,
// and the trump suit is concealed from everyone except the bidder until it's exposed in play.

import { Card, Suit, teamOf } from "./cards28.js";
import { State, currentActor, minBid, legalPlay, pointCards } from "./round28.js";

export interface View28 {
  phase: State["phase"];
  dealer: number;
  you: number;
  team: 0 | 1;
  actor: number;          // whose action the table is waiting on
  bid: number;
  bidder: number;         // -1 until the auction resolves (teams are public in 28)
  hand: Card[];           // your playable cards only
  handCounts: number[];   // how many cards each seat still holds
  trumpRevealed: boolean;
  trumpConcealed: boolean; // a face-down trump card exists
  trumpSuit: Suit | null;  // the suit — visible to the bidder always, to others only after reveal
  trick: { seat: number; card: Card }[];
  lastTrick: { plays: { seat: number; card: Card }[]; winner: number; points: number } | null;
  captured: [number, number];
  result: State["result"];
  // what YOU may do right now
  minBid: number | null;
  canPass: boolean;
  canDemandRedeal: boolean;
  legal: { play: Card[]; canReveal: boolean; mustReveal: boolean } | null;
}

export function playerView(s: State, seat: number): View28 {
  const iAmActor = currentActor(s) === seat;
  const iAmBidder = seat === s.bidder;
  const showTrump = s.trumpRevealed || iAmBidder;
  return {
    phase: s.phase,
    dealer: s.dealer,
    you: seat,
    team: teamOf(seat),
    actor: currentActor(s),
    bid: s.bid,
    bidder: s.bidder,
    hand: s.hands[seat]!.slice(),
    handCounts: s.hands.map((h) => h.length),
    trumpRevealed: s.trumpRevealed,
    trumpConcealed: s.trumpCard !== null && !s.trumpRevealed,
    trumpSuit: showTrump ? s.trumpSuit : null,
    trick: s.trick.map((p) => ({ seat: p.seat, card: p.card })),
    lastTrick: s.completed.length > 0
      ? (() => { const t = s.completed[s.completed.length - 1]!; return { plays: t.plays.map((p) => ({ seat: p.seat, card: p.card })), winner: t.winner, points: t.points }; })()
      : null,
    captured: [...s.captured] as [number, number],
    result: s.result,
    minBid: s.phase === "BIDDING" && iAmActor ? minBid(s, seat) : null,
    canPass: s.phase === "BIDDING" && iAmActor && !(s.bidder === -1 && seat === (s.dealer + 1) % 4),
    canDemandRedeal: s.phase === "BIDDING" && iAmActor && s.bidder === -1 && seat === (s.dealer + 1) % 4 && pointCards(s.hands[seat]!) === 0,
    legal: s.phase === "PLAY" && iAmActor ? legalPlay(s, seat) : null,
  };
}
