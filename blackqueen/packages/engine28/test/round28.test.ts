import { describe, it, expect } from "vitest";
import {
  initRound, applyAction, botAction, currentActor, playerView, State,
  pointValue, strength, teamOf, canonicalDeck, deal, trickWinner, gamePointsFor,
} from "../src/index.js";

/** Drive a round to a terminal phase entirely with bots. */
function playOut(dealer: number, seed: number): State {
  let s = initRound(dealer, seed);
  for (let guard = 0; guard < 200; guard++) {
    if (s.phase === "DONE" || s.phase === "REDEAL") return s;
    const seat = currentActor(s);
    expect(seat).toBeGreaterThanOrEqual(0);
    const a = botAction(s, seat);
    expect(a).not.toBeNull();
    const r = applyAction(s, a!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  throw new Error("round did not terminate");
}

describe("28 cards", () => {
  it("has a 32-card deck totalling 28 points", () => {
    const deck = canonicalDeck();
    expect(deck).toHaveLength(32);
    expect(deck.reduce((n, c) => n + pointValue(c), 0)).toBe(28);
  });
  it("ranks J-9-A-10-K-Q-8-7 high to low", () => {
    const order = ["J", "9", "A", "10", "K", "Q", "8", "7"] as const;
    for (let i = 0; i < order.length - 1; i++) expect(strength(order[i]!)).toBeGreaterThan(strength(order[i + 1]!));
  });
});

describe("28 deal", () => {
  it("gives 8 cards to each of 4 seats, no duplicates", () => {
    const d = deal(0, 12345);
    expect(d.hands.every((h) => h.length === 8)).toBe(true);
    const keys = d.hands.flat().map((c) => `${c.rank}${c.suit}`);
    expect(new Set(keys).size).toBe(32);
  });
});

describe("trick resolution", () => {
  it("ignores trump-suit cards played before the reveal", () => {
    // North leads spadeJ (concealed), West reveals, South K♠ (after), East 9♠ (after) -> East wins.
    const winner = trickWinner([
      { seat: 0, card: { suit: "S", rank: "J" }, revealedWhenPlayed: false },
      { seat: 1, card: { suit: "D", rank: "7" }, revealedWhenPlayed: true },
      { seat: 2, card: { suit: "S", rank: "K" }, revealedWhenPlayed: true },
      { seat: 3, card: { suit: "S", rank: "9" }, revealedWhenPlayed: true },
    ], "S");
    expect(winner).toBe(3);
  });
});

describe("scoring bands", () => {
  it("uses 1/2/3 to win and 2/3/4 to lose across the bid bands", () => {
    expect(gamePointsFor(16, true)).toBe(1);
    expect(gamePointsFor(16, false)).toBe(-2);
    expect(gamePointsFor(22, true)).toBe(2);
    expect(gamePointsFor(22, false)).toBe(-3);
    expect(gamePointsFor(26, true)).toBe(3);
    expect(gamePointsFor(26, false)).toBe(-4);
  });
});

describe("full round via bots", () => {
  it("terminates and conserves 28 card points when played out", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = playOut(seed % 4, seed * 7919);
      if (s.phase === "REDEAL") { expect(s.redealReason).toBeTruthy(); continue; }
      expect(s.phase).toBe("DONE");
      expect(s.completed).toHaveLength(8);
      expect(s.captured[0] + s.captured[1]).toBe(28); // all card points accounted for
      expect(s.result).not.toBeNull();
      const bt = teamOf(s.bidder);
      expect(s.result!.success).toBe(s.captured[bt] >= s.bid);
    }
  });
  it("hides the trump suit from non-bidders until it is revealed", () => {
    let s = initRound(0, 42);
    while (s.phase === "BIDDING") { const seat = currentActor(s); s = (applyAction(s, botAction(s, seat)!) as any).state; }
    if (s.phase !== "CONCEAL") return; // a redeal happened; nothing to assert
    const seat = currentActor(s);
    s = (applyAction(s, botAction(s, seat)!) as any).state;
    if (s.phase === "REDEAL") return;
    const bidder = s.bidder;
    const other = (bidder + 1) % 4;
    expect(playerView(s, bidder).trumpSuit).not.toBeNull(); // the bidder knows
    expect(playerView(s, other).trumpSuit).toBeNull();       // opponents don't
  });
});
