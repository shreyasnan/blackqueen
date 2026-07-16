// Deterministic deal for 28. A 32-bit seed (supplied by the server) drives a mulberry32 PRNG through a
// Fisher–Yates shuffle, then a round-robin deal of 8 cards each. The FIRST four a seat receives are its
// stage-1 (bidding) hand; the next four arrive after the trump is concealed.

import { Card, canonicalDeck, PLAYER_COUNT, HAND_SIZE, nextSeat } from "./cards28.js";

/** Small, fast, fully-deterministic PRNG (Tomas Wang / mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place-free Fisher–Yates using the given PRNG. */
export function shuffle(deck: Card[], rng: () => number): Card[] {
  const d = deck.slice();
  for (let i = d.length - 1; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

export interface Deal {
  hands: Card[][];      // 8 cards per seat, in the order received (hands[s][0..3] = stage-1)
  firstReceiver: number;
}

/** Deal 8 cards to each seat, one at a time, starting from the seat to the dealer's right. */
export function deal(dealer: number, seed: number): Deal {
  const shuffled = shuffle(canonicalDeck(), mulberry32(seed));
  const hands: Card[][] = Array.from({ length: PLAYER_COUNT }, () => []);
  const firstReceiver = nextSeat(dealer);
  let seat = firstReceiver;
  for (let i = 0; i < PLAYER_COUNT * HAND_SIZE; i++) {
    hands[seat]!.push(shuffled[i]!);
    seat = nextSeat(seat);
  }
  return { hands, firstReceiver };
}

/** A seat's stage-1 (first four) hand — what it bids on before the rest is dealt. */
export const stage1Hand = (hand: Card[]): Card[] => hand.slice(0, 4);
