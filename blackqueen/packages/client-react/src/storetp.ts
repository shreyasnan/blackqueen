// Isolated client state for Teen Patti — kept separate from the other games' stores. Server truth only:
// the view IS the game. Mirrors RoomCoreTP.viewFor + the engine's per-seat ViewTP.
import { create } from "zustand";

export interface CardTP { suit: "C" | "D" | "H" | "S"; rank: "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" }

export interface PlayerTP { active: boolean; packed: boolean; seen: boolean; allIn: boolean; bet: number; stack: number }

export interface RoundTP {
  phase: "BETTING" | "SIDESHOW" | "DONE";
  you: number; dealer: number; actor: number;
  pot: number; stake: number; boot: number;
  players: PlayerTP[];
  yourCards: CardTP[] | null;
  yourHand: string | null;
  countLive: number;
  sideshow: { requester: number; target: number } | null;
  reveal: { seat: number; cards: CardTP[]; hand: string }[] | null;
  result: { winner: number; pot: number; byFold: boolean; tie: boolean; winners: number[]; deltas: number[] } | null;
  legal: {
    canSee: boolean; bets: number[]; canPack: boolean; canShow: boolean; showCost: number;
    canSideshow: boolean; sideshowTarget: number | null; answerSideshow: boolean; sideshowRequester: number | null;
  } | null;
}

export interface ViewTP {
  game: "tp";
  phase: "OPEN" | "IN_GAME" | "ENDED";
  handNumber: number; dealer: number;
  seatNames: string[]; seatAvatars: string[]; seatConnected: boolean[];
  stacks: number[]; startingChips: number; boot: number;
  mySeat: number | null; hostSeat: number | null;
  winnerSeat: number | null; endedAt: number | null;
  turnMs?: number;
  round: RoundTP | null;
  events: { kind: string; [k: string]: unknown }[];
}

export type RoomInfoTP = { roomId: string; code: string | null; members: { accountId: string; displayName: string; avatar?: string; isBot?: boolean }[]; host: string; chips?: number; boot?: number; cap?: number };

export interface FlightTP { id: number; x0: number; y0: number; x1: number; y1: number; card?: CardTP; delay: number }

interface StoreTP {
  screen: "home" | "lobby" | "table";
  view: ViewTP | null;
  stateVersion: number;
  connection: "idle" | "connecting" | "connected" | "reconnecting";
  roomInfo: RoomInfoTP | null;
  toasts: { id: number; text: string }[];
  flights: FlightTP[];
  setScreen(s: StoreTP["screen"]): void;
  setView(v: ViewTP, version: number): void;
  setConnection(c: StoreTP["connection"]): void;
  setRoomInfo(r: RoomInfoTP | null): void;
  pushToast(text: string): void;
  dropToast(id: number): void;
  addFlights(fs: Omit<FlightTP, "id">[]): void;
  reset(): void;
}

let tid = 0;
let fid = 0;
export const useStoreTP = create<StoreTP>((set) => ({
  screen: "home",
  view: null,
  stateVersion: 0,
  connection: "idle",
  roomInfo: null,
  toasts: [],
  flights: [],
  setScreen: (screen) => set({ screen }),
  setView: (view, stateVersion) => set({ view, stateVersion, screen: "table" }),
  setConnection: (connection) => set({ connection }),
  setRoomInfo: (roomInfo) => set({ roomInfo }),
  pushToast: (text) => { const id = ++tid; set((s) => ({ toasts: [...s.toasts, { id, text }] })); setTimeout(() => useStoreTP.getState().dropToast(id), 2600); },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  addFlights: (fs) => {
    const withIds = fs.map((f) => ({ ...f, id: ++fid }));
    set((s) => ({ flights: [...s.flights, ...withIds] }));
    const maxDelay = Math.max(...fs.map((f) => f.delay), 0);
    setTimeout(() => set((s) => ({ flights: s.flights.filter((f) => !withIds.some((w) => w.id === f.id)) })), maxDelay + 900);
  },
  reset: () => set({ screen: "home", view: null, stateVersion: 0, connection: "idle", roomInfo: null, flights: [] }),
}));
