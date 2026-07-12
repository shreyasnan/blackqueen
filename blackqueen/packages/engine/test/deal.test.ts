// KAT-001 + CONFIG-001 (TEST_CASES.md §7)
import { describe, expect, it } from "vitest";
import { deal, canonicalDeck, removedCards, trimmedDeckSize, calledCardCount, pointValue, cardKey, initGame, minHandSize, maxHandSize, defaultHandSize } from "../src/index.js";

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

// ---------------- v2.0: two-deck mode ----------------

describe("CONFIG-004 — 2-deck trim, points, bounds (TEST_CASES §11)", () => {
  it("6p: 102 cards / 17 each; removes one 2♣ + one 2♦", () => {
    expect(trimmedDeckSize(6, 2)).toBe(102);
    expect(removedCards(6, 2).map(cardKey).sort()).toEqual(["2C", "2D"]);
    expect(canonicalDeck(6, 2).length).toBe(102);
  });
  it("7p: 98 cards / 14 each; removes both 2♣, both 2♦, one 2♥, one 2♠", () => {
    expect(trimmedDeckSize(7, 2)).toBe(98);
    expect(removedCards(7, 2).map(cardKey).sort()).toEqual(["2C", "2C", "2D", "2D", "2H", "2S"]);
  });
  it("300 points, two Queens, both worth 30", () => {
    const deck = canonicalDeck(6, 2);
    expect(deck.reduce((s, c) => s + pointValue(c), 0)).toBe(300);
    expect(deck.filter((c) => c.rank === "Q" && c.suit === "S").length).toBe(2);
  });
  it("2-deck rejected below 6 players; calledCount bounds enforced", () => {
    expect(() => initGame(5, 10, 0, 2)).toThrow();
    expect(() => initGame(6, 12, 0, 2, 0)).toThrow();
    expect(() => initGame(6, 12, 0, 2, 4)).toThrow();
    expect(initGame(6, 12, 0, 2, 3).calledCount).toBe(3);
    expect(initGame(6, 12, 0, 2).calledCount).toBe(2); // default
    expect(initGame(4, 8, 0, 1, 3).calledCount).toBe(1); // single-deck: fixed table, override ignored
  });
});

describe("KAT-002 — 2-deck known-answer deal vector (REQUIRED conformance)", () => {
  // Inputs: playerCount=6, defaultDeclarerSeat=0, deckCount=2, seed bytes 00..1f.
  // Frozen from the reference implementation (TEST_CASES §11).
  const KAT2: string[][] = [
    "AC 3D 9S 10C 8C 7C 7S 6D 3D 5H 8S 7D 7H AD 9C 9H 9D",
    "10S QS JD 9D 8S 5S 6C 7C 10H 2H 3H 10D JC 6S QD 5D 7H",
    "6D KC 8D JD 5H 9S 6S KH 10S AH 10H AD JH JS 4C JS QH",
    "QH 7D 2S KS JH QD QS 5C 4S KC AS 4D 3H 8H 3C KS 8D",
    "4H 8H 4H 3S 6H 2D KD 4C 4D 5C JC 9C 6H 4S 6C KD 2H",
    "10D 2C 7S AH 9H 10C 2S 3C 8C 3S 5D KH QC AC AS 5S QC",
  ].map((s) => s.split(" "));
  it("reproduces the exact 2-deck hands, in deal order", () => {
    const hands = deal(6, 0, seed, 2, 17); // handSize pinned: KAT-002 is the whole-deck vector
    expect(hands.map((h) => h.map(cardKey))).toEqual(KAT2);
  });
  it("union is the trimmed 102-card multiset; 300 points", () => {
    const all = deal(6, 0, seed, 2, 17).flat();
    expect(all.length).toBe(102);
    expect(all.reduce((s, c) => s + pointValue(c), 0)).toBe(300);
    // exactly deckCount copies of every non-trimmed identity
    const counts = new Map<string, number>();
    for (const c of all) counts.set(cardKey(c), (counts.get(cardKey(c)) ?? 0) + 1);
    expect(counts.get("QS")).toBe(2);
    expect(counts.get("2C")).toBe(1); // one copy trimmed at 6p
    expect(counts.get("2D")).toBe(1);
    expect(counts.get("2H")).toBe(2);
  });
});

describe("CONFIG-005 — v2.1 creator-selectable hand size (TEST_CASES §12)", () => {
  it("bounds: max = whole deck, min = 8 (1 deck) / 10 (2 decks), clamped at tiny tables", () => {
    expect(maxHandSize(4, 1)).toBe(13); expect(minHandSize(4, 1)).toBe(8);
    expect(maxHandSize(7, 1)).toBe(7);  expect(minHandSize(7, 1)).toBe(7); // clamp: only one legal size
    expect(maxHandSize(6, 2)).toBe(17); expect(minHandSize(6, 2)).toBe(10);
    expect(maxHandSize(7, 2)).toBe(14); expect(minHandSize(7, 2)).toBe(10);
  });
  it("defaults: 1 deck deals everything (pre-v2.1 behavior); 2 decks default to 12", () => {
    expect(defaultHandSize(4, 1)).toBe(13);
    expect(defaultHandSize(6, 2)).toBe(12);
    expect(defaultHandSize(7, 2)).toBe(12);
    expect(initGame(6, 12, 0, 2).handSize).toBe(12);
    expect(initGame(4, 8, 0).handSize).toBe(13);
  });
  it("trim never removes a point card; total stays 150 x deckCount at every legal size", () => {
    for (const [pc, dc] of [[4, 1], [5, 1], [6, 1], [7, 1], [6, 2], [7, 2]] as const) {
      for (let h = minHandSize(pc, dc); h <= maxHandSize(pc, dc); h++) {
        const deck = canonicalDeck(pc, dc, h);
        expect(deck.length).toBe(pc * h);
        expect(deck.reduce((s, c) => s + pointValue(c), 0)).toBe(150 * dc);
        expect(removedCards(pc, dc, h).every((c) => pointValue(c) === 0)).toBe(true);
      }
    }
  });
  it("6p/2-deck/handSize 10: removes 44 non-point copies, lowest ranks first", () => {
    const removed = removedCards(6, 2, 10);
    expect(removed.length).toBe(44);
    // ranks 2,3,4,6,7 fully gone (8 copies each = 40), then copy-1 of 8C,8D,8H,8S
    const byRank = (r: string) => removed.filter((c) => c.rank === r).length;
    expect([byRank("2"), byRank("3"), byRank("4"), byRank("6"), byRank("7"), byRank("8")]).toEqual([8, 8, 8, 8, 8, 4]);
    expect(byRank("5")).toBe(0); // point rank untouched
  });
  it("out-of-range hand sizes rejected by initGame", () => {
    expect(() => initGame(6, 12, 0, 2, 2, 9)).toThrow();
    expect(() => initGame(6, 12, 0, 2, 2, 18)).toThrow();
    expect(() => initGame(4, 8, 0, 1, undefined, 7)).toThrow();
    expect(initGame(6, 12, 0, 2, 2, 17).handSize).toBe(17);
    expect(initGame(4, 8, 0, 1, undefined, 8).handSize).toBe(8);
  });
  it("deal at a chosen size is deterministic and dealt evenly", () => {
    const seedb = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
    const hands = deal(6, 0, seedb, 2, 12);
    expect(hands.every((h) => h.length === 12)).toBe(true);
    expect(JSON.stringify(deal(6, 0, seedb, 2, 12))).toBe(JSON.stringify(hands));
  });
});
