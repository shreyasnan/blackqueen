// KAT-001 + CONFIG-001 (TEST_CASES.md §7)
import { describe, expect, it } from "vitest";
import { deal, canonicalDeck, removedCards, trimmedDeckSize, calledCardCount, pointValue, cardKey } from "../src/index.js";

const seed = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

// Expected hands from TEST_CASES.md §7 (suits ♣♦♥♠ → C D H S), deal order.
const KAT: string[][] = [
  ["3H", "2D", "9C", "QH", "5D", "AS", "AD", "7D", "4S", "QD", "3S", "4C", "2S"],
  ["7C", "8C", "JS", "AH", "9S", "10D", "8D", "6C", "9H", "10C", "QS", "10H", "KH"],
  ["6D", "7S", "6S", "8S", "3D", "QC", "JC", "5S", "5C", "KS", "8H", "JD", "JH"],
  ["AC", "KC", "6H", "2C", "4H", "7H", "10S", "KD", "9D", "5H", "4D", "2H", "3C"],
];

describe("KAT-001 — known-answer deal vector (REQUIRED conformance)", () => {
  it("reproduces the exact hands, in deal order", () => {
    const hands = deal(4, 0, seed);
    expect(hands.map((h) => h.map(cardKey))).toEqual(KAT);
  });
  it("union is all 52 cards, no duplicates; 13 point cards / 150 points", () => {
    const hands = deal(4, 0, seed);
    const all = hands.flat();
    expect(new Set(all.map(cardKey)).size).toBe(52);
    expect(all.reduce((s, c) => s + pointValue(c), 0)).toBe(150);
  });
  it("re-running yields identical hands", () => {
    expect(deal(4, 0, seed)).toEqual(deal(4, 0, seed));
  });
  it("changing only defaultDeclarerSeat rotates card→seat assignment", () => {
    const h0 = deal(4, 0, seed);
    const h1 = deal(4, 1, seed);
    expect(h1[1]).toEqual(h0[0]);
    expect(h1[0]).toEqual(h0[3]);
  });
});

describe("CONFIG-001 — deck & shares per player count", () => {
  const table = [
    { p: 4, size: 52, per: 13, removed: [], C: 1 },
    { p: 5, size: 50, per: 10, removed: ["2C", "2D"], C: 1 },
    { p: 6, size: 48, per: 8, removed: ["2C", "2D", "2H", "2S"], C: 2 },
    { p: 7, size: 49, per: 7, removed: ["2C", "2D", "2H"], C: 2 },
  ];
  for (const row of table) {
    it(`${row.p} players`, () => {
      expect(trimmedDeckSize(row.p)).toBe(row.size);
      expect(removedCards(row.p).map(cardKey)).toEqual(row.removed);
      expect(calledCardCount(row.p)).toBe(row.C);
      const deck = canonicalDeck(row.p);
      expect(deck.length).toBe(row.size);
      expect(deck.length / row.p).toBe(row.per);
      expect(deck.reduce((s, c) => s + pointValue(c), 0)).toBe(150); // all point cards present
      const hands = deal(row.p, 0, seed);
      expect(hands.every((h) => h.length === row.per)).toBe(true);
    });
  }
});
