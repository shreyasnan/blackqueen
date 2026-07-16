// The 28 game screens — Home (create/join), Lobby, and Table. Isolated from Black Queen; renders
// purely from the server view (store28). Uses the shared Real Card Club theme tokens.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore28, Card28, Round28 } from "./store28";
import { api28, connect28, sendAction28, storedRoom28, disconnect28, getRoomId28 } from "./net28";
import { btn, btnSec } from "./App";
import { CardFace } from "./Table";
import { Face } from "./faces";
import type { AuthState } from "./net";

const card28 = (c: Card28) => c as unknown as Parameters<typeof CardFace>[0]["card"]; // 28 ranks are valid BQ ranks

const GLYPH: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠" };
const SUIT_WORD: Record<string, string> = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" };
const red = (s: string) => s === "D" || s === "H";
const ck = (c: Card28) => `${c.rank}${c.suit}`;
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const TEAM_COLORS = ["#c2a24a", "#2e7d6b"]; // team 0 gold, team 1 teal

export function Game28({ auth, onExit }: { auth: AuthState; onExit: () => void }) {
  const screen = useStore28((s) => s.screen);
  // reconnect-on-load into a live 28 room
  useEffect(() => {
    const rid = storedRoom28();
    if (rid) connect28(rid);
  }, []);
  if (screen === "table") return <Table28 />;
  if (screen === "lobby") return <Lobby28 auth={auth} />;
  return <Home28 auth={auth} onExit={onExit} />;
}

const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 };
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ported from Black Queen's TimerRing: a countdown ring around the active avatar + last-15s digits. */
function TurnRing28({ active, budgetMs, size }: { active: boolean; budgetMs: number; size: number }) {
  const sv = useStore28((s) => s.stateVersion);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!active) { setLeft(null); return; }
    const started = Date.now();
    const t = setInterval(() => { const l = Math.ceil((budgetMs - (Date.now() - started)) / 1000); setLeft(l <= 15 ? Math.max(0, l) : null); }, 250);
    return () => clearInterval(t);
  }, [active, budgetMs, sv]);
  if (!active) return null;
  const r = size / 2 - 2; const c = 2 * Math.PI * r; const urgent = left !== null && left <= 5;
  return (
    <>
      {!REDUCED && (
        <svg key={sv} width={size} height={size} style={{ position: "absolute", top: -4, left: "50%", marginLeft: -size / 2, transform: "rotate(-90deg)", pointerEvents: "none" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,.32)" strokeWidth={4} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
            initial={{ strokeDashoffset: 0, stroke: "#c2a24a" }} animate={{ strokeDashoffset: -c, stroke: ["#c2a24a", "#d9a418", "#e0724b"] }}
            transition={{ duration: budgetMs / 1000, ease: "linear", times: [0, 0.72, 1] }} strokeDasharray={c} />
        </svg>
      )}
      {left !== null && (
        <motion.span animate={urgent && !REDUCED ? { scale: [1, 1.25, 1] } : { scale: 1 }} transition={urgent ? { repeat: Infinity, duration: 0.8 } : undefined}
          style={{ position: "absolute", top: -10, right: -16, background: urgent ? "#c62f12" : "var(--coral)", color: "#fff", fontSize: urgent ? 12.5 : 11, fontWeight: 900, borderRadius: 9, minWidth: 18, padding: "1px 3px", textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.3)" }}>
          {left}
        </motion.span>
      )}
    </>
  );
}

/* ------------------------------ Home ------------------------------ */
function Home28({ auth, onExit }: { auth: AuthState; onExit: () => void }) {
  const setScreen = useStore28((s) => s.setScreen);
  const setRoomInfo = useStore28((s) => s.setRoomInfo);
  const pushToast = useStore28((s) => s.pushToast);
  const [code, setCode] = useState("");
  const nick = (localStorage.getItem("bq_nick") || auth.name).slice(0, 20);
  const avatar = localStorage.getItem("bq_face") || "classic";
  const create = async () => {
    try {
      const r = await api28<{ roomId: string; code: string }>("/api/28/rooms", { displayName: nick, avatar });
      setRoomInfo({ roomId: r.roomId, code: r.code, members: [{ accountId: auth.accountId, displayName: nick, avatar }], host: auth.accountId });
      setScreen("lobby");
    } catch (e) { pushToast(String(e)); }
  };
  const join = async () => {
    try {
      const r = await api28<{ roomId: string; members?: any[]; host?: string; reconnect?: boolean }>("/api/28/rooms/join", { code, displayName: nick, avatar });
      if (r.reconnect) { connect28(r.roomId); return; }
      setRoomInfo({ roomId: r.roomId, code: null, members: r.members ?? [], host: r.host ?? "" });
      setScreen("lobby");
    } catch (e) { pushToast(e instanceof Error ? e.message : "Invalid or expired code"); }
  };
  return (
    <div style={{ fontFamily: SANS, maxWidth: 440, margin: "0 auto", padding: "clamp(16px,4vw,26px)" }}>
      <button onClick={onExit} style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, marginBottom: 8 }}>← Games</button>
      <h1 style={{ fontFamily: SERIF, fontSize: "clamp(25px,7vw,31px)", fontWeight: 700, color: "var(--ink)", margin: "8px 0 4px" }}>28</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 20, fontSize: 14.5 }}>Fixed partners. Win the bid, hide the trump.</p>
      <button style={{ width: "100%", ...btn, borderRadius: 15, padding: 15, fontSize: 16 }} onClick={create}>Create table</button>
      <div style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center", marginTop: 10 }}>28 is 4 players in two fixed teams — fill empty seats with bots.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0 16px", color: "var(--ink-soft)", fontSize: 12.5 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(70,52,26,.14)" }} />or join a table<div style={{ flex: 1, height: 1, background: "rgba(70,52,26,.14)" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="INVITE CODE"
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && join()}
          style={{ flex: 1, background: "var(--card)", border: "1px solid rgba(70,52,26,.16)", borderRadius: 14, padding: "13px 15px", fontSize: 15.5, letterSpacing: 4, fontWeight: 600, color: "var(--ink)" }} />
        <button style={{ ...btnSec, borderRadius: 14, padding: "0 18px" }} onClick={join}>Join</button>
      </div>
    </div>
  );
}

