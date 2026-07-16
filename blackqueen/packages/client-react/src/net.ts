// Net layer — auth (Clerk / dev), REST, and the seq-ordered socket client.
// Ports the proven vanilla logic 1:1 (MESSAGE_PROTOCOL §5.2 client conformance):
// strict seq order with gap buffering, ViewUpdate checkpoints, stale-version guard,
// reconnect with a FRESH short-lived Clerk token per connect.
import { useStore, GameEvent } from "./store";
import type { ClientView } from "@engine/view";

const CLERK_PUBLISHABLE_KEY = "pk_test_Y2FsbS1raWQtOTIuY2xlcmsuYWNjb3VudHMuZGV2JA";
const CLERK_FRONTEND = "https://calm-kid-92.clerk.accounts.dev";

declare global {
  interface Window { Clerk?: any }
}

export interface AuthState { mode: "clerk" | "dev" | "guest"; name: string; accountId: string; devUser?: string; guestToken?: string }
let auth: AuthState | null = null;
export const getAuth = () => auth;

export async function guestLogin(): Promise<AuthState> {
  const r = await fetch("/api/guest", { method: "POST" });
  const { token, accountId } = await r.json() as { token: string; accountId: string };
  localStorage.setItem("bq_guest", token);
  auth = { mode: "guest", name: "Guest", accountId, guestToken: token };
  return auth;
}

export async function initAuth(onReady: (a: AuthState | null) => void): Promise<void> {
  // returning guest: token in localStorage keeps their seat across refreshes/reconnects
  const guestToken = localStorage.getItem("bq_guest");
  if (guestToken) {
    const id = guestToken.split(".")[1] ?? "";
    auth = { mode: "guest", name: "Guest", accountId: id, guestToken };
    onReady(auth);
    return;
  }
  if (new URLSearchParams(location.search).get("dev") === "1") { onReady(null); return; } // dev sign-in UI
  const s = document.createElement("script");
  s.src = `${CLERK_FRONTEND}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  s.setAttribute("data-clerk-publishable-key", CLERK_PUBLISHABLE_KEY);
  s.async = true;
  s.onload = async () => {
    await window.Clerk.load();
    const u = window.Clerk.user;
    if (u) {
      auth = { mode: "clerk", accountId: u.id, name: u.fullName || u.username || (u.primaryEmailAddress?.emailAddress ?? "Player").split("@")[0] };
      onReady(auth);
    } else onReady(null);
  };
  document.head.appendChild(s);
}

// Real Card Club theme: no white card — the widget blends into the ivory page, and the Google/Apple
// buttons match the dark "Play as guest" button. OAuth-only: the email/identifier form + divider are
// hidden so only Continue-with-Google/Apple show. (The clean way to drop email is to disable it as an
// identifier in the Clerk dashboard; this hides it client-side too.)
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#26402f",
    colorText: "#26402f",
    colorTextSecondary: "#5f5a44",
    colorBackground: "#efe7db",
    colorInputBackground: "#f7f1e5",
    colorInputText: "#26402f",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    borderRadius: "14px",
  },
  elements: {
    // strip the card chrome so the widget sits flat on the page (no white box, no shadow, no striped footer)
    rootBox: { width: "100%" },
    cardBox: { boxShadow: "none", border: "none", background: "transparent" },
    card: { boxShadow: "none", border: "none", background: "transparent", padding: "0" },
    header: { display: "none" }, // the page already shows the Black Queen wordmark + tagline
    // Google/Apple styled like the dark "Play as guest" button (charcoal, ivory text, lit top edge)
    socialButtonsBlockButton: {
      background: "linear-gradient(180deg,#242a20,#15170f)", color: "#f2ead6",
      border: "none", borderRadius: "14px", padding: "14px 16px", minHeight: "52px",
      boxShadow: "0 6px 14px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.08)",
    },
    socialButtonsBlockButton__apple: { background: "linear-gradient(180deg,#242a20,#15170f)" },
    socialButtonsBlockButtonText: { color: "#f2ead6", fontWeight: "600" },
    socialButtonsProviderInitialIcon: { color: "#f2ead6" },
    badge: { display: "none" }, // drop the clipped "Last used" tab on the provider button
    // OAuth-only + no card chrome: hide the email form, divider, the striped dev-mode footer, and sign-up prompt
    dividerRow: { display: "none" },
    form: { display: "none" },
    footer: { display: "none" },
    footerAction: { display: "none" },
  },
};

export function mountClerkSignIn(el: HTMLElement): void {
  const wantSignUp = new URLSearchParams(location.search).get("mode") === "signup";
  const opts = { signInUrl: "/", signUpUrl: "/?mode=signup", appearance: CLERK_APPEARANCE };
  if (wantSignUp) window.Clerk?.mountSignUp(el, opts);
  else window.Clerk?.mountSignIn(el, opts);
}

export function devLogin(name: string): AuthState {
  auth = { mode: "dev", name, accountId: `dev_${name}`, devUser: name };
  return auth;
}

export function signOut(): void {
  localStorage.removeItem("bq_guest");
  if (window.Clerk) window.Clerk.signOut().then(() => location.reload());
  else location.reload();
}

async function q(): Promise<string> {
  if (auth?.mode === "dev") return `?devUser=${encodeURIComponent(auth.devUser!)}`;
  if (auth?.mode === "guest") return `?token=${encodeURIComponent(auth.guestToken!)}`;
  const t = await window.Clerk.session.getToken(); // fresh ~60s token per request (PLATFORM_SPEC §2.2)
  return `?token=${encodeURIComponent(t)}`;
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path + (await q()), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || String(r.status));
  return j as T;
}

// ---------------- socket ----------------
let ws: WebSocket | null = null;
let roomId: string | null = null;
let stateVersion = 0;
let lastSeq = 0;
let tries = 0; // consecutive reconnect attempts that never opened → give up (room ended / not a member)
const eventBuffer = new Map<number, any>();
const ROOM_KEY = "bq_room"; // the live room this browser belongs to — survives reload so we can rejoin

export function getStateVersion() { return stateVersion; }
export function getRoomId() { return roomId; }
/** The room this browser was last in, for reconnect-on-load. */
export function storedRoom(): string | null { return localStorage.getItem(ROOM_KEY); }

/** Deliberate leave: kill the socket WITHOUT the auto-reconnect loop, and forget the room. */
export function disconnect(): void {
  const w = ws;
  ws = null;
  roomId = null;
  stateVersion = 0;
  lastSeq = 0;
  tries = 0;
  eventBuffer.clear();
  localStorage.removeItem(ROOM_KEY);
  try { w?.close(1000, "left"); } catch { /* already closed */ }
}

export async function connect(rid: string): Promise<void> {
  roomId = rid;
  localStorage.setItem(ROOM_KEY, rid); // remember the room so a reload can reconnect (no code needed)
  if (ws) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/api/rooms/${rid}/ws${await q()}`);
  useStore.getState().setConnection("connecting");
  ws.onopen = () => { useStore.getState().setConnection("connected"); tries = 0; };
  ws.onmessage = (e) => handleMsg(JSON.parse(e.data));
  ws.onclose = () => {
    ws = null;
    if (!roomId) return; // deliberate disconnect
    tries += 1;
    if (tries > 4) {
      // repeated failures with no stable connection: the room ended, was destroyed, or we're no
      // longer a member. Stop retrying, forget the room, and drop the player home.
      localStorage.removeItem(ROOM_KEY);
      roomId = null;
      useStore.getState().pushToast("Couldn't rejoin — the game may have ended.");
      useStore.getState().resetToHome();
      return;
    }
    useStore.getState().setConnection("reconnecting");
    setTimeout(() => roomId && connect(roomId), 1500); // fresh token on every reconnect
  };
}

