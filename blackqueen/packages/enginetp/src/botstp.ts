// Heuristic Teen Patti bots — legal by construction, deliberately simple for v1. They see their cards
// immediately, bet by hand strength, pack weak hands when it gets expensive, show/decide at two players,
// and occasionally ask for a sideshow. A stronger bot can replace botAction later without touching callers.

import { Card, HandCat, evaluate } from "./cardstp.js";
import { State, Action, currentActor, legalActions } from "./roundtp.js";
import { mulberry32 } from "./dealtp.js";

/** 0 (junk) → 1 (trail). */
function strength(cards: Card[]): number {
  const r = evaluate(cards);
  switch (r.cat) {
    case HandCat.TRAIL: return 1;
    case HandCat.PURE_SEQUENCE: return 0.95;
    case HandCat.SEQUENCE: return 0.85;
    case HandCat.COLOUR: return 0.68;
    case HandCat.PAIR: return 0.42 + (r.key[0]! - 2) / 45;
    default: return 0.12 + (r.key[0]! - 2) / 55;
  }
}

export function botAction(s: State, seat: number): Action | null {
  if (currentActor(s) !== seat) return null;
  const p = s.players[seat]!;
  const st = strength(p.cards);
  const rng = mulberry32((s.pot * 131 + s.stake * 17 + seat * 7 + p.cards.reduce((a, c) => a + c.rank.charCodeAt(0), 0)) >>> 0);

  // answering a sideshow request: accept when we're likely ahead
  if (s.phase === "SIDESHOW" && s.sideshow?.target === seat) {
    return { type: "SIDESHOW_RESPONSE", seat, accept: st >= 0.45 };
  }

  const a = legalActions(s, seat);
  // look at our cards before betting
  if (a.canSee) return { type: "SEE", seat };

  const rem = p.stack - p.bet;
  const call = a.bets.length > 0 ? a.bets[0]! : 0;
  const raise = a.bets.length > 0 ? a.bets[a.bets.length - 1]! : 0;
  const expensive = call > rem * 0.22;

  // heads-up: decide the hand instead of bleeding chips
  if (a.canShow) {
    if (st >= 0.6 || s.stake >= s.maxStake / 2) return { type: "SHOW", seat };
    if (st < 0.32) return { type: "PACK", seat };
    return a.bets.length ? { type: "BET", seat, amount: call } : { type: "PACK", seat };
  }

  // occasional sideshow with a medium hand
  if (a.canSideshow && st >= 0.4 && st < 0.78 && rng() < 0.35) return { type: "SIDESHOW", seat };

  if (a.bets.length === 0) return { type: "PACK", seat };
  if (st >= 0.7 && raise > call && s.stake < s.maxStake / 4) return { type: "BET", seat, amount: raise };
  if (st >= 0.3 && !(expensive && st < 0.45)) return { type: "BET", seat, amount: call };
  if (st < 0.3 && s.stake <= s.boot * 2) return { type: "BET", seat, amount: call }; // cheap to stay
  return { type: "PACK", seat };
}