/* ------------------------------ Lobby ------------------------------ */
function Lobby28({ auth }: { auth: AuthState }) {
  const roomInfo = useStore28((s) => s.roomInfo);
  const setRoomInfo = useStore28((s) => s.setRoomInfo);
  const pushToast = useStore28((s) => s.pushToast);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!roomInfo) return;
    const t = setInterval(async () => {
      try {
        const s = await api28<any>(`/api/28/rooms/${roomInfo.roomId}/state`);
        if (s.phase !== "OPEN") { clearInterval(t); connect28(roomInfo.roomId); return; }
        setRoomInfo({ ...roomInfo, members: s.members, host: s.host, code: s.code });
      } catch { /* transient */ }
    }, 2000);
    return () => clearInterval(t);
  }, [roomInfo?.roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!roomInfo) return null;
  const isHost = roomInfo.host === auth.accountId;
  const members = roomInfo.members;
  const ghosts = Math.max(0, 4 - members.length);
  const shareLink = () => {
    const link = `${location.origin}/?join28=${roomInfo.code}`;
    if (navigator.share) navigator.share({ title: "28", text: "Join my table:", url: link }).catch(() => {});
    else { navigator.clipboard?.writeText(link); pushToast("Invite link copied"); }
  };
  const start = async () => {
    setStarting(true);
    try { await api28(`/api/28/rooms/${roomInfo.roomId}/start`, {}); connect28(roomInfo.roomId); }
    catch (e) { pushToast(`Couldn't start: ${e instanceof Error ? e.message : e}`); setStarting(false); }
  };
  return (
    <div style={{ fontFamily: SANS, maxWidth: 440, margin: "0 auto", padding: "clamp(16px,4vw,26px)" }}>
      <button onClick={() => { disconnect28(); useStore28.getState().reset(); }} style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, marginBottom: 12 }}>← Leave</button>
      {roomInfo.code && (
        <div style={{ background: "var(--card)", border: "1px solid rgba(70,52,26,.12)", borderRadius: 20, padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--ink-soft)" }}>Invite code</div>
          <div style={{ fontFamily: SERIF, fontSize: "clamp(30px,10vw,40px)", letterSpacing: 8, marginTop: 6, color: "var(--ink)" }}>{roomInfo.code}</div>
          <button onClick={shareLink} style={{ ...btnSec, marginTop: 14, borderRadius: 14, padding: "12px 18px" }}>Share invite link</button>
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 4px 12px" }}>{members.length} of 4 seated</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {members.map((m) => (
          <div key={m.accountId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 68 }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, background: "var(--parchment)", display: "grid", placeItems: "center", border: "1px solid rgba(70,52,26,.12)", fontSize: 24 }}>{(m as any).isBot ? "🤖" : "🂠"}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink)", maxWidth: 68, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName.split(" ")[0]}</div>
          </div>
        ))}
        {Array.from({ length: ghosts }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 68 }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, border: "1.6px dashed rgba(70,52,26,.22)" }} />
            <div style={{ fontSize: 12.5, color: "rgba(70,52,26,.35)" }}>Open</div>
          </div>
        ))}
      </div>
      {isHost && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button style={{ ...btnSec, flex: 1, borderRadius: 15, padding: 13, opacity: members.length >= 4 ? 0.5 : 1 }} disabled={members.length >= 4}
              onClick={async () => { try { await api28(`/api/28/rooms/${roomInfo.roomId}/addbot`, {}); } catch (e) { pushToast(String(e)); } }}>Add a bot</button>
            {members.some((m: any) => m.isBot) && (
              <button style={{ ...btnSec, borderRadius: 15, padding: "13px 18px" }} onClick={async () => { try { await api28(`/api/28/rooms/${roomInfo.roomId}/removebot`, {}); } catch { /* none */ } }}>Remove</button>
            )}
          </div>
          <button style={{ width: "100%", ...btn, borderRadius: 15, padding: 15, fontSize: 16, opacity: members.length !== 4 || starting ? 0.5 : 1 }} disabled={members.length !== 4 || starting} onClick={start}>
            {starting ? "Starting…" : "Start game"}
          </button>
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
            {members.length < 4 ? `Add ${4 - members.length} more (bots count).` : "Everyone's in. Deal them."}
          </div>
        </>
      )}
      {!isHost && <div style={{ textAlign: "center", fontSize: 13, color: "var(--ink-soft)" }}>Waiting for the host to start…</div>}
    </div>
  );
}

