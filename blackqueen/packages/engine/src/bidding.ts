// GAME_SPEC.md §8 — auction with binding standing 75 and the §8.3.1 turn-safety invariants.

export interface BiddingState {
  currentHighBid: number;
  currentHighBidderSeat: number;
  activeSeats: number[]; // non-passed, ascending seat order
  turnSeat: number | null; // null ⇔ auction ended
  history: BidHistoryEntry[];
}

export type BidHistoryEntry =
  | { seat: number; action: "bid"; value: number }
  | { seat: number; action: "pass" };

export function initBidding(playerCount: number, defaultDeclarerSeat: number, standingBid = 75): BiddingState {
  const activeSeats = Array.from({ length: playerCount }, (_, i) => i);
  return {
    currentHighBid: standingBid, // totalPoints / 2 (§8.1): 75 single-deck, 150 two-deck
    currentHighBidderSeat: defaultDeclarerSeat,
    activeSeats,
    // §8.3: first on turn = immediately clockwise from the default declarer
    turnSeat: (defaultDeclarerSeat + 1) % playerCount,
    history: [],
  };
}

/** §8.3.1: next eligible actor clockwise — never the high bidder, never a passed seat. */
function nextTurn(s: BiddingState, playerCount: number, from: number): number {
  for (let i = 1; i <= playerCount; i++) {
    const seat = (from + i) % playerCount;
    if (seat !== s.currentHighBidderSeat && s.activeSeats.includes(seat)) return seat;
  }
  throw new Error("invariant violation: no eligible bidder"); // unreachable if §8.4 checked first
}

export type BiddingResult =
  | { ok: true; state: BiddingState; ended: false }
  | { ok: true; state: BiddingState; ended: true; declarerSeat: number; Y: number }
  | { ok: false; reason: string };

export function applyBid(s: BiddingState, playerCount: number, seat: number, value: number, bidCap = 150): BiddingResult {
  if (s.turnSeat === null || seat !== s.turnSeat) return { ok: false, reason: "NOT_YOUR_TURN" };
  if (value % 5 !== 0 || value <= s.currentHighBid || value > bidCap || !Number.isInteger(value)) {
    return { ok: false, reason: "ILLEGAL" };
  }
  const state: BiddingState = {
    ...s,
    currentHighBid: value,
    currentHighBidderSeat: seat,
    history: [...s.history, { seat, action: "bid", value }],
    turnSeat: null,
  };
  // §8.4(1): a bid of the full pot (totalPoints) ends the auction immediately.
  if (value === bidCap) return { ok: true, state, ended: true, declarerSeat: seat, Y: bidCap };
  state.turnSeat = nextTurn(state, playerCount, seat);
  return { ok: true, state, ended: false };
}

export function applyPass(s: BiddingState, playerCount: number, seat: number): BiddingResult {
  if (s.turnSeat === null || seat !== s.turnSeat) return { ok: false, reason: "NOT_YOUR_TURN" };
  if (seat === s.currentHighBidderSeat) return { ok: false, reason: "ILLEGAL" }; // unreachable by scheduler
  const activeSeats = s.activeSeats.filter((x) => x !== seat);
  const state: BiddingState = {
    ...s,
    activeSeats,
    history: [...s.history, { seat, action: "pass" }],
    turnSeat: null,
  };
  // §8.4(2): evaluate termination BEFORE assigning the next turn.
  if (activeSeats.length === 1) {
    return { ok: true, state, ended: true, declarerSeat: activeSeats[0]!, Y: s.currentHighBid };
  }
  state.turnSeat = nextTurn(state, playerCount, seat);
  return { ok: true, state, ended: false };
}
