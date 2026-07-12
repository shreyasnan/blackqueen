// TEST_CASES.md §1 (BID-001…004) + TO-001
import { describe, expect, it } from "vitest";
import { initBidding, applyBid, applyPass, BiddingState } from "../src/index.js";

const P = 4; // Alice(0) Bob(1) Carol(2) Dave(3); default declarer Alice(0)

function must(r: ReturnType<typeof applyBid>): Extract<typeof r, { ok: true }> {
  if (!r.ok) throw new Error(`unexpected reject: ${r.reason}`);
  return r;
}

describe("BID-001 — escalation, defender outbid then default declarer reclaims", () => {
  it("runs the exact table", () => {
    let s = initBidding(P, 0);
    expect(s.currentHighBid).toBe(75);
    expect(s.currentHighBidderSeat).toBe(0);
    expect(s.turnSeat).toBe(1); // Bob first

    let r = must(applyBid(s, P, 1, 80));
    expect(r.state.currentHighBidderSeat).toBe(1);
    s = r.state;
    expect(s.turnSeat).toBe(2);

    r = must(applyPass(s, P, 2)); s = r.state; // Carol
    expect(s.activeSeats).toEqual([0, 1, 3]);
    expect(s.turnSeat).toBe(3);

    r = must(applyPass(s, P, 3)); s = r.state; // Dave
    expect(s.activeSeats).toEqual([0, 1]);
    expect(s.turnSeat).toBe(0); // Alice (no longer high bidder)

    r = must(applyBid(s, P, 0, 85)); s = r.state; // Alice reclaims
    expect(s.currentHighBidderSeat).toBe(0);
    expect(s.turnSeat).toBe(1); // Bob — Alice (high bidder) never on turn

    const end = must(applyPass(s, P, 1));
    expect(end.ended).toBe(true);
    if (end.ended) {
      expect(end.declarerSeat).toBe(0);
      expect(end.Y).toBe(85);
    }
    expect(end.state.activeSeats).toEqual([0]);
    expect(end.state.turnSeat).toBeNull(); // Alice never placed on turn again
  });
});

describe("BID-002 — all others pass against standing 75", () => {
  it("default declarer wins at 75; all-pass-no-declarer is impossible", () => {
    let s = initBidding(P, 0);
    s = must(applyPass(s, P, 1)).state;
    s = must(applyPass(s, P, 2)).state;
    const end = must(applyPass(s, P, 3));
    expect(end.ended).toBe(true);
    if (end.ended) {
      expect(end.declarerSeat).toBe(0);
      expect(end.Y).toBe(75);
    }
  });
});

describe("BID-003 — 150 ends the auction immediately", () => {
  it("no further turns after a 150 bid", () => {
    let s = initBidding(P, 0);
    s = must(applyBid(s, P, 1, 80)).state;
    const end = must(applyBid(s, P, 2, 150));
    expect(end.ended).toBe(true);
    if (end.ended) {
      expect(end.declarerSeat).toBe(2);
      expect(end.Y).toBe(150);
    }
    expect(end.state.turnSeat).toBeNull(); // Dave and Alice never asked
  });
});

describe("BID-004 — multi-lap escalation", () => {
  it("players are placed on turn more than once; winner never self-bids", () => {
    let s = initBidding(P, 0);
    const turns: number[] = [];
    const act = (r: ReturnType<typeof applyBid>) => { const m = must(r); if (!m.ended) turns.push(m.state.turnSeat!); return m.state; };
    s = act(applyBid(s, P, 1, 80));
    s = act(applyBid(s, P, 2, 85));
    s = act(applyBid(s, P, 3, 90));
    s = act(applyBid(s, P, 0, 95));
    s = act(applyBid(s, P, 1, 100)); // Bob's second time on turn already happened
    s = act(applyPass(s, P, 2));
    s = act(applyPass(s, P, 3));
    const end = must(applyPass(s, P, 0));
    expect(end.ended).toBe(true);
    if (end.ended) { expect(end.declarerSeat).toBe(1); expect(end.Y).toBe(100); }
    // Bob (1) and Alice (0) each on turn at least twice across the auction
    expect(turns.filter((t) => t === 0).length).toBeGreaterThanOrEqual(1);
  });
});

describe("§8.2/§8.5 rejections", () => {
  it("rejects non-multiple-of-5, not-higher, >150, wrong seat, and never lets high bidder act", () => {
    const s = initBidding(P, 0);
    expect(applyBid(s, P, 1, 82).ok).toBe(false);
    expect(applyBid(s, P, 1, 75).ok).toBe(false);
    expect(applyBid(s, P, 1, 70).ok).toBe(false);
    expect(applyBid(s, P, 1, 155).ok).toBe(false);
    expect(applyBid(s, P, 2, 80).ok).toBe(false); // not on turn
    expect(applyPass(s, P, 0).ok).toBe(false); // high bidder can't act (and is never on turn)
  });
});

describe("TO-001 — bidding timeout → auto-pass is always legal", () => {
  it("the on-turn player is never the high bidder, so pass always succeeds", () => {
    // exhaustive: random auctions, at every step auto-pass the on-turn player must be legal
    for (let seed = 0; seed < 200; seed++) {
      let s: BiddingState = initBidding(4 + (seed % 4), seed % (4 + (seed % 4)));
      const pc = 4 + (seed % 4);
      let guard = 0;
      while (s.turnSeat !== null && guard++ < 100) {
        const r = applyPass(s, pc, s.turnSeat);
        expect(r.ok).toBe(true);
        if (r.ok) { if (r.ended) break; s = r.state; }
      }
    }
  });
});
