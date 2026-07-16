// Rules-legal heuristic bots for filling seats. Deliberately simple for v1: sensible bids, conceal the
// weakest card of the best suit, decline optional raises, win point tricks cheaply, dump low otherwise.
// (A stronger search-based bot, like Black Queen's, can replace botPlay later without touching callers.)

import { Card, Suit, pointValue, strength, SUITS } from "./cards28.js";
import {
  State, Action, currentActor, minBid, legalPlay, trickWinner, trickPoints, MIN_OPEN, MAX_BID,
} from "./round28.js";

const leastValuable = (cards: Card[]): Card =>
  cards.slice().sort((a, b) => pointValue(a) - pointValue(b) || strength(a.rank) - strength(b.rank))[0]!;

/** How high this 4-card stage-1 hand is worth chasing (a conservative ceiling). */
function bidCeiling(hand: Card[]): number {
  let v = MIN_OPEN;
  for (const c of hand) {
    if (c.rank === "J") v += 2;
    else if (c.rank === "9") v += 1;
    else if (pointValue(c) > 0) v += 1;
  }
  const bestSuitLen = Math.max(...SUITS.map((s) => hand.filter((c) => c.suit === s).length));
  if (bestSuitLen >= 3) v += 1;
  return Math.min(v, 20); // bots stay out of the Honours stratosphere in v1
}

/** Best trump suit for the bidder: longest, then strongest. */
function bestSuit(hand: Card[]): Suit {
  return SUITS.slice().sort((a, b) => {
    const la = hand.filter((c) => c.suit === a).length, lb = hand.filter((c) => c.suit === b).length;
    if (lb !== la) return lb - la;
    const sa = hand.filter((c) => c.suit === a).reduce((n, c) => n + strength(c.rank), 0);
    const sb = hand.filter((c) => c.suit === b).reduce((n, c) => n + strength(c.rank), 0);
    return sb - sa;
  })[0]!;
}

/** The single action a bot would take as the current actor. Returns null if it's not this seat's turn. */
export function botAction(s: State, seat: number): Action | null {
  if (currentActor(s) !== seat) return null;

  if (s.phase === "BIDDING") {
    const stage1 = s.hands[seat]!;
    const m = minBid(s, seat);
    const isOpener = s.bidder === -1 && seat === (s.dealer + 1) % 4;
    if (isOpener) {
      if (stage1.every((c) => pointValue(c) === 0)) return { type: "DEMAND_REDEAL", seat };
      return { type: "BID", seat, value: MIN_OPEN };
    }
    if (m !== null && m <= Math.min(bidCeiling(stage1), MAX_BID)) return { type: "BID", seat, value: m };
    return { type: "PASS", seat };
  }

  if (s.phase === "CONCEAL") {
    const suit = bestSuit(s.hands[seat]!);
    const inSuit = s.hands[seat]!.filter((c) => c.suit === suit);
    const card = inSuit.length > 0 ? leastValuable(inSuit) : leastValuable(s.hands[seat]!);
    return { type: "SET_TRUMP", seat, card };
  }

  if (s.phase === "RAISE") return { type: "DECLINE_RAISE", seat };

  if (s.phase === "PLAY") {
    const info = legalPlay(s, seat);
    if (info.mustReveal) return { type: "REVEAL_TRUMP", seat };
    // Consider exposing the trump if we're void and holding a trump that would grab a valuable trick.
    if (info.canReveal && s.trumpSuit) {
      const myTrumps = s.hands[seat]!.filter((c) => c.suit === s.trumpSuit);
      if (myTrumps.length > 0 && trickPoints(s.trick) >= 2) return { type: "REVEAL_TRUMP", seat };
    }
    return { type: "PLAY", seat, card: chooseCard(s, seat, info.play) };
  }
  return null;
}

function chooseCard(s: State, seat: number, options: Card[]): Card {
  if (s.trick.length > 0) {
    const winning = options.filter((c) =>
      trickWinner([...s.trick, { seat, card: c, revealedWhenPlayed: s.trumpRevealed }], s.trumpSuit) === seat);
    if (winning.length > 0 && trickPoints(s.trick) >= 1) {
      return winning.slice().sort((a, b) => strength(a.rank) - strength(b.rank))[0]!; // cheapest card that still wins
    }
    return leastValuable(options);
  }
  return leastValuable(options); // leading: don't gift points
}
