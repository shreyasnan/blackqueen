// Teen Patti cards — a standard 52-card deck and the 3-card hand ranking.
// Ranking (high → low): Trail (trio) > Pure sequence (straight flush) > Sequence (straight) >
// Colour (flush) > Pair > High card. Ace is high (A-K-Q best); A-2-3 is a valid run ranked just
// below A-K-Q (a common house rule), and 2-3-4 is the lowest run.

export const SUITS = ["C", "D", "H", "S"] as const;
export type Suit = (typeof SUITS)[number];

// Ranks WEAKEST → STRONGEST so the index is the strength. Ace high.
export const RANKS_ASC = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS_ASC)[number];

export interface Card { suit: Suit; rank: Rank }

export const PLAYER_MIN = 3;
export const PLAYER_MAX = 6;

export const rankVal = (r: Rank): number => RANKS_ASC.indexOf(r) + 2; // 2..14 (A=14)
export const cardEq = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
export const cardKey = (c: Card): string => `${c.rank}${c.suit}`;
export const nextSeat = (seat: number, n: number): number => (seat + 1) % n;

export function canonicalDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS_ASC) deck.push({ suit, rank });
  return deck;
}

/** Hand categories, ordered low → high so a bigger number is a better hand. */
export enum HandCat { HIGH = 0, PAIR = 1, COLOUR = 2, SEQUENCE = 3, PURE_SEQUENCE = 4, TRAIL = 5 }
export const CAT_NAME: Record<HandCat, string> = {
  [HandCat.HIGH]: "High card",
  [HandCat.PAIR]: "Pair",
  [HandCat.COLOUR]: "Colour",
  [HandCat.SEQUENCE]: "Sequence",
  [HandCat.PURE_SEQUENCE]: "Pure sequence",
  [HandCat.TRAIL]: "Trail",
};

export interface HandRank { cat: HandCat; key: number[]; name: string } // key = tie-breakers, high→low

/** Rank a 3-card hand into a comparable {cat, key}. Compare with compareHands. */
export function evaluate(cards: Card[]): HandRank {
  const vals = cards.map((c) => rankVal(c.rank)).sort((a, b) => b - a); // desc
  const [a, b, c] = vals as [number, number, number];
  const flush = cards.every((x) => x.suit === cards[0]!.suit);

  // sequence detection (with the A-2-3 special)
  const sorted = [...vals].sort((x, y) => x - y); // asc
  const isRun = sorted[1] === sorted[0]! + 1 && sorted[2] === sorted[1]! + 1;
  const isWheel = sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 14; // A-2-3
  const seq = isRun || isWheel;
  // sequence high value: A-K-Q = 15 (top), A-2-3 = 14 (2nd), else the top card
  const seqHigh = isWheel ? 14 : sorted[2] === 14 && sorted[1] === 13 ? 15 : sorted[2]!;

  const cat = (): HandRank => {
    if (a === b && b === c) return { cat: HandCat.TRAIL, key: [a], name: CAT_NAME[HandCat.TRAIL] };
    if (seq && flush) return { cat: HandCat.PURE_SEQUENCE, key: [seqHigh], name: CAT_NAME[HandCat.PURE_SEQUENCE] };
    if (seq) return { cat: HandCat.SEQUENCE, key: [seqHigh], name: CAT_NAME[HandCat.SEQUENCE] };
    if (flush) return { cat: HandCat.COLOUR, key: [a, b, c], name: CAT_NAME[HandCat.COLOUR] };
    if (a === b || b === c) { // pair (b is always the pair since sorted desc: aab or abb)
      const pair = a === b ? a : b;
      const kicker = a === b ? c : a;
      return { cat: HandCat.PAIR, key: [pair, kicker], name: CAT_NAME[HandCat.PAIR] };
    }
    return { cat: HandCat.HIGH, key: [a, b, c], name: CAT_NAME[HandCat.HIGH] };
  };
  return cat();
}

/** > 0 if hand A beats hand B, < 0 if B beats A, 0 on an exact tie. */
export function compareHands(x: HandRank, y: HandRank): number {
  if (x.cat !== y.cat) return x.cat - y.cat;
  for (let i = 0; i < Math.max(x.key.length, y.key.length); i++) {
    const d = (x.key[i] ?? 0) - (y.key[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