/* ------------------------------ Table ------------------------------ */
function Table28() {
  const view = useStore28((s) => s.view);
  const connection = useStore28((s) => s.connection);
  const toasts = useStore28((s) => s.toasts);
  const [review, setReview] = useState(false);
  if (!view) return <div style={{ display: "grid", placeItems: "center", height: "100dvh", color: "var(--ivory)", background: "#14150f" }}>Connecting…</div>;

  if (view.phase === "ENDED") return <MatchEnd view={view} />;
  const r = view.round;
  const me = view.mySeat ?? 0;
  const rel = (seat: number) => (seat - me + 4) % 4;
  const pos: Record<number, React.CSSProperties> = {
    0: { bottom: "2%", left: "50%", transform: "translateX(-50%)" },
    1: { top: "44%", right: "3%", transform: "translateY(-50%)" },
    2: { top: "2%", left: "50%", transform: "translateX(-50%)" },
    3: { top: "44%", left: "3%", transform: "translateY(-50%)" },
  };

  return (
    <div style={{ height: "100dvh", position: "relative", overflow: "hidden", background: "radial-gradient(135% 95% at 50% 4%, #23241c 0%, #16170f 58%, #0c0d08 100%)", display: "flex", flexDirection: "column", fontFamily: SANS }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", color: "rgba(242,234,214,.82)", fontSize: 12.5, zIndex: 2 }}>
        <span>Deal {view.dealNumber} / {view.totalDeals}</span>
        <span style={{ display: "flex", gap: 12 }}>
          <b style={{ color: TEAM_COLORS[0] }}>Us {view.teamScores[view.round?.team ?? 0]}</b>
          <b style={{ color: TEAM_COLORS[1] }}>Them {view.teamScores[(view.round?.team ?? 0) === 0 ? 1 : 0]}</b>
        </span>
        <span style={{ color: r?.trumpSuit ? (red(r.trumpSuit) ? "#e0a" : "var(--gold)") : "rgba(242,234,214,.5)" }}>
          {r?.trumpRevealed ? `Trump ${GLYPH[r.trumpSuit!]}` : r?.trumpConcealed ? "Trump ●" : "—"}
        </span>
      </div>

      <TurnTimer view={view} />
      {/* felt + seats */}
      <div onClick={() => view.round?.lastTrick && setReview(true)} style={{ flex: 1, position: "relative", margin: "0 8px", cursor: view.round?.lastTrick ? "pointer" : "default" }}>
        <div style={{ position: "absolute", inset: "5% 2%", borderRadius: "50%/42%", background: "linear-gradient(180deg,var(--wood-a),var(--wood-b) 44%,var(--wood-c))", boxShadow: "0 14px 30px rgba(0,0,0,.55), inset 0 2px 1px rgba(255,222,170,.3)" }} />
        <div style={{ position: "absolute", inset: "7.5% 4%", borderRadius: "50%/42%", background: "radial-gradient(ellipse at 50% 34%, var(--felt-a), var(--felt-b) 52%, var(--felt-c))", boxShadow: "inset 0 8px 30px rgba(0,0,0,.45)" }} />
        {/* center: current trick / status */}
        <Center28 view={view} />
        {/* seats */}
        {[0, 1, 2, 3].map((seat) => (
          <div key={seat} style={{ position: "absolute", ...pos[rel(seat)], zIndex: 3 }}>
            <Seat28 view={view} seat={seat} />
          </div>
        ))}
      </div>

      {/* controls + your hand */}
      <Controls28 view={view} />
      {review && <LastTrick28 view={view} onClose={() => setReview(false)} />}
      {connection === "reconnecting" && <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: "var(--coral)", color: "#fff", textAlign: "center", padding: 6 }}>Reconnecting…</div>}
      <div style={{ position: "fixed", bottom: 90, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none" }}>
        {toasts.map((t) => <div key={t.id} style={{ background: "var(--ink)", color: "var(--ivory)", borderRadius: 8, padding: "8px 14px" }}>{t.text}</div>)}
      </div>
    </div>
  );
}

/** Client-side countdown for whoever's on turn. Resets whenever the actor or state advances; the
 *  server enforces the real deadline (this is display only, so a lag can't cost you your turn). */
function TurnTimer({ view }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]> }) {
  const stateVersion = useStore28((s) => s.stateVersion);
  const r = view.round;
  const total = Math.round((view.turnMs ?? 45000) / 1000);
  const [left, setLeft] = useState(total);
  const mine = r?.actor === view.mySeat;
  const active = !!r && (r.phase === "BIDDING" || r.phase === "CONCEAL" || r.phase === "RAISE" || r.phase === "PLAY");
  useEffect(() => {
    if (!active) return;
    setLeft(total);
    const started = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, total - Math.floor((Date.now() - started) / 1000))), 500);
    return () => clearInterval(t);
  }, [stateVersion, r?.actor, active, total]);
  if (!active) return null;
  const who = mine ? "Your turn" : `${view.seatNames[r!.actor]?.split(" ")[0] ?? "…"}`;
  const urgent = left <= 10;
  return (
    <div style={{ textAlign: "center", zIndex: 2, marginTop: -2, marginBottom: 2 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: mine ? "#efe3c4" : "rgba(242,234,214,.7)" }}>
        {who} · <span style={{ color: urgent ? "#e0724b" : mine ? "var(--gold)" : "rgba(242,234,214,.7)" }}>{left}s</span>
      </span>
    </div>
  );
}

