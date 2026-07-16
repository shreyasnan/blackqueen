// Corridor screens (UI_SPEC §3): Welcome/Sign-in → Home → Lobby → Table.
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { initAuth, mountClerkSignIn, devLogin, guestLogin, signOut, api, connect, storedRoom, AuthState } from "./net";
import { Face, FACE_IDS } from "./faces";
import { Table } from "./Table";

export const BUILD_TAG = "ui-45-clerk-clean"; // bump on every UI iteration — visible on Home, so builds are never ambiguous

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

  // once authenticated with a pending invite: join automatically, using the saved identity.
  // If the game already started and this account is already a member, we reconnect straight to the table.
  useEffect(() => {
    if (!authed || !pendingJoin) return;
    const code = pendingJoin;
    setPendingJoin(null);
    history.replaceState(null, "", location.pathname); // the link is spent
    const p = loadProfile(authed);
    api<{ roomId: string; members?: any[]; host?: string; reconnect?: boolean }>("/api/rooms/join", { code, displayName: p.nick, avatar: p.face })
      .then((r) => {
        if (r.reconnect) { connect(r.roomId); return; } // returning player — go straight back to their seat
        setRoomInfo({ roomId: r.roomId, code: null, members: r.members ?? [], host: r.host ?? "" });
        setScreen("lobby");
      })
      .catch((e) => pushToast(e instanceof Error ? e.message : "That invite has expired — ask for a fresh link"));
  }, [authed, pendingJoin, setRoomInfo, setScreen, pushToast]);

  // reconnect-on-load: if this browser was in a live game and there's no fresh invite to act on,
  // reconnect straight to that room by id (no code needed). If the room's gone, net gives up → home.
  useEffect(() => {
    if (!authed || pendingJoin) return;
    const rid = storedRoom();
    if (rid) connect(rid);
    // run once auth resolves; connect + ViewUpdate flips the screen to the table
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  if (screen === "table") return <Table />;
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "clamp(16px,4vw,26px)", fontFamily: SANS }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: SERIF, fontSize: "clamp(25px,7vw,31px)", fontWeight: 700, margin: 0, letterSpacing: 0.2, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: "var(--ink)", fontSize: "0.9em" }}>♠</span>
          <span><span style={{ color: "#1c2a20" }}>Black</span> <span style={{ color: "var(--ink)" }}>Queen</span></span>
        </h1>
        <span style={{ fontSize: 10.5, opacity: 0.4, whiteSpace: "nowrap" }}>{BUILD_TAG}</span>
      </div>
      {screen === "auth" && (
        <p style={{ color: "var(--ink-soft)", marginBottom: 18, fontSize: 14.5 }}>Hidden teams. Trust no one.</p>
      )}
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
  const identity = () => {
    const n = nick.trim().slice(0, 20) || auth.name;
    saveProfile(face, n);
    return { displayName: n, avatar: face };
  };
  const isGuestNick = /^guest$/i.test(nick.trim());
  const create = async () => {
    try {
      const me = identity();
      // Create the room first (defaults: 1 deck); the host picks decks & partners in the lobby.
      const r = await api<{ roomId: string; code: string }>("/api/rooms", { N: 8, ...me });
      setRoomInfo({ roomId: r.roomId, code: r.code, members: [{ accountId: auth.accountId, displayName: me.displayName, avatar: me.avatar }], host: auth.accountId });
      setScreen("lobby");
    } catch (e) { pushToast(String(e)); }
  };
  const join = async () => {
    try {
      const r = await api<{ roomId: string; members?: any[]; host?: string; reconnect?: boolean }>("/api/rooms/join", { code, ...identity() });
      if (r.reconnect) { connect(r.roomId); return; } // returning member — straight back to the table
      setRoomInfo({ roomId: r.roomId, code: null, members: r.members ?? [], host: r.host ?? "" });
      setScreen("lobby");
    } catch (e) { pushToast(e instanceof Error ? e.message : "Invalid or expired code"); }
  };
  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 13.5, color: "var(--ink-soft)" }}>
        <span>Signed in as <b style={{ color: "var(--ink)" }}>{auth.name}</b></span>
        <button onClick={signOut} style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, textDecoration: "underline", padding: 4 }}>Sign out</button>
      </div>

      {/* ---- your table identity: face + nickname ---- */}
      <div style={{ ...surfaceCard, padding: 16, marginBottom: 16 }}>
        <div style={labelCaps}>Playing as</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <button onClick={() => setPickerOpen((x) => !x)} aria-label="choose face"
            style={{ width: 56, height: 56, borderRadius: 28, background: "var(--parchment)", border: "2px solid var(--gold)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, padding: 0 }}>
            <Face id={face} size={42} />
          </button>
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} placeholder="Table nickname"
            autoFocus={nick === "Guest"} onFocus={(e) => nick === "Guest" && e.target.select()}
            style={{ ...field, flex: 1, fontWeight: 600, borderColor: isGuestNick ? "var(--coral)" : (field.border as string) }} />
        </div>
        {isGuestNick && (
          <div style={{ fontSize: 12, color: "var(--coral)", fontWeight: 500, marginTop: 8 }}>
            Pick a nickname so friends recognize you at the table.
          </div>
        )}
        {pickerOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 12 }}>
            {FACE_IDS.map((f) => (
              <button key={f} onClick={() => { setFace(f); setPickerOpen(false); saveProfile(f, nick); }} title={f}
                style={{
                  padding: "6px 0 3px", borderRadius: 12, cursor: "pointer", display: "grid", placeItems: "center", gap: 1,
                  background: f === face ? "rgba(201,153,46,.16)" : "transparent", border: f === face ? "2px solid var(--gold)" : "1px solid rgba(59,34,71,.1)",
                }}>
                <Face id={f} size={42} />
              </button>
            ))}
          </div>
        )}
      </div>

      <button style={primaryBtn} onClick={create}>Create table</button>
      <div style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center", marginTop: 10 }}>
        You'll pick decks and partner cards in the lobby, after friends join.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0 16px", color: "var(--ink-soft)", fontSize: 12.5 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(59,34,71,.12)" }} />
        or join a table
        <div style={{ flex: 1, height: 1, background: "rgba(59,34,71,.12)" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="INVITE CODE"
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && join()}
          style={{ ...field, flex: 1, letterSpacing: 4, fontWeight: 600 }} />
        <button style={{ ...inkBtn, flexShrink: 0, borderRadius: 14 }} onClick={join}>Join</button>
      </div>
    </div>
  );
}

