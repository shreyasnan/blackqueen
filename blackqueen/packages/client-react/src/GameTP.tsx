// Teen Patti screens — Home, Lobby, Table. Built on the same UX kit as the other games: oval felt,
// circular seat plates, synthesized sound, quick-chat, set-piece showdowns, confetti, chip flights.
// Renders purely from the server view (storetp). 3–6 players, chips, elimination.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStoreTP, CardTP, RoundTP, ViewTP } from "./storetp";
import { apiTP, connectTP, sendActionTP, storedRoomTP, disconnectTP, getRoomIdTP } from "./nettp";
import { btn, btnSec } from "./App";
import { CardFace } from "./Table";
import { Face } from "./faces";
import { sfx, haptic, isMuted, toggleMute } from "./audio";
import type { AuthState } from "./net";

const cardTP = (c: CardTP) => c as unknown as Parameters<typeof CardFace>[0]["card"];
const GLYPH: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠" };
const red = (s: string) => s === "D" || s === "H";
const ck = (c: CardTP) => `${c.rank}${c.suit}`;
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const SEAT_COLORS = ["#e0684b", "#2e8f83", "#c9992e", "#7b5ea7", "#4a7fb5", "#b5527f"];
const chips = (n: number) => n.toLocaleString();

const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 };
const SPRING_SOFT = { type: "spring" as const, stiffness: 260, damping: 22 };

const EMOTES: Record<string, { face: string; bubble: string }> = {
  allin: { face: "🔥", bubble: "🔥 All in!" }, bluff: { face: "😏", bubble: "😏 Bluffing?" },
  gg: { face: "🤝", bubble: "🤝 Good game" }, jaldi: { face: "⚡", bubble: "⚡ Jaldi!" },
  show: { face: "👀", bubble: "👀 Show it!" }, pack: { face: "🙅", bubble: "🙅 Pack kar" },
  waah: { face: "👏", bubble: "👏 Waah!" }, oof: { face: "😬", bubble: "😬 Oof" },
  lucky: { face: "🍀", bubble: "🍀 Lucky!" }, chai: { face: "☕", bubble: "☕ Chai break?" },
};
const CHAT_ORDER = ["allin", "bluff", "gg", "jaldi", "show", "pack", "waah", "oof", "lucky", "chai"];

const seatEls = new Map<number, HTMLElement>();
let potEl: HTMLElement | null = null;
const centerOf = (el: HTMLElement | null) => {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
function seatAngle(rel: number, n: number): number { return ((90 + (rel * 360) / n) * Math.PI) / 180; }
function seatPct(rel: number, n: number, rx: number, ry: number): { left: string; top: string } {
  const a = seatAngle(rel, n);
  return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
}
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(min-width: 1020px)").matches);
  useEffect(() => { const m = matchMedia("(min-width: 1020px)"); const h = () => setWide(m.matches); m.addEventListener("change", h); return () => m.removeEventListener("change", h); }, []);
  return wide;
}

export function GameTP({ auth, onExit }: { auth: AuthState; onExit: () => void }) {
  const screen = useStoreTP((s) => s.screen);
  useEffect(() => { const rid = storedRoomTP(); if (rid) connectTP(rid); }, []);
  if (screen === "table") return <TableTP onExit={onExit} />;
  if (screen === "lobby") return <LobbyTP auth={auth} />;
  return <HomeTP auth={auth} onExit={onExit} />;
}