function Seat28({ view, seat }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]>; seat: number }) {
  const r = view.round;
  const me = view.mySeat ?? 0;
  const active = !!r && r.actor === seat && (r.phase === "BIDDING" || r.phase === "CONCEAL" || r.phase === "RAISE" || r.phase === "PLAY");
  const isBidder = r?.bidder === seat;
  const team = seat % 2;
  const ring = active ? "#efe3c4" : TEAM_COLORS[team]!;
  const faceSize = seat === me ? 42 : 34;
  const ringD = faceSize + 10;
  const name = seat === me ? "You" : (view.seatNames[seat]?.split(" ")[0] ?? `Seat ${seat}`);
  const count = r?.handCounts[seat] ?? 0;
  const away = seat !== me && view.seatConnected[seat] === false;
  return (
    <motion.div animate={{ scale: active ? 1.08 : 1, y: active ? -2 : 0 }} transition={SPRING}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <AnimatePresence>
        {active && !REDUCED && (
          <motion.div initial={{ opacity: 0, y: -6 }} exit={{ opacity: 0 }} animate={{ opacity: 1, y: [0, -6, 0] }} transition={{ y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" } }}
            style={{ position: "absolute", top: -20, left: "50%", marginLeft: -10, zIndex: 9, width: 0, height: 0, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: "13px solid var(--gold)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))" }} />
        )}
      </AnimatePresence>
      {active && seat === me && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
          style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", zIndex: 10, whiteSpace: "nowrap", background: "var(--coral)", color: "#fff", fontSize: 9, fontWeight: 900, letterSpacing: 0.6, borderRadius: 8, padding: "1.5px 6px", boxShadow: "0 2px 6px rgba(0,0,0,.3)" }}>
          YOUR TURN
        </motion.div>
      )}
      <div style={{ position: "relative" }}>
        <div style={{ width: ringD, height: ringD, borderRadius: "50%", border: `2.5px solid ${ring}`, background: "var(--parchment)", overflow: "hidden", display: "grid", placeItems: "center", boxShadow: active ? "0 0 16px rgba(232,214,176,.6)" : "0 3px 8px rgba(0,0,0,.4)" }}>
          <Face id={view.seatAvatars[seat] ?? "classic"} size={faceSize} />
        </div>
        <TurnRing28 active={active} budgetMs={view.turnMs ?? 45000} size={ringD + 8} />
        {isBidder && (
          <span title="bidder" style={{ position: "absolute", right: -3, bottom: -1, width: 18, height: 18, borderRadius: 9, background: "var(--coral)", color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: "18px", textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.35)" }}>B</span>
        )}
      </div>
      <div style={{ background: "rgba(16,32,24,.62)", borderRadius: 10, padding: "2px 10px", maxWidth: "40vw", boxShadow: "0 2px 6px rgba(0,0,0,.28)", textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: team === 0 ? "#ffe6a6" : "#bfeede", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{name}</div>
        <div style={{ fontSize: 10, color: "rgba(255,253,247,.8)", lineHeight: 1.25 }}>{away ? <b style={{ color: "#ff9b8a" }}>💤 away</b> : `${count} cards`}</div>
      </div>
    </motion.div>
  );
}

function Center28({ view }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]> }) {
  const r = view.round;
  const me = view.mySeat ?? 0;
  if (!r) return null;
  // Show the live trick, or — in the gap between tricks — the just-completed one with the winner lit.
  const shown = r.trick.length > 0
    ? r.trick.map((p) => ({ seat: p.seat, card: p.card, win: false }))
    : (r.lastTrick ? r.lastTrick.plays.map((p) => ({ seat: p.seat, card: p.card, win: p.seat === r.lastTrick!.winner })) : []);
  if (shown.length > 0) {
    const off: Record<number, [number, number]> = { 0: [0, 60], 1: [70, 0], 2: [0, -60], 3: [-70, 0] };
    const done = r.trick.length === 0 && r.lastTrick; // showing the just-finished trick
    const winName = done ? (r.lastTrick!.winner === me ? "You take" : `${view.seatNames[r.lastTrick!.winner]?.split(" ")[0] ?? "Bot"} takes`) : "";
    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {done && (
          <motion.div initial={{ opacity: 0, y: 6, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            style={{ position: "absolute", left: "50%", top: "20%", transform: "translateX(-50%)", background: "var(--gold)", color: "#1c1c1a", fontWeight: 800, borderRadius: 20, padding: "5px 15px", fontSize: 13.5, whiteSpace: "nowrap", boxShadow: "0 5px 14px rgba(0,0,0,.45)" }}>
            {winName} it{r.lastTrick!.points > 0 ? ` · +${r.lastTrick!.points}` : ""}
          </motion.div>
        )}
        {shown.map((p) => {
          const [dx, dy] = off[(p.seat - me + 4) % 4]!;
          return (
            <motion.div key={p.seat} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: p.win ? 1.14 : 1 }}
              style={{ position: "absolute", left: "50%", top: "45%", transform: `translate(-50%,-50%) translate(${dx}px,${dy}px)`, borderRadius: 11, boxShadow: p.win ? "0 0 0 3px var(--gold), 0 6px 16px rgba(0,0,0,.5)" : undefined }}>
              <CardFace card={card28(p.card)} width={46} deck="28" single />
            </motion.div>
          );
        })}
      </div>
    );
  }
  let msg = "";
  if (r.phase === "BIDDING") msg = r.actor === me ? "Your bid" : `${view.seatNames[r.actor]?.split(" ")[0] ?? "…"} is bidding · high ${r.bid || "—"}`;
  else if (r.phase === "CONCEAL") msg = r.actor === me ? "Choose your trump" : "Bidder is setting trump…";
  else if (r.phase === "RAISE") msg = r.actor === me ? "Raise or play?" : "Bidding side may raise…";
  else if (r.phase === "DONE") msg = r.result ? (r.result.success ? "Bid MADE" : "Bid FAILED") : "";
  return <div style={{ position: "absolute", left: "50%", top: "40%", transform: "translate(-50%,-50%)", color: "rgba(255,253,247,.92)", fontSize: 15, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,.5)", whiteSpace: "nowrap" }}>{msg}</div>;
}

function Controls28({ view }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]> }) {
  const r = view.round;
  const me = view.mySeat ?? 0;
  const isHost = view.hostSeat === me;
  if (!r) return null;
  const mine = r.actor === me;

  // DONE: host advances
  if (r.phase === "DONE") {
    return (
      <div style={{ padding: 14, textAlign: "center" }}>
        <div style={{ color: "var(--ivory)", fontSize: 15, marginBottom: 8 }}>
          {r.result?.success ? "Bid made" : "Bid failed"} — {r.result ? `${r.result.gamePoints > 0 ? "+" : ""}${r.result.gamePoints} game pts` : ""}
        </div>
        {isHost
          ? <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => sendAction28("HOST_NEXT_DEAL", {})}>{view.dealNumber >= view.totalDeals ? "Finish match ▸" : "Next deal ▸"}</button>
          : <div style={{ color: "var(--ink-soft)" }}>Waiting for the host…</div>}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 10px 12px" }}>
      {mine && r.phase === "BIDDING" && <BidBar28 r={r} />}
      {mine && r.phase === "RAISE" && <RaiseBar28 r={r} />}
      {!mine && (r.phase === "BIDDING" || r.phase === "RAISE" || r.phase === "CONCEAL") && (
        <div style={{ textAlign: "center", color: "rgba(242,234,214,.7)", fontSize: 13, marginBottom: 8 }}>waiting…</div>
      )}
      {mine && r.phase === "PLAY" && r.legal?.canReveal && (
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <button style={{ ...btn, background: "linear-gradient(180deg,#3c2a52,#2a1c3e)", padding: "9px 18px" }} onClick={() => sendAction28("REVEAL_TRUMP", {})}>
            {r.legal.mustReveal ? "Reveal trump & play ▸" : "Call for trump"}
          </button>
        </div>
      )}
      <Hand28 view={view} />
    </div>
  );
}

