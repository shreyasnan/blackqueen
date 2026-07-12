// GAME_SPEC.md §14.1 state machine as a pure reducer.
// applyAction(state, action) -> { state, events, versionBump } | { reject }
// Zero I/O: seeds, abandoned-seat info, and timeouts arrive AS actions from the shell (RoomDO).

import { Card, Suit, SUITS, cardEq, cardKey, calledCardCount, canonicalDeck, defaultHandSize, minHandSize, maxHandSize } from "./cards.js";
import { deal } from "./deal.js";
import { BiddingState, applyBid, applyPass, initBidding } from "./bidding.js";
import { autoPlayCard, autoPlayCardTeam, isLegalPlay, legalPlays, trickWinner, trickPoints, TrickPlay } from "./tricks.js";
import { scoreRound, pauseEndDelta, competitionRanks, RoundScore } from "./scoring.js";

export type Phase =
  | "BIDDING"
  | "TRUMP_SELECTION"
  | "CALLING_PARTNERS"
  | "TRICK_PLAY" // TRICK_LEAD/TRICK_FOLLOW distinction is derivable (empty trick = lead)
  | "ROUND_END"
  | "GAME_END"
  | "PAUSED"
  | "ABORTED";

export interface RoundData {
  defaultDeclarerSeat: number;
  hands: Card[][]; // SECRET per seat
  bidding: BiddingState;
  declarerSeat: number;
  Y: number;
  stagedTrump: Suit | null; // §9.2: staged, unversioned, undisclosed
  trump: Suit | null; // committed at CALL_CARDS
  calledCards: Card[];
  claimedBy: (number | null)[]; // CLAIM model §9.3: parallel to calledCards; set when the FIRST copy is played
  revealedTeamMembers: number[]; // public claim record: declarerSeat (at CALL_CARDS) + claimants
  trickLeaderSeat: number;
  currentTrick: TrickPlay[];
  completedTricks: { plays: TrickPlay[]; winnerSeat: number }[];
  capturedPoints: number[]; // PER SEAT — never a team total (§10)
  turnSeat: number | null;
}

export interface GameState {
  playerCount: number;
  N: number;
  deckCount: number; // 1 | 2 (§3/§16); 2 only for 6–7 players
  handSize: number; // cards per player (§3.2/§16, v2.1); deck trimmed to playerCount × handSize
  calledCount: number; // C (§9.2/§16)
  totalPoints: number; // 150 × deckCount (§5)
  roundNumber: number; // 1-based; 0 = not started
  totalScore: number[];
  phase: Phase;
  pausedFrom: "TRUMP_SELECTION" | "CALLING_PARTNERS" | null;
  round: RoundData | null;
  lastRoundResult: (RoundScore & { roundNumber: number }) | null;
  nextDefaultDeclarerSeat: number; // rotation pointer (round-1 seat at init)
}

export type Action =
  | { type: "START_ROUND"; seed: Uint8Array; abandonedSeats: number[] }
  | { type: "BID"; seat: number; value: number }
  | { type: "PASS"; seat: number }
  | { type: "CHOOSE_TRUMP"; seat: number; suit: Suit }
  | { type: "CALL_CARDS"; seat: number; cards: Card[] }
  | { type: "PLAY_CARD"; seat: number; card: Card }
  | { type: "TIMEOUT" } // shell fires at turnTimerMs+graceMs; engine picks the normative default
  | { type: "HOST_RESOLVE_PAUSE"; resolution: "resume" | "end" }
  | { type: "HOST_END_GAME" }
  | { type: "HOST_RESTART_ROUND"; seed: Uint8Array }
  | { type: "ABORT" }; // §10 fatal guard escalation from the shell

export type Event =
  | { kind: "ROUND_STARTED"; roundNumber: number; defaultDeclarerSeat: number; handCounts: number[] }
  | { kind: "ROTATION_SKIPPED"; skippedSeats: number[]; newDefaultDeclarerSeat: number }
  | { kind: "BID_PLACED"; seat: number; value: number }
  | { kind: "PLAYER_PASSED"; seat: number; auto: boolean }
  | { kind: "AUCTION_ENDED"; declarerSeat: number; Y: number }
  | { kind: "TRUMP_CHOSEN"; suit: Suit } // emitted only alongside CARDS_CALLED (§9.2)
  | { kind: "CARDS_CALLED"; cards: Card[] }
  | { kind: "CARD_PLAYED"; seat: number; card: Card; auto: boolean }
  | { kind: "PARTNER_REVEALED"; seat: number; card: Card }
  | { kind: "TRICK_WON"; winnerSeat: number; points: number; capturedPointsWinner: number }
  | { kind: "ROUND_SCORED"; roundNumber: number; success: boolean; declarerTeamPoints: number; roundDelta: number[]; totalScore: number[] }
  | { kind: "GAME_ENDED"; totalScore: number[]; ranks: number[]; reason: "completed" | "host_end_paused" | "host_end_aborted" }
  | { kind: "PAUSED" } // deliberately carries NO sub-state (§9.2 disclosure gating)
  | { kind: "RESUMED" }
  | { kind: "ABORTED" };

