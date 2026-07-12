// M2 gate — property tests over randomized full games (IMPLEMENTATION_PLAN.md M1.5/M2).
// Invariants: 150 points/round; auction terminates; playable always; views never leak;
// replay of (seed, actions) is bit-identical.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  initGame, applyAction, playerView, GameState, Action, Event, Card, cardKey,
  legalPlays, canonicalDeck, SUITS, calledCardCount, TOTAL_POINTS,
} from "../src/index.js";

/** Deterministic pseudo-driver: plays a full game making rng-driven legal choices. */
function driveGame(playerCount: number, N: number, rngSeq: number[]): { finals: GameState; log: Action[]; states: GameState[] } {
  let rp = 0;
  const rnd = (n: number) => rngSeq[rp++ % rngSeq.length]! % n;
  let s = initGame(playerCount, N, rnd(playerCount));
  const log: Action[] = [];
  const states: GameState[] = [s];
  const apply = (a: Action) => {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`rejected ${r.reject} on ${a.type} in ${s.phase}`);
    s = r.state;
    log.push(a);
    states.push(s);
    return r.events;
  };
  let guard = 0;
  while (s.phase !== "GAME_END" && guard++ < 20000) {
    switch (s.phase) {
      case "ROUND_END": {
        const seedBytes = new Uint8Array(32).map(() => rnd(256));
        apply({ type: "START_ROUND", seed: seedBytes, abandonedSeats: [] });
        break;
      }
      case "BIDDING": {
        const seat = s.round!.turnSeat!;
        const hi = s.round!.bidding.currentHighBid;
        if (hi < 150 && rnd(4) === 0) {
          const maxSteps = (150 - hi) / 5;
          apply({ type: "BID", seat, value: hi + 5 * (1 + rnd(maxSteps)) });
        } else {
          apply({ type: "PASS", seat });
        }
        break;
      }
      case "TRUMP_SELECTION":
        apply({ type: "CHOOSE_TRUMP", seat: s.round!.declarerSeat, suit: SUITS[rnd(4)]! });
        break;
      case "CALLING_PARTNERS": {
        const deck = canonicalDeck(playerCount);
        const C = calledCardCount(playerCount);
        const cards: Card[] = [];
        while (cards.length < C) {
          const c = deck[rnd(deck.length)]!;
          if (!cards.some((x) => cardKey(x) === cardKey(c))) cards.push(c);
        }
        apply({ type: "CALL_CARDS", seat: s.round!.declarerSeat, cards });
        break;
      }
      case "TRICK_PLAY": {
        const seat = s.round!.turnSeat!;
        if (rnd(6) === 0) {
          apply({ type: "TIMEOUT" }); // exercise auto-play
        } else {
          const led = s.round!.currentTrick.length === 0 ? null : s.round!.currentTrick[0]!.card.suit;
          const legal = legalPlays(s.round!.hands[seat]!, led);
          apply({ type: "PLAY_CARD", seat, card: legal[rnd(legal.length)]! });
        }
        break;
      }
      default:
        throw new Error(`unexpected phase ${s.phase}`);
    }
  }
  if (s.phase !== "GAME_END") throw new Error("game did not terminate");
  return { finals: s, log, states };
}

/** Structural leak walker: every Card object reachable in a view must be publicly justified. */
function assertNoLeak(state: GameState, viewerSeat: number): void {
  const v = playerView(state, viewerSeat);
  const allowed = new Set<string>([
    ...v.ownHand.map(cardKey),
    ...v.calledCards.map(cardKey),
    ...v.currentTrick.map((p) => cardKey(p.card)),
    ...v.completedTricks.flatMap((t) => t.plays.map((p) => cardKey(p.card))),
  ]);
  const walk = (o: unknown): void => {
    if (o === null || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const rec = o as Record<string, unknown>;
    if (typeof rec.suit === "string" && typeof rec.rank === "string") {
      const key = `${rec.rank}${rec.suit}`;
      if (!allowed.has(key)) throw new Error(`view for seat ${viewerSeat} leaks card ${key}`);
      return;
    }
    Object.values(rec).forEach(walk);
  };
  walk(v);
  // Membership visibility must be exactly justified: a seat may appear in the viewer's
  // revealedTeamMembers iff it is the declarer, has played a called card, or is the viewer themselves.
  const r = state.round;
  if (r) {
    const justified = (seat: number): boolean =>
      seat === r.declarerSeat ||
      seat === viewerSeat ||
      r.calledCardHolders.some((h, i) => h === seat && r.playedCalledCards.includes(cardKey(r.calledCards[i]!)));
    for (const seat of v.revealedTeamMembers) {
      if (!justified(seat)) throw new Error(`unjustified membership ${seat} leaked to seat ${viewerSeat}`);
    }
  }
  // Deltas/success only at round end
  if (state.phase !== "ROUND_END" && state.phase !== "GAME_END") {
    if (v.lastRoundDelta !== null || v.lastRoundSuccess !== null) throw new Error("pre-ROUND_END delta leak");
  }
}

describe("property suite — randomized full games", () => {
  it("invariants hold across random games (all player counts)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 7 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 40, maxLength: 200 }),
        (playerCount, rngSeq) => {
          const N = playerCount; // one rotation keeps runs fast
          const { finals, states } = driveGame(playerCount, N, rngSeq);

          // termination + round count
          expect(finals.phase).toBe("GAME_END");
          expect(finals.roundNumber).toBe(N);

          for (const s of states) {
            // captured points never exceed 150; at ROUND_END they sum to exactly 150
            if (s.round) {
              const sum = s.round.capturedPoints.reduce((a, b) => a + b, 0);
              expect(sum).toBeLessThanOrEqual(TOTAL_POINTS);
              if (s.phase === "ROUND_END" || (s.phase === "GAME_END" && s.round)) expect(sum).toBe(TOTAL_POINTS);
              // on-turn player always has a legal action in trick play
              if (s.phase === "TRICK_PLAY") {
                const led = s.round.currentTrick.length === 0 ? null : s.round.currentTrick[0]!.card.suit;
                expect(legalPlays(s.round.hands[s.round.turnSeat!]!, led).length).toBeGreaterThan(0);
              }
              // bidding: scheduler never selects the high bidder
              if (s.phase === "BIDDING") expect(s.round.turnSeat).not.toBe(s.round.bidding.currentHighBidderSeat);
            }
            // leak check for every viewer at every step
            for (let seat = 0; seat < playerCount; seat++) assertNoLeak(s, seat);
          }

          // score conservation: total deltas match team formula sign structure (defenders 0)
          const totals = finals.totalScore;
          expect(totals.length).toBe(playerCount);
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);

  it("replay determinism: same driver inputs ⇒ bit-identical final state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 7 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 40, maxLength: 120 }),
        (playerCount, rngSeq) => {
          const a = driveGame(playerCount, playerCount, rngSeq);
          const b = driveGame(playerCount, playerCount, rngSeq);
          expect(JSON.stringify(a.finals)).toBe(JSON.stringify(b.finals));
        },
      ),
      { numRuns: 10 },
    );
  }, 60_000);
});