function BidBar28({ r }: { r: Round28 }) {
  const min = r.minBid ?? 14;
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <button style={{ ...btnSec }} onClick={() => setVal((x) => Math.max(min, x - 1))}>−</button>
      <b style={{ fontSize: 22, minWidth: 42, textAlign: "center", color: "var(--ivory)" }}>{val}</b>
      <button style={{ ...btnSec }} onClick={() => setVal((x) => Math.min(28, x + 1))}>+</button>
      <button style={{ ...btn }} onClick={() => sendAction28("BID", { value: val })}>Bid {val}</button>
      {r.canPass && <button style={{ ...btnSec }} onClick={() => sendAction28("PASS", {})}>Pass</button>}
      {r.canDemandRedeal && <button style={{ ...btnSec }} onClick={() => sendAction28("DEMAND_REDEAL", {})}>Redeal</button>}
    </div>
  );
}

function RaiseBar28({ r }: { r: Round28 }) {
  const min = Math.max(r.bid + 1, 24);
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <button style={{ ...btnSec }} onClick={() => setVal((x) => Math.max(min, x - 1))}>−</button>
      <b style={{ fontSize: 22, minWidth: 42, textAlign: "center", color: "var(--ivory)" }}>{val}</b>
      <button style={{ ...btnSec }} onClick={() => setVal((x) => Math.min(28, x + 1))}>+</button>
      <button style={{ ...btn }} onClick={() => sendAction28("RAISE", { value: val })}>Raise to {val}</button>
      <button style={{ ...btnSec }} onClick={() => sendAction28("DECLINE_RAISE", {})}>Play as is</button>
    </div>
  );
}