export type ApplyResult =
  | { ok: true; state: GameState; events: Event[]; versionBump: boolean }
  | { ok: false; reject: "ILLEGAL" | "NOT_YOUR_TURN" | "WRONG_PHASE" };

export function initGame(playerCount: number, N: number, round1DefaultDeclarerSeat: number, deckCount = 1, calledCountOverride?: number, handSizeOverride?: number): GameState {
  if (playerCount < 4 || playerCount > 7) throw new Error("4–7 players only (§2)");
  if (deckCount !== 1 && deckCount !== 2) throw new Error("deckCount must be 1 or 2 (§16)");
  if (deckCount === 2 && playerCount < 6) throw new Error("2-deck games require 6–7 players (§3/§16)");
  if (!Number.isInteger(N) || N < 1 || N > 10 * playerCount) throw new Error("N out of bounds (§16)");
  const handSize = handSizeOverride ?? defaultHandSize(playerCount, deckCount);
  if (!Number.isInteger(handSize) || handSize < minHandSize(playerCount, deckCount) || handSize > maxHandSize(playerCount, deckCount)) {
    throw new Error(`handSize must be ${minHandSize(playerCount, deckCount)}–${maxHandSize(playerCount, deckCount)} for ${playerCount}p/${deckCount}-deck (§3.2/§16)`);
  }
  const calledCount = deckCount === 2
    ? (calledCountOverride ?? 2)
    : calledCardCount(playerCount); // single-deck: fixed table, override ignored (§9.2)
  if (deckCount === 2 && (calledCount < 1 || calledCount > 3 || !Number.isInteger(calledCount))) {
    throw new Error("calledCount must be 1–3 in 2-deck games (§16)");
  }
  return {
    playerCount, N,
    deckCount, handSize, calledCount, totalPoints: 150 * deckCount,
    roundNumber: 0,
    totalScore: Array(playerCount).fill(0),
    phase: "ROUND_END" as Phase, // pre-game: awaiting first START_ROUND
    pausedFrom: null,
    round: null,
    lastRoundResult: null,
    nextDefaultDeclarerSeat: round1DefaultDeclarerSeat,
  };
}

const reject = (reason: "ILLEGAL" | "NOT_YOUR_TURN" | "WRONG_PHASE"): ApplyResult => ({ ok: false, reject: reason });

export function allPartnersRevealed(r: RoundData): boolean {
  return r.calledCards.length > 0 && r.claimedBy.length === r.calledCards.length && r.claimedBy.every((s) => s !== null);
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  switch (action.type) {
    case "START_ROUND": return startRound(state, action);
    case "BID": return bid(state, action.seat, action.value);
    case "PASS": return pass(state, action.seat, false);
    case "CHOOSE_TRUMP": return chooseTrump(state, action.seat, action.suit);
    case "CALL_CARDS": return callCards(state, action.seat, action.cards);
    case "PLAY_CARD": return playCard(state, action.seat, action.card, false);
    case "TIMEOUT": return timeout(state);
    case "HOST_RESOLVE_PAUSE": return resolvePause(state, action.resolution);
    case "HOST_END_GAME": return hostEndGame(state);
    case "HOST_RESTART_ROUND": return restartRound(state, action.seed);
    case "ABORT": return abort(state);
  }
}