function Lobby({ auth }: { auth: AuthState }) {
  const roomInfo = useStore((s) => s.roomInfo);
  const setRoomInfo = useStore((s) => s.setRoomInfo);
  const pushToast = useStore((s) => s.pushToast);
  const [starting, setStarting] = useState(false);
  // Table rules are now chosen in the lobby (host-only), seeded from the server config.
  const [deckCount, setDeckCount] = useState<1 | 2>((((roomInfo as any)?.deckCount ?? 1)) as 1 | 2);
  const [calledCount, setCalledCount] = useState<number>((roomInfo as any)?.calledCount ?? 2);
  const [handSize, setHandSize] = useState<number | "all">((((roomInfo as any)?.handSize ?? "all")) as number | "all");
  const pushConfig = async (deck: 1 | 2, called: number, hs: number | "all") => {
    if (!roomInfo) return;
    // "whole deck" = engine default for 1 deck; for 2 decks send 17 (server clamps to the table max)
    const body = { deckCount: deck, calledCount: deck === 2 ? called : null, handSize: hs !== "all" ? hs : deck === 2 ? 17 : null };
    setRoomInfo({ ...roomInfo, deckCount: deck, calledCount: body.calledCount, handSize: body.handSize } as any); // optimistic
    try { await api(`/api/rooms/${roomInfo.roomId}/config`, body); } catch (e) { pushToast(`Couldn't update rules: ${e instanceof Error ? e.message : e}`); }
  };

  useEffect(() => {
    if (!roomInfo) return;
    const t = setInterval(async () => {
      try {
        const s = await api<any>(`/api/rooms/${roomInfo.roomId}/state`);
        if (s.phase !== "OPEN") { clearInterval(t); connect(roomInfo.roomId); return; }
        setRoomInfo({ ...roomInfo, members: s.members, host: s.host, code: s.code, deckCount: s.deckCount, calledCount: s.calledCount, handSize: s.handSize } as any);
      } catch { /* transient */ }
    }, 2000);
    return () => clearInterval(t);
  }, [roomInfo?.roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Above 6 players, default the table to 2 decks + 2 partners (fires once; host can still change it).
  const auto2Deck = useRef(false);
  useEffect(() => {
    if (!roomInfo || roomInfo.host !== auth.accountId) return;
    if (roomInfo.members.length > 6 && deckCount === 1 && !auto2Deck.current) {
      auto2Deck.current = true;
      setDeckCount(2); setCalledCount(2); setHandSize(12);
      void pushConfig(2, 2, 12);
    }
  }, [roomInfo?.members.length, deckCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!roomInfo) return null;
  const isHost = roomInfo.host === auth.accountId;
  const members = roomInfo.members;
  const effDeck = (isHost ? deckCount : ((roomInfo as any).deckCount ?? 1)) as 1 | 2;
  const effHand = (isHost ? handSize : ((roomInfo as any).handSize ?? "all")) as number | "all";
  const minPlayers = effDeck === 2 ? 6 : 4;
  const short = minPlayers - members.length;
  const ghosts = Math.max(0, Math.min(10, minPlayers) - members.length);
  const leaveLobby = async () => {
    if (!window.confirm(isHost && members.length > 1 ? "Leave? Someone else becomes host." : "Leave this lobby?")) return;
    try { await api(`/api/rooms/${roomInfo.roomId}/leave`, {}); } catch { /* best effort */ }
    useStore.getState().resetToHome();
  };
  const copyCode = () => { if (roomInfo.code) { navigator.clipboard?.writeText(roomInfo.code); pushToast("Code copied"); } };
  const shareLink = () => {
    const link = `${location.origin}/?join=${roomInfo.code}`;
    if (navigator.share) navigator.share({ title: "Black Queen", text: "Join my table:", url: link }).catch(() => {});
    else { navigator.clipboard?.writeText(link); pushToast("Invite link copied"); }
  };
  const start = async () => {
    setStarting(true);
    try { await api(`/api/rooms/${roomInfo.roomId}/start`, {}); connect(roomInfo.roomId); }
    catch (e) { pushToast(`Couldn't start: ${e instanceof Error ? e.message : e}`); setStarting(false); }
  };

  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ marginBottom: 12 }}>
        <button onClick={leaveLobby} aria-label="leave lobby"
          style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, padding: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>← Leave</button>
      </div>

      {roomInfo.code && (
        <div style={{ ...surfaceCard, padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={labelCaps}>Invite code</div>
          <div onClick={copyCode} title="Tap to copy"
            style={{ fontFamily: SERIF, fontSize: "clamp(30px,10vw,40px)", letterSpacing: 8, paddingLeft: 8, cursor: "pointer", marginTop: 6, lineHeight: 1 }}>
            {roomInfo.code}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={copyCode} style={{ ...ghostBtn, width: "auto", flex: "0 0 auto", padding: "12px 18px" }}>Copy</button>
            <button onClick={shareLink} style={{ ...inkBtn, flex: 1, borderRadius: 14 }}>Share invite link</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 4px 12px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Players</div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{members.length} of {minPlayers} seated</div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {members.map((m) => (
          <div key={m.accountId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 68 }}>
            <div style={{ position: "relative", width: 52, height: 52, borderRadius: 26, background: "var(--parchment)", display: "grid", placeItems: "center", border: "1px solid rgba(59,34,71,.08)" }}>
              <Face id={(m as any).avatar || "classic"} size={44} />
              {m.accountId === roomInfo.host && (
                <span title="host" style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: 10, background: "var(--gold)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}>♛</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink)", maxWidth: 68, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(m as any).isBot ? "🤖 " : ""}{m.displayName.split(" ")[0]}
            </div>
          </div>
        ))}
        {Array.from({ length: ghosts }).map((_, i) => (
          <div key={`g${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 68 }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, border: "1.6px dashed rgba(59,34,71,.22)" }} />
            <div style={{ fontSize: 12.5, color: "rgba(59,34,71,.35)" }}>Open</div>
          </div>
        ))}
      </div>

      {/* Table rules — host picks decks & partners here, once people have joined */}
      {isHost ? (
        <div style={{ ...surfaceCard, padding: 18, margin: "20px 0" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 13 }}>Table rules</div>
          <Segmented full value={deckCount}
            onChange={(v) => {
              if (v === 1) { setDeckCount(1); setHandSize("all"); pushConfig(1, calledCount, "all"); }
              else { const hs = handSize === "all" ? 12 : handSize; setDeckCount(2); setHandSize(hs); pushConfig(2, calledCount, hs); }
            }}
            options={[{ label: "1 deck · 150", value: 1 }, { label: "2 decks · 300", value: 2 }]} />

          {deckCount === 2 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 7 }}>Partner cards</div>
              <Segmented full value={calledCount} onChange={(v) => { const n = Number(v); setCalledCount(n); pushConfig(2, n, handSize); }}
                options={[1, 2, 3].map((n) => ({ label: String(n), value: n }))} />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 7 }}>Cards per hand</div>
            <Segmented full small value={handSize}
              onChange={(v) => { const hs = v === "all" ? "all" : Number(v); setHandSize(hs); pushConfig(deckCount, calledCount, hs); }}
              options={[...(deckCount === 2 ? [10, 11, 12, 13, 14] : [8, 9, 10]).map((n) => ({ label: String(n), value: n })), { label: "All", value: "all" }]} />
          </div>

          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.5 }}>
            {deckCount === 2
              ? <>Two of every card · needs 6–10 players · the first to play a called card joins your team.{calledCount === 3 && <span style={{ color: "var(--coral)" }}> Three partner cards means big swings.</span>}</>
              : handSize !== "all"
                ? <>Extra cards are trimmed before the deal — lowest ranks first, never point cards — so the total stays 150.</>
                : <>Every card is dealt — hand size depends on the player count.</>}
          </div>
        </div>
      ) : (
        <div style={{ ...surfaceCard, padding: 16, margin: "20px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>The host sets the table rules.</div>
          <div style={{ fontSize: 14.5, fontWeight: 500, marginTop: 6 }}>
            {effDeck === 2 ? "2 decks · 300 pts" : "1 deck · 150 pts"}{effHand != null && effHand !== "all" ? ` · ${effHand} cards each` : ""}
          </div>
        </div>
      )}

      {isHost && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button style={{ ...ghostBtn, opacity: members.length >= 10 ? 0.5 : 1 }} disabled={members.length >= 10}
              onClick={async () => { try { await api(`/api/rooms/${roomInfo.roomId}/addbot`, {}); } catch (e) { pushToast(String(e)); } }}>
              Add a bot
            </button>
            {members.some((m: any) => m.isBot) && (
              <button style={{ ...ghostBtn, width: "auto", flex: "0 0 auto", padding: "13px 18px" }}
                onClick={async () => { try { await api(`/api/rooms/${roomInfo.roomId}/removebot`, {}); } catch { /* none */ } }}>
                Remove
              </button>
            )}
          </div>
          <button style={{ ...primaryBtn, opacity: short > 0 || starting ? 0.5 : 1 }} disabled={short > 0 || starting} onClick={start}>
            {starting ? "Starting…" : "Start game"}
          </button>
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
            {short > 0 ? <>Add {short} more player{short > 1 ? "s" : ""} to begin — bots count.</> : <>Everyone's here. Deal them in.</>}
          </div>
        </>
      )}
      {!isHost && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--ink-soft)", marginTop: 8 }}>Waiting for the host to start…</div>
      )}
    </div>
  );
}

// Primary = forest green (commit); secondary = neutral charcoal; both lit from above (top highlight, AO base).
export const btn: React.CSSProperties = { background: "linear-gradient(180deg,#33543a,#22412a)", color: "var(--ivory)", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 3px 8px rgba(0,0,0,.28)" };
export const btnSec: React.CSSProperties = { background: "var(--charcoal-2)", color: "var(--ivory)", border: 0, borderRadius: 8, padding: "10px 16px", cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)" };
export const inp: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--shadow)", borderRadius: 8, padding: "10px" };

/* ---- v3 corridor design (Home/Lobby): clean sans UI, serif wordmark, soft surfaces, mobile-first ---- */
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
// Surfaces catch the overhead light: bright top edge, soft ambient-occlusion shadow beneath.
const surfaceCard: React.CSSProperties = { background: "linear-gradient(180deg,#fbf6ea,#f2ebda)", border: "1px solid rgba(70,52,26,.12)", borderRadius: 20, boxShadow: "0 10px 22px rgba(46,34,16,.12), inset 0 1px 0 rgba(255,252,244,.9)" };
const primaryBtn: React.CSSProperties = { width: "100%", background: "linear-gradient(180deg,#2f5138,#213c2b)", color: "var(--ivory)", border: 0, borderRadius: 15, padding: "15px", fontSize: 16, fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 16px rgba(24,44,30,.30), inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 5px rgba(0,0,0,.22)" };
const inkBtn: React.CSSProperties = { background: "linear-gradient(180deg,#40304e,#2c1e40)", color: "var(--ivory)", border: 0, borderRadius: 14, padding: "13px 18px", fontSize: 14.5, fontWeight: 500, cursor: "pointer", boxShadow: "0 6px 14px rgba(30,20,40,.28), inset 0 1px 0 rgba(255,255,255,.12)" };
const ghostBtn: React.CSSProperties = { width: "100%", background: "transparent", border: "1px solid rgba(70,52,26,.2)", color: "var(--ink-soft)", borderRadius: 15, padding: "13px", fontSize: 14.5, cursor: "pointer" };
const field: React.CSSProperties = { width: "100%", background: "var(--card)", border: "1px solid rgba(70,52,26,.16)", borderRadius: 14, padding: "13px 15px", fontSize: 15.5, minHeight: 50, color: "var(--ink)", fontFamily: SANS };
const labelCaps: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--ink-soft)" };

function Segmented({ options, value, onChange, full, small }: {
  options: { label: React.ReactNode; value: string | number }[];
  value: string | number; onChange: (v: string | number) => void; full?: boolean; small?: boolean;
}) {
  return (
    <div style={{ display: full ? "flex" : "inline-flex", width: full ? "100%" : undefined, background: "rgba(59,34,71,.06)", borderRadius: 12, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button key={String(o.value)} onClick={() => onChange(o.value)}
            style={{
              flex: full ? 1 : undefined, border: 0, cursor: "pointer", borderRadius: 9, fontFamily: SANS,
              padding: small ? "7px 10px" : "9px 12px", fontSize: small ? 13 : 13.5, fontWeight: sel ? 600 : 400, whiteSpace: "nowrap",
              background: sel ? "var(--card)" : "transparent", color: sel ? "var(--ink)" : "var(--ink-soft)",
              boxShadow: sel ? "0 1px 3px rgba(40,20,50,.14)" : "none", transition: "background .15s ease",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