function Hand28({ view }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]> }) {
  const r = view.round;
  const me = view.mySeat ?? 0;
  if (!r) return null;
  const mine = r.actor === me;
  const conceal = mine && r.phase === "CONCEAL";
  const play = mine && r.phase === "PLAY";
  const isLegal = (c: Card28) => r.legal?.play.some((x) => x.suit === c.suit && x.rank === c.rank) ?? false;
  const onCard = (c: Card28) => {
    if (conceal) sendAction28("SET_TRUMP", { card: c });
    else if (play && isLegal(c)) sendAction28("PLAY", { card: c });
  };
  const n = r.hand.length;
  const w = Math.min(62, Math.max(42, Math.floor((typeof innerWidth !== "undefined" ? innerWidth : 400) / (n * 0.72 + 1))));
  return (
    <>
      {conceal && <div style={{ textAlign: "center", color: "var(--gold)", fontSize: 12.5, marginBottom: 6 }}>Tap or swipe up a card to set it face-down as trump (its suit becomes trump).</div>}
      {play && r.actor === me && <div style={{ textAlign: "center", color: "rgba(242,234,214,.7)", fontSize: 11.5, marginBottom: 4 }}>tap or swipe a card up to play</div>}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 2, touchAction: "pan-x", minHeight: w * 1.42 + 14 }}>
        {r.hand.map((c, i) => {
          const actionable = conceal || (play && isLegal(c));
          const illegal = play && !isLegal(c);
          return (
            <motion.div key={ck(c)} drag={actionable ? "y" : false} dragSnapToOrigin dragElastic={0.5} dragConstraints={{ top: -120, bottom: 0 }}
              whileDrag={{ scale: 1.12, zIndex: 60 }}
              onDragEnd={(_e, info) => { if (actionable && info.offset.y < -55) onCard(c); }}
              onClick={() => { if (actionable) onCard(c); }}
              initial={{ y: 70, opacity: 0, rotate: -4 }}
              animate={{ y: actionable ? -8 : 0, opacity: 1, rotate: 0 }}
              transition={{ delay: Math.min(i * 0.045, 0.5), type: "spring", stiffness: 320, damping: 26 }}
              style={{ marginLeft: i === 0 ? 0 : -Math.round(w * 0.32), zIndex: i, cursor: actionable ? "pointer" : "default", touchAction: actionable ? "none" : "auto", opacity: illegal ? 0.68 : 1, filter: illegal ? "saturate(0.8) brightness(0.96)" : undefined }}>
              <CardFace card={card28(c)} width={w} highlight={actionable} single />
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

function LastTrick28({ view, onClose }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]>; onClose: () => void }) {
  const lt = view.round?.lastTrick;
  const me = view.mySeat ?? 0;
  if (!lt) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 55, display: "grid", placeItems: "center", background: "rgba(10,14,10,.62)", cursor: "pointer" }}>
      <motion.div initial={{ scale: 0.85, y: 14 }} animate={{ scale: 1, y: 0 }} transition={SPRING} onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--parchment)", border: "2.5px solid var(--gold)", borderRadius: 14, padding: "16px 20px", textAlign: "center", boxShadow: "0 14px 44px rgba(0,0,0,.5)", maxWidth: 460 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)" }}>LAST TRICK</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", margin: "12px 0", flexWrap: "wrap" }}>
          {lt.plays.map((p, i) => {
            const win = p.seat === lt.winner;
            return (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ borderRadius: 11, boxShadow: win ? "0 0 0 3px var(--gold)" : undefined, transform: win ? "scale(1.06)" : "none", display: "inline-block" }}>
                  <CardFace card={card28(p.card)} small deck="28" single />
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: 700, color: win ? "var(--gold)" : "var(--ink)" }}>
                  {p.seat === me ? "You" : (view.seatNames[p.seat]?.split(" ")[0] ?? "Bot")}{win ? " ✓" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--ink)" }}>
          <b>{lt.winner === me ? "You" : (view.seatNames[lt.winner]?.split(" ")[0] ?? "Bot")}</b> took it{lt.points > 0 ? <> — <b style={{ color: "var(--gold)" }}>+{lt.points}</b></> : " (no points)"}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 6 }}>tap anywhere to close</div>
      </motion.div>
    </motion.div>
  );
}