function startRound(state: GameState, action: { seed: Uint8Array; abandonedSeats: number[] }): ApplyResult {
  if (state.phase !== "ROUND_END") return reject("WRONG_PHASE");
  if (state.roundNumber >= state.N) return reject("WRONG_PHASE"); // game over
  const events: Event[] = [];
  const roundNumber = state.roundNumber + 1;

  // §7 rotation + v1.9 abandoned-seat skip (all-abandoned fallback: no skip)
  let seat = state.nextDefaultDeclarerSeat;
  const skipped: number[] = [];
  const abandoned = new Set(action.abandonedSeats);
  if (abandoned.size < state.playerCount) {
    while (abandoned.has(seat)) {
      skipped.push(seat);
      seat = (seat + 1) % state.playerCount;
    }
  }
  if (skipped.length > 0) events.push({ kind: "ROTATION_SKIPPED", skippedSeats: skipped, newDefaultDeclarerSeat: seat });

  const hands = deal(state.playerCount, seat, action.seed, state.deckCount, state.handSize);
  const bidding = initBidding(state.playerCount, seat, state.totalPoints / 2);
  const round: RoundData = {
    defaultDeclarerSeat: seat,
    hands,
    bidding,
    declarerSeat: -1,
    Y: 0,
    stagedTrump: null,
    trump: null,
    calledCards: [],
    claimedBy: [],
    revealedTeamMembers: [],
    trickLeaderSeat: -1,
    currentTrick: [],
    completedTricks: [],
    capturedPoints: Array(state.playerCount).fill(0),
    turnSeat: bidding.turnSeat,
  };
  events.push({ kind: "ROUND_STARTED", roundNumber, defaultDeclarerSeat: seat, handCounts: hands.map((h) => h.length) });
  return {
    ok: true,
    versionBump: true,
    events,
    state: {
      ...state,
      roundNumber,
      phase: "BIDDING",
      round,
      lastRoundResult: null,
      nextDefaultDeclarerSeat: (seat + 1) % state.playerCount, // rotate from the seat actually used
    },
  };
}

function bid(state: GameState, seat: number, value: number): ApplyResult {
  if (state.phase !== "BIDDING" || !state.round) return reject("WRONG_PHASE");
  const res = applyBid(state.round.bidding, state.playerCount, seat, value, state.totalPoints);
  if (!res.ok) return reject(res.reason as "ILLEGAL" | "NOT_YOUR_TURN");
  const events: Event[] = [{ kind: "BID_PLACED", seat, value }];
  return finishBidStep(state, res, events);
}

function pass(state: GameState, seat: number, auto: boolean): ApplyResult {
  if (state.phase !== "BIDDING" || !state.round) return reject("WRONG_PHASE");
  const res = applyPass(state.round.bidding, state.playerCount, seat);
  if (!res.ok) return reject(res.reason as "ILLEGAL" | "NOT_YOUR_TURN");
  const events: Event[] = [{ kind: "PLAYER_PASSED", seat, auto }];
  return finishBidStep(state, res, events);
}

function finishBidStep(
  state: GameState,
  res: Extract<ReturnType<typeof applyBid>, { ok: true }>,
  events: Event[],
): ApplyResult {
  const round = { ...state.round!, bidding: res.state };
  if (res.ended) {
    events.push({ kind: "AUCTION_ENDED", declarerSeat: res.declarerSeat, Y: res.Y });
    round.declarerSeat = res.declarerSeat;
    round.Y = res.Y;
    round.turnSeat = res.declarerSeat;
    return { ok: true, versionBump: true, events, state: { ...state, phase: "TRUMP_SELECTION", round } };
  }
  round.turnSeat = res.state.turnSeat;
  return { ok: true, versionBump: true, events, state: { ...state, round } };
}

function chooseTrump(state: GameState, seat: number, suit: Suit): ApplyResult {
  // v2.2 (§9.1 amendment): the staged trump may be REPLACED any time before CALL_CARDS —
  // staging bumps nothing and emits nothing, so re-staging leaks nothing to the table.
  // Trump is final only when CALL_CARDS applies the staged value in one versioned transition.
  if ((state.phase !== "TRUMP_SELECTION" && state.phase !== "CALLING_PARTNERS") || !state.round) return reject("WRONG_PHASE");
  if (seat !== state.round.declarerSeat) return reject("NOT_YOUR_TURN");
  if (!SUITS.includes(suit)) return reject("ILLEGAL");
  // §9.2 staged apply: NO version bump, NO events (declarer's client echoes locally).
  return {
    ok: true,
    versionBump: false,
    events: [],
    state: { ...state, phase: "CALLING_PARTNERS", round: { ...state.round, stagedTrump: suit } },
  };
}

