// TEST_CASES.md §3 (REVEAL), §5 (HID engine-level), §9 (PHASE/ROT/ENDEQ engine-level), §6 TO-003, §8 PAUSE-001
import { describe, expect, it } from "vitest";
import {
  initGame, applyAction, playerView, GameState, Action, Event, Card, cardKey, RoundData,
} from "../src/index.js";

const seed = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const c = (s: string): Card => ({ suit: s.slice(-1) as Card["suit"], rank: s.slice(0, -1) as Card["rank"] });

function ok(state: GameState, action: Action): { state: GameState; events: Event[]; versionBump: boolean } {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`rejected: ${r.reject} on ${action.type}`);
  return r;
}

/** All pass → default declarer (seat0) at 75, trump H, call QS (KAT: held by seat1). */
function setupRound(): GameState {
  let s = initGame(4, 8, 0);
  s = ok(s, { type: "START_ROUND", seed, abandonedSeats: [] }).state;
  s = ok(s, { type: "PASS", seat: 1 }).state;
  s = ok(s, { type: "PASS", seat: 2 }).state;
  s = ok(s, { type: "PASS", seat: 3 }).state;
  return s;
}
function setupTrickPlay(): GameState {
  let s = setupRound();
  s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" }).state;
  s = ok(s, { type: "CALL_CARDS", seat: 0, cards: [c("QS")] }).state; // holder = seat1 (KAT)
  return s;
}
/** Timeout-drive trick play to round end (auto-play is always legal). */
function finishRound(s: GameState): { state: GameState; events: Event[] } {
  const all: Event[] = [];
  let guard = 0;
  while (s.phase === "TRICK_PLAY" && guard++ < 200) {
    const r = ok(s, { type: "TIMEOUT" });
    s = r.state;
    all.push(...r.events);
  }
  return { state: s, events: all };
}

describe("PHASE-001/002 — declarer setup collapse & staged trump (engine level)", () => {
  it("CHOOSE_TRUMP: no version bump, no events, trump invisible in every view", () => {
    let s = setupRound();
    const r = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" });
    expect(r.versionBump).toBe(false);
    expect(r.events).toEqual([]);
    s = r.state;
    for (let seat = 0; seat < 4; seat++) {
      const v = playerView(s, seat);
      expect(v.trump).toBeNull();
      expect(v.phase).toBe("DECLARER_SETUP");
    }
  });
  it("v2.2: staged trump may be REPLACED before CALL_CARDS — silent, latest wins (§9.1 amendment)", () => {
    let s = setupRound();
    s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" }).state;
    const r = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "S" }); // mis-click fix
    expect(r.versionBump).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.state.round!.stagedTrump).toBe("S");
    const done = ok(r.state, { type: "CALL_CARDS", seat: 0, cards: [c("QH")] });
    expect(playerView(done.state, 2).trump).toBe("S"); // the replacement committed
    // after CALL_CARDS the trump IS final:
    expect(applyAction(done.state, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" }).ok).toBe(false);
  });
  it("CALL_CARDS: one transition emits TRUMP_CHOSEN then CARDS_CALLED consecutively", () => {
    let s = setupRound();
    s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" }).state;
    const r = ok(s, { type: "CALL_CARDS", seat: 0, cards: [c("QS")] });
    expect(r.versionBump).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(["TRUMP_CHOSEN", "CARDS_CALLED"]);
    for (let seat = 0; seat < 4; seat++) expect(playerView(r.state, seat).trump).toBe("H");
  });
  it("PAUSED from either sub-state is indistinguishable (event carries no sub-state; view identical)", () => {
    // (a) timeout in TRUMP_SELECTION
    const a = ok(setupRound(), { type: "TIMEOUT" });
    // (b) trump chosen (no bump/no events), then timeout in CALLING_PARTNERS
    let sb = setupRound();
    sb = ok(sb, { type: "CHOOSE_TRUMP", seat: 0, suit: "H" }).state;
    const b = ok(sb, { type: "TIMEOUT" });
    expect(a.events).toEqual([{ kind: "PAUSED" }]);
    expect(b.events).toEqual([{ kind: "PAUSED" }]);
    // Non-declarer views bit-identical across (a) and (b)
    for (const seat of [1, 2, 3]) {
      expect(JSON.stringify(playerView(a.state, seat))).toBe(JSON.stringify(playerView(b.state, seat)));
    }
    // resume returns to the correct sub-state; staged trump retained in (b)
    const resumed = ok(b.state, { type: "HOST_RESOLVE_PAUSE", resolution: "resume" });
    expect(resumed.state.phase).toBe("CALLING_PARTNERS");
    expect(resumed.state.round!.stagedTrump).toBe("H");
  });
});

