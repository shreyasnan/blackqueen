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

export const getRoomId28 = () => roomId;
export const getStateVersion28 = () => stateVersion;
export const storedRoom28 = (): string | null => localStorage.getItem(ROOM_KEY);

export function disconnect28(): void {
  const w = ws; ws = null; roomId = null; stateVersion = 0; tries = 0;
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
    const m = JSON.parse(e.data);
    if (m.t === "ViewUpdate") {
      if (m.stateVersion < stateVersion) return;
      stateVersion = m.stateVersion;
      useStore28.getState().setView(m.view, m.stateVersion);
    }
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