function callCards(state: GameState, seat: number, cards: Card[]): ApplyResult {
  if (state.phase !== "CALLING_PARTNERS" || !state.round) return reject("WRONG_PHASE");
  const r = state.round;
  if (seat !== r.declarerSeat) return reject("NOT_YOUR_TURN");
  const C = state.calledCount;
  if (cards.length !== C) return reject("ILLEGAL");
  const inPlay = new Set(canonicalDeck(state.playerCount, state.deckCount, state.handSize).map(cardKey));
  if (!cards.every((c) => inPlay.has(cardKey(c)))) return reject("ILLEGAL"); // identity must have a copy in play (§9.2)
  const keys = cards.map(cardKey);
  if (new Set(keys).size !== keys.length) return reject("ILLEGAL"); // pairwise-distinct identities

  // §9.2 + §9.3: single versioned transition — TRUMP_CHOSEN + CARDS_CALLED at consecutive seq.
  const events: Event[] = [
    { kind: "TRUMP_CHOSEN", suit: r.stagedTrump! },
    { kind: "CARDS_CALLED", cards },
  ];
  const round: RoundData = {
    ...r,
    trump: r.stagedTrump,
    stagedTrump: null,
    calledCards: cards,
    claimedBy: cards.map(() => null), // CLAIM model: nothing claimed until a first copy is played
    revealedTeamMembers: [r.declarerSeat], // §9.3: declarer seeded — public role membership
    trickLeaderSeat: r.declarerSeat, // §10: declarer leads trick 1
    turnSeat: r.declarerSeat,
  };
  return { ok: true, versionBump: true, events, state: { ...state, phase: "TRICK_PLAY", round } };
}

function playCard(state: GameState, seat: number, card: Card, auto: boolean): ApplyResult {
  if (state.phase !== "TRICK_PLAY" || !state.round) return reject("WRONG_PHASE");
  const r = state.round;
  if (seat !== r.turnSeat) return reject("NOT_YOUR_TURN");
  const hand = r.hands[seat]!;
  const ledSuit = r.currentTrick.length === 0 ? null : r.currentTrick[0]!.card.suit;
  if (!isLegalPlay(hand, ledSuit, card)) return reject("ILLEGAL");

  // §10 accepted-play atomic steps
  const events: Event[] = [{ kind: "CARD_PLAYED", seat, card, auto }];
  // remove exactly ONE copy — a hand may hold two identical cards in 2-deck games
  const removeIdx = hand.findIndex((c) => cardEq(c, card));
  const hands = r.hands.map((h, i) => (i === seat ? h.filter((_, j) => j !== removeIdx) : h));
  const currentTrick = [...r.currentTrick, { seat, card }];
  let revealedTeamMembers = r.revealedTeamMembers;
  let claimedBy = r.claimedBy;
  const claimIdx = r.calledCards.findIndex((cc, i) => cardEq(cc, card) && r.claimedBy[i] === null);
  if (claimIdx >= 0) {
    // CLAIM (§9.3): first copy of an unclaimed called card — claimant joins the team, atomically.
    // A later copy of an already-claimed identity matches nothing here: ordinary card, no event.
    claimedBy = claimedBy.map((s, i) => (i === claimIdx ? seat : s));
    events.push({ kind: "PARTNER_REVEALED", seat, card }); // atomic with the play, before next turn (§9.3)
    if (!revealedTeamMembers.includes(seat)) revealedTeamMembers = [...revealedTeamMembers, seat];
  }

  let round: RoundData = { ...r, hands, currentTrick, revealedTeamMembers, claimedBy };

  if (currentTrick.length === state.playerCount) {
    // TRICK_RESOLVE (engine step): per-seat crediting only (§10/§14.1)
    const winnerSeat = trickWinner(currentTrick, round.trump!, state.deckCount);
    const pts = trickPoints(currentTrick);
    const capturedPoints = round.capturedPoints.map((p, i) => (i === winnerSeat ? p + pts : p));
    events.push({ kind: "TRICK_WON", winnerSeat, points: pts, capturedPointsWinner: capturedPoints[winnerSeat]! });
    round = {
      ...round,
      capturedPoints,
      completedTricks: [...round.completedTricks, { plays: currentTrick, winnerSeat }],
      currentTrick: [],
      trickLeaderSeat: winnerSeat,
      turnSeat: winnerSeat,
    };
    if (round.hands.every((h) => h.length === 0)) {
      return scoreAndEndRound(state, round, events); // ROUND_SCORING guard: all hands empty (§10)
    }
  } else {
    round.turnSeat = (seat + 1) % state.playerCount;
  }
  return { ok: true, versionBump: true, events, state: { ...state, round } };
}

function scoreAndEndRound(state: GameState, round: RoundData, events: Event[]): ApplyResult {
  const claimants = round.claimedBy.map((s) => s!); // round complete ⇒ every called card claimed (§9.3)
  const score = scoreRound(state.playerCount, round.Y, round.declarerSeat, round.calledCards, claimants, round.capturedPoints);
  const totalScore = state.totalScore.map((t, i) => t + score.roundDelta[i]!);
  events.push({
    kind: "ROUND_SCORED",
    roundNumber: state.roundNumber,
    success: score.success,
    declarerTeamPoints: score.declarerTeamPoints,
    roundDelta: score.roundDelta,
    totalScore,
  });
  let phase: Phase = "ROUND_END";
  if (state.roundNumber >= state.N) {
    phase = "GAME_END";
    events.push({ kind: "GAME_ENDED", totalScore, ranks: competitionRanks(totalScore), reason: "completed" });
  }
  return {
    ok: true, versionBump: true, events,
    state: { ...state, phase, totalScore, round: { ...round, turnSeat: null }, lastRoundResult: { ...score, roundNumber: state.roundNumber } },
  };
}

