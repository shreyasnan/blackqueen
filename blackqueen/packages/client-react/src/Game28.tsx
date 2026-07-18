// The 28 game screens — Home (create/join), Lobby, and Table. Isolated from Black Queen, but built on
// the SAME UX system: oval felt, circular seat plates, synthesized sound, quick-chat bubbles, set-piece
// verdicts, confetti and card flights. Renders purely from the server view (store28).
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore28, Card28, Round28, View28 } from "./store28";
import { api28, connect28, sendAction28, storedRoom28, disconnect28, getRoomId28 } from "./net28";
import { btn, btnSec } from "./App";
import { CardFace } from "./Table";
import { Face } from "./faces";
import { sfx, haptic, isMuted, toggleMute } from "./audio";
import { useCardScale, toggleLargeCards, isLargeCards } from "./prefs";
import type { AuthState } from "./net";

const card28 = (c: Card28) => c as unknown as Parameters<typeof CardFace>[0]["card"]; // 28 ranks are valid BQ ranks

const GLYPH: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠" };
const SUIT_WORD: Record<string, string> = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" };
const red = (s: string) => s === "D" || s === "H";
const ck = (c: Card28) => `${c.rank}${c.suit}`;
const ckg = (c: Card28) => `${c.rank}${GLYPH[c.suit]}`;
const pv28 = (c: Card28) => (c.rank === "J" ? 3 : c.rank === "9" ? 2 : c.rank === "A" || c.rank === "10" ? 1 : 0);
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const TEAM_COLORS = ["#c2a24a", "#2e7d6b"]; // team 0 gold (seats 0,2), team 1 teal (seats 1,3)
const teamOf = (seat: number) => seat % 2;

const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 };
const SPRING_SOFT = { type: "spring" as const, stiffness: 260, damping: 22 };

// Quick-chat set — broadcast-only, fixed phrases (matches Black Queen's tray).
const EMOTES: Record<string, { face: string; bubble: string }> = {
  abbe:    { face: "😏", bubble: "😏 Abbe!" },
  jaldi:   { face: "⚡", bubble: "⚡ Jaldi chal" },
  mast:    { face: "🔥", bubble: "🔥 Mast!" },
  gg:      { face: "🤝", bubble: "🤝 Good game" },
  trump:   { face: "🃏", bubble: "🃏 Show trump!" },
  kya:     { face: "🤦", bubble: "🤦 Kya kar raha hai" },
  waah:    { face: "👏", bubble: "👏 Waah!" },
  chalo:   { face: "⏩", bubble: "⏩ Chalo chalo" },
  oof:     { face: "😬", bubble: "😬 Oof" },
  bakwaas: { face: "😤", bubble: "😤 Bakwaas" },
};
const CHAT_ORDER = ["abbe", "jaldi", "mast", "gg", "trump", "kya", "waah", "chalo", "oof", "bakwaas"];