describe("CALL_CARDS validation (§9.2)", () => {
  it("rejects trimmed-out cards, wrong count, duplicates", () => {
    let s = initGame(5, 10, 0);
    s = ok(s, { type: "START_ROUND", seed, abandonedSeats: [] }).state;
    for (const seat of [1, 2, 3, 4]) s = ok(s, { type: "PASS", seat }).state;
    s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "S" }).state;
    expect(applyAction(s, { type: "CALL_CARDS", seat: 0, cards: [c("2C")] }).ok).toBe(false); // trimmed out (5p)
    expect(applyAction(s, { type: "CALL_CARDS", seat: 0, cards: [c("AS"), c("AH")] }).ok).toBe(false); // C=1
    const good = applyAction(s, { type: "CALL_CARDS", seat: 0, cards: [c("AS")] });
    expect(good.ok).toBe(true);
  });
});

describe("REVEAL-001/002 — atomic reveal (§9.3)", () => {
  it("declarer seeded at CALL_CARDS; holder revealed only when card played, atomically", () => {
    let s = setupTrickPlay();
    // Before any play: EVERY view shows exactly {0} (claim model: membership = public claim record)
    expect(playerView(s, 0).revealedTeamMembers).toEqual([0]);
    expect(playerView(s, 2).revealedTeamMembers).toEqual([0]);
    expect(playerView(s, 1).revealedTeamMembers).toEqual([0]); // CLAIM model: no membership exists pre-claim, even for the holder
    expect(playerView(s, 1).allPartnersRevealed).toBe(false);

    // Drive until seat1 plays QS (spades led by declarer forces it eventually; use timeouts)
    let events: Event[] = [];
    let guard = 0;
    while (guard++ < 200 && !events.some((e) => e.kind === "PARTNER_REVEALED")) {
      const r = ok(s, { type: "TIMEOUT" });
      s = r.state;
      events = r.events;
    }
    const kinds = events.map((e) => e.kind);
    const playIdx = kinds.indexOf("CARD_PLAYED");
    const revealIdx = kinds.indexOf("PARTNER_REVEALED");
    expect(revealIdx).toBe(playIdx + 1); // reveal immediately after the play, before anything else
    const reveal = events[revealIdx] as Extract<Event, { kind: "PARTNER_REVEALED" }>;
    expect(reveal.seat).toBe(1);
    expect(cardKey(reveal.card)).toBe("QS");
    for (let seat = 0; seat < 4; seat++) {
      expect(playerView(s, seat).revealedTeamMembers).toContain(1);
      expect(playerView(s, seat).allPartnersRevealed).toBe(true);
    }
  });
});

describe("HID-001/002 — view leak protections (engine level)", () => {
  it("no view exposes another seat's hand or the unrevealed holder mapping", () => {
    const s = setupTrickPlay();
    for (let viewer = 0; viewer < 4; viewer++) {
      const v = playerView(s, viewer);
      // hand counts only for others
      expect(v.ownHand.length).toBe(13);
      expect(v.handCounts).toEqual([13, 13, 13, 13]);
      // unrevealed holder never in another viewer's revealed set
      if (viewer !== 1) expect(v.revealedTeamMembers).not.toContain(1);
      // no team totals / deltas / success anywhere pre-ROUND_END
      expect(v.lastRoundDelta).toBeNull();
      expect(v.lastRoundSuccess).toBeNull();
      // per-seat captured points present (public/derivable)
      expect(v.perPlayerCapturedPoints).toEqual([0, 0, 0, 0]);
    }
  });
  it("ROUND_SCORED at round end is the first carrier of deltas; totals correct", () => {
    const { state, events } = finishRound(setupTrickPlay());
    expect(state.phase === "ROUND_END" || state.phase === "GAME_END").toBe(true);
    const scored = events.find((e) => e.kind === "ROUND_SCORED") as Extract<Event, { kind: "ROUND_SCORED" }>;
    expect(scored).toBeDefined();
    // defenders (2,3) exactly 0; team seats ±75 each (declarer 0 + partner 1)
    expect(scored.roundDelta[2]).toBe(0);
    expect(scored.roundDelta[3]).toBe(0);
    expect(Math.abs(scored.roundDelta[0]!)).toBe(75);
    expect(scored.roundDelta[0]).toBe(scored.roundDelta[1]);
    // all 150 points captured by someone
    expect(state.round!.capturedPoints.reduce((a, b) => a + b, 0)).toBe(150);
    // view now exposes deltas
    expect(playerView(state, 2).lastRoundDelta).toEqual(scored.roundDelta);
  });
});