/* ------------------------------ Home ------------------------------ */
function HomeTP({ auth, onExit }: { auth: AuthState; onExit: () => void }) {
  const setScreen = useStoreTP((s) => s.setScreen);
  const setRoomInfo = useStoreTP((s) => s.setRoomInfo);
  const pushToast = useStoreTP((s) => s.pushToast);
  const [code, setCode] = useState("");
  const nick = (localStorage.getItem("bq_nick") || auth.name).slice(0, 20);
  const avatar = localStorage.getItem("bq_face") || "classic";
  const create = async () => {
    try {
      const r = await apiTP<{ roomId: string; code: string }>("/api/tp/rooms", { displayName: nick, avatar });
      setRoomInfo({ roomId: r.roomId, code: r.code, members: [{ accountId: auth.accountId, displayName: nick, avatar }], host: auth.accountId });
      setScreen("lobby");
    } catch (e) { pushToast(String(e)); }
  };
  const join = async () => {
    try {
      const r = await apiTP<{ roomId: string; members?: any[]; host?: string; reconnect?: boolean }>("/api/tp/rooms/join", { code, displayName: nick, avatar });
      if (r.reconnect) { connectTP(r.roomId); return; }
      setRoomInfo({ roomId: r.roomId, code: null, members: r.members ?? [], host: r.host ?? "" });
      setScreen("lobby");
    } catch (e) { pushToast(e instanceof Error ? e.message : "Invalid or expired code"); }
  };
  return (
    <div style={{ fontFamily: SANS, maxWidth: 440, margin: "0 auto", padding: "clamp(16px,4vw,26px)" }}>
      <button onClick={onExit} style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, marginBottom: 8 }}>← Games</button>
      <h1 style={{ fontFamily: SERIF, fontSize: "clamp(25px,7vw,31px)", fontWeight: 700, color: "var(--ink)", margin: "8px 0 4px" }}>Teen Patti</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 20, fontSize: 14.5 }}>Blind or seen, bet your chips, last one standing wins.</p>
      <button style={{ width: "100%", ...btn, borderRadius: 15, padding: 15, fontSize: 16 }} onClick={create}>Create table</button>
      <div style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center", marginTop: 10 }}>3–6 players — fill empty seats with bots. Everyone starts with 1,000 chips.</div>
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
function LobbyTP({ auth }: { auth: AuthState }) {
  const roomInfo = useStoreTP((s) => s.roomInfo);
  const setRoomInfo = useStoreTP((s) => s.setRoomInfo);
  const pushToast = useStoreTP((s) => s.pushToast);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!roomInfo) return;
    const t = setInterval(async () => {
      try {
        const s = await apiTP<any>(`/api/tp/rooms/${roomInfo.roomId}/state`);
        if (s.phase !== "OPEN") { clearInterval(t); connectTP(roomInfo.roomId); return; }
        setRoomInfo({ ...roomInfo, members: s.members, host: s.host, code: s.code });
      } catch { /* transient */ }
    }, 2000);
    return () => clearInterval(t);
  }, [roomInfo?.roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!roomInfo) return null;
  const isHost = roomInfo.host === auth.accountId;
  const members = roomInfo.members;
  const ghosts = Math.max(0, 6 - members.length);
  const canStart = members.length >= 3 && members.length <= 6;
  const shareLink = () => {
    const link = `${location.origin}/?jointp=${roomInfo.code}`;
    if (navigator.share) navigator.share({ title: "Teen Patti", text: "Join my table:", url: link }).catch(() => {});
    else { navigator.clipboard?.writeText(link); pushToast("Invite link copied"); }
  };
  const start = async () => {
    setStarting(true);
    try { await apiTP(`/api/tp/rooms/${roomInfo.roomId}/start`, {}); connectTP(roomInfo.roomId); }
    catch (e) { pushToast(`Couldn't start: ${e instanceof Error ? e.message : e}`); setStarting(false); }
  };
  return (
    <div style={{ fontFamily: SANS, maxWidth: 440, margin: "0 auto", padding: "clamp(16px,4vw,26px)" }}>
      <button onClick={() => { disconnectTP(); useStoreTP.getState().reset(); }} style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: "pointer", fontSize: 13.5, marginBottom: 12 }}>← Leave</button>
      {roomInfo.code && (
        <div style={{ background: "var(--card)", border: "1px solid rgba(70,52,26,.12)", borderRadius: 20, padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--ink-soft)" }}>Invite code</div>
          <div style={{ fontFamily: SERIF, fontSize: "clamp(30px,10vw,40px)", letterSpacing: 8, marginTop: 6, color: "var(--ink)" }}>{roomInfo.code}</div>
          <button onClick={shareLink} style={{ ...btnSec, marginTop: 14, borderRadius: 14, padding: "12px 18px" }}>Share invite link</button>
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 4px 12px" }}>{members.length} of 6 seated · need 3 to start</div>
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
            <button style={{ ...btnSec, flex: 1, borderRadius: 15, padding: 13, opacity: members.length >= 6 ? 0.5 : 1 }} disabled={members.length >= 6}
              onClick={async () => { try { await apiTP(`/api/tp/rooms/${roomInfo.roomId}/addbot`, {}); } catch (e) { pushToast(String(e)); } }}>Add a bot</button>
            {members.some((m: any) => m.isBot) && (
              <button style={{ ...btnSec, borderRadius: 15, padding: "13px 18px" }} onClick={async () => { try { await apiTP(`/api/tp/rooms/${roomInfo.roomId}/removebot`, {}); } catch { /* none */ } }}>Remove</button>
            )}
          </div>
          <button style={{ width: "100%", ...btn, borderRadius: 15, padding: 15, fontSize: 16, opacity: !canStart || starting ? 0.5 : 1 }} disabled={!canStart || starting} onClick={start}>
            {starting ? "Starting…" : "Start game"}
          </button>
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
            {members.length < 3 ? `Add ${3 - members.length} more (bots count).` : "Deal them in."}
          </div>
        </>
      )}
      {!isHost && <div style={{ textAlign: "center", fontSize: 13, color: "var(--ink-soft)" }}>Waiting for the host to start…</div>}
    </div>
  );
}