/* DOM registry for flight animations (deal + trick gather) */
const seatEls = new Map<number, HTMLElement>();
let trickEl: HTMLElement | null = null;
const centerOf = (el: HTMLElement | null) => {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/* seat placement: viewer at 6 o'clock, play proceeds clockwise around an ellipse */
function seatAngle(rel: number): number { return ((90 + rel * 90) * Math.PI) / 180; }
function seatPct(rel: number, rx: number, ry: number): { left: string; top: string } {
  const a = seatAngle(rel);
  return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(min-width: 1020px)").matches);
  useEffect(() => {
    const m = matchMedia("(min-width: 1020px)");
    const h = () => setWide(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return wide;
}

export function Game28({ auth, onExit }: { auth: AuthState; onExit: () => void }) {
  const screen = useStore28((s) => s.screen);
  useEffect(() => {
    const rid = storedRoom28();
    if (rid) connect28(rid);
  }, []);
  if (screen === "table") return <Table28 onExit={onExit} />;
  if (screen === "lobby") return <Lobby28 auth={auth} />;
  return <Home28 auth={auth} onExit={onExit} />;
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

/* ------------------------------ quick chat ------------------------------ */
function QuickChatSheet28() {
  const [open, setOpen] = useState(false);
  const lastSent = useRef(0);
  const send = (key: string) => {
    setOpen(false);
    const now = Date.now();
    if (now - lastSent.current < 700) return;
    lastSent.current = now;
    sendAction28("EMOTE", { emote: key });
    sfx.emote(); haptic(12);
  };
  return (
    <>
      <button aria-label="quick chat" onClick={() => { setOpen((o) => !o); sfx.lift(); }}
        style={{ position: "absolute", right: 12, bottom: 184, zIndex: 30, width: 48, height: 48, borderRadius: 24, border: "1.5px solid var(--gold)", background: "var(--card)", boxShadow: "0 3px 10px rgba(0,0,0,.28)", fontSize: 23, cursor: "pointer", display: "grid", placeItems: "center", opacity: 0.94 }}>
        😊
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(24,44,38,.4)" }} />
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={SPRING_SOFT}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--parchment)", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 28px rgba(0,0,0,.28)", padding: "12px 14px calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ maxWidth: 460, margin: "0 auto" }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(59,34,71,.18)", margin: "0 auto 12px" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 4px 12px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "var(--ink-soft)", textTransform: "uppercase" }}>Quick chat</div>
                <button aria-label="close quick chat" onClick={() => setOpen(false)}
                  style={{ width: 28, height: 28, borderRadius: 14, background: "rgba(59,34,71,.08)", border: 0, cursor: "pointer", color: "var(--ink-soft)", fontSize: 14, display: "grid", placeItems: "center" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                {CHAT_ORDER.map((key) => {
                  const em = EMOTES[key]!;
                  const phrase = em.bubble.slice(em.face.length + 1);
                  return (
                    <button key={key} type="button" onClick={() => send(key)}
                      style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--card)", border: "1px solid rgba(59,34,71,.1)", borderRadius: 13, padding: "11px 12px", fontSize: 14.5, color: "var(--ink)", cursor: "pointer", boxShadow: "0 1px 3px rgba(40,20,50,.05)", textAlign: "left" }}>
                      <span style={{ fontSize: 19, lineHeight: 1 }}>{em.face}</span>{phrase}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </>
  );
}

/* ------------------------------ theater: sound, bubbles, confetti, flights ------------------------------ */
type Overlay28 =
  | { type: "crown"; seat: number; value: number }
  | { type: "reveal"; seat: number; suit: string }
  | { type: "round"; success: boolean; captured: number; bid: number; gamePoints: number; bidderTeam: number }
  | null;

function useTheater28(
  view: View28 | null,
  stateVersion: number,
  setOverlay: (o: Overlay28) => void,
  setBubbles: React.Dispatch<React.SetStateAction<{ id: number; seat: number; text: string }[]>>,
  confetti: () => void,
) {
  const processed = useRef(0);
  const bubbleId = useRef(0);
  const wasMyTurn = useRef(false);
  const prevDeal = useRef(0);
  const shownVerdict = useRef(0);

  useEffect(() => {
    if (!view) return;
    const r = view.round;
    const me = view.mySeat ?? 0;

    // NEW DEAL: fan cards out from the center to each seat
    if (view.dealNumber !== prevDeal.current) {
      prevDeal.current = view.dealNumber;
      if (!REDUCED && r) {
        const from = centerOf(trickEl);
        const fs: { x0: number; y0: number; x1: number; y1: number; delay: number }[] = [];
        for (let round = 0; round < 4; round++) {
          for (let seat = 0; seat < 4; seat++) {
            const to = centerOf(seatEls.get(seat) ?? null);
            fs.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, delay: (round * 4 + seat) * 55 });
          }
        }
        setTimeout(() => useStore28.getState().addFlights(fs), 60);
        sfx.gather();
      }
    }

    // events for THIS state step (server ships lastEvents per engine step)
    if (stateVersion > processed.current) {
      processed.current = stateVersion;
      for (const e of view.events ?? []) cue(e as any);
    }

    // "your turn" chime the moment control lands on you in PLAY
    const mine = !!r && r.actor === me && r.phase === "PLAY";
    if (mine && !wasMyTurn.current) { sfx.yourTurn(); haptic(30); }
    wasMyTurn.current = mine;

    // ROUND VERDICT — state-derived so reconnect/refresh still shows it; once per deal
    if (r && r.phase === "DONE" && r.result && shownVerdict.current !== view.dealNumber) {
      shownVerdict.current = view.dealNumber;
      const res = r.result;
      setTimeout(() => {
        if (res.success) { sfx.made(); confetti(); } else sfx.failed();
        setOverlay({ type: "round", success: res.success, captured: res.captured[res.bidderTeam], bid: r.bid, gamePoints: res.gamePoints, bidderTeam: res.bidderTeam });
      }, 1200);
    }
    if (r && r.phase !== "DONE" && shownVerdict.current !== 0 && r.phase !== "REDEAL") shownVerdict.current = 0;

    function cue(e: { kind: string; [k: string]: any }) {
      switch (e.kind) {
        case "BID": {
          if (e.value >= 28) sfx.slam150(); else sfx.bid(e.value);
          break;
        }
        case "PASS": sfx.pass(); break;
        case "BIDDING_WON": {
          sfx.crown();
          if (e.seat !== (view!.mySeat ?? 0)) { setOverlay({ type: "crown", seat: e.seat, value: e.value }); setTimeout(() => setOverlay(null), 2200); }
          break;
        }
        case "TRUMP_CONCEALED": sfx.stamp(); haptic(20); break;
        case "RAISED": sfx.bid(e.value); break;
        case "TRUMP_REVEALED": {
          sfx.sting(); haptic([40, 60, 40]); confetti();
          setOverlay({ type: "reveal", seat: e.seat, suit: e.suit });
          setTimeout(() => setOverlay(null), 2000);
          break;
        }
        case "PLAY": { sfx.thock(); if (pv28(e.card) > 0) sfx.coin(0); break; }
        case "TRICK_WON": { sfx.gather(); haptic(15); if (e.points > 0) for (let i = 0; i < Math.min(3, Math.ceil(e.points / 3)); i++) sfx.coin(i); break; }
        case "REDEAL": useStore28.getState().pushToast(`Redeal — ${String(e.reason).replace(/-/g, " ")}`); break;
        case "EMOTE": {
          sfx.emote();
          const id = ++bubbleId.current;
          setBubbles((b) => [...b, { id, seat: e.seat, text: EMOTES[e.emote]?.bubble ?? "👋" }]);
          setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2200);
          break;
        }
      }
    }
  }, [stateVersion, view]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------ Table ------------------------------ */
function Table28({ onExit }: { onExit: () => void }) {
  const view = useStore28((s) => s.view);
  const stateVersion = useStore28((s) => s.stateVersion);
  const connection = useStore28((s) => s.connection);
  const toasts = useStore28((s) => s.toasts);
  const [overlay, setOverlay] = useState<Overlay28>(null);
  const [bubbles, setBubbles] = useState<{ id: number; seat: number; text: string }[]>([]);
  const [burst, setBurst] = useState(0);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [, force] = useState(0);
  useTheater28(view, stateVersion, setOverlay, setBubbles, () => setBurst((b) => b + 1));

  if (!view) return <div style={{ display: "grid", placeItems: "center", height: "100dvh", color: "var(--ivory)", background: "#14150f" }}>Connecting…</div>;
  if (view.phase === "ENDED") return <MatchEnd view={view} onExit={onExit} />;

  return (
    <div style={{ height: "100dvh", position: "relative", overflow: "hidden", background: "radial-gradient(135% 95% at 50% 4%, #23241c 0%, #16170f 58%, #0c0d08 100%)", display: "flex", flexDirection: "column", fontFamily: SANS }}>
      {/* overhead bloom + vignette */}
      <div aria-hidden style={{ position: "absolute", top: "-14%", left: "50%", transform: "translateX(-50%)", width: "min(760px,120%)", height: "42%", background: "radial-gradient(ellipse at center, rgba(255,244,222,.13), rgba(255,244,222,0) 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 105% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        <HUD28 view={view} onMute={() => force((x) => x + 1)} onScores={() => setScoresOpen(true)} />
        <PokerTable28 view={view} bubbles={bubbles} />
        <MyArea28 view={view} hideControls={overlay?.type === "round"} />
      </div>

      <QuickChatSheet28 />
      <LastTrick28 view={view} />
      <ScoresModal28 view={view} open={scoresOpen} onClose={() => setScoresOpen(false)} />
      <SetPiece28 overlay={overlay} view={view} onDismiss={() => setOverlay(null)} />
      <Confetti burst={burst} />
      <FlightLayer28 />
      {connection === "reconnecting" && <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: "var(--coral)", color: "#fff", textAlign: "center", padding: 6, zIndex: 70 }}>Reconnecting…</div>}
      <Toasts28 toasts={toasts} />
    </div>
  );
}

/* ------------------------------ HUD ------------------------------ */
function HUD28({ view: v, onMute, onScores }: { view: View28; onMute: () => void; onScores: () => void }) {
  const wide = useWide();
  const r = v.round;
  const me = v.mySeat ?? 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "8px 12px", gap: 8, zIndex: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button aria-label="leave table" title="Leave the table" style={{ ...btnSec, padding: "4px 8px", fontSize: 12, borderRadius: 8 }}
          onClick={() => { if (!window.confirm("Leave the table? The table plays your cards until you rejoin (reopen the same link).")) return; const rid = getRoomId28(); if (rid) void api28(`/api/28/rooms/${rid}/leave`, {}).catch(() => {}); disconnect28(); useStore28.getState().reset(); }}>↩</button>
        <div style={{ fontSize: 13, color: "rgba(242,234,214,.82)", fontWeight: 700, letterSpacing: 0.4, whiteSpace: "nowrap" }}>
          DEAL {v.dealNumber}<span style={{ opacity: 0.5 }}>/{v.totalDeals}</span>
        </div>
      </div>
      <div />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        {r && r.bidder >= 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--card)", border: "1.5px solid var(--gold)", borderRadius: 9, padding: "3px 10px", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>{r.bid}</span>
            <span style={{ fontSize: 17, lineHeight: 1, color: r.trumpSuit && red(r.trumpSuit) ? "var(--coral)" : "var(--ink)" }}>
              {r.trumpRevealed && r.trumpSuit ? GLYPH[r.trumpSuit]
                : r.trumpSuit ? <span title="you set this trump — hidden from others" style={{ opacity: 0.6 }}>{GLYPH[r.trumpSuit]}…</span>
                : r.trumpConcealed ? "●" : "❓"}
            </span>
          </div>
        )}
        <button aria-label="scores" title="Scores" onClick={onScores} style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8 }}>{wide ? "🏆 scores" : "🏆"}</button>
        <button aria-label="large cards" title="Bigger cards" onClick={() => { toggleLargeCards(); onMute(); }} style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8, fontWeight: 800, background: isLargeCards() ? "var(--gold)" : undefined, color: isLargeCards() ? "#1c1c1a" : undefined }}>🅐</button>
        <button aria-label="mute" onClick={() => { toggleMute(); onMute(); }} style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8 }}>{isMuted() ? "🔇" : "🔊"}</button>
      </div>
    </div>
  );
}