describe("PAUSE-001 + ENDEQ-001 — v1.9 pause-end scoring, identical end paths", () => {
  it("declarer −(S×Y), others 0; HOST_END_GAME ≡ HOST_RESOLVE_PAUSE(end)", () => {
    const paused = ok(setupRound(), { type: "TIMEOUT" }).state; // PAUSED from TRUMP_SELECTION, Y=75, declarer 0
    const a = ok(paused, { type: "HOST_END_GAME" });
    const b = ok(paused, { type: "HOST_RESOLVE_PAUSE", resolution: "end" });
    expect(a.events).toEqual(b.events);
    expect(a.state.totalScore).toEqual(b.state.totalScore);
    expect(a.state.totalScore).toEqual([-150, 0, 0, 0]); // S=2, Y=75
    expect(a.state.phase).toBe("GAME_END");
    const ended = a.events.find((e) => e.kind === "GAME_ENDED") as Extract<Event, { kind: "GAME_ENDED" }>;
    expect(ended.reason).toBe("host_end_paused");
    expect(ended.ranks).toEqual([4, 1, 1, 1]);
  });
  it("HOST_END_GAME rejected outside PAUSED/ABORTED", () => {
    expect(applyAction(setupTrickPlay(), { type: "HOST_END_GAME" }).ok).toBe(false);
  });
});

describe("REC-002 — ABORTED: no deltas; restart re-deals fresh, same round/declarer", () => {
  it("abort → end keeps prior totals; restart with new seed differs from old hands", () => {
    let s = setupTrickPlay();
    const preTotals = s.totalScore.slice();
    const oldHand0 = s.round!.hands[0]!.map(cardKey);
    s = ok(s, { type: "ABORT" }).state;
    expect(s.phase).toBe("ABORTED");

    const ended = ok(s, { type: "HOST_END_GAME" });
    expect(ended.state.totalScore).toEqual(preTotals); // no deltas
    const ev = ended.events.find((e) => e.kind === "GAME_ENDED") as Extract<Event, { kind: "GAME_ENDED" }>;
    expect(ev.reason).toBe("host_end_aborted");

    const fresh = new Uint8Array(32).fill(7);
    const restarted = ok(s, { type: "HOST_RESTART_ROUND", seed: fresh });
    expect(restarted.state.roundNumber).toBe(1); // same round number
    expect(restarted.state.round!.defaultDeclarerSeat).toBe(0); // same default declarer
    expect(restarted.state.round!.hands[0]!.map(cardKey)).not.toEqual(oldHand0); // fresh deal
  });
});

describe("ROT-001 — rotation skips abandoned seats", () => {
  it("skips abandoned seat with ROTATION_SKIPPED; all-abandoned falls back to normal", () => {
    let s = initGame(5, 10, 2);
    const r = ok(s, { type: "START_ROUND", seed, abandonedSeats: [2, 3] });
    const skip = r.events.find((e) => e.kind === "ROTATION_SKIPPED") as Extract<Event, { kind: "ROTATION_SKIPPED" }>;
    expect(skip.skippedSeats).toEqual([2, 3]);
    expect(skip.newDefaultDeclarerSeat).toBe(4);
    expect(r.state.round!.defaultDeclarerSeat).toBe(4);
    expect(r.state.nextDefaultDeclarerSeat).toBe(0); // rotates from the seat actually used

    const all = ok(initGame(5, 10, 2), { type: "START_ROUND", seed, abandonedSeats: [0, 1, 2, 3, 4] });
    expect(all.events.some((e) => e.kind === "ROTATION_SKIPPED")).toBe(false);
    expect(all.state.round!.defaultDeclarerSeat).toBe(2); // fallback: normal rotation
  });
});