/* ------------------------------ quick chat ------------------------------ */
function QuickChatTP() {
  const [open, setOpen] = useState(false);
  const lastSent = useRef(0);
  const send = (key: string) => {
    setOpen(false);
    const now = Date.now();
    if (now - lastSent.current < 700) return;
    lastSent.current = now;
    sendActionTP("EMOTE", { emote: key });
    sfx.emote(); haptic(12);
  };
  return (
    <>
      <button aria-label="quick chat" onClick={() => { setOpen((o) => !o); sfx.lift(); }}
        style={{ position: "absolute", right: 12, bottom: 184, zIndex: 30, width: 48, height: 48, borderRadius: 24, border: "1.5px solid var(--gold)", background: "var(--card)", boxShadow: "0 3px 10px rgba(0,0,0,.28)", fontSize: 23, cursor: "pointer", display: "grid", placeItems: "center", opacity: 0.94 }}>😊</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(24,44,38,.4)" }} />
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={SPRING_SOFT}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--parchment)", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 28px rgba(0,0,0,.28)", padding: "12px 14px calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ maxWidth: 460, margin: "0 auto" }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(59,34,71,.18)", margin: "0 auto 12px" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                {CHAT_ORDER.map((key) => {
                  const em = EMOTES[key]!;
                  return (
                    <button key={key} type="button" onClick={() => send(key)}
                      style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--card)", border: "1px solid rgba(59,34,71,.1)", borderRadius: 13, padding: "11px 12px", fontSize: 14.5, color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ fontSize: 19, lineHeight: 1 }}>{em.face}</span>{em.bubble.slice(em.face.length + 1)}
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

/* ------------------------------ theater ------------------------------ */
type OverlayTP =
  | { type: "round"; winner: number; pot: number; byFold: boolean; tie: boolean; winners: number[]; reveal: { seat: number; cards: CardTP[]; hand: string }[] | null }
  | { type: "sideshow"; requester: number; target: number }
  | null;

function useTheaterTP(view: ViewTP | null, stateVersion: number, setOverlay: (o: OverlayTP) => void, setBubbles: React.Dispatch<React.SetStateAction<{ id: number; seat: number; text: string }[]>>, confetti: () => void) {
  const processed = useRef(0);
  const bubbleId = useRef(0);
  const wasMyTurn = useRef(false);
  const prevHand = useRef(0);
  const shownVerdict = useRef(0);
  const prevStacks = useRef<number[] | null>(null);

  useEffect(() => {
    if (!view) return;
    const r = view.round;
    const me = view.mySeat ?? 0;

    if (view.handNumber !== prevHand.current) {
      prevHand.current = view.handNumber;
      shownVerdict.current = 0;
      if (!REDUCED && r) { const from = centerOf(potEl); const fs: any[] = []; for (let round = 0; round < 3; round++) for (let s = 0; s < view.stacks.length; s++) { const to = centerOf(seatEls.get(s) ?? null); fs.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, delay: (round * view.stacks.length + s) * 45 }); } setTimeout(() => useStoreTP.getState().addFlights(fs), 60); sfx.gather(); }
    }

    if (stateVersion > processed.current) {
      processed.current = stateVersion;
      for (const e of view.events ?? []) cue(e as any);
    }

    // elimination toasts (a stack dropped to 0)
    if (prevStacks.current) for (let s = 0; s < view.stacks.length; s++) if (prevStacks.current[s]! > 0 && view.stacks[s] === 0) useStoreTP.getState().pushToast(`💥 ${s === me ? "You are" : (view.seatNames[s]?.split(" ")[0] ?? "Bot") + " is"} out of chips`);
    prevStacks.current = view.stacks.slice();

    const mine = !!r && r.actor === me && r.phase === "BETTING";
    if (mine && !wasMyTurn.current) { sfx.yourTurn(); haptic(30); }
    wasMyTurn.current = mine;

    if (r && r.phase === "DONE" && r.result && shownVerdict.current !== view.handNumber) {
      shownVerdict.current = view.handNumber;
      const res = r.result;
      setTimeout(() => {
        sfx.made(); confetti();
        setOverlay({ type: "round", winner: res.winner, pot: res.pot, byFold: res.byFold, tie: res.tie, winners: res.winners, reveal: r.reveal });
        if (!REDUCED) { const from = centerOf(potEl); const to = centerOf(seatEls.get(res.winner) ?? null); useStoreTP.getState().addFlights(Array.from({ length: 6 }, (_, i) => ({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, delay: i * 70 }))); }
      }, 900);
    }

    function cue(e: { kind: string; [k: string]: any }) {
      switch (e.kind) {
        case "SEEN": if (e.seat === me) sfx.lift(); break;
        case "BET": { sfx.coin(0); if (e.allIn) sfx.slam150(); break; }
        case "PACK": sfx.pass(); break;
        case "SHOW": sfx.sting(); break;
        case "SHOWDOWN": sfx.sting(); haptic([40, 60, 40]); break;
        case "SIDESHOW_REQUEST": { sfx.lift(); setOverlay({ type: "sideshow", requester: e.requester, target: e.target }); setTimeout(() => setOverlay(null), 1600); break; }
        case "SIDESHOW_RESULT": useStoreTP.getState().pushToast(`Sideshow — ${e.loser === me ? "you" : view!.seatNames[e.loser]?.split(" ")[0] ?? "Bot"} packed`); break;
        case "SIDESHOW_DECLINED": useStoreTP.getState().pushToast("Sideshow declined"); break;
        case "HAND_WON": break; // verdict handled by the state-derived effect
        case "EMOTE": { sfx.emote(); const id = ++bubbleId.current; setBubbles((b) => [...b, { id, seat: e.seat, text: EMOTES[e.emote]?.bubble ?? "👋" }]); setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2200); break; }
      }
    }
  }, [stateVersion, view]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------ Table ------------------------------ */
function TableTP({ onExit }: { onExit: () => void }) {
  const view = useStoreTP((s) => s.view);
  const stateVersion = useStoreTP((s) => s.stateVersion);
  const connection = useStoreTP((s) => s.connection);
  const toasts = useStoreTP((s) => s.toasts);
  const [overlay, setOverlay] = useState<OverlayTP>(null);
  const [bubbles, setBubbles] = useState<{ id: number; seat: number; text: string }[]>([]);
  const [burst, setBurst] = useState(0);
  const [, force] = useState(0);
  useTheaterTP(view, stateVersion, setOverlay, setBubbles, () => setBurst((b) => b + 1));

  if (!view) return <div style={{ display: "grid", placeItems: "center", height: "100dvh", color: "var(--ivory)", background: "#14150f" }}>Connecting…</div>;
  if (view.phase === "ENDED") return <MatchEndTP view={view} onExit={onExit} />;

  return (
    <div style={{ height: "100dvh", position: "relative", overflow: "hidden", background: "radial-gradient(135% 95% at 50% 4%, #23241c 0%, #16170f 58%, #0c0d08 100%)", display: "flex", flexDirection: "column", fontFamily: SANS }}>
      <div aria-hidden style={{ position: "absolute", top: "-14%", left: "50%", transform: "translateX(-50%)", width: "min(760px,120%)", height: "42%", background: "radial-gradient(ellipse at center, rgba(255,244,222,.13), rgba(255,244,222,0) 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 105% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        <HUDTP view={view} onMute={() => force((x) => x + 1)} />
        <PokerTableTP view={view} bubbles={bubbles} />
        <MyAreaTP view={view} hideControls={overlay?.type === "round"} />
      </div>
      <QuickChatTP />
      <SetPieceTP overlay={overlay} view={view} onDismiss={() => setOverlay(null)} />
      <Confetti burst={burst} />
      <FlightLayerTP />
      {connection === "reconnecting" && <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: "var(--coral)", color: "#fff", textAlign: "center", padding: 6, zIndex: 70 }}>Reconnecting…</div>}
      <ToastsTP toasts={toasts} />
    </div>
  );
}

function HUDTP({ view: v, onMute }: { view: ViewTP; onMute: () => void }) {
  const r = v.round;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "8px 12px", gap: 8, zIndex: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button aria-label="leave" title="Leave the table" style={{ ...btnSec, padding: "4px 8px", fontSize: 12, borderRadius: 8 }}
          onClick={() => { if (!window.confirm("Leave the table? The table folds for you until you rejoin.")) return; const rid = getRoomIdTP(); if (rid) void apiTP(`/api/tp/rooms/${rid}/leave`, {}).catch(() => {}); disconnectTP(); useStoreTP.getState().reset(); }}>↩</button>
        <div style={{ fontSize: 13, color: "rgba(242,234,214,.82)", fontWeight: 700, letterSpacing: 0.4, whiteSpace: "nowrap" }}>HAND {v.handNumber}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        {r && <span style={{ fontSize: 12.5, color: "rgba(242,234,214,.7)" }}>stake <b style={{ color: "var(--gold)" }}>{chips(r.stake)}</b></span>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        <button aria-label="mute" onClick={() => { toggleMute(); onMute(); }} style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8 }}>{isMuted() ? "🔇" : "🔊"}</button>
      </div>
    </div>
  );
}

function TimerRingTP({ active, budgetMs, size, self }: { active: boolean; budgetMs: number; size: number; self?: boolean }) {
  const sv = useStoreTP((s) => s.stateVersion);
  const [left, setLeft] = useState<number | null>(null);
  const ticked = useRef(99);
  useEffect(() => {
    if (!active) { setLeft(null); ticked.current = 99; return; }
    const started = Date.now();
    const t = setInterval(() => { const l = Math.ceil((budgetMs - (Date.now() - started)) / 1000); setLeft(l <= 15 ? Math.max(0, l) : null); if (self && l <= 3 && l >= 1 && l < ticked.current) { ticked.current = l; sfx.lift(); haptic(20); } }, 250);
    return () => clearInterval(t);
  }, [active, budgetMs, sv, self]);
  if (!active) return null;
  const r = size / 2 - 2; const c = 2 * Math.PI * r; const urgent = left !== null && left <= 5;
  return (
    <>
      {!REDUCED && (
        <svg key={sv} width={size} height={size} style={{ position: "absolute", top: -4, left: "50%", marginLeft: -size / 2, transform: "rotate(-90deg)", pointerEvents: "none" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,.32)" strokeWidth={4} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round" initial={{ strokeDashoffset: 0, stroke: "#c2a24a" }} animate={{ strokeDashoffset: -c, stroke: ["#c2a24a", "#d9a418", "#e0724b"] }} transition={{ duration: budgetMs / 1000, ease: "linear", times: [0, 0.72, 1] }} strokeDasharray={c} />
        </svg>
      )}
      {left !== null && (
        <motion.span animate={urgent && !REDUCED ? { scale: [1, 1.25, 1] } : { scale: 1 }} transition={urgent ? { repeat: Infinity, duration: 0.8 } : undefined}
          style={{ position: "absolute", top: -10, right: -16, background: urgent ? "#c62f12" : "var(--coral)", color: "#fff", fontSize: urgent ? 12.5 : 11, fontWeight: 900, borderRadius: 9, minWidth: 18, padding: "1px 3px", textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.3)" }}>{left}</motion.span>
      )}
    </>
  );
}

function PokerTableTP({ view: v, bubbles }: { view: ViewTP; bubbles: { id: number; seat: number; text: string }[] }) {
  const me = v.mySeat ?? 0;
  const n = v.stacks.length;
  const rel = (seat: number) => (seat - me + n) % n;
  const wide = useWide();
  const seatRx = wide ? 44 : 39;
  return (
    <div style={{ flex: 1, minHeight: 300, position: "relative", margin: "2px 8px", paddingTop: 22 }}>
      <div style={{ position: "absolute", inset: "6% 2%", borderRadius: "50% / 42%", background: "linear-gradient(180deg, var(--wood-a) 0%, var(--wood-b) 44%, var(--wood-c) 100%)", boxShadow: "0 14px 30px rgba(0,0,0,.55), inset 0 2px 1px rgba(255,222,170,.32), inset 0 -4px 6px rgba(0,0,0,.5)" }} />
      <div style={{ position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%", background: "radial-gradient(ellipse at 50% 34%, var(--felt-a) 0%, var(--felt-b) 52%, var(--felt-c) 100%)", boxShadow: "inset 0 8px 30px rgba(0,0,0,.45), inset 0 -12px 44px rgba(0,0,0,.32)" }} />
      <PotTP view={v} />
      {Array.from({ length: n }, (_, seat) => seat).map((seat) => {
        const pos = seatPct(rel(seat), n, seatRx, seat === me ? 40 : 46);
        return <div key={seat} style={{ position: "absolute", ...pos, transform: "translate(-50%,-50%)", zIndex: 4 }}><SeatTP view={v} seat={seat} bubbles={bubbles} /></div>;
      })}
    </div>
  );
}

function PotTP({ view: v }: { view: ViewTP }) {
  const r = v.round;
  return (
    <div ref={(el) => { potEl = el; }} style={{ position: "absolute", left: "50%", top: "40%", transform: "translate(-50%,-50%)", textAlign: "center", zIndex: 2, pointerEvents: "none" }}>
      <div style={{ display: "inline-block", background: "rgba(20,12,6,.5)", border: "1.5px solid var(--gold)", borderRadius: 16, padding: "6px 16px", boxShadow: "0 4px 14px rgba(0,0,0,.4)" }}>
        <div style={{ fontSize: 10, letterSpacing: 1.2, color: "rgba(242,234,214,.6)", textTransform: "uppercase" }}>Pot</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--gold)", lineHeight: 1.1 }}>🪙 {chips(r?.pot ?? 0)}</div>
      </div>
      {r && r.phase !== "DONE" && (
        <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,253,247,.85)", textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>
          {r.actor === v.mySeat ? "Your move" : `${v.seatNames[r.actor]?.split(" ")[0] ?? "…"} to act`}
        </div>
      )}
    </div>
  );
}

function SeatTP({ view: v, seat, bubbles }: { view: ViewTP; seat: number; bubbles: { id: number; seat: number; text: string }[] }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  const wide = useWide();
  const p = r?.players[seat];
  const active = !!r && r.actor === seat && r.phase !== "DONE";
  const packed = p?.packed || (p && !p.active);
  const color = SEAT_COLORS[seat % SEAT_COLORS.length]!;
  const faceSize = seat === me ? 42 : 34;
  const ringD = faceSize + 10;
  const ringColor = active ? "#efe3c4" : packed ? "rgba(150,150,150,.5)" : color;
  const name = seat === me ? "You" : (v.seatNames[seat]?.split(" ")[0] ?? `Seat ${seat}`);
  const away = seat !== me && v.seatConnected[seat] === false;
  const isDealer = r?.dealer === seat;
  const out = v.stacks[seat] === 0 && (!p || !p.active);
  // Show chips that visibly decrease as bets go in: available = start-of-hand stack − committed bet
  // during a live hand; once the hand is DONE the room has already paid out, so use the settled stack.
  const avail = p && p.active && r && r.phase !== "DONE" ? p.stack - p.bet : v.stacks[seat] ?? 0;
  return (
    <motion.div ref={(el) => { if (el) seatEls.set(seat, el); }} animate={{ scale: active ? 1.08 : 1, y: active ? -2 : 0, opacity: packed ? 0.55 : 1 }} transition={SPRING}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", maxWidth: wide ? undefined : "40vw" }}>
      <AnimatePresence>
        {bubbles.filter((b) => b.seat === seat).map((b) => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 6, scale: 0.6 }} animate={{ opacity: 1, y: -8, scale: 1 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "var(--card)", border: "1.5px solid var(--gold)", borderRadius: 12, padding: "2px 9px", whiteSpace: "nowrap", fontSize: 14, zIndex: 8, boxShadow: "0 3px 8px rgba(0,0,0,.3)" }}>{b.text}</motion.div>
        ))}
      </AnimatePresence>
      {active && seat === me && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING} style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", zIndex: 10, whiteSpace: "nowrap", background: "var(--coral)", color: "#fff", fontSize: 9, fontWeight: 900, letterSpacing: 0.6, borderRadius: 8, padding: "1.5px 6px", boxShadow: "0 2px 6px rgba(0,0,0,.3)" }}>YOUR TURN</motion.div>
      )}
      <div style={{ position: "relative", display: "inline-block" }}>
        <motion.div animate={{ borderColor: ringColor, boxShadow: active ? ["0 0 10px rgba(242,232,212,.4)", "0 0 20px rgba(232,214,176,.85)", "0 0 10px rgba(242,232,212,.4)"] : `0 0 7px ${color}55` }} transition={{ boxShadow: active ? { repeat: Infinity, duration: 1.6 } : { duration: 0.3 } }}
          style={{ width: ringD, height: ringD, borderRadius: "50%", border: "2.5px solid", borderColor: ringColor, background: "var(--parchment)", overflow: "hidden", display: "grid", placeItems: "center", filter: out ? "grayscale(1)" : undefined }}>
          <Face id={v.seatAvatars[seat] ?? "classic"} size={faceSize} tint={color} />
        </motion.div>
        <TimerRingTP active={active} self={active && seat === me} budgetMs={v.turnMs ?? 45000} size={ringD + 8} />
        {isDealer && <span title="dealer" style={{ position: "absolute", left: -4, bottom: -1, width: 18, height: 18, borderRadius: 9, background: "#fff", color: "#1c1c1a", fontSize: 10, fontWeight: 900, lineHeight: "18px", textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.35)" }}>D</span>}
        {p && !packed && p.active && (
          <span style={{ position: "absolute", right: -6, top: -4, background: p.seen ? "var(--gold)" : "#3c2a52", color: "#fff", fontSize: 8.5, fontWeight: 800, borderRadius: 7, padding: "1px 5px", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>{p.allIn ? "ALL-IN" : p.seen ? "SEEN" : "BLIND"}</span>
        )}
      </div>
      <div style={{ background: "rgba(16,32,24,.62)", borderRadius: 10, padding: seat === me ? "3px 11px" : "2px 8px", maxWidth: wide ? 150 : "38vw", boxShadow: "0 2px 6px rgba(0,0,0,.28)" }}>
        <div style={{ fontWeight: 700, fontSize: seat === me ? 13 : 12, color: "#f2ead6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{name}{out ? " · out" : ""}</div>
        <div style={{ fontSize: 10.5, color: "var(--gold)", whiteSpace: "nowrap", lineHeight: 1.25, fontWeight: 700 }}>{away ? <b style={{ color: "#ff9b8a" }}>💤 away</b> : `🪙 ${chips(avail)}`}</div>
        {p && p.active && !packed && p.bet > 0 && r?.phase !== "DONE" && <div style={{ fontSize: 9.5, color: "rgba(255,253,247,.75)" }}>in pot {chips(p.bet)}</div>}
        {packed && p?.active && <div style={{ fontSize: 9.5, color: "#ff9b8a", fontWeight: 700 }}>packed</div>}
      </div>
    </motion.div>
  );
}

/* ------------------------------ my area (hand + controls) ------------------------------ */
function MyAreaTP({ view: v, hideControls }: { view: ViewTP; hideControls?: boolean }) {
  const r = v.round;
  const me = v.mySeat ?? 0;
  const isHost = v.hostSeat === me;
  if (!r) return null;

  if (r.phase === "DONE") {
    if (hideControls) return <div style={{ height: 8 }} />;
    return (
      <div style={{ padding: 14, textAlign: "center" }}>
        {isHost ? <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => sendActionTP("HOST_NEXT_HAND", {})}>Next hand ▸</button>
          : <div style={{ color: "var(--ink-soft)" }}>Waiting for the host…</div>}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 10px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <HandTP view={v} />
      <ControlsTP view={v} />
    </div>
  );
}

function HandTP({ view: v }: { view: ViewTP }) {
  const r = v.round!;
  const wide = useWide();
  const cards = r.yourCards;
  const w = wide ? 74 : 62;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {cards
          ? cards.map((c, i) => (
            <motion.div key={ck(c)} initial={{ rotateY: 180, opacity: 0, y: 20 }} animate={{ rotateY: 0, opacity: 1, y: 0 }} transition={{ delay: i * 0.08, ...SPRING }}>
              <CardFace card={cardTP(c)} width={w} deck="tp" single />
            </motion.div>
          ))
          : [0, 1, 2].map((i) => <CardBackTP key={i} width={w} />)}
      </div>
      {r.yourHand && <div style={{ fontSize: 12.5, color: "var(--gold)", fontWeight: 700 }}>you have: {r.yourHand}</div>}
      {!cards && <div style={{ fontSize: 11.5, color: "rgba(242,234,214,.6)" }}>you're playing blind</div>}
    </div>
  );
}

function ControlsTP({ view: v }: { view: ViewTP }) {
  const r = v.round!;
  const me = v.mySeat ?? 0;
  const L = r.legal;
  if (r.actor !== me && !(r.phase === "SIDESHOW" && r.sideshow?.target === me)) {
    return <div style={{ fontSize: 13, color: "rgba(242,234,214,.7)" }}>waiting…</div>;
  }
  if (!L) return null;

  if (L.answerSideshow) {
    const who = v.seatNames[L.sideshowRequester ?? 0]?.split(" ")[0] ?? "Bot";
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "var(--ivory)", fontSize: 13.5, marginBottom: 8 }}>{who} wants a sideshow — compare hands?</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button style={{ ...btn, padding: "10px 20px" }} onClick={() => { sendActionTP("SIDESHOW_RESPONSE", { accept: true }); sfx.sting(); }}>Accept</button>
          <button style={{ ...btnSec, padding: "10px 20px" }} onClick={() => sendActionTP("SIDESHOW_RESPONSE", { accept: false })}>Decline</button>
        </div>
      </div>
    );
  }

  const seen = r.players[me]?.seen;
  const call = L.bets.length > 0 ? L.bets[0]! : 0;
  const raise = L.bets.length > 1 ? L.bets[L.bets.length - 1]! : 0;
  const chaalLabel = seen ? "Chaal" : "Blind";
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center", alignItems: "center", maxWidth: "min(620px,98vw)" }}>
      {L.canSee && <button style={{ ...btn, background: "linear-gradient(180deg,#33543a,#22412a)", padding: "10px 16px" }} onClick={() => { sendActionTP("SEE", {}); sfx.lift(); }}>👀 See cards</button>}
      {L.canPack && <button style={{ ...btnSec, padding: "10px 16px" }} onClick={() => { sendActionTP("PACK", {}); sfx.pass(); }}>Pack</button>}
      {L.bets.length > 0 && <button style={{ ...btn, padding: "10px 16px" }} onClick={() => { sendActionTP("BET", { amount: call }); sfx.coin(0); }}>{chaalLabel} {chips(call)}</button>}
      {raise > call && <button style={{ ...btn, background: "linear-gradient(180deg,#8a5a1f,#6a4212)", padding: "10px 16px" }} onClick={() => { sendActionTP("BET", { amount: raise }); sfx.coin(1); }}>Raise {chips(raise)}</button>}
      {L.canSideshow && <button style={{ ...btnSec, padding: "10px 14px" }} onClick={() => { sendActionTP("SIDESHOW", {}); sfx.lift(); }}>Sideshow</button>}
      {L.canShow && <button style={{ ...btn, background: "linear-gradient(180deg,#3c2a52,#2a1c3e)", padding: "10px 16px" }} onClick={() => { sendActionTP("SHOW", {}); sfx.sting(); }}>Show ({chips(L.showCost)})</button>}
    </div>
  );
}