/* ------------------------------ timer ring ------------------------------ */
function TimerRing28({ active, budgetMs, size, self }: { active: boolean; budgetMs: number; size: number; self?: boolean }) {
  const sv = useStore28((s) => s.stateVersion);
  const [left, setLeft] = useState<number | null>(null);
  const ticked = useRef(99);
  useEffect(() => {
    if (!active) { setLeft(null); ticked.current = 99; return; }
    const started = Date.now();
    const t = setInterval(() => {
      const l = Math.ceil((budgetMs - (Date.now() - started)) / 1000);
      setLeft(l <= 15 ? Math.max(0, l) : null);
      if (self && l <= 3 && l >= 1 && l < ticked.current) { ticked.current = l; sfx.lift(); haptic(20); }
    }, 250);
    return () => clearInterval(t);
  }, [active, budgetMs, sv, self]);
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

/* ------------------------------ oval table ------------------------------ */
function PokerTable28({ view: v, bubbles }: { view: View28; bubbles: { id: number; seat: number; text: string }[] }) {
  const me = v.mySeat ?? 0;
  const rel = (seat: number) => (seat - me + 4) % 4;
  const wide = useWide();
  const seatRx = wide ? 44 : 39;
  return (
    <div style={{ flex: 1, minHeight: 300, position: "relative", margin: "2px 8px", paddingTop: 22 }}>
      <div style={{ position: "absolute", inset: "6% 2%", borderRadius: "50% / 42%", background: "linear-gradient(180deg, var(--wood-a) 0%, var(--wood-b) 44%, var(--wood-c) 100%)", boxShadow: "0 14px 30px rgba(0,0,0,.55), inset 0 2px 1px rgba(255,222,170,.32), inset 0 -4px 6px rgba(0,0,0,.5)" }} />
      <div style={{ position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%", background: "radial-gradient(ellipse at 50% 34%, var(--felt-a) 0%, var(--felt-b) 52%, var(--felt-c) 100%)", boxShadow: "inset 0 8px 30px rgba(0,0,0,.45), inset 0 -12px 44px rgba(0,0,0,.32)" }} />
      <div aria-hidden style={{ position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%", pointerEvents: "none", background: "radial-gradient(60% 44% at 50% 30%, rgba(255,248,225,.10), rgba(255,248,225,0) 62%)" }} />
      <div style={{ position: "absolute", inset: "22% 18%", borderRadius: "50% / 44%", border: "1.5px solid rgba(255,246,220,.12)", pointerEvents: "none" }} />
      <TrickOnFelt28 view={v} />
      <FeltStatus28 view={v} />
      {[0, 1, 2, 3].map((seat) => {
        const pos = seatPct(rel(seat), seatRx, seat === me ? 40 : 46);
        return (
          <div key={seat} style={{ position: "absolute", ...pos, transform: "translate(-50%,-50%)", zIndex: 4 }}>
            <SeatChip28 view={v} seat={seat} big={seat === me} bubbles={bubbles} />
          </div>
        );
      })}
    </div>
  );
}

function FeltStatus28({ view: v }: { view: View28 }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  if (!r) return null;
  const mine = r.actor === me;
  let main: string | null = null; let sub: string | null = null;
  const who = (seat: number) => (seat === me ? "You" : v.seatNames[seat]?.split(" ")[0] ?? `Seat ${seat}`);
  if (r.phase === "BIDDING") {
    main = mine ? "Your bid" : `${who(r.actor)} is bidding`;
    if (r.bidder >= 0) sub = `high bid ${r.bid} · ${who(r.bidder)}`;
  } else if (r.phase === "CONCEAL") {
    main = mine ? "Choose your trump" : `${who(r.actor)} is setting trump…`;
  } else if (r.phase === "RAISE") {
    main = mine ? "Raise or play?" : "Bidding side may raise…";
  }
  if (!main) return null;
  return (
    <div style={{ position: "absolute", left: "50%", top: "33%", transform: "translate(-50%,-50%)", zIndex: 2, pointerEvents: "none", textAlign: "center", whiteSpace: "nowrap" }}>
      <div style={{ display: "inline-block", background: "rgba(35,20,45,.34)", color: mine ? "#ffe6a6" : "rgba(255,253,247,.96)", fontSize: 15.5, fontWeight: 700, padding: "3px 13px", borderRadius: 14, textShadow: "0 1px 3px rgba(0,0,0,.4)" }}>{main}</div>
      {sub && <div style={{ marginTop: 4, fontSize: 12.5, color: "rgba(255,253,247,.8)", textShadow: "0 1px 3px rgba(0,0,0,.4)" }}>{sub}</div>}
    </div>
  );
}

function SeatChip28({ view: v, seat, big, bubbles }: { view: View28; seat: number; big?: boolean; bubbles: { id: number; seat: number; text: string }[] }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  const wide = useWide();
  const active = !!r && r.actor === seat && (r.phase === "BIDDING" || r.phase === "CONCEAL" || r.phase === "RAISE" || r.phase === "PLAY");
  const isBidder = r?.bidder === seat;
  const team = teamOf(seat);
  const faceSize = big ? 42 : 34;
  const ringD = faceSize + 10;
  const ringColor = active ? "#efe3c4" : TEAM_COLORS[team]!;
  const ringGlow = active
    ? ["0 0 10px rgba(242,232,212,.4)", "0 0 20px rgba(232,214,176,.85)", "0 0 10px rgba(242,232,212,.4)"]
    : `0 0 7px ${TEAM_COLORS[team]}55`;
  const name = seat === me ? "You" : (v.seatNames[seat]?.split(" ")[0] ?? `Seat ${seat}`);
  const count = r?.handCounts[seat] ?? 0;
  const away = seat !== me && v.seatConnected[seat] === false;
  const nameTint = team === 0 ? "#ffe6a6" : "#bfeede";
  return (
    <motion.div ref={(el) => { if (el) seatEls.set(seat, el); }}
      animate={{ scale: active ? 1.08 : 1, y: active ? -2 : 0 }} transition={SPRING}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", maxWidth: wide ? undefined : "42vw" }}>
      {/* emote bubbles */}
      <AnimatePresence>
        {bubbles.filter((b) => b.seat === seat).map((b) => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 6, scale: 0.6 }} animate={{ opacity: 1, y: -8, scale: 1 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "var(--card)", border: "1.5px solid var(--gold)", borderRadius: 12, padding: "2px 9px", whiteSpace: "nowrap", fontSize: 14, zIndex: 8, boxShadow: "0 3px 8px rgba(0,0,0,.3)" }}>
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>
      {/* bobbing pointer */}
      <AnimatePresence>
        {active && !REDUCED && (
          <motion.div initial={{ opacity: 0, y: -6 }} exit={{ opacity: 0 }} animate={{ opacity: 1, y: [0, -6, 0] }} transition={{ y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" } }}
            style={{ position: "absolute", top: -20, left: "50%", marginLeft: -10, zIndex: 9, width: 0, height: 0, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: "13px solid var(--gold)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))" }} />
        )}
      </AnimatePresence>
      {active && seat === me && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
          style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", zIndex: 10, whiteSpace: "nowrap", background: "var(--coral)", color: "#fff", fontSize: wide ? 10 : 9, fontWeight: 900, letterSpacing: 0.6, borderRadius: 8, padding: "1.5px 6px", boxShadow: "0 2px 6px rgba(0,0,0,.3)" }}>
          YOUR TURN
        </motion.div>
      )}
      <div style={{ position: "relative", display: "inline-block" }}>
        <motion.div animate={{ borderColor: ringColor, boxShadow: ringGlow }}
          transition={{ boxShadow: active ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : { duration: 0.3 } }}
          style={{ width: ringD, height: ringD, borderRadius: "50%", border: "2.5px solid", borderColor: ringColor, background: "var(--parchment)", overflow: "hidden", display: "grid", placeItems: "center" }}>
          <Face id={v.seatAvatars[seat] ?? "classic"} size={faceSize} tint={TEAM_COLORS[team]} />
        </motion.div>
        <TimerRing28 active={active} self={active && seat === me} budgetMs={v.turnMs ?? 45000} size={ringD + 8} />
        {isBidder && (
          <span title="bidder" style={{ position: "absolute", right: -3, bottom: -1, width: 18, height: 18, borderRadius: 9, background: "var(--coral)", color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: "18px", textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.35)" }}>B</span>
        )}
      </div>
      <div style={{ background: "rgba(16,32,24,.62)", borderRadius: 10, padding: big ? "3px 11px" : "2px 8px", maxWidth: wide ? 150 : "40vw", boxShadow: "0 2px 6px rgba(0,0,0,.28)" }}>
        <div style={{ fontWeight: 700, fontSize: big ? 13 : 12, color: nameTint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{name}</div>
        <div style={{ fontSize: 10, color: "rgba(255,253,247,.8)", whiteSpace: "nowrap", lineHeight: 1.25 }}>{away ? <b style={{ color: "#ff9b8a" }}>💤 away</b> : `${count} cards`}</div>
      </div>
    </motion.div>
  );
}

/* ------------------------------ trick on felt ------------------------------ */
function TrickOnFelt28({ view: v }: { view: View28 }) {
  const setLastTrickOpen = useStore28((s) => s.setLastTrickOpen);
  const r = v.round;
  const [linger, setLinger] = useState<{ plays: { seat: number; card: Card28 }[]; winner: number; points: number } | null>(null);
  const lastTrick = r?.lastTrick ?? null;
  // A completed trick is identified purely by its card signature. Keying the linger effect ONLY on this
  // (never on the live trick length) is what lets each new trick's cards land one-by-one underneath —
  // an earlier version also depended on trick length, which cancelled the clear-timer and froze the felt.
  const lastSig = lastTrick ? lastTrick.plays.map((p) => ck(p.card)).join(",") : "";
  const prevSig = useRef("");
  useEffect(() => {
    if (!lastTrick || !lastSig || lastSig === prevSig.current) return;
    prevSig.current = lastSig;
    setLinger({ plays: lastTrick.plays, winner: lastTrick.winner, points: lastTrick.points });
    const t = setTimeout(() => {
      setLinger(null);
      if (!REDUCED) {
        const from = centerOf(trickEl);
        const to = centerOf(seatEls.get(lastTrick.winner) ?? null);
        useStore28.getState().addFlights(lastTrick.plays.map((p, i) => ({ x0: from.x + (i - lastTrick.plays.length / 2) * 26, y0: from.y, x1: to.x, y1: to.y, card: p.card, delay: i * 60 })));
      }
    }, 1050);
    return () => clearTimeout(t);
  }, [lastSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = v.mySeat ?? 0;
  const rel = (seat: number) => (seat - me + 4) % 4;
  const wide = useWide();
  const shown = linger ? linger.plays : (r?.trick ?? []);
  const rx = wide ? 26 : 20; const ryOther = wide ? 24 : 17.5; const ryMine = wide ? 17 : 14;
  const trickW = wide ? 52 : 48; const tiltAmp = wide ? 10 : 6;
  return (
    <div ref={(el) => { trickEl = el; }} onClick={() => { if (lastTrick) setLastTrickOpen(true); }}
      style={{ position: "absolute", inset: 0, cursor: lastTrick ? "pointer" : "default", zIndex: linger ? 6 : 3 }}>
      {linger && (
        <motion.div initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING}
          style={{ position: "absolute", top: "26%", left: "50%", transform: "translateX(-50%)", zIndex: 8, whiteSpace: "nowrap", background: "var(--gold)", color: "#fff", fontWeight: 800, borderRadius: 20, padding: "5px 16px", fontSize: wide ? 15 : 13.5, boxShadow: "0 4px 14px rgba(0,0,0,.35)", maxWidth: "88%", overflow: "hidden", textOverflow: "ellipsis" }}>
          <Face id={v.seatAvatars[linger.winner] ?? "classic"} size={19} /> {linger.winner === me ? "You take" : `${v.seatNames[linger.winner]?.split(" ")[0] ?? "Bot"} takes`}{wide ? " the hand" : " it"}{linger.points > 0 ? ` +${linger.points}` : ""}
        </motion.div>
      )}
      {shown.length === 0 && r?.phase === "PLAY" && r.actor === me && (
        <span style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%,-50%)", color: "rgba(255,253,247,.75)", fontStyle: "italic", fontSize: 14, whiteSpace: "nowrap" }}>your lead — drag up or tap a card</span>
      )}
      <AnimatePresence>
        {shown.map((p) => {
          const winner = linger && p.seat === linger.winner;
          const pos = seatPct(rel(p.seat), rx, rel(p.seat) === 0 ? ryMine : ryOther);
          const a = seatAngle(rel(p.seat));
          const tilt = (Math.cos(a) * -tiltAmp).toFixed(1);
          const from = seatPct(rel(p.seat), 44, 46);
          return (
            <motion.div key={`${p.seat}-${ck(p.card)}`}
              initial={{ left: from.left, top: from.top, opacity: 0, scale: 0.7, rotate: Number(tilt) }}
              animate={{ left: pos.left, top: pos.top, opacity: 1, scale: winner && linger ? 1.16 : 1, rotate: Number(tilt) }}
              exit={{ opacity: 0, scale: 0.7 }} transition={SPRING_SOFT}
              style={{ position: "absolute", transform: "translate(-50%,-50%)", marginLeft: -26, marginTop: -37 }}>
              <div style={{ borderRadius: 9, boxShadow: `0 0 0 2.5px ${TEAM_COLORS[teamOf(p.seat)]}, 0 4px 10px rgba(0,0,0,.35)` }}>
                <CardFace card={card28(p.card)} small highlight={!!winner && !!linger} width={trickW} deck="28" single />
              </div>
              <div style={{ textAlign: "center", fontSize: 9.5, fontWeight: 800, marginTop: 1, color: "#fff", background: TEAM_COLORS[teamOf(p.seat)], borderRadius: 6, padding: "0px 4px", maxWidth: trickW + 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: "auto", marginRight: "auto", width: "fit-content", opacity: 0.92 }}>
                {p.seat === me ? "you" : v.seatNames[p.seat]?.split(" ")[0] ?? "Bot"}
              </div>
              {winner && <div style={{ textAlign: "center", fontSize: 11, marginTop: 2, color: "#ffd97a", fontWeight: 800, textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>✓</div>}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------ my area (controls + hand) ------------------------------ */
function MyArea28({ view: v, hideControls }: { view: View28; hideControls?: boolean }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  const isHost = v.hostSeat === me;
  if (!r) return null;
  const mine = r.actor === me;

  if (r.phase === "DONE") {
    if (hideControls) return null; // the verdict modal already offers "Next deal"
    return (
      <div style={{ padding: 14, textAlign: "center" }}>
        <div style={{ color: "var(--ivory)", fontSize: 15, marginBottom: 8 }}>
          {r.result?.success ? "Bid made" : "Bid failed"} — {r.result ? `${r.result.gamePoints > 0 ? "+" : ""}${r.result.gamePoints} game pts` : ""}
        </div>
        {isHost
          ? <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => sendAction28("HOST_NEXT_DEAL", {})}>{v.dealNumber >= v.totalDeals ? "Finish match ▸" : "Next deal ▸"}</button>
          : <div style={{ color: "var(--ink-soft)" }}>Waiting for the host…</div>}
      </div>
    );
  }
  return (
    <div style={{ padding: "8px 10px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      {mine && r.phase === "BIDDING" && !hideControls && <BidBar28 r={r} />}
      {mine && r.phase === "RAISE" && !hideControls && <RaiseBar28 r={r} />}
      {!mine && (r.phase === "BIDDING" || r.phase === "RAISE" || r.phase === "CONCEAL") && (
        <div style={{ textAlign: "center", color: "rgba(242,234,214,.7)", fontSize: 13, marginBottom: 4 }}>waiting…</div>
      )}
      {mine && r.phase === "PLAY" && r.legal?.canReveal && (
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <button style={{ ...btn, background: "linear-gradient(180deg,#3c2a52,#2a1c3e)", padding: "9px 18px" }} onClick={() => { sendAction28("REVEAL_TRUMP", {}); sfx.stamp(); }}>
            {r.legal.mustReveal ? "Reveal trump & play ▸" : "Call for trump 🃏"}
          </button>
        </div>
      )}
      <Hand28 view={v} />
    </div>
  );
}

function BidBar28({ r }: { r: Round28 }) {
  const min = r.minBid ?? 14;
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  const tile: React.CSSProperties = { background: "linear-gradient(180deg,#2f2833,#221d27)", color: "var(--ivory)", border: 0, borderRadius: 10, padding: "9px 12px", fontWeight: 700, fontSize: 15, cursor: "pointer" };
  return (
    <div style={{ background: "linear-gradient(180deg,#1c211b,#12160f)", borderRadius: 15, padding: 10, width: "min(560px,96vw)", boxShadow: "0 9px 18px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: 7, marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button aria-label="lower bid" style={tile} onClick={() => setVal((x) => Math.max(min, x - 1))}>−</button>
          <div style={{ ...tile, minWidth: 44, textAlign: "center", fontSize: 17, cursor: "default", color: "#f3ecd8" }}>{val}</div>
          <button aria-label="raise bid" style={tile} onClick={() => setVal((x) => Math.min(28, x + 1))}>+</button>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 7 }}>
          <button style={{ ...btn, flex: 1, padding: 11 }} onClick={() => sendAction28("BID", { value: val })}>Bid {val}</button>
          {r.canPass && <button style={{ ...btn, flex: 1, background: "linear-gradient(180deg,#3c2a52,#2a1c3e)", padding: 11 }} onClick={() => sendAction28("PASS", {})}>Pass</button>}
          {r.canDemandRedeal && <button style={{ ...btnSec, padding: 11 }} onClick={() => sendAction28("DEMAND_REDEAL", {})}>Redeal</button>}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "#8f8a78", textAlign: "center" }}>Min bid {min} · max 28</div>
    </div>
  );
}

function RaiseBar28({ r }: { r: Round28 }) {
  const min = Math.max(r.bid + 1, 24);
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  const tile: React.CSSProperties = { background: "linear-gradient(180deg,#2f2833,#221d27)", color: "var(--ivory)", border: 0, borderRadius: 10, padding: "9px 12px", fontWeight: 700, fontSize: 15, cursor: "pointer" };
  return (
    <div style={{ background: "linear-gradient(180deg,#1c211b,#12160f)", borderRadius: 15, padding: 10, width: "min(560px,96vw)", boxShadow: "0 9px 18px rgba(0,0,0,.5)", display: "flex", gap: 7, alignItems: "center", marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <button style={tile} onClick={() => setVal((x) => Math.max(min, x - 1))}>−</button>
        <div style={{ ...tile, minWidth: 44, textAlign: "center", fontSize: 17, cursor: "default", color: "#f3ecd8" }}>{val}</div>
        <button style={tile} onClick={() => setVal((x) => Math.min(28, x + 1))}>+</button>
      </div>
      <div style={{ flex: 1, display: "flex", gap: 7 }}>
        <button style={{ ...btn, flex: 1, padding: 11 }} onClick={() => sendAction28("RAISE", { value: val })}>Raise to {val}</button>
        <button style={{ ...btn, flex: 1, background: "linear-gradient(180deg,#3c2a52,#2a1c3e)", padding: 11 }} onClick={() => sendAction28("DECLINE_RAISE", {})}>Play as is</button>
      </div>
    </div>
  );
}

/* ------------------------------ hand ------------------------------ */
function Hand28({ view: v }: { view: View28 }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  const wide = useWide();
  const scale = useCardScale();
  if (!r) return null;
  const mine = r.actor === me;
  const conceal = mine && r.phase === "CONCEAL";
  const play = mine && r.phase === "PLAY";
  const isLegal = (c: Card28) => r.legal?.play.some((x) => x.suit === c.suit && x.rank === c.rank) ?? false;
  const onCard = (c: Card28) => {
    if (conceal) { sendAction28("SET_TRUMP", { card: c }); sfx.stamp(); haptic(14); }
    else if (play && isLegal(c)) { sendAction28("PLAY", { card: c }); sfx.thock(); haptic(10); }
  };
  const n = r.hand.length;
  const base = wide ? 74 : Math.min(66, Math.max(50, Math.floor((typeof innerWidth !== "undefined" ? innerWidth : 400) / (n * 0.66 + 1))));
  const cardW = Math.round(base * scale);
  const overlap = -Math.round(cardW * 0.34);
  const fanWidth = cardW + (n - 1) * (cardW + overlap);
  const vw = typeof innerWidth !== "undefined" ? innerWidth : 400;
  const overflows = fanWidth > vw - 16;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      {conceal && <div style={{ textAlign: "center", color: "var(--gold)", fontSize: 12.5, marginBottom: 6 }}>Tap or swipe up a card to set it face-down as trump — its suit becomes trump.</div>}
      {play && <div style={{ textAlign: "center", color: "rgba(242,234,214,.7)", fontSize: 11.5, marginBottom: 4 }}>tap or swipe a card up to play</div>}
      <div style={{ position: "relative", display: "flex", justifyContent: overflows ? "flex-start" : "center", alignItems: "flex-end", padding: overflows ? "2px 8px" : "2px 0", minHeight: cardW * 1.42 + 16, width: "100%", overflowX: overflows ? "auto" : "visible", WebkitOverflowScrolling: "touch" as any }}>
        {r.hand.map((c, i) => {
          const mid = (n - 1) / 2;
          const rot = n > 1 ? (i - mid) * Math.min(2.6, 24 / n) : 0;
          const lift = Math.abs(i - mid) * Math.min(1.6, 12 / n);
          const actionable = conceal || (play && isLegal(c));
          const illegal = play && !isLegal(c);
          // The fan's rotation + lift live on this STATIC wrapper; only the inner card is draggable, so
          // the swipe gesture never fights the fan transform (that was the stiffness vs. Black Queen).
          return (
            <div key={ck(c)} style={{ marginLeft: i === 0 ? 0 : overlap, transform: `rotate(${rot}deg) translateY(${lift}px)`, transformOrigin: "bottom center", zIndex: i, flexShrink: 0 }}>
              <DraggableCard28 card={c} width={cardW} actionable={actionable} illegal={!!illegal} delay={Math.min(i * 0.045, 0.5)} onPlay={() => onCard(c)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A single draggable/tappable card — drag physics ported 1:1 from Black Queen's DraggableCard:
 *  free-axis drag, snap back to origin, no constraints, so the swipe feels light and elastic. */
function DraggableCard28({ card, width, actionable, illegal, delay, onPlay }: { card: Card28; width: number; actionable: boolean; illegal: boolean; delay: number; onPlay: () => void }) {
  return (
    <motion.div drag={actionable} dragSnapToOrigin dragElastic={0.6}
      whileDrag={{ scale: 1.15, rotate: 4, zIndex: 60 }}
      onDragStart={() => actionable && sfx.lift()}
      onDragEnd={(_e, info) => { if (!actionable) return; if (info.offset.y < -80) onPlay(); else sfx.ret(); }}
      onClick={() => { if (actionable) onPlay(); }}
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: actionable ? -10 : 0, opacity: 1 }}
      transition={{ delay, type: "spring", stiffness: 320, damping: 26 }}
      style={{ cursor: actionable ? "pointer" : "default", touchAction: actionable ? "none" : "auto", opacity: illegal ? 0.7 : 1, filter: illegal ? "saturate(0.8) brightness(0.96)" : actionable ? "drop-shadow(0 4px 10px rgba(201,153,46,.4))" : undefined }}>
      <CardFace card={card28(card)} width={width} highlight={actionable} deck="28" single />
    </motion.div>
  );
}

/* ------------------------------ scores modal ------------------------------ */
function ScoresModal28({ view: v, open, onClose }: { view: View28; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const me = v.mySeat ?? 0;
  const myTeam = teamOf(me);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(20,20,14,.6)" }}>
      <motion.div initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT} onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 16, padding: "16px 18px", width: "min(360px,92vw)", boxShadow: "0 14px 44px rgba(0,0,0,.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>🏆 Scores</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>after deal {v.dealNumber} / {v.totalDeals}</div>
        </div>
        {[0, 1].map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: 11, marginBottom: 6, background: t === myTeam ? `${TEAM_COLORS[t]}22` : "transparent", border: `1.5px solid ${TEAM_COLORS[t]}` }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: TEAM_COLORS[t] }} />
              Team {t === 0 ? "Gold" : "Teal"}{t === myTeam ? " (you)" : ""}
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 400 }}>
                {v.seatNames[t]?.split(" ")[0] ?? `S${t}`} &amp; {v.seatNames[t + 2]?.split(" ")[0] ?? `S${t + 2}`}
              </span>
            </span>
            <b style={{ fontSize: 22, color: TEAM_COLORS[t] }}>{v.teamScores[t]}</b>
          </div>
        ))}
        <button onClick={onClose} style={{ ...btnSec, width: "100%", marginTop: 8, padding: "9px 0", fontSize: 14 }}>Close</button>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------ last trick ------------------------------ */
function LastTrick28({ view: v }: { view: View28 }) {
  const open = useStore28((s) => s.lastTrickOpen);
  const setOpen = useStore28((s) => s.setLastTrickOpen);
  const lt = v.round?.lastTrick;
  const me = v.mySeat ?? 0;
  if (!open || !lt) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, zIndex: 55, display: "grid", placeItems: "center", background: "rgba(10,14,10,.62)", cursor: "pointer" }}>
      <motion.div initial={{ scale: 0.85, y: 14 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT} onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--parchment)", border: "2.5px solid var(--gold)", borderRadius: 14, padding: "16px 20px", textAlign: "center", boxShadow: "0 14px 44px rgba(0,0,0,.5)", maxWidth: 460 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)" }}>LAST TRICK</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", margin: "12px 0", flexWrap: "wrap" }}>
          {lt.plays.map((p, i) => {
            const win = p.seat === lt.winner;
            return (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ borderRadius: 11, boxShadow: win ? `0 0 0 3px var(--gold)` : `0 0 0 2px ${TEAM_COLORS[teamOf(p.seat)]}`, transform: win ? "scale(1.06)" : "none", display: "inline-block" }}>
                  <CardFace card={card28(p.card)} small deck="28" single />
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: 700, color: win ? "var(--gold)" : TEAM_COLORS[teamOf(p.seat)] }}>
                  {p.seat === me ? "You" : (v.seatNames[p.seat]?.split(" ")[0] ?? "Bot")}{win ? " ✓" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--ink)" }}>
          <b>{lt.winner === me ? "You" : (v.seatNames[lt.winner]?.split(" ")[0] ?? "Bot")}</b> took it{lt.points > 0 ? <> — <b style={{ color: "var(--gold)" }}>+{lt.points}</b></> : " (no points)"}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 6 }}>tap anywhere to close</div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------ set pieces ------------------------------ */
function SetPiece28({ overlay, view: v, onDismiss }: { overlay: Overlay28; view: View28; onDismiss: () => void }) {
  const persistent = overlay?.type === "round";
  const me = v.mySeat ?? 0;
  const isHost = v.hostSeat === me;
  const name = (s: number) => (s === me ? "You" : v.seatNames[s]?.split(" ")[0] ?? "Bot");
  return (
    <AnimatePresence>
      {overlay && (
        <motion.div key={overlay.type} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 50, pointerEvents: persistent ? "auto" : "none", background: "rgba(30,20,10,.45)" }}>
          <motion.div initial={{ scale: 0.6, y: 24 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
            style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 14, padding: "18px 26px", textAlign: "center", maxWidth: 460, boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
            {overlay.type === "crown" && (
              <div style={{ fontSize: 22 }}>♛ <b>{name(overlay.seat)}</b> wins the bid<div style={{ fontSize: 30, fontWeight: 700, color: "var(--gold)" }}>{overlay.value}</div></div>
            )}
            {overlay.type === "reveal" && (
              <div>
                <motion.div initial={{ rotate: -8, scale: 1.5 }} animate={{ rotate: 0, scale: 1 }} style={{ fontSize: 52, color: red(overlay.suit) ? "var(--coral)" : "var(--ink)" }}>{GLYPH[overlay.suit]}</motion.div>
                <div style={{ fontSize: 20, marginTop: 8 }}>🃏 Trump revealed — <b>{SUIT_WORD[overlay.suit]}</b>!</div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>{name(overlay.seat)} called for it.</div>
              </div>
            )}
            {overlay.type === "round" && (
              <div>
                <div style={{ fontSize: 30, fontWeight: 800, color: overlay.success ? "var(--teal)" : "var(--coral)" }}>{overlay.success ? "BID MADE" : "BID FAILED"}</div>
                <div style={{ color: "var(--ink-soft)", lineHeight: 1.4, marginTop: 4 }}>
                  Team {overlay.bidderTeam === 0 ? "Gold" : "Teal"} captured <b>{overlay.captured}</b> of the <b>{overlay.bid}</b> they needed {overlay.success ? "✓" : "✗"}
                </div>
                <div style={{ marginTop: 8, fontWeight: 800, fontSize: 18, color: overlay.gamePoints > 0 ? "var(--teal)" : "var(--coral)" }}>
                  {overlay.gamePoints > 0 ? "+" : ""}{overlay.gamePoints} game points
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center" }}>
                  {isHost && v.dealNumber < v.totalDeals && (
                    <button style={{ ...btn, padding: "10px 20px" }} onClick={() => { sendAction28("HOST_NEXT_DEAL", {}); onDismiss(); }}>Next deal ▸</button>
                  )}
                  {isHost && v.dealNumber >= v.totalDeals && (
                    <button style={{ ...btn, padding: "10px 20px" }} onClick={() => { sendAction28("HOST_NEXT_DEAL", {}); onDismiss(); }}>Final standings ▸</button>
                  )}
                  <button style={{ ...btnSec, padding: "10px 18px" }} onClick={onDismiss}>{isHost ? "Look at the table" : "Close"}</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------ confetti + flights ------------------------------ */
const CONFETTI_COLORS = ["#c2a24a", "#e0724b", "#2e7d6b", "#7b5ea7", "#e7c25c"];
function Confetti({ burst }: { burst: number }) {
  if (burst === 0 || REDUCED) return null;
  return (
    <div key={burst} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 58, overflow: "hidden" }}>
      {Array.from({ length: 22 }, (_, i) => {
        const x = 8 + Math.random() * 84; const drift = (Math.random() - 0.5) * 30; const size = 6 + Math.random() * 7; const round = Math.random() > 0.5;
        return (
          <motion.div key={i} initial={{ left: `${x}%`, top: "38%", opacity: 1, rotate: 0 }}
            animate={{ left: `${x + drift}%`, top: "105%", opacity: [1, 1, 0.7], rotate: (Math.random() - 0.5) * 720 }}
            transition={{ duration: 1.5 + Math.random() * 0.8, ease: [0.2, 0.6, 0.7, 1], delay: Math.random() * 0.25 }}
            style={{ position: "absolute", width: size, height: round ? size : size * 1.6, borderRadius: round ? "50%" : 2, background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }} />
        );
      })}
    </div>
  );
}

function FlightLayer28() {
  const flights = useStore28((s) => s.flights);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 45 }}>
      <AnimatePresence>
        {flights.map((f) => (
          <motion.div key={f.id}
            initial={{ x: f.x0 - 20, y: f.y0 - 28, rotate: -10, opacity: 0.95, scale: 0.9 }}
            animate={{ x: f.x1 - 20, y: f.y1 - 28, rotate: 8, opacity: 0.2, scale: 0.55 }}
            exit={{ opacity: 0 }} transition={{ delay: f.delay / 1000, duration: 0.5, ease: [0.3, 0.7, 0.4, 1] }}
            style={{ position: "absolute" }}>
            {f.card ? <CardFace card={card28(f.card)} small deck="28" single /> : <CardBack28 />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
function CardBack28() {
  return <div style={{ width: 40, height: 56, borderRadius: 7, background: "repeating-linear-gradient(45deg, #1c2a20 0 4px, #2e4a3a 4px 8px)", border: "2px solid var(--gold)" }} />;
}

/* ------------------------------ toasts + match end ------------------------------ */
function Toasts28({ toasts }: { toasts: { id: number; text: string }[] }) {
  return (
    <div style={{ position: "fixed", bottom: 90, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 60 }}>
      {toasts.map((t) => (
        <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: "var(--ink)", color: "var(--ivory)", borderRadius: 8, padding: "8px 14px" }}>{t.text}</motion.div>
      ))}
    </div>
  );
}

function MatchEnd({ view, onExit }: { view: View28; onExit: () => void }) {
  const winner = view.teamScores[0] === view.teamScores[1] ? -1 : view.teamScores[0] > view.teamScores[1] ? 0 : 1;
  const myTeam = teamOf(view.mySeat ?? 0);
  useEffect(() => { sfx.fanfare(); }, []);
  const leave = () => { disconnect28(); useStore28.getState().reset(); onExit(); };
  return (
    <div style={{ height: "100dvh", display: "grid", placeItems: "center", background: "radial-gradient(135% 95% at 50% 4%, #23241c, #0c0d08)", color: "var(--ivory)", fontFamily: SANS, textAlign: "center" }}>
      <div>
        <div style={{ fontSize: 26, fontFamily: SERIF, marginBottom: 10 }}>♠ Match over</div>
        <div style={{ fontSize: 18, marginBottom: 6 }}>
          <b style={{ color: TEAM_COLORS[0] }}>Team Gold {view.teamScores[0]}</b> · <b style={{ color: TEAM_COLORS[1] }}>Team Teal {view.teamScores[1]}</b>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: winner < 0 ? "var(--ivory)" : winner === myTeam ? "var(--gold)" : "var(--teal)", marginBottom: 18 }}>
          {winner < 0 ? "Tied match" : winner === myTeam ? "Your team wins!" : "Your team lost"}
        </div>
        <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={leave}>Back to games ▸</button>
      </div>
    </div>
  );
}

export { getRoomId28 };
