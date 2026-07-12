// GAME_SPEC.md §11–§12 + §9.4 (v1.9 pause-end) + §13 (competition ranking).
import { Card, cardEq, calledCardCount } from "./cards.js";

/** S = C + 1 where C is the game's configured called-card count (§9.2/§16). */
export const sharesFromCalledCount = (calledCount: number): number => calledCount + 1;
/** Legacy helper (single-deck fixed table). */
export const shares = (playerCount: number): number => calledCardCount(playerCount) + 1;

export function shareCount(seat: number, declarerSeat: number, calledCards: Card[], holderOf: (c: Card) => number): number {
  let n = seat === declarerSeat ? 1 : 0;
  for (const c of calledCards) if (holderOf(c) === seat) n++;
  return n;
}

export interface RoundScore {
  success: boolean;
  declarerTeamPoints: number;
  roundDelta: number[]; // by seat
}

/** §11–§12: computed ONLY at ROUND_SCORING, from per-seat capturedPoints. */
export function scoreRound(
  playerCount: number,
  Y: number,
  declarerSeat: number,
  calledCards: Card[],
  calledCardHolders: number[], // parallel to calledCards
  capturedPoints: number[],
): RoundScore {
  const teamSeats = new Set<number>([declarerSeat, ...calledCardHolders]);
  const declarerTeamPoints = [...teamSeats].reduce((s, seat) => s + capturedPoints[seat]!, 0);
  const success = declarerTeamPoints >= Y;
  const roundDelta = Array.from({ length: playerCount }, (_, seat) => {
    if (!teamSeats.has(seat)) return 0; // defenders always 0
    const holder = (c: Card) => calledCardHolders[calledCards.findIndex((cc) => cardEq(cc, c))]!;
    const n = shareCount(seat, declarerSeat, calledCards, holder);
    return (success ? Y : -Y) * n;
  });
  return { success, declarerTeamPoints, roundDelta };
}

/** §9.4 (v1.9): ending a declarer-stalled PAUSED — failure charged to the declarer alone.
 *  S comes from the configured called count (v2.0: creator-selectable in 2-deck games). */
export function pauseEndDelta(playerCount: number, Y: number, declarerSeat: number, calledCount?: number): number[] {
  const S = calledCount !== undefined ? sharesFromCalledCount(calledCount) : shares(playerCount);
  return Array.from({ length: playerCount }, (_, seat) => (seat === declarerSeat ? -(S * Y) : 0));
}

/** §13: standard competition ranking ("1224"). Returns rank per seat (1-based). */
export function competitionRanks(totals: number[]): number[] {
  return totals.map((t) => 1 + totals.filter((o) => o > t).length);
}
