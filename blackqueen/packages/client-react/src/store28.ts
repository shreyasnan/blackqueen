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
  turnMs?: number;
  round: Round28 | null;
  events: { kind: string; [k: string]: unknown }[];
}

export type RoomInfo28 = { roomId: string; code: string | null; members: { accountId: string; displayName: string; avatar?: string; isBot?: boolean }[]; host: string; N?: number };

// Card-flight animation (dealing, trick-gather) — mirrors Black Queen's flight layer.
export interface Flight28 {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  card?: Card28; // undefined = face-down card back
  delay: number;
}

interface Store28 {
  screen: "home" | "lobby" | "table";
  view: View28 | null;
  stateVersion: number;
  connection: "idle" | "connecting" | "connected" | "reconnecting";
  roomInfo: RoomInfo28 | null;
  toasts: { id: number; text: string }[];
  flights: Flight28[];
  lastTrickOpen: boolean;
  setScreen(s: Store28["screen"]): void;
  setView(v: View28, version: number): void;
  setConnection(c: Store28["connection"]): void;
  setRoomInfo(r: RoomInfo28 | null): void;
  pushToast(text: string): void;
  dropToast(id: number): void;
  addFlights(fs: Omit<Flight28, "id">[]): void;
  setLastTrickOpen(open: boolean): void;
  reset(): void;
}

let tid = 0;
let fid = 0;
export const useStore28 = create<Store28>((set) => ({
  screen: "home",
  view: null,
  stateVersion: 0,
  connection: "idle",
  roomInfo: null,
  toasts: [],
  flights: [],
  lastTrickOpen: false,
  setScreen: (screen) => set({ screen }),
  setView: (view, stateVersion) => set({ view, stateVersion, screen: "table" }),
  setConnection: (connection) => set({ connection }),
  setRoomInfo: (roomInfo) => set({ roomInfo }),
  pushToast: (text) => { const id = ++tid; set((s) => ({ toasts: [...s.toasts, { id, text }] })); setTimeout(() => useStore28.getState().dropToast(id), 2600); },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  addFlights: (fs) => {
    const withIds = fs.map((f) => ({ ...f, id: ++fid }));
    set((s) => ({ flights: [...s.flights, ...withIds] }));
    const maxDelay = Math.max(...fs.map((f) => f.delay), 0);
    setTimeout(() => set((s) => ({ flights: s.flights.filter((f) => !withIds.some((w) => w.id === f.id)) })), maxDelay + 900);
  },
  setLastTrickOpen: (lastTrickOpen) => set({ lastTrickOpen }),
  reset: () => set({ screen: "home", view: null, stateVersion: 0, connection: "idle", roomInfo: null, flights: [], lastTrickOpen: false }),
}));
