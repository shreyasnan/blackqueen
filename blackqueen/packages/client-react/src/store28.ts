// Isolated client state for 28 — kept separate from the Black Queen store so the two games never
// interfere. Server truth only: the view IS the game.
import { create } from "zustand";

export interface Card28 { suit: "C" | "D" | "H" | "S"; rank: "7" | "8" | "Q" | "K" | "10" | "A" | "9" | "J" }

export interface Round28 {
  phase: "BIDDING" | "CONCEAL" | "RAISE" | "PLAY" | "DONE" | "REDEAL";
  dealer: number; you: number; team: 0 | 1; actor: number;
  bid: number; bidder: number;
  hand: Card28[]; handCounts: number[];
  trumpRevealed: boolean; trumpConcealed: boolean; trumpSuit: Card28["suit"] | null;
  trick: { seat: number; card: Card28 }[];
  lastTrick: { plays: { seat: number; card: Card28 }[]; winner: number; points: number } | null;
  captured: [number, number];
  result: { success: boolean; gamePoints: number; bidderTeam: 0 | 1; captured: [number, number] } | null;
  minBid: number | null; canPass: boolean; canDemandRedeal: boolean;
  legal: { play: Card28[]; canReveal: boolean; mustReveal: boolean } | null;
}

export interface View28 {
  game: "28";
  phase: "OPEN" | "IN_GAME" | "ENDED";
  dealNumber: number; totalDeals: number; dealer: number;
  teamScores: [number, number];
  seatNames: string[]; seatAvatars: string[];
  mySeat: number | null; hostSeat: number | null;
  seatConnected: boolean[];
  endedAt: number | null;
  round: Round28 | null;
  events: { kind: string; [k: string]: unknown }[];
}

export type RoomInfo28 = { roomId: string; code: string | null; members: { accountId: string; displayName: string; avatar?: string; isBot?: boolean }[]; host: string; N?: number };

interface Store28 {
  screen: "home" | "lobby" | "table";
  view: View28 | null;
  stateVersion: number;
  connection: "idle" | "connecting" | "connected" | "reconnecting";
  roomInfo: RoomInfo28 | null;
  toasts: { id: number; text: string }[];
  setScreen(s: Store28["screen"]): void;
  setView(v: View28, version: number): void;
  setConnection(c: Store28["connection"]): void;
  setRoomInfo(r: RoomInfo28 | null): void;
  pushToast(text: string): void;
  dropToast(id: number): void;
  reset(): void;
}

let tid = 0;
export const useStore28 = create<Store28>((set) => ({
  screen: "home",
  view: null,
  stateVersion: 0,
  connection: "idle",
  roomInfo: null,
  toasts: [],
  setScreen: (screen) => set({ screen }),
  setView: (view, stateVersion) => set({ view, stateVersion, screen: "table" }),
  setConnection: (connection) => set({ connection }),
  setRoomInfo: (roomInfo) => set({ roomInfo }),
  pushToast: (text) => { const id = ++tid; set((s) => ({ toasts: [...s.toasts, { id, text }] })); setTimeout(() => useStore28.getState().dropToast(id), 2600); },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  reset: () => set({ screen: "home", view: null, stateVersion: 0, connection: "idle", roomInfo: null }),
}));
