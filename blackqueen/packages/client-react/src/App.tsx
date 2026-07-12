// Corridor screens (UI_SPEC §3): Welcome/Sign-in → Home → Lobby → Table.
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { initAuth, mountClerkSignIn, devLogin, guestLogin, signOut, api, connect, AuthState } from "./net";
import { Face, FACE_IDS } from "./faces";
import { Table } from "./Table";

export const BUILD_TAG = "ui-20-two-decks"; // bump on every UI iteration — visible on Home, so builds are never ambiguous

export function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const setRoomInfo = useStore((s) => s.setRoomInfo);
  const pushToast = useStore((s) => s.pushToast);
  const [authed, setAuthed] = useState<AuthState | null>(null);
  // playtest #5: one link does everything — /?join=CODE auto-joins after sign-in/guest
  const [pendingJoin, setPendingJoin] = useState<string | null>(
    () => new URLSearchParams(location.search).get("join")?.toUpperCase() ?? null,
  );

  useEffect(() => {
    initAuth((a) => {
      setAuthed(a);
      if (a) setScreen("home");
    });
  }, [setScreen]);

  // once authenticated with a pending invite: join automatically, using the saved identity
  useEffect(() => {
    if (!authed || !pendingJoin) return;
    const code = pendingJoin;
    setPendingJoin(null);
    history.replaceState(null, "", location.pathname); // the link is spent
    const p = loadProfile(authed);
    api<{ roomId: string; members: any[]; host: string }>("/api/rooms/join", { code, displayName: p.nick, avatar: p.face })
      .then((r) => { setRoomInfo({ roomId: r.roomId, code: null, members: r.members, host: r.host }); setScreen("lobby"); })
      .catch(() => pushToast("That invite has expired — ask for a fresh link"));
  }, [authed, pendingJoin, setRoomInfo, setScreen, pushToast]);

  if (screen === "table") return <Table />;
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 26, margin: "18px 0" }}>
        Black <span style={{ color: "var(--gold)" }}>Queen</span>
      </h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 18 }}>
        Hidden teams. Trust no one.
        <span style={{ float: "right", fontSize: 11, opacity: 0.45 }}>{BUILD_TAG}</span>
      </p>
      {screen === "auth" && <AuthScreen invited={pendingJoin !== null} onAuthed={(a) => { setAuthed(a); setScreen("home"); }} />}
      {screen === "home" && authed && <Home auth={authed} />}
      {screen === "lobby" && authed && <Lobby auth={authed} />}
    </div>
  );
}

