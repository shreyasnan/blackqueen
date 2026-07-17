// Net layer for 28 — its own REST + socket client hitting the isolated /api/28/* routes. Reuses the
// shared auth identity (getAuth) so guests/Clerk users carry over, but keeps room state separate.
import { getAuth } from "./net";
import { useStore28 } from "./store28";

declare global { interface Window { Clerk?: any } }

async function q(): Promise<string> {
  const auth = getAuth();
  if (auth?.mode === "dev") return `?devUser=${encodeURIComponent(auth.devUser!)}`;
  if (auth?.mode === "guest") return `?token=${encodeURIComponent(auth.guestToken!)}`;
  const t = await window.Clerk.session.getToken();
  return `?token=${encodeURIComponent(t)}`;
}

export async function api28<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path + (await q()), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || String(r.status));
  return j as T;
}

let ws: WebSocket | null = null;
let roomId: string | null = null;
let stateVersion = 0;
let tries = 0;
const ROOM_KEY = "bq28_room";

// ---- render pacing ----
// The server resolves a run of bot moves instantly and pushes one ViewUpdate per step. We queue those
// frames and apply them ~750ms apart so bot play is watchable — but never delay the human: the instant a
// frame is "your turn" or the deal ends, we apply it and drop the rest. Purely cosmetic: a pacing glitch
// can only skip a frame, never stall the game (the server is already authoritative and unstuck).
const PACE_MS = 750;
let viewQueue: { view: any; sv: number }[] = [];
let paceTimer: ReturnType<typeof setTimeout> | null = null;
let lastEnq = 0;
function clearPacing(): void { if (paceTimer) { clearTimeout(paceTimer); paceTimer = null; } viewQueue = []; lastEnq = 0; }

/** Rate-limited pump: applies at most one frame per PACE_MS so a burst of bot moves plays out
 *  one-by-one (the server ships them all instantly). The FIRST frame after an idle gap applies
 *  immediately for responsiveness; the moment a frame is "your turn" or a deal ends, we stop
 *  gating so the human is never made to wait. */
function enqueueView(view: any, sv: number): void {
  if (!roomId) return; // left the table — ignore stragglers so they can't resurrect the game-over screen
  if (sv <= lastEnq) return;
  lastEnq = sv;
  viewQueue.push({ view, sv });
  pump();
}
function apply(item: { view: any; sv: number }): void {
  stateVersion = item.sv;
  useStore28.getState().setView(item.view, item.sv);
}
function isFast(v: any): boolean {
  const mine = v.round && v.round.actor === v.mySeat;
  const terminal = v.phase !== "IN_GAME" || (v.round && v.round.phase === "DONE");
  return !!(mine || terminal);
}
function pump(): void {
  if (paceTimer) return;            // a frame is already on the clock — new arrivals just wait in the queue
  if (!roomId) { viewQueue = []; return; }
  const item = viewQueue.shift();
  if (!item) return;
  apply(item);
  if (isFast(item.view)) {          // your turn / deal end: don't gate — surface the freshest state at once
    if (viewQueue.length) { const latest = viewQueue.pop()!; viewQueue = []; apply(latest); }
    return;
  }
  paceTimer = setTimeout(() => { paceTimer = null; pump(); }, PACE_MS); // gate the NEXT frame
}

export const getRoomId28 = () => roomId;
export const getStateVersion28 = () => stateVersion;
export const storedRoom28 = (): string | null => localStorage.getItem(ROOM_KEY);

export function disconnect28(): void {
  const w = ws; ws = null; roomId = null; stateVersion = 0; tries = 0;
  clearPacing();
  localStorage.removeItem(ROOM_KEY);
  try { w?.close(1000, "left"); } catch { /* already closed */ }
}

export async function connect28(rid: string): Promise<void> {
  roomId = rid;
  localStorage.setItem(ROOM_KEY, rid);
  if (ws) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/api/28/rooms/${rid}/ws${await q()}`);
  useStore28.getState().setConnection("connecting");
  ws.onopen = () => { useStore28.getState().setConnection("connected"); tries = 0; };
  ws.onmessage = (e) => {
    if (!roomId) return; // already left — ignore
    const m = JSON.parse(e.data);
    if (m.t === "ViewUpdate") enqueueView(m.view, m.stateVersion);
  };
  ws.onclose = () => {
    ws = null;
    if (!roomId) return;
    tries += 1;
    if (tries > 4) { localStorage.removeItem(ROOM_KEY); roomId = null; useStore28.getState().pushToast("Couldn't rejoin — the game may have ended."); useStore28.getState().reset(); return; }
    useStore28.getState().setConnection("reconnecting");
    setTimeout(() => roomId && connect28(roomId), 1500);
  };
}

export function sendAction28(type: string, payload: unknown): void {
  const auth = getAuth();
  if (!ws || !roomId || !auth) return;
  ws.send(JSON.stringify({ type, roomId, playerId: auth.accountId, actionId: crypto.randomUUID(), stateVersion, payload }));
}
