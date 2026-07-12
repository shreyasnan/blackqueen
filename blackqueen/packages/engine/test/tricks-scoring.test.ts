// TEST_CASES.md §2 (TRICK-001…004), §4 (SCORE-*), TO-002, RANK-001
import { describe, expect, it } from "vitest";
import { legalPlays, isLegalPlay, trickWinner, trickPoints, autoPlayCard, scoreRound, pauseEndDelta, competitionRanks, Card, cardKey } from "../src/index.js";

const c = (s: string): Card => {
  const suit = s.slice(-1) as Card["suit"];
  const rank = s.slice(0, -1) as Card["rank"];
  return { suit, rank };
};
const cs = (...xs: string[]) => xs.map(c);

describe("TRICK-001 — follow-suit enforcement", () => {
  const hand = cs("KH", "3C", "7D");
  it("rejects off-suit when holding led suit; accepts the follow", () => {
    expect(isLegalPlay(hand, "H", c("3C"))).toBe(false);
    expect(isLegalPlay(hand, "H", c("KH"))).toBe(true);
    expect(legalPlays(hand, "H").map(cardKey)).toEqual(["KH"]);
  });
});

describe("TRICK-002 — void: any card, no forced trump", () => {
  const hand = cs("AC", "2D", "7S");
  it("entire hand legal when void", () => {
    expect(legalPlays(hand, "H").map(cardKey)).toEqual(["AC", "2D", "7S"]);
    expect(isLegalPlay(hand, "H", c("2D"))).toBe(true);
    expect(isLegalPlay(hand, "H", c("7S"))).toBe(true); // trump also legal, never forced
  });
});

describe("TRICK-003 — lone trump beats highest led card", () => {
  it("2♠ beats A♥ under ♠ trump; winner credited 15 (A♥)", () => {
    const plays = [
      { seat: 0, card: c("KH") }, { seat: 1, card: c("AH") },
      { seat: 2, card: c("2S") }, { seat: 3, card: c("3H") },
    ];
    expect(trickWinner(plays, "S")).toBe(2);
    expect(trickPoints(plays)).toBe(15);
  });
});

describe("TRICK-004 — highest trump among multiple trumps", () => {
  it("J♠ beats 9♠; 5♦ led-suit point goes to trump winner", () => {
    const plays = [
      { seat: 0, card: c("4D") }, { seat: 1, card: c("9S") },
      { seat: 2, card: c("JS") }, { seat: 3, card: c("5D") },
    ];
    expect(trickWinner(plays, "S")).toBe(2);
    expect(trickPoints(plays)).toBe(5);
  });
});

describe("TO-002 — auto-play least-valuable legal card (pointValue↑, rank↑, suit↑)", () => {
  it("must-follow: Q♥ (0 pts) over 5♥ (5 pts)", () => {
    expect(cardKey(autoPlayCard(cs("QH", "5H", "2C", "AS"), "H"))).toBe("QH");
  });
  it("void bug-fix case: 2♦ over A♣ (old suit-major rule would donate 15)", () => {
    expect(cardKey(autoPlayCard(cs("AC", "2D"), "H"))).toBe("2D");
  });
  it("void tie-break: 2♣ (0 pts, lowest rank)", () => {
    expect(cardKey(autoPlayCard(cs("AC", "2C", "10D"), "H"))).toBe("2C");
  });
});

describe("SCORE — §12 share distributions", () => {
  const cap = (pc: number, team: number[], pts: number): number[] => {
    // put `pts` on the first team seat, 150-pts on the first non-team seat
    const arr = Array(pc).fill(0);
    arr[team[0]!] = pts;
    arr[Array.from({ length: pc }, (_, i) => i).find((i) => !team.includes(i))!] = 150 - pts;
    return arr;
  };

  it("SCORE-4A/4B — 4p distinct partner, success & failure", () => {
    const a = scoreRound(4, 85, 0, cs("AS"), [2], cap(4, [0, 2], 90));
    expect(a.success).toBe(true);
    expect(a.roundDelta).toEqual([85, 0, 85, 0]);
    const b = scoreRound(4, 85, 0, cs("AS"), [2], cap(4, [0, 2], 70));
    expect(b.success).toBe(false);
    expect(b.roundDelta).toEqual([-85, 0, -85, 0]);
  });

  it("SCORE-4C — secret solo ±200", () => {
    const win = scoreRound(4, 100, 0, cs("AS"), [0], cap(4, [0], 100));
    expect(win.roundDelta).toEqual([200, 0, 0, 0]);
    const lose = scoreRound(4, 100, 0, cs("AS"), [0], cap(4, [0], 99));
    expect(lose.roundDelta).toEqual([-200, 0, 0, 0]);
  });

  it("SCORE-5 — partner and solo", () => {
    const p = scoreRound(5, 90, 0, cs("10H"), [3], cap(5, [0, 3], 95));
    expect(p.roundDelta).toEqual([90, 0, 0, 90, 0]);
    const solo = scoreRound(5, 90, 0, cs("10H"), [0], cap(5, [0], 95));
    expect(solo.roundDelta).toEqual([180, 0, 0, 0, 0]);
  });

  it("SCORE-6 — all partner combinations at Y=100", () => {
    expect(scoreRound(6, 100, 0, cs("KD", "QH"), [2, 4], cap(6, [0, 2, 4], 110)).roundDelta)
      .toEqual([100, 0, 100, 0, 100, 0]);
    expect(scoreRound(6, 100, 0, cs("KD", "QH"), [2, 2], cap(6, [0, 2], 110)).roundDelta)
      .toEqual([100, 0, 200, 0, 0, 0]);
    expect(scoreRound(6, 100, 0, cs("KD", "QH"), [0, 3], cap(6, [0, 3], 110)).roundDelta)
      .toEqual([200, 0, 0, 100, 0, 0]);
    expect(scoreRound(6, 100, 0, cs("KD", "QH"), [2, 4], cap(6, [0, 2, 4], 99)).roundDelta)
      .toEqual([-100, 0, -100, 0, -100, 0]);
  });

  it("SCORE-7 — two partners and full solo at Y=120", () => {
    expect(scoreRound(7, 120, 0, cs("AD", "AC"), [2, 5], cap(7, [0, 2, 5], 130)).roundDelta)
      .toEqual([120, 0, 120, 0, 0, 120, 0]);
    expect(scoreRound(7, 120, 0, cs("AD", "AC"), [0, 0], cap(7, [0], 150)).roundDelta)
      .toEqual([360, 0, 0, 0, 0, 0, 0]);
  });

  it("SCORE-EDGE — exact-bid boundary (≥ inclusive)", () => {
    expect(scoreRound(4, 90, 0, cs("AS"), [2], cap(4, [0, 2], 90)).success).toBe(true);
    expect(scoreRound(4, 90, 0, cs("AS"), [2], cap(4, [0, 2], 89)).success).toBe(false);
  });

  it("PAUSE-001 scoring — declarer-only −(S×Y)", () => {
    expect(pauseEndDelta(4, 85, 2)).toEqual([0, 0, -170, 0]);
    expect(pauseEndDelta(7, 120, 1)).toEqual([0, -360, 0, 0, 0, 0, 0]);
  });
});

describe("RANK-001 — competition ranking (1224)", () => {
  it("A=1 B=1 C=3 D=3 E=5", () => {
    expect(competitionRanks([300, 300, 150, 150, -75])).toEqual([1, 1, 3, 3, 5]);
  });
});
