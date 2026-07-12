// GAME_SPEC.md §3–§5, MESSAGE_PROTOCOL.md §2.1 (wire encoding)

export const SUITS = ["C", "D", "H", "S"] as const; // ♣ < ♦ < ♥ < ♠ (canonical, §3.1)
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const; // ascending

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export interface Card {
  suit: Suit;
  rank: Rank;
}

export const rankIndex = (r: Rank): number => RANKS.indexOf(r);
export const suitIndex = (s: Suit): number => SUITS.indexOf(s);

export const cardKey = (c: Card): string => `${c.rank}${c.suit}`;
export const cardEq = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** §5 point values. Q♠ = 30 regardless of trump. */
export function pointValue(c: Card): number {
  if (c.rank === "Q" && c.suit === "S") return 30;
  if (c.rank === "A") return 15;
  if (c.rank === "10") return 10;
  if (c.rank === "5") return 5;
  return 0;
}

export const TOTAL_POINTS = 150; // invariant, §3/§5

/** §3 deterministic trim: lowest ranks first, one card per suit, ♣→♦→♥→♠, until divisible. */
export function trimmedDeckSize(playerCount: number): number {
  let size = 52;
  while (size % playerCount !== 0) size--;
  return size;
}

export function removedCards(playerCount: number): Card[] {
  const toRemove = 52 - trimmedDeckSize(playerCount);
  const out: Card[] = [];
  outer: for (const rank of RANKS) {
    for (const suit of SUITS) {
      if (out.length >= toRemove) break outer;
      if (pointValue({ suit, rank }) > 0) throw new Error("trim reached a point card"); // §3 invariant guard
      out.push({ suit, rank });
    }
  }
  return out;
}

/** §3.1 step 1: canonical order — suit-major ♣<♦<♥<♠, rank ascending — over the trimmed set. */
export function canonicalDeck(playerCount: number): Card[] {
  const removed = new Set(removedCards(playerCount).map(cardKey));
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) {
    const c = { suit, rank };
    if (!removed.has(cardKey(c))) deck.push(c);
  }
  return deck;
}

/** §9.2: called-card count by player size. */
export const calledCardCount = (playerCount: number): number => (playerCount <= 5 ? 1 : 2);