function MatchEnd({ view }: { view: NonNullable<ReturnType<typeof useStore28.getState>["view"]> }) {
  const winner = view.teamScores[0] === view.teamScores[1] ? -1 : view.teamScores[0] > view.teamScores[1] ? 0 : 1;
  const myTeam = (view.mySeat ?? 0) % 2;
  return (
    <div style={{ height: "100dvh", display: "grid", placeItems: "center", background: "radial-gradient(135% 95% at 50% 4%, #23241c, #0c0d08)", color: "var(--ivory)", fontFamily: SANS, textAlign: "center" }}>
      <div>
        <div style={{ fontSize: 26, fontFamily: SERIF, marginBottom: 10 }}>♠ Match over</div>
        <div style={{ fontSize: 18, marginBottom: 6 }}>Team Gold {view.teamScores[0]} · Team Teal {view.teamScores[1]}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: winner < 0 ? "var(--ivory)" : winner === myTeam ? "var(--gold)" : "var(--teal)", marginBottom: 18 }}>
          {winner < 0 ? "Tied match" : winner === myTeam ? "Your team wins!" : "Your team lost"}
        </div>
        <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => { disconnect28(); useStore28.getState().reset(); }}>Back to games ▸</button>
      </div>
    </div>
  );
}

export { getRoomId28 };
