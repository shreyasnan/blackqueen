// 28 (Irupathiyettu) cards — a 32-card deck with ONE rank order in every suit and its own point values.
// Rank strength high→low: J-9-A-10-K-Q-8-7. Points: J 3, 9 2, A 1, 10 1 (total 28), rest 0.

export const SUITS = ["C", "D", "H", "S"] as const; // canonical suit order (display/tie-break only)
export type Suit = (typeof SUITS)[number];

// The 8 ranks used in 28, listed WEAKEST → STRONGEST so the array index IS the strength.
export const RANKS_ASC = ["7", "8", "Q", "K", "10", "A", "9", "J"] as const;
export type Rank = (typeof RANKS_ASC)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const suitIndex = (s: Suit): number => SUITS.indexOf(s);
/** Higher = stronger. J is highest, 7 lowest. */
export const strength = (r: Rank): number => RANKS_ASC.indexOf(r);
export const cardKey = (c: Card): string => `${c.rank}${c.suit}`;
export const cardEq = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** 28 point values — J 3, 9 2, A 1, 10 1, everything else 0. */
export function pointValue(c: Card): number {
  switch (c.rank) {
    case "J": return 3;
    case "9": return 2;
    case "A": return 1;
    case "10": return 1;
    default: return 0;
  }
}

export const TOTAL_POINTS = 28; // sum of all card points in the deck
export const HAND_SIZE = 8;     // 4 players × 8 = 32
export const PLAYER_COUNT = 4;

/** Canonical 32-card deck (order is fixed and only used before the shuffle). */
export function canonicalDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS_ASC) deck.push({ suit, rank });
  return deck;
}

/** Fixed 2v2 partnerships — partners sit opposite, so seats 0&2 vs 1&3. */
export const teamOf = (seat: number): 0 | 1 => (seat % 2) as 0 | 1;
export const partnerOf = (seat: number): number => (seat + 2) % PLAYER_COUNT;
/** Play/deal order used throughout (a fixed rotation; direction is a convention, not real-world CCW). */
export const nextSeat = (seat: number): number => (seat + 1) % PLAYER_COUNT;
