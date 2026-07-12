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

export const TOTAL_POINTS = 150; // per deck, §3/§5
export const totalPoints = (deckCount: number): number => TOTAL_POINTS * deckCount;

/** §3 deterministic trim: lowest ranks first, ONE COPY per suit per pass, ♣→♦→♥→♠;
 *  repeat passes over a rank while copies remain (2-deck), then next rank, until divisible. */
export function trimmedDeckSize(playerCount: number, deckCount = 1): number {
  let size = 52 * deckCount;
  while (size % playerCount !== 0) size--;
  return size;
}

/** Removed card COPIES (an identity may appear twice in 2-deck trims, e.g. both 2♣ at 7p). */
export function removedCards(playerCount: number, deckCount = 1): Card[] {
  const toRemove = 52 * deckCount - trimmedDeckSize(playerCount, deckCount);
  const out: Card[] = [];
  outer: for (const rank of RANKS) {
    for (let copy = 0; copy < deckCount; copy++) { // §3: per-copy passes within a rank
      for (const suit of SUITS) {
        if (out.length >= toRemove) break outer;
        if (pointValue({ suit, rank }) > 0) throw new Error("trim reached a point card"); // §3 invariant guard
        out.push({ suit, rank });
      }
    }
  }
  return out;
}

/** §3.1 step 1: canonical order — suit ♣<♦<♥<♠, rank ascending, copy index ascending
 *  (copies consecutive) — over the trimmed set. Locked by KAT-001 (1 deck) / KAT-002 (2 decks). */
export function canonicalDeck(playerCount: number, deckCount = 1): Card[] {
  const removedCount = new Map<string, number>();
  for (const c of removedCards(playerCount, deckCount)) {
    removedCount.set(cardKey(c), (removedCount.get(cardKey(c)) ?? 0) + 1);
  }
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) {
    const c = { suit, rank };
    const copies = deckCount - (removedCount.get(cardKey(c)) ?? 0);
    for (let i = 0; i < copies; i++) deck.push({ suit, rank });
  }
  return deck;
}

/** §9.2: default called-card count. Single-deck: fixed by player size. 2-deck default: 2 (creator may pick 1–3, §16). */
export const calledCardCount = (playerCount: number, deckCount = 1): number =>
  deckCount === 2 ? 2 : playerCount <= 5 ? 1 : 2;
