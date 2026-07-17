import { describe, it, expect } from "vitest";
import {
  canonicalDeck, evaluate, compareHands, HandCat, deal, initRound, applyAction, botAction,
  currentActor, playerView, State, Card,
} from "../src/index.js";

const C = (rank: any, suit: any): Card => ({ rank, suit });

describe("teen patti deck", () => {
  it("is 52 unique cards", () => {
    const d = canonicalDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
  });
});

describe("hand ranking", () => {
  const rank = (cards: Card[]) => evaluate(cards);
  it("orders the categories correctly", () => {
    const trail = rank([C("A", "C"), C("A", "D"), C("A", "H")]);
    const pureSeq = rank([C("Q", "S"), C("K", "S"), C("A", "S")]);
    const seq = rank([C("Q", "S"), C("K", "D"), C("A", "S")]);
    const colour = rank([C("2", "S"), C("7", "S"), C("J", "S")]);
    const pair = rank([C("9", "C"), C("9", "D"), C("K", "S")]);
    const high = rank([C("2", "C"), C("7", "D"), C("J", "S")]);
    expect(trail.cat).toBe(HandCat.TRAIL);
    expect(pureSeq.cat).toBe(HandCat.PURE_SEQUENCE);
    expect(seq.cat).toBe(HandCat.SEQUENCE);
    expect(colour.cat).toBe(HandCat.COLOUR);
    expect(pair.cat).toBe(HandCat.PAIR);
    expect(high.cat).toBe(HandCat.HIGH);
    expect(compareHands(trail, pureSeq)).toBeGreaterThan(0);
    expect(compareHands(pureSeq, seq)).toBeGreaterThan(0);
    expect(compareHands(seq, colour)).toBeGreaterThan(0);
    expect(compareHands(colour, pair)).toBeGreaterThan(0);
    expect(compareHands(pair, high)).toBeGreaterThan(0);
  });
  it("ranks A-K-Q above A-2-3 above K-Q-J", () => {
    const akq = rank([C("A", "C"), C("K", "D"), C("Q", "H")]);
    const a23 = rank([C("A", "C"), C("2", "D"), C("3", "H")]);
    const kqj = rank([C("K", "C"), C("Q", "D"), C("J", "H")]);
    expect(compareHands(akq, a23)).toBeGreaterThan(0);
    expect(compareHands(a23, kqj)).toBeGreaterThan(0);
  });
  it("breaks trail ties by rank (AAA > 222)", () => {
    expect(compareHands(rank([C("A", "C"), C("A", "D"), C("A", "H")]), rank([C("2", "C"), C("2", "D"), C("2", "H")]))).toBeGreaterThan(0);
  });
});

describe("deal", () => {
  it("gives 3 cards to each participant, no duplicates", () => {
    const parts = [true, true, true, true];
    const d = deal(0, 999, parts);
    expect(d.hands.every((h) => h.length === 3)).toBe(true);
    const keys = d.hands.flat().map((c) => `${c.rank}${c.suit}`);
    expect(new Set(keys).size).toBe(12);
  });
});

describe("hidden information", () => {
  it("hides your own cards while blind, and everyone else's always", () => {
    const s = initRound(0, 42, [1000, 1000, 1000, 1000], 10);
    const actor = currentActor(s);
    const v = playerView(s, actor);
    expect(v.yourCards).toBeNull();           // blind: you can't see your own cards
    expect((v.players[0] as any).cards).toBe(undefined); // opponents never carry cards
    const r = applyAction(s, { type: "SEE", seat: actor });
    expect(r.ok).toBe(true);
    if (r.ok) { const v2 = playerView(r.state, actor); expect(v2.yourCards).not.toBeNull(); }
  });
});

/** Drive one full hand with bots. */
function playHand(seed: number, seats: number): State {
  const stacks = Array.from({ length: seats }, () => 1000);
  let s = initRound(seed % seats, seed * 2654435761 >>> 0, stacks, 10);
  for (let guard = 0; guard < 400; guard++) {
    if (s.phase === "DONE") return s;
    const seat = currentActor(s);
    expect(seat).toBeGreaterThanOrEqual(0);
    const a = botAction(s, seat);
    expect(a).not.toBeNull();
    const r = applyAction(s, a!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  throw new Error("hand did not terminate");
}

describe("full hands via bots", () => {
  it("terminate and conserve chips (deltas sum to zero) for 3–6 players", () => {
    for (let seats = 3; seats <= 6; seats++) {
      for (let seed = 1; seed <= 30; seed++) {
        const s = playHand(seed, seats);
        expect(s.phase).toBe("DONE");
        expect(s.result).not.toBeNull();
        const res = s.result!;
        expect(res.deltas.reduce((a, b) => a + b, 0)).toBe(0); // chips conserved
        const totalBet = s.players.reduce((a, p) => a + p.bet, 0);
        expect(totalBet).toBe(res.pot);                        // pot accounts for every chip in
        expect(res.winners.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