function CardBackTP({ width }: { width: number }) {
  return <div style={{ width, height: width * 1.42, borderRadius: 9, background: "repeating-linear-gradient(45deg, #23402f 0 6px, #2e5a41 6px 12px)", border: "2px solid var(--gold)", boxShadow: "0 6px 13px rgba(0,0,0,.42)" }} />;
}

/* ------------------------------ set pieces ------------------------------ */
function SetPieceTP({ overlay, view: v, onDismiss }: { overlay: OverlayTP; view: ViewTP; onDismiss: () => void }) {
  const persistent = overlay?.type === "round";
  const me = v.mySeat ?? 0;
  const isHost = v.hostSeat === me;
  const name = (s: number) => (s === me ? "You" : v.seatNames[s]?.split(" ")[0] ?? "Bot");
  return (
    <AnimatePresence>
      {overlay && (
        <motion.div key={overlay.type} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 50, pointerEvents: persistent ? "auto" : "none", background: "rgba(30,20,10,.5)" }}>
          <motion.div initial={{ scale: 0.6, y: 24 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
            style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 14, padding: "18px 22px", textAlign: "center", maxWidth: 480, boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
            {overlay.type === "sideshow" && (
              <div style={{ fontSize: 18 }}>👀 <b>{name(overlay.requester)}</b> asks <b>{name(overlay.target)}</b> for a sideshow…</div>
            )}
            {overlay.type === "round" && (
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--teal)" }}>{overlay.tie ? "SPLIT POT" : `${name(overlay.winner)} win${overlay.winner === me ? "" : "s"}!`}</div>
                <div style={{ color: "var(--ink-soft)", marginTop: 4 }}>🪙 <b>{chips(overlay.pot)}</b> {overlay.byFold ? "— everyone else packed" : "at showdown"}</div>
                {overlay.reveal && (
                  <div style={{ display: "flex", gap: 14, justifyContent: "center", margin: "12px 0", flexWrap: "wrap" }}>
                    {overlay.reveal.map((rv) => {
                      const win = overlay.winners.includes(rv.seat);
                      return (
                        <div key={rv.seat} style={{ textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 3, justifyContent: "center", borderRadius: 9, padding: 3, boxShadow: win ? "0 0 0 3px var(--gold)" : undefined }}>
                            {rv.cards.map((c) => <CardFace key={ck(c)} card={cardTP(c)} small deck="tp" single />)}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700, color: win ? "var(--gold)" : "var(--ink)" }}>{name(rv.seat)} · {rv.hand}{win ? " ✓" : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center" }}>
                  {isHost && <button style={{ ...btn, padding: "10px 20px" }} onClick={() => { sendActionTP("HOST_NEXT_HAND", {}); onDismiss(); }}>Next hand ▸</button>}
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

/* ------------------------------ confetti + flights + toasts ------------------------------ */
const CONFETTI_COLORS = ["#c2a24a", "#e0724b", "#2e7d6b", "#7b5ea7", "#e7c25c"];
function Confetti({ burst }: { burst: number }) {
  if (burst === 0 || REDUCED) return null;
  return (
    <div key={burst} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 58, overflow: "hidden" }}>
      {Array.from({ length: 22 }, (_, i) => {
        const x = 8 + Math.random() * 84; const drift = (Math.random() - 0.5) * 30; const size = 6 + Math.random() * 7; const round = Math.random() > 0.5;
        return <motion.div key={i} initial={{ left: `${x}%`, top: "38%", opacity: 1, rotate: 0 }} animate={{ left: `${x + drift}%`, top: "105%", opacity: [1, 1, 0.7], rotate: (Math.random() - 0.5) * 720 }} transition={{ duration: 1.5 + Math.random() * 0.8, ease: [0.2, 0.6, 0.7, 1], delay: Math.random() * 0.25 }} style={{ position: "absolute", width: size, height: round ? size : size * 1.6, borderRadius: round ? "50%" : 2, background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }} />;
      })}
    </div>
  );
}
function FlightLayerTP() {
  const flights = useStoreTP((s) => s.flights);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 45 }}>
      <AnimatePresence>
        {flights.map((f) => (
          <motion.div key={f.id} initial={{ x: f.x0 - 12, y: f.y0 - 12, opacity: 0.95, scale: 1 }} animate={{ x: f.x1 - 12, y: f.y1 - 12, opacity: 0.2, scale: 0.5 }} exit={{ opacity: 0 }} transition={{ delay: f.delay / 1000, duration: 0.5, ease: [0.3, 0.7, 0.4, 1] }} style={{ position: "absolute" }}>
            {f.card ? <CardFace card={cardTP(f.card)} small deck="tp" single /> : <div style={{ width: 22, height: 22, borderRadius: 11, background: "radial-gradient(circle at 40% 35%, #f6d871, #c2a24a)", border: "1.5px solid #8a6d1f", boxShadow: "0 2px 5px rgba(0,0,0,.4)" }} />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
function ToastsTP({ toasts }: { toasts: { id: number; text: string }[] }) {
  return (
    <div style={{ position: "fixed", bottom: 90, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 60 }}>
      {toasts.map((t) => <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: "var(--ink)", color: "var(--ivory)", borderRadius: 8, padding: "8px 14px" }}>{t.text}</motion.div>)}
    </div>
  );
}

function MatchEndTP({ view, onExit }: { view: ViewTP; onExit: () => void }) {
  const me = view.mySeat ?? 0;
  const won = view.winnerSeat === me;
  useEffect(() => { sfx.fanfare(); }, []);
  const name = view.winnerSeat != null ? (view.winnerSeat === me ? "You" : view.seatNames[view.winnerSeat]?.split(" ")[0] ?? "Bot") : "Nobody";
  const leave = () => { disconnectTP(); useStoreTP.getState().reset(); onExit(); };
  return (
    <div style={{ height: "100dvh", display: "grid", placeItems: "center", background: "radial-gradient(135% 95% at 50% 4%, #23241c, #0c0d08)", color: "var(--ivory)", fontFamily: SANS, textAlign: "center" }}>
      <div>
        <div style={{ fontSize: 26, fontFamily: SERIF, marginBottom: 10 }}>🃏 Game over</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: won ? "var(--gold)" : "var(--ivory)", marginBottom: 6 }}>{won ? "You cleaned them out!" : `${name} takes the table`}</div>
        <div style={{ fontSize: 15, color: "rgba(242,234,214,.7)", marginBottom: 18 }}>🪙 {chips(view.stacks[view.winnerSeat ?? 0] ?? 0)} chips</div>
        <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={leave}>Back to games ▸</button>
      </div>
    </div>
  );
}

export { };