function timeout(state: GameState): ApplyResult {
  const r = state.round;
  switch (state.phase) {
    case "BIDDING": // §8.6 auto-pass — always legal (on-turn is never the high bidder)
      return pass(state, r!.turnSeat!, true);
    case "TRICK_PLAY": { // §10 auto-play: defenders least-valuable; declarer side team-preserving (v2.2)
      const seat = r!.turnSeat!;
      const ledSuit = r!.currentTrick.length === 0 ? null : r!.currentTrick[0]!.card.suit;
      const onDeclarerSide = seat === r!.declarerSeat || r!.claimedBy.includes(seat);
      const card = onDeclarerSide
        ? autoPlayCardTeam(r!.hands[seat]!, ledSuit, r!.trump!, r!.currentTrick, state.deckCount)
        : autoPlayCard(r!.hands[seat]!, ledSuit);
      return playCard(state, seat, card, true);
    }
    case "TRUMP_SELECTION":
    case "CALLING_PARTNERS": // §9.4: never auto-select → PAUSED (event carries no sub-state)
      return {
        ok: true, versionBump: true, events: [{ kind: "PAUSED" }],
        state: { ...state, phase: "PAUSED", pausedFrom: state.phase },
      };
    default:
      return reject("WRONG_PHASE");
  }
}

function resolvePause(state: GameState, resolution: "resume" | "end"): ApplyResult {
  if (state.phase !== "PAUSED") return reject("WRONG_PHASE");
  if (resolution === "resume") {
    return {
      ok: true, versionBump: true, events: [{ kind: "RESUMED" }],
      state: { ...state, phase: state.pausedFrom!, pausedFrom: null },
    };
  }
  return endFromPaused(state);
}

/** §9.4 v1.9: abandoned contract = failure charged to the declarer alone. */
function endFromPaused(state: GameState): ApplyResult {
  const r = state.round!;
  const delta = pauseEndDelta(state.playerCount, r.Y, r.declarerSeat, state.calledCount);
  const totalScore = state.totalScore.map((t, i) => t + delta[i]!);
  const events: Event[] = [
    {
      kind: "ROUND_SCORED",
      roundNumber: state.roundNumber,
      success: false,
      declarerTeamPoints: 0,
      roundDelta: delta,
      totalScore,
    },
    { kind: "GAME_ENDED", totalScore, ranks: competitionRanks(totalScore), reason: "host_end_paused" },
  ];
  return {
    ok: true, versionBump: true, events,
    state: { ...state, phase: "GAME_END", pausedFrom: null, totalScore, round: null },
  };
}

function hostEndGame(state: GameState): ApplyResult {
  if (state.phase === "PAUSED") return endFromPaused(state); // ENDEQ-001: identical to HOST_RESOLVE_PAUSE end
  if (state.phase === "ABORTED") {
    // §14.1: no deltas — corruption is nobody's fault
    const events: Event[] = [{ kind: "GAME_ENDED", totalScore: state.totalScore, ranks: competitionRanks(state.totalScore), reason: "host_end_aborted" }];
    return { ok: true, versionBump: true, events, state: { ...state, phase: "GAME_END", round: null } };
  }
  return reject("WRONG_PHASE"); // only PAUSED/ABORTED (MESSAGE_PROTOCOL §2)
}

function restartRound(state: GameState, seed: Uint8Array): ApplyResult {
  if (state.phase !== "ABORTED" || !state.round) return reject("WRONG_PHASE");
  // §14.1: same roundNumber, same defaultDeclarerSeat, FRESH seed; prior hands never reused.
  const rolledBack: GameState = {
    ...state,
    phase: "ROUND_END",
    roundNumber: state.roundNumber - 1,
    nextDefaultDeclarerSeat: state.round.defaultDeclarerSeat,
    round: null,
  };
  return startRound(rolledBack, { seed, abandonedSeats: [] });
}

function abort(state: GameState): ApplyResult {
  if (state.phase === "GAME_END" || state.phase === "ABORTED") return reject("WRONG_PHASE");
  return { ok: true, versionBump: true, events: [{ kind: "ABORTED" }], state: { ...state, phase: "ABORTED" } };
}

export { legalPlays };
