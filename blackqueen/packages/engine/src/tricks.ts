// GAME_SPEC.md §10 — trick play: validation, resolution, timeout auto-play.
import { Card, Suit, cardEq, pointValue, rankIndex, suitIndex } from "./cards.js";

export interface TrickPlay {
  seat: number;
  card: Card;
}

/** §10 play validation: legal set for a hand given the led suit (null when leading). */
export function legalPlays(hand: Card[], ledSuit: Suit | null): Card[] {
  if (ledSuit === null) return hand.slice(); // leader: any held card
  const follow = hand.filter((c) => c.suit === ledSuit);
  return follow.length > 0 ? follow : hand.slice(); // void: any card, no forced trump
}

export function isLegalPlay(hand: Card[], ledSuit: Suit | null, card: Card): boolean {
  return hand.some((c) => cardEq(c, card)) && legalPlays(hand, ledSuit).some((c) => cardEq(c, card));
}

/** §10 winning rules. Throws on rank ties (card-uniqueness fatal guard → engine treats as corruption). */
export function trickWinner(plays: TrickPlay[], trump: Suit): number {
  const ledSuit = plays[0]!.card.suit;
  const trumps = plays.filter((p) => p.card.suit === trump);
  const candidates = trumps.length > 0 ? trumps : plays.filter((p) => p.card.suit === ledSuit);
  let best: TrickPlay | null = null;
  for (const p of candidates) {
    if (best && rankIndex(p.card.rank) === rankIndex(best.card.rank)) {
      throw new Error("FATAL: rank tie among trick candidates — state corruption (§10)");
    }
    if (!best || rankIndex(p.card.rank) > rankIndex(best.card.rank)) best = p;
  }
  return best!.seat;
}

export const trickPoints = (plays: TrickPlay[]): number =>
  plays.reduce((s, p) => s + pointValue(p.card), 0);

/** §10 timeout auto-play: minimum legal card by (pointValue↑, rank↑, suit↑). Total order — deck unique. */
export function autoPlayCard(hand: Card[], ledSuit: Suit | null): Card {
  const legal = legalPlays(hand, ledSuit);
  return legal.reduce((min, c) => {
    const d = pointValue(c) - pointValue(min) || rankIndex(c.rank) - rankIndex(min.rank) || suitIndex(c.suit) - suitIndex(min.suit);
    return d < 0 ? c : min;
  });
}