describe("Full-game smoke — N rounds to GAME_END with competition ranks", () => {
  it("plays a complete 4p game via timeouts", () => {
    let s = initGame(4, 8, 0);
    let guard = 0;
    while (s.phase !== "GAME_END" && guard++ < 4000) {
      if (s.phase === "ROUND_END") {
        s = ok(s, { type: "START_ROUND", seed: new Uint8Array(32).fill(guard % 256), abandonedSeats: [] }).state;
      } else if (s.phase === "TRUMP_SELECTION") {
        s = ok(s, { type: "CHOOSE_TRUMP", seat: s.round!.declarerSeat, suit: "S" }).state;
      } else if (s.phase === "CALLING_PARTNERS") {
        // call the highest trump not in hand when possible — just call A♠ (always in play)
        s = ok(s, { type: "CALL_CARDS", seat: s.round!.declarerSeat, cards: [c("AS")] }).state;
      } else {
        s = ok(s, { type: "TIMEOUT" }).state;
      }
    }
    expect(s.phase).toBe("GAME_END");
    expect(s.roundNumber).toBe(8);
  });
});

describe("CLAIM-001/002 — 2-deck claim model (TEST_CASES §11)", () => {
  function setup2Deck(): GameState {
    let s = initGame(6, 2, 0, 2, undefined, 17); // 6 players, 2 decks, C=2 default, whole deck (102 plays)
    s = ok(s, { type: "START_ROUND", seed, abandonedSeats: [] }).state;
    let guard = 0;
    while (s.phase === "BIDDING" && guard++ < 12) s = ok(s, { type: "PASS", seat: s.round!.turnSeat! }).state;
    expect(s.round!.Y).toBe(150); // standing bid = totalPoints/2
    s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "S" }).state;
    s = ok(s, { type: "CALL_CARDS", seat: 0, cards: [c("AC"), c("KH")] }).state;
    return s;
  }

  it("first copy claims atomically; second copy of a claimed card is silent; exactly C claims per round", () => {
    let s = setup2Deck();
    expect(s.round!.claimedBy).toEqual([null, null]);
    // pre-claim: NO view shows any member beyond the declarer (claim model)
    for (let seat = 0; seat < 6; seat++) expect(playerView(s, seat).revealedTeamMembers).toEqual([0]);

    const claimed = new Set<string>();
    let claims = 0;
    let secondCopySilent = true;
    let plays = 0;
    let guard = 0;
    while (s.phase === "TRICK_PLAY" && guard++ < 300) {
      const r = ok(s, { type: "TIMEOUT" });
      for (const e of r.events) {
        if (e.kind === "CARD_PLAYED") {
          plays++;
          const k = cardKey(e.card);
          const wasClaimed = claimed.has(k);
          const revealNow = r.events.some((x) => x.kind === "PARTNER_REVEALED" && cardKey((x as any).card) === k);
          if (wasClaimed && revealNow) secondCopySilent = false;
        }
        if (e.kind === "PARTNER_REVEALED") { claims++; claimed.add(cardKey((e as any).card)); }
      }
      s = r.state;
    }
    expect(s.phase === "ROUND_END" || s.phase === "GAME_END").toBe(true);
    expect(plays).toBe(102); // every card of the trimmed double deck is played
    expect(claims).toBe(2); // exactly C claims — never one per copy
    expect(secondCopySilent).toBe(true);
    expect(s.round!.capturedPoints.reduce((a, b) => a + b, 0)).toBe(300);
    // scoring: only declarer + claimants carry deltas; defenders exactly 0
    const team = new Set([0, ...s.round!.claimedBy.map((x) => x!)]);
    s.lastRoundResult!.roundDelta.forEach((d, seat) => {
      if (team.has(seat)) expect(d).not.toBe(0);
      else expect(d).toBe(0);
    });
  });

  it("duplicate identities rejected in CALL_CARDS; one-copy-per-play removal", () => {
    let s = initGame(6, 2, 0, 2, undefined, 17);
    s = ok(s, { type: "START_ROUND", seed, abandonedSeats: [] }).state;
    let guard = 0;
    while (s.phase === "BIDDING" && guard++ < 12) s = ok(s, { type: "PASS", seat: s.round!.turnSeat! }).state;
    s = ok(s, { type: "CHOOSE_TRUMP", seat: 0, suit: "S" }).state;
    expect(applyAction(s, { type: "CALL_CARDS", seat: 0, cards: [c("AC"), c("AC")] }).ok).toBe(false); // same identity twice
    s = ok(s, { type: "CALL_CARDS", seat: 0, cards: [c("AC"), c("KH")] }).state;
    // a hand holding two identical cards loses exactly ONE per play (the empty-hand bug guard)
    const total = () => s.round!.hands.flat().length + s.round!.completedTricks.length * 6 + s.round!.currentTrick.length;
    const before = total();
    s = ok(s, { type: "TIMEOUT" }).state; // one auto-play
    expect(total()).toBe(before); // conservation: 102 cards accounted for at all times
  });
});