function handleMsg(m: any): void {
  const st = useStore.getState();
  if (m.t === "ViewUpdate") {
    if (m.stateVersion < stateVersion) return;                 // never render stale
    stateVersion = m.stateVersion;
    for (const [seq, buf] of eventBuffer) if (buf.stateVersion <= m.stateVersion) eventBuffer.delete(seq);
    st.setView(m.view as ClientView & { seatNames?: string[]; hostSeat?: number | null }, m.stateVersion);
  } else if (m.t === "Event") {
    if (m.seq <= lastSeq) return;                              // duplicate = no-op
    if (lastSeq && m.seq !== lastSeq + 1) { eventBuffer.set(m.seq, m); return; } // buffer gaps
    applyEvent(m);
    let next;
    while ((next = eventBuffer.get(lastSeq + 1))) { eventBuffer.delete(next.seq); applyEvent(next); }
  } else if (m.t === "Reject") {
    stateVersion = Math.max(stateVersion, m.currentStateVersion ?? 0);
    st.pushToast(`Not allowed: ${m.reason}`);
  } else if (m.t === "Ack") {
    st.confirmStagedTrump();                                   // §9.2 local echo confirmation
  }
}

function applyEvent(m: any): void {
  lastSeq = m.seq;
  useStore.getState().pushEvent({ seq: m.seq, kind: m.kind, data: m.data } as GameEvent);
}

export function sendAction(type: string, payload: unknown): void {
  if (!ws || !roomId || !auth) return;
  ws.send(JSON.stringify({ type, roomId, playerId: auth.accountId, actionId: crypto.randomUUID(), stateVersion, payload }));
}
