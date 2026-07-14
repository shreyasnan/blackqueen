// State layer (UI_SPEC §14): server truth only. The view IS the game; events feed the theater/log.
import { create } from "zustand";
import type { ClientView } from "@engine/view";
import type { Card } from "@engine/cards";

export type ExtendedView = ClientView & {
  seatNames?: string[]; seatAvatars?: string[]; hostSeat?: number | null;
  turnBudgetMs?: number; stagedTrumpOwn?: string | null;
  seatConnected?: boolean[]; awayBudgetMs?: number;
};

export interface GameEvent { seq: number; kind: string; data: any }

export interface Flight {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  card?: { suit: string; rank: string }; // undefined = card back
  delay: number;
}

interface AppState {
  flights: Flight[];
  addFlights(fs: Omit<Flight, "id">[]): void;
  clearFlights(): void;
  screen: "auth" | "home" | "lobby" | "table";
  view: ExtendedView | null;
  stateVersion: number;
  events: GameEvent[];
  toasts: { id: number; text: string }[];
  connection: "idle" | "connecting" | "connected" | "reconnecting";
  stagedTrump: string | null; // local echo (§9.2) — never from the wire
  stagedConfirmed: boolean;
  preselect: Card | null; // a card queued to auto-play the moment it's your turn (client-only)
  setPreselect(c: Card | null): void;
  lastTrickOpen: boolean;
  setLastTrickOpen(open: boolean): void;
  roomInfo: { roomId: string; code: string | null; members: { accountId: string; displayName: string; avatar?: string }[]; host: string } | null;
  setScreen(s: AppState["screen"]): void;
  setView(v: ExtendedView, version: number): void;
  pushEvent(e: GameEvent): void;
  pushToast(text: string): void;
  dropToast(id: number): void;
  setConnection(c: AppState["connection"]): void;
  stageTrump(suit: string): void;
  confirmStagedTrump(): void;
  setRoomInfo(r: AppState["roomInfo"]): void;
  /** Leave the table/lobby on this device: wipe game state, back to Home. */
  resetToHome(): void;
}

let toastId = 0;
let flightId = 0;

export const useStore = create<AppState>((set) => ({
  flights: [],
  addFlights: (fs) => {
    const withIds = fs.map((f) => ({ ...f, id: ++flightId }));
    set((s) => ({ flights: [...s.flights, ...withIds] }));
    const maxDelay = Math.max(...fs.map((f) => f.delay), 0);
    setTimeout(() => set((s) => ({ flights: s.flights.filter((f) => !withIds.some((w) => w.id === f.id)) })), maxDelay + 900);
  },
  clearFlights: () => set({ flights: [] }),
  screen: "auth",
  view: null,
  stateVersion: 0,
  events: [],
  toasts: [],
  connection: "idle",
  stagedTrump: null,
  stagedConfirmed: false,
  preselect: null,
  setPreselect: (preselect) => set({ preselect }),
  lastTrickOpen: false,
  setLastTrickOpen: (lastTrickOpen) => set({ lastTrickOpen }),
  roomInfo: null,
  setScreen: (screen) => set({ screen }),
  setView: (view, stateVersion) =>
    set((s) => ({
      view, stateVersion, screen: "table",
      // clear the staged echo once the contract is public
      stagedTrump: view.phase === "DECLARER_SETUP" ? s.stagedTrump : null,
      stagedConfirmed: view.phase === "DECLARER_SETUP" ? s.stagedConfirmed : false,
      // a queued card only makes sense during trick play
      preselect: view.phase === "TRICK_PLAY" ? s.preselect : null,
    })),
  pushEvent: (e) => set((s) => ({ events: [...s.events.slice(-199), e] })),
  pushToast: (text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => useStore.getState().dropToast(id), 2600);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnection: (connection) => set({ connection }),
  stageTrump: (stagedTrump) => set({ stagedTrump, stagedConfirmed: false }),
  confirmStagedTrump: () => set({ stagedConfirmed: true }),
  setRoomInfo: (roomInfo) => set({ roomInfo }),
  resetToHome: () => set({
    screen: "home", view: null, stateVersion: 0, events: [], roomInfo: null,
    connection: "idle", stagedTrump: null, stagedConfirmed: false, preselect: null, lastTrickOpen: false, flights: [],
  }),
}));