// DEADRUBBER — v2.3: end a round the instant its outcome is settled AND every partner is public.
describe("DEADRUBBER — auto-end decided rounds", () => {
  const S = (r: string): Card => ({ suit: "S", rank: r as Card["rank"] });
  // A mid-round TRICK_PLAY state: partner (seat1) already claimed Q♠, all hands hold 2 plain spades,
  // so a full trick can resolve without emptying hands — the ideal probe for the auto-end check.
  const mkRound = (over: Partial<RoundData> = {}): RoundData => ({
    defaultDeclarerSeat: 0,
    hands: [[S("2"), S("3")], [S("4"), S("6")], [S("7"), S("8")], [S("9"), S("J")]],
    bidding: { currentHighBid: 5, currentHighBidderSeat: 0, activeSeats: [0], turnSeat: null, history: [] },
    declarerSeat: 0, Y: 5, stagedTrump: null, trump: "S", calledCards: [S("Q")],
    claimedBy: [1], revealedTeamMembers: [0, 1],
    trickLeaderSeat: 0, currentTrick: [], completedTricks: [],
    capturedPoints: [10, 0, 0, 0], // declarer team (seats 0,1) already holds 10 ≥ Y=5 → made for sure
    turnSeat: 0,
    ...over,
  });
  const mkState = (autoEnd: boolean, round: RoundData): GameState => ({
    playerCount: 4, N: 1, deckCount: 1, handSize: 2, calledCount: 1, totalPoints: 150,
    roundNumber: 1, totalScore: [0, 0, 0, 0], phase: "TRICK_PLAY", pausedFrom: null,
    round, lastRoundResult: null, nextDefaultDeclarerSeat: 1, autoEndDecidedRounds: autoEnd,
  });
  const playFullTrick = (s: GameState) => {
    s = ok(s, { type: "PLAY_CARD", seat: 0, card: S("2") }).state;
    s = ok(s, { type: "PLAY_CARD", seat: 1, card: S("4") }).state;
    s = ok(s, { type: "PLAY_CARD", seat: 2, card: S("7") }).state;
    return ok(s, { type: "PLAY_CARD", seat: 3, card: S("9") });
  };

  it("ends the round early (mid-hand) once decided + all partners revealed", () => {
    const r = playFullTrick(mkState(true, mkRound()));
    const scored = r.events.find((e) => e.kind === "ROUND_SCORED") as Extract<Event, { kind: "ROUND_SCORED" }>;
    expect(scored).toBeTruthy();
    expect(scored.earlyEnd).toBe(true);
    expect(scored.success).toBe(true); // 10 ≥ Y=5
    expect(r.state.phase).toBe("GAME_END"); // N=1
    expect(r.state.round!.hands.some((h) => h.length > 0)).toBe(true); // hands NOT empty — tail was skipped
    expect(playerView(r.state, 0).lastRoundEarlyEnd).toBe(true);
  });

  it("gate off: same state plays on normally (no early end)", () => {
    const r = playFullTrick(mkState(false, mkRound()));
    expect(r.events.some((e) => e.kind === "ROUND_SCORED")).toBe(false);
    expect(r.state.phase).toBe("TRICK_PLAY");
  });

  it("undecided contract keeps playing even with the gate on", () => {
    // declarer team holds 0; 150 points still unaccounted → outcome not settled → no early end
    const r = playFullTrick(mkState(true, mkRound({ capturedPoints: [0, 0, 0, 0] })));
    expect(r.events.some((e) => e.kind === "ROUND_SCORED")).toBe(false);
    expect(r.state.phase).toBe("TRICK_PLAY");
  });

  it("failed-for-sure ends early too (can't reach Y even with all remaining points)", () => {
    // Y bigger than every point still in play: total captured so far 150 (all points already taken by
    // defenders), declarer team 0 → 0 + 0 remaining < Y → decided failure.
    const r = playFullTrick(mkState(true, mkRound({ Y: 20, capturedPoints: [0, 0, 90, 60] })));
    const scored = r.events.find((e) => e.kind === "ROUND_SCORED") as Extract<Event, { kind: "ROUND_SCORED" }>;
    expect(scored.earlyEnd).toBe(true);
    expect(scored.success).toBe(false);
  });
});