function AuthScreen({ onAuthed, invited }: { onAuthed: (a: AuthState) => void; invited?: boolean }) {
  const clerkEl = useRef<HTMLDivElement>(null);
  const [devName, setDevName] = useState("");
  const dev = new URLSearchParams(location.search).get("dev") === "1";
  useEffect(() => {
    if (!dev) {
      const t = setInterval(() => {
        if (window.Clerk?.loaded && clerkEl.current && !clerkEl.current.hasChildNodes()) {
          mountClerkSignIn(clerkEl.current);
          clearInterval(t);
        }
      }, 200);
      return () => clearInterval(t);
    }
  }, [dev]);
  return (
    <div>
      {dev ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="display name" style={inp} />
          <button style={btn} onClick={() => onAuthed(devLogin(devName || `Player${Math.floor(Math.random() * 100)}`))}>Dev sign-in</button>
        </div>
      ) : (
        <div>
          {invited && (
            <div style={{ background: "var(--card)", border: "2px solid var(--gold)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>🎴 You're invited to a table</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>sign in below or jump straight in as a guest — you'll land at the table either way</div>
              <button style={{ ...btn, padding: "12px 26px", fontSize: 15, marginTop: 10 }} onClick={async () => onAuthed(await guestLogin())}>
                Join as guest ▸
              </button>
            </div>
          )}
          <div ref={clerkEl} />
          {!invited && (
            <div style={{ textAlign: "center", margin: "14px 0", color: "var(--ink-soft)" }}>
              — or —
              <div style={{ marginTop: 8 }}>
                <button style={{ ...btnSec, padding: "10px 22px" }} onClick={async () => onAuthed(await guestLogin())}>
                  🎭 Play as guest
                </button>
                <div style={{ fontSize: 12, marginTop: 6, opacity: 0.75 }}>
                  no account — your name & face live only in this browser
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function loadProfile(auth: AuthState): { face: string; nick: string } {
  const meta = window.Clerk?.user?.unsafeMetadata as { bqFace?: string; bqNick?: string } | undefined;
  const stored = meta?.bqFace ?? localStorage.getItem("bq_face");
  return {
    face: stored && (FACE_IDS as readonly string[]).includes(stored) ? stored : "classic",
    nick: meta?.bqNick ?? localStorage.getItem("bq_nick") ?? auth.name,
  };
}
function saveProfile(face: string, nick: string): void {
  localStorage.setItem("bq_face", face);
  localStorage.setItem("bq_nick", nick);
  // Cross-device persistence via Clerk profile metadata (fire-and-forget; local copy is the fallback)
  window.Clerk?.user?.update?.({ unsafeMetadata: { ...window.Clerk.user.unsafeMetadata, bqFace: face, bqNick: nick } }).catch(() => {});
}

function Home({ auth }: { auth: AuthState }) {
  const setScreen = useStore((s) => s.setScreen);
  const setRoomInfo = useStore((s) => s.setRoomInfo);
  const pushToast = useStore((s) => s.pushToast);
  const [code, setCode] = useState("");
  const initial = loadProfile(auth);
  const [face, setFace] = useState(initial.face);
  const [nick, setNick] = useState(initial.nick);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deckCount, setDeckCount] = useState<1 | 2>(1);
  const [calledCount, setCalledCount] = useState(2);
  const identity = () => {
    const n = nick.trim().slice(0, 20) || auth.name;
    saveProfile(face, n);
    return { displayName: n, avatar: face };
  };
  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        Signed in as <b>{auth.name}</b>{" "}
        <button style={{ ...btnSec, padding: "4px 10px" }} onClick={signOut}>Sign out</button>
      </p>

      {/* ---- your table identity: face + nickname for this game ---- */}
      <div style={{ background: "var(--card)", border: "1px solid var(--shadow)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: "var(--ink-soft)", marginBottom: 8 }}>PLAYING AS</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => setPickerOpen((x) => !x)} aria-label="choose face"
            style={{ width: 54, height: 54, borderRadius: 27, background: "var(--parchment)", border: "2.5px solid var(--gold)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Face id={face} size={40} />
          </button>
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} placeholder="table nickname"
            autoFocus={nick === "Guest"} onFocus={(e) => nick === "Guest" && e.target.select()}
            style={{ ...inp, flex: 1, fontWeight: 700 }} />
        </div>
        {pickerOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 10 }}>
            {FACE_IDS.map((f) => (
              <button key={f} onClick={() => { setFace(f); setPickerOpen(false); saveProfile(f, nick); }} title={f}
                style={{
                  padding: "6px 0 2px", borderRadius: 10, cursor: "pointer", display: "grid", placeItems: "center",
                  background: f === face ? "var(--gold)" : "transparent", border: f === face ? "2px solid var(--ink)" : "2px solid rgba(59,34,71,.12)",
                }}>
                <Face id={f} size={46} />
                <span style={{ fontSize: 9.5, color: f === face ? "#fff" : "var(--ink-soft)", fontWeight: 700 }}>{f}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* v2.0: deck mode at creation */}
      <div style={{ background: "var(--card)", border: "1px solid var(--shadow)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: "var(--ink-soft)", marginBottom: 8 }}>TABLE RULES</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setDeckCount(1)} style={{ ...(deckCount === 1 ? btn : btnSec), padding: "8px 14px" }}>1 deck · 150 pts</button>
          <button onClick={() => setDeckCount(2)} style={{ ...(deckCount === 2 ? btn : btnSec), padding: "8px 14px" }}>2 decks · 300 pts</button>
          {deckCount === 2 && (
            <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              partner cards:
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => setCalledCount(n)}
                  style={{ ...(calledCount === n ? btn : btnSec), padding: "5px 11px", fontSize: 13 }}>{n}</button>
              ))}
            </span>
          )}
        </div>
        {deckCount === 2 && (
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
            two of every card · needs <b>6–7 players</b> · the <b>first player to play</b> a called card becomes the partner
            {calledCount === 3 && <span style={{ color: "var(--coral)", fontWeight: 700 }}> · 3 partner cards = big swings (±4× the bid)</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button style={{ ...btn, padding: "14px" }} onClick={async () => {
          try {
            const me = identity();
            const r = await api<{ roomId: string; code: string }>("/api/rooms", { N: 8, deckCount, ...(deckCount === 2 ? { calledCount } : {}), ...me });
            setRoomInfo({ roomId: r.roomId, code: r.code, members: [{ accountId: auth.accountId, displayName: me.displayName, avatar: me.avatar }], host: auth.accountId });
            setScreen("lobby");
          } catch (e) { pushToast(String(e)); }
        }}>Create table</button>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="INVITE CODE" style={{ ...inp, letterSpacing: 3, flex: 1 }} />
          <button style={btnSec} onClick={async () => {
            try {
              const r = await api<{ roomId: string; members: any[]; host: string }>("/api/rooms/join", { code, ...identity() });
              setRoomInfo({ roomId: r.roomId, code: null, members: r.members, host: r.host });
              setScreen("lobby");
            } catch (e) { pushToast("Invalid or expired code"); }
          }}>Join</button>
        </div>
      </div>
    </div>
  );
}

function Lobby({ auth }: { auth: AuthState }) {
  const roomInfo = useStore((s) => s.roomInfo);
  const setRoomInfo = useStore((s) => s.setRoomInfo);
  const pushToast = useStore((s) => s.pushToast);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!roomInfo) return;
    const t = setInterval(async () => {
      try {
        const s = await api<any>(`/api/rooms/${roomInfo.roomId}/state`);
        if (s.phase !== "OPEN") { clearInterval(t); connect(roomInfo.roomId); return; }
        setRoomInfo({ ...roomInfo, members: s.members, host: s.host, code: s.code, deckCount: s.deckCount, calledCount: s.calledCount } as any);
      } catch { /* transient */ }
    }, 2000);
    return () => clearInterval(t);
  }, [roomInfo?.roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!roomInfo) return null;
  const isHost = roomInfo.host === auth.accountId;
  return (
    <div>
      {roomInfo.code && (
        <div style={{ textAlign: "center", margin: "14px 0" }}>
          <div style={{ color: "var(--ink-soft)" }}>Invite code</div>
          <div style={{ fontSize: 42, letterSpacing: 8, fontWeight: 700, cursor: "pointer" }}
               onClick={() => { navigator.clipboard?.writeText(roomInfo.code!); pushToast("Code copied"); }}>
            {roomInfo.code}
          </div>
          <button style={{ ...btn, padding: "10px 20px", marginTop: 6 }}
            onClick={() => {
              const link = `${location.origin}/?join=${roomInfo.code}`;
              if (navigator.share) navigator.share({ title: "Black Queen", text: "Join my table:", url: link }).catch(() => {});
              else { navigator.clipboard?.writeText(link); pushToast("Invite link copied — one tap seats them"); }
            }}>
            🔗 Share invite link
          </button>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>the link signs them in (or seats them as a guest) and joins automatically</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {roomInfo.members.map((m) => (
          <span key={m.accountId} style={{ background: "var(--card)", border: "1px solid var(--shadow)", borderRadius: 16, padding: "6px 12px" }}>
            {(m as any).avatar && <><Face id={(m as any).avatar} size={20} />{" "}</>}{m.displayName}{m.accountId === roomInfo.host ? " ♛" : ""}
          </span>
        ))}
      </div>
      <p style={{ color: "var(--ink-soft)", marginBottom: 10 }}>
        {roomInfo.members.length} / {(roomInfo as any).deckCount === 2 ? "6–7" : "4–7"} players
        {(roomInfo as any).deckCount === 2 && <b style={{ color: "var(--gold)" }}> · 2 decks · 300 pts · {(roomInfo as any).calledCount ?? 2} partner card{((roomInfo as any).calledCount ?? 2) > 1 ? "s" : ""}</b>}
      </p>
      {isHost && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button style={btnSec} disabled={roomInfo.members.length >= 7}
            onClick={async () => { try { await api(`/api/rooms/${roomInfo.roomId}/addbot`, {}); } catch (e) { pushToast(String(e)); } }}>
            + Add bot
          </button>
          {roomInfo.members.some((m: any) => m.isBot) && (
            <button style={btnSec} onClick={async () => { try { await api(`/api/rooms/${roomInfo.roomId}/removebot`, {}); } catch { /* none */ } }}>
              − Remove bot
            </button>
          )}
        </div>
      )}
      {isHost && (
        <button style={{ ...btn, opacity: roomInfo.members.length >= 4 ? 1 : 0.4 }} disabled={roomInfo.members.length < 4 || starting}
          onClick={async () => {
            setStarting(true);
            try { await api(`/api/rooms/${roomInfo.roomId}/start`, {}); connect(roomInfo.roomId); }
            catch (e) { pushToast(String(e)); setStarting(false); }
          }}>
          Start game
        </button>
      )}
    </div>
  );
}

export const btn: React.CSSProperties = { background: "var(--gold)", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer" };
export const btnSec: React.CSSProperties = { background: "var(--ink)", color: "var(--parchment)", border: 0, borderRadius: 8, padding: "10px 16px", cursor: "pointer" };
export const inp: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--shadow)", borderRadius: 8, padding: "10px" };
