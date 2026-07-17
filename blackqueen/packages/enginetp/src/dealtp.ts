// Deterministic 3-card deal for Teen Patti. Seeded mulberry32 + Fisher–Yates (same proven approach
// as the other games), dealing 3 cards to each participating seat starting left of the dealer.

import { Card, canonicalDeck, nextSeat } from "./cardstp.js";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(deck: Card[], rng: () => number): Card[] {
  const d = deck.slice();
  for (let i = d.length - 1; i >= 1; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

/** Deal 3 cards to each participating seat (participants[s] === true), clockwise from left of dealer.
 *  Returns hands indexed by seat; non-participants get an empty array. */
export function deal(dealer: number, seed: number, participants: boolean[]): { hands: Card[][]; firstReceiver: number } {
  const n = participants.length;
  const shuffled = shuffle(canonicalDeck(), mulberry32(seed));
  const hands: Card[][] = Array.from({ length: n }, () => []);
  const firstReceiver = firstActive(dealer, participants);
  // three passes, one card each, like a real dealer
  let idx = 0;
  for (let pass = 0; pass < 3; pass++) {
    let seat = firstReceiver;
    for (let k = 0; k < n; k++) {
      if (participants[seat]) hands[seat]!.push(shuffled[idx++]!);
      seat = nextSeat(seat, n);
    }
  }
  return { hands, firstReceiver };
}

export function firstActive(dealer: number, participants: boolean[]): number {
  const n = participants.length;
  let s = nextSeat(dealer, n);
  for (let i = 0; i < n; i++) { if (participants[s]) return s; s = nextSeat(s, n); }
  return dealer;
}
