// Net layer for Teen Patti — its own REST + socket client hitting the isolated /api/tp/* routes.
// Reuses the shared auth identity (getAuth). Ports the hardened pacing pump + leave guards from net28.
import { getAuth } from "./net";
import { useStoreTP } from "./storetp";

declare global { interface Window { Clerk?: any } }

async function q(): Promise<string> {
  const auth = getAuth();
  if (auth?.mode === "dev") return `?devUser=${encodeURIComponent(auth.devUser!)}`;
  if (auth?.mode === "guest") return `?token=${encodeURIComponent(auth.guestToken!)}`;
  const t = await window.Clerk.session.getToken();
  return `?token=${encodeURIComponent(t)}`;
}

export async function apiTP<T = any>(path: string, body?: unknown): Promise<T> {
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
const ROOM_KEY = "bqtp_room";

const PACE_MS = 750;
let viewQueue: { view: any; sv: number }[] = [];
let paceTimer: ReturnType<typeof setTimeout> | null = null;
let lastEnq = 0;
function clearPacing(): void { if (paceTimer) { clearTimeout(paceTimer); paceTimer = null; } viewQueue = []; lastEnq = 0; }

function enqueueView(view: any, sv: number): void {
  if (!roomId) return;
  if (sv <= lastEnq) return;
  lastEnq = sv;
  viewQueue.push({ view, sv });
  pump();
}
function apply(item: { view: any; sv: number }): void {
  stateVersion = item.sv;
  useStoreTP.getState().setView(item.view, item.sv);
}
function isFast(v: any): boolean {
  const mine = v.round && v.round.actor === v.mySeat;
  const terminal = v.phase !== "IN_GAME" || (v.round && v.round.phase === "DONE");
  return !!(mine || terminal);
}
function pump(): void {
  if (paceTimer) return;
  if (!roomId) { viewQueue = []; return; }
  const item = viewQueue.shift();
  if (!item) return;
  apply(item);
  if (isFast(item.view)) {
    if (viewQueue.length) { const latest = viewQueue.pop()!; viewQueue = []; apply(latest); }
    return;
  }
  paceTimer = setTimeout(() => { paceTimer = null; pump(); }, PACE_MS);
}

export const getRoomIdTP = () => roomId;
export const storedRoomTP = (): string | null => localStorage.getItem(ROOM_KEY);

export function disconnectTP(): void {
  const w = ws; ws = null; roomId = null; stateVersion = 0; tries = 0;
  clearPacing();
  localStorage.removeItem(ROOM_KEY);
  try { w?.close(1000, "left"); } catch { /* already closed */ }
}

export async function connectTP(rid: string): Promise<void> {
  roomId = rid;
  localStorage.setItem(ROOM_KEY, rid);
  if (ws) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/api/tp/rooms/${rid}/ws${await q()}`);
  useStoreTP.getState().setConnection("connecting");
  ws.onopen = () => { useStoreTP.getState().setConnection("connected"); tries = 0; };
  ws.onmessage = (e) => {
    if (!roomId) return;
    const m = JSON.parse(e.data);
    if (m.t === "ViewUpdate") enqueueView(m.view, m.stateVersion);
  };
  ws.onclose = () => {
    ws = null;
    if (!roomId) return;
    tries += 1;
    if (tries > 4) { localStorage.removeItem(ROOM_KEY); roomId = null; useStoreTP.getState().pushToast("Couldn't rejoin — the game may have ended."); useStoreTP.getState().reset(); return; }
    useStoreTP.getState().setConnection("reconnecting");
    setTimeout(() => roomId && connectTP(roomId), 1500);
  };
}

export function sendActionTP(type: string, payload: unknown): void {
  const auth = getAuth();
  if (!ws || !roomId || !auth) return;
  ws.send(JSON.stringify({ type, roomId, playerId: auth.accountId, actionId: crypto.randomUUID(), stateVersion, payload }));
}
