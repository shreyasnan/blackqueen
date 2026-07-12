// The table — composition pass (UI_SPEC v1.1 §4): a real table you sit at.
// Structure: HUD (status) → table zone (opponents arc + trick felt) → YOUR seat + hand → drawer.
// Renders ONLY from ClientView; all drama is event-driven (theater hook).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimate } from "motion/react";
import { useStore, ExtendedView, GameEvent } from "./store";
import { sendAction } from "./net";
import { legalPlays } from "@engine/tricks"; // the ONE permitted engine function (UI_SPEC §14)
import type { Card, Suit } from "@engine/cards";
import { btn, btnSec, inp } from "./App";
import { sfx, haptic, isMuted, toggleMute } from "./audio";
import { Face } from "./faces";

const GLYPH: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠" };
const SUIT_WORD: Record<string, string> = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" }; // U5: aria labels
const SUITS: Suit[] = ["C", "D", "H", "S"];
const AVATARS = ["🦊", "🦉", "🐱", "🦡", "🐰", "🦝", "🐸"];
const SEAT_COLORS = ["#e0684b", "#2e8f83", "#c9992e", "#7b5ea7", "#4a7fb5", "#b5527f", "#6b8e3f"];
const EMOTES: Record<string, string> = { hello: "👋", wellplayed: "👏", uhoh: "😬", trusted: "🎭 I trusted you!!", laugh: "😂", gg: "🫡" };
const red = (s: string) => s === "D" || s === "H";
const ck = (c: Card) => `${c.rank}${GLYPH[c.suit]}`;
const isQS = (c: Card) => c.rank === "Q" && c.suit === "S";
const pv = (c: Card) => (isQS(c) ? 30 : c.rank === "A" ? 15 : c.rank === "10" ? 10 : c.rank === "5" ? 5 : 0);
const REDUCED = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- ONE motion language (UI_SPEC §14: one spring config = one app-wide feel) ---- */
const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 };
const SPRING_SOFT = { type: "spring" as const, stiffness: 260, damping: 22 };

/* ---- tempo system (UI_SPEC §6): the round accelerates as it matures ---- */
function tempo(v: ExtendedView): number {
  const done = v.completedTricks.length;
  const total = Math.max(1, v.ownHand.length + done); // tricks in this round = cards left + tricks played
  return 1 - 0.35 * (done / total); // trick 1 → 1.0×, last trick → ~0.65× durations
}

/* DOM registry for flight animations */
const seatEls = new Map<number, HTMLElement>();
let trickEl: HTMLElement | null = null;
const centerOf = (el: HTMLElement | null) => {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

type Overlay =
  | { type: "reveal"; seat: number; card: Card; tier: "normal" | "final" | "solo" | "queen" }
  | { type: "contract"; trump: Suit; cards: Card[] }
  | { type: "crown"; seat: number; Y: number }
  | { type: "slam"; seat: number }
  | { type: "round"; success: boolean; pts: number; delta: number[]; solo?: boolean }
  | null;

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

export function Table() {
  const view = useStore((s) => s.view);
  const toasts = useStore((s) => s.toasts);
  const connection = useStore((s) => s.connection);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [bubbles, setBubbles] = useState<{ id: number; seat: number; text: string }[]>([]);
  const [burst, setBurst] = useState(0);
  const wide = useWide();
  useTheater(view, setOverlay, setBubbles, () => setBurst((b) => b + 1));
  const [, force] = useState(0);
  // Playtest #2 fix: the round verdict is DERIVED FROM STATE, not only from the live event —
  // reconnect/refresh/late-join during ROUND_END still shows the "BID MADE/FAILED" screen.
  const dismissedRound = useRef(0);
  useEffect(() => {
    const v2 = view;
    if (!v2) return;
    const delta = v2.lastRoundDelta;
    if (v2.phase === "ROUND_END" && delta && dismissedRound.current !== v2.roundNumber) {
      setOverlay((o) => o ?? ({
        type: "round",
        success: v2.lastRoundSuccess ?? false,
        pts: v2.revealedTeamMembers.reduce((s, seat) => s + (v2.perPlayerCapturedPoints[seat] ?? 0), 0),
        delta,
        solo: !(v2.lastRoundSuccess ?? false) && delta.filter((x) => x < 0).length === 1,
      } as Overlay));
    }
    if (v2.phase !== "ROUND_END" && dismissedRound.current !== v2.roundNumber) dismissedRound.current = 0;
  }, [view]);
  if (!view) return <Center>Connecting…</Center>;
  const isHost = view.hostSeat === view.viewerSeat;

  if (view.phase === "GAME_END") {
    return (
      <Shell wide={false}>
        <GameEnd view={view} />
        <Toasts toasts={toasts} />
      </Shell>
    );
  }

  return (
    <Shell wide={wide}>
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <HUD view={view} onMute={() => force((x) => x + 1)} />
          <PartnerStatus view={view} />
          {/* ---- THE TABLE: top-down oval, seats around the rim, cards land in front of their player ---- */}
          <PokerTable view={view} bubbles={bubbles} />
          {/* ---- your controls + hand below the rail ---- */}
          <MyArea view={view} isHost={isHost} hideNext={overlay?.type === "round"} />
          {!wide && <BottomDrawer view={view} />}
        </div>
        {wide && <ActivitySidebar view={view} isHost={isHost} />}
      </div>
      <LastTrickModal view={view} />
      <DeclarerSetupModal view={view} />
      <SetPiece overlay={overlay} view={view} onDismiss={() => { dismissedRound.current = view.roundNumber; setOverlay(null); }} />
      <Confetti burst={burst} />
      <FlightLayer />
      {connection === "reconnecting" && <Banner>Reconnecting…</Banner>}
      <Toasts toasts={toasts} />
    </Shell>
  );
}

/** The declarer's moment, all in one place: "You win the bid" → choose trump → pick partner card(s).
 *  Replaces the crown-overlay-then-tiny-controls flow and the typed card input. */
/** Fully-dead identities (§3, v2.1): mirrors the engine trim — lowest ranks first, per-copy passes
 *  (♣→♦→♥→♠), point cards skipped. An identity is dead only if EVERY copy was trimmed. */
const RANKS_ASC = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS_CDHS = ["C", "D", "H", "S"];
const isPointCard = (rank: string, suit: string) => rank === "A" || rank === "10" || rank === "5" || (rank === "Q" && suit === "S");
const deadIdentities = (playerCount: number, deckCount: number, handSize?: number | null): string[] => {
  const h = handSize ?? Math.floor((52 * deckCount) / playerCount);
  let toRemove = 52 * deckCount - playerCount * h;
  const removed = new Map<string, number>();
  outer: for (const rank of RANKS_ASC) for (let copy = 0; copy < deckCount; copy++) for (const suit of SUITS_CDHS) {
    if (toRemove <= 0) break outer;
    if (isPointCard(rank, suit)) continue;
    removed.set(rank + suit, (removed.get(rank + suit) ?? 0) + 1);
    toRemove--;
  }
  return [...removed.entries()].filter(([, n]) => n >= deckCount).map(([k]) => k);
};
const RANKS_DESC: Card["rank"][] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

/** U6: partner-card picks survive a PAUSE/resume (and a remount) within the same round. */
const pickCache = new Map<number, Card[]>();

function DeclarerSetupModal({ view: v }: { view: ExtendedView }) {
  const stagedLocal = useStore((s) => s.stagedTrump);
  const stageTrump = useStore((s) => s.stageTrump);
  const stagedTrump = stagedLocal ?? v.stagedTrumpOwn ?? null;
  const [picked, setPickedRaw] = useState<Card[]>(() => pickCache.get(v.roundNumber) ?? []);
  const setPicked = (fn: (ps: Card[]) => Card[]) =>
    setPickedRaw((ps) => { const next = fn(ps); pickCache.set(v.roundNumber, next); return next; });
  const open = v.phase === "DECLARER_SETUP" && v.declarerSeat === v.viewerSeat;
  useEffect(() => { if (open) setPickedRaw(pickCache.get(v.roundNumber) ?? []); }, [open, v.roundNumber]);
  if (!open) return null;

  const C = v.calledCount ?? (v.playerCount <= 5 ? 1 : 2);
  const trimmed = new Set(deadIdentities(v.playerCount, v.deckCount ?? 1, (v as any).handSize));
  const inHand = (c: Card) => v.ownHand.some((h) => h.rank === c.rank && h.suit === c.suit);
  const isPicked = (c: Card) => picked.some((p) => p.rank === c.rank && p.suit === c.suit);
  const toggle = (c: Card) => {
    sfx.lift();
    setPicked((ps) => isPicked(c) ? ps.filter((p) => !(p.rank === c.rank && p.suit === c.suit))
      : ps.length >= C ? [...ps.slice(1), c] : [...ps, c]); // picking beyond C swaps the oldest
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ position: "absolute", inset: 0, zIndex: 52, display: "grid", placeItems: "center", background: "rgba(59,34,71,.55)" }}>
      <motion.div initial={{ scale: 0.85, y: 16 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
        style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 16, padding: "16px 20px", textAlign: "center", boxShadow: "0 14px 44px rgba(0,0,0,.45)", width: "min(430px, 94vw)" }}>

        {/* the moment */}
        <div style={{ fontSize: 20 }}>♛ <b>You win the bid</b></div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "var(--gold)", lineHeight: 1.1 }}>{v.Y}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>your team must capture {v.Y} of {v.totalPoints ?? 150} points</div>

        {/* step 1: trump — v2.2: switchable until you call (mis-click insurance, §9.1 amendment) */}
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "var(--ink-soft)", margin: "6px 0 4px" }}>
          {stagedTrump ? "TRUMP" : "CHOOSE THE TRUMP"}
        </div>
        <Row>
          {SUITS.map((s) => {
            const chosen = stagedTrump === s;
            return (
              <motion.button key={s} whileTap={{ scale: 0.88 }}
                onClick={() => { if (!chosen) { stageTrump(s); sendAction("CHOOSE_TRUMP", { suit: s }); sfx.lift(); } }}
                style={{
                  ...btnSec, fontSize: 24, padding: "8px 15px", borderRadius: 10,
                  color: red(s) ? "#ff9b8a" : "var(--parchment)",
                  background: chosen ? "var(--gold)" : "var(--ink)",
                  opacity: stagedTrump && !chosen ? 0.55 : 1, cursor: "pointer",
                }}>
                {GLYPH[s]}
              </motion.button>
            );
          })}
        </Row>
        {stagedTrump && (
          <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 3 }}>
            changed your mind? tap another suit — trump locks when you call
          </div>
        )}
        <SetupCountdown view={v} />

        {/* step 2: partner card(s) — tap to select from the full deck grid */}
        <div style={{ opacity: stagedTrump ? 1 : 0.35, pointerEvents: stagedTrump ? "auto" : "none", transition: "opacity .25s" }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "var(--ink-soft)", margin: "12px 0 4px" }}>
            SELECT {C} CARD{C > 1 ? "S" : ""} TO BE YOUR PARTNER{C > 1 ? "S" : ""}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 6 }}>
            {(v.deckCount ?? 1) === 2
              ? <>two copies of every card exist — <b>whoever plays the first copy joins your team</b> (maybe even you)</>
              : <>whoever holds {C > 1 ? "them" : "it"} secretly joins your team — call a card you hold to go solo</>}
          </div>
          {SUITS.map((s) => {
            const SUIT_NAMES: Record<string, string> = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
            // diamonds render in a distinct orange so ♥/♦ can never be mistaken at small sizes (playtest #6)
            const suitColor = s === "H" ? "#c73a3a" : s === "D" ? "#d97b28" : "var(--ink)";
            return (
              <div key={s} style={{ display: "flex", gap: 3, justifyContent: "center", alignItems: "center", marginBottom: 4 }}>
                <span style={{ width: 74, textAlign: "right", paddingRight: 6, fontSize: 12, color: suitColor, fontWeight: 800 }}>
                  {SUIT_NAMES[s]} <span style={{ fontSize: 15 }}>{GLYPH[s]}</span>
                </span>
                {RANKS_DESC.map((r) => {
                  const c: Card = { suit: s, rank: r };
                  const dead = trimmed.has(`${r}${s}`);
                  const sel = isPicked(c);
                  return (
                    <button key={r} disabled={dead} onClick={() => toggle(c)}
                      style={{
                        width: 26, height: 26, borderRadius: 6, fontSize: 11.5, fontWeight: 800, cursor: dead ? "default" : "pointer",
                        border: sel ? "2px solid var(--ink)" : "1px solid rgba(59,34,71,.2)",
                        background: sel ? "var(--gold)" : dead ? "transparent" : "var(--card)",
                        color: sel ? "#fff" : dead ? "rgba(59,34,71,.15)" : suitColor,
                        padding: 0,
                      }}>
                      {r}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {/* the confirmation that ends all ambiguity: your selection as a REAL card, big */}
          <div style={{ minHeight: 96, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 6 }}>
            {picked.length === 0
              ? <span style={{ fontSize: 12, color: "var(--ink-soft)", fontStyle: "italic" }}>tap a card above — it'll show here full size</span>
              : picked.map((c, i) => (
                <motion.div key={ck(c)} initial={{ scale: 0.6, y: 8 }} animate={{ scale: 1, y: 0 }} transition={SPRING}>
                  <CardFace card={c} width={60} highlight />
                  {inHand(c) && <div style={{ fontSize: 10, fontWeight: 800, color: "var(--coral)", marginTop: 2 }}>IN YOUR HAND 🎭</div>}
                </motion.div>
              ))}
          </div>
          <div style={{ minHeight: 18, fontSize: 12, fontWeight: 700, color: "var(--coral)" }}>
            {picked.some(inHand) && <>calling your own card — that's a SOLO play</>}
          </div>
          <button disabled={picked.length !== C} onClick={() => { sendAction("CALL_CARDS", { cards: picked }); pickCache.delete(v.roundNumber); sfx.thock(); }}
            style={{ ...btn, padding: "11px 26px", fontSize: 15, opacity: picked.length === C ? 1 : 0.4, marginTop: 2 }}>
            {picked.length === C ? `Call ${picked.map(ck).join(" + ")} ▸` : `pick ${C - picked.length} more`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** G3: honest countdown inside the setup modal — the table pauses when it hits zero. */
function SetupCountdown({ view: v }: { view: ExtendedView }) {
  const budget = (v as any).setupBudgetMs ?? ((v.turnBudgetMs ?? 45000) + 45000);
  const [left, setLeft] = useState(budget);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, budget - (Date.now() - started))), 1000);
    return () => clearInterval(t);
  }, [budget]);
  const s = Math.ceil(left / 1000);
  if (s > 20) return null; // silence until it matters
  return (
    <motion.div animate={{ scale: s <= 8 ? [1, 1.06, 1] : 1 }} transition={s <= 8 ? { repeat: Infinity, duration: 0.9 } : undefined}
      style={{ marginTop: 6, fontSize: 12.5, fontWeight: 800, color: s <= 8 ? "var(--coral)" : "var(--ink-soft)" }}>
      ⏳ choose in {s}s or the table pauses
    </motion.div>
  );
}

/** Last-trick review — first-class, for everyone, any time after trick one (button / felt tap / T). */
function LastTrickModal({ view: v }: { view: ExtendedView }) {
  const open = useStore((s) => s.lastTrickOpen);
  const setOpen = useStore((s) => s.setLastTrickOpen);
  const last = v.completedTricks.at(-1);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "t" && !(e.target instanceof HTMLInputElement)) setOpen(!useStore.getState().lastTrickOpen);
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setOpen]);
  if (!open || !last) return null;
  const pts = last.plays.reduce((a, p) => a + pv(p.card), 0);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setOpen(false)}
      style={{ position: "absolute", inset: 0, zIndex: 55, display: "grid", placeItems: "center", background: "rgba(59,34,71,.55)", cursor: "pointer" }}>
      <motion.div initial={{ scale: 0.8, y: 14 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
        style={{ background: "var(--parchment)", border: "2.5px solid var(--gold)", borderRadius: 14, padding: "16px 22px", textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,.4)", maxWidth: 460 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)" }}>
          LAST HAND · #{v.completedTricks.length}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", margin: "12px 0", flexWrap: "wrap" }}>
          {last.plays.map((p, i) => {
            const winner = p.seat === last.winnerSeat;
            return (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ borderRadius: 9, boxShadow: `0 0 0 2.5px ${SEAT_COLORS[p.seat % 7]}`, transform: winner ? "scale(1.1)" : "none" }}>
                  <CardFace card={p.card} small highlight={winner} />
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: 700, color: winner ? "var(--gold)" : SEAT_COLORS[p.seat % 7] }}>
                  <Face id={faceOf(v, p.seat)} size={15} /> {p.seat === v.viewerSeat ? "you" : firstName(v, p.seat)}{winner ? " ✓" : ""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13.5 }}>
          <b>{last.winnerSeat === v.viewerSeat ? "You" : firstName(v, last.winnerSeat)}</b> took it{pts > 0 ? <> — <b style={{ color: "var(--gold)" }}>+{pts} points</b></> : " (no points)"}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 6 }}>tap anywhere to close · T toggles</div>
      </motion.div>
    </motion.div>
  );
}

const Shell = ({ children, wide }: { children: React.ReactNode; wide: boolean }) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: wide ? 1400 : 1100, margin: "0 auto", padding: "6px 10px 4px", position: "relative", overflow: "hidden" }}>
    {children}
  </div>
);

/* ------------------------------ HUD: what matters, where you look ------------------------------ */
function HUD({ view: v, onMute }: { view: ExtendedView; onMute: () => void }) {
  const wide = useWide();
  const stagedLocal = useStore((s) => s.stagedTrump);
  const stagedTrump = stagedLocal ?? v.stagedTrumpOwn ?? null;
  const stagedConfirmed = useStore((s) => s.stagedConfirmed);
  const me = v.viewerSeat;
  const isDeclarer = v.declarerSeat === me;

  const turnText =
    v.phase === "BIDDING" ? (v.turnSeat === me ? "Your bid" : `${nameOf(v, v.turnSeat!)} is bidding…`)
    : v.phase === "DECLARER_SETUP" ? (isDeclarer ? "Set up your bid" : `${nameOf(v, v.declarerSeat!)} is scheming…`)
    : v.phase === "TRICK_PLAY" ? (v.turnSeat === me ? "Your turn" : `${nameOf(v, v.turnSeat!)}…`)
    : v.phase === "PAUSED" ? "Paused"
    : v.phase === "ROUND_END" ? "Round complete"
    : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "4px 2px", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 700, letterSpacing: 0.4 }}>
        ROUND {v.roundNumber}<span style={{ opacity: 0.5 }}>/{v.N}</span>
      </div>
      <motion.div key={turnText} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
        style={{ fontWeight: 800, fontSize: 15, color: v.turnSeat === me || (v.phase === "DECLARER_SETUP" && isDeclarer) ? "var(--gold)" : "var(--ink)" }}>
        {turnText}
      </motion.div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        {v.Y !== null && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, background: "var(--card)", border: "1.5px solid var(--gold)",
            borderRadius: 9, padding: "3px 10px", boxShadow: "0 1px 3px var(--shadow)",
          }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{v.Y}</span>
            <span style={{ fontSize: 17, lineHeight: 1, color: v.trump && red(v.trump) ? "var(--coral)" : "var(--ink)" }}>
              {v.trump ? GLYPH[v.trump]
                : isDeclarer && stagedTrump ? <span title="staged — hidden from others" style={{ opacity: 0.55 }}>{GLYPH[stagedTrump]}{stagedConfirmed ? "" : "…"}</span>
                : "❓"}
            </span>
            {v.calledCards.map((c, i) => (
              <span key={i} style={{ fontWeight: 800, fontSize: 13, color: red(c.suit) ? "var(--coral)" : "var(--ink)", borderLeft: "1px solid var(--shadow)", paddingLeft: 6 }}>
                {ck(c)}
              </span>
            ))}
          </div>
        )}
        {v.completedTricks.length > 0 && ( // mobile review #4: icon-only on phones, same footprint as mute
          <button aria-label="review last hand" title="Last hand (T)"
            style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8, whiteSpace: "nowrap" }}
            onClick={() => useStore.getState().setLastTrickOpen(true)}>
            {wide ? "🕐 last hand" : "🕐"}
          </button>
        )}
        <button aria-label="mute" style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8, flexShrink: 0 }} onClick={() => { toggleMute(); onMute(); }}>
          {isMuted() ? "🔇" : "🔊"}
        </button>
      </div>
    </div>
  );
}

const nameOf = (v: ExtendedView, s: number) => v.seatNames?.[s] ?? `Seat ${s}`;
const firstName = (v: ExtendedView, s: number) => nameOf(v, s).split(" ")[0]!;
/** Player-chosen face (server-validated); seat-index animal only as legacy fallback. */
const faceOf = (v: ExtendedView, s: number): string => v.seatAvatars?.[s] ?? AVATARS[s % AVATARS.length]!;

/* ------------------------------ seats ------------------------------ */
function TimerRing({ active, budgetMs, size, self }: { active: boolean; budgetMs: number; size: number; self?: boolean }) {
  const stateVersion = useStore((s) => s.stateVersion);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const ticked = useRef<number>(99);
  useEffect(() => { // countdown digits for the final stretch — the ring alone is easy to miss
    if (!active) { setSecondsLeft(null); ticked.current = 99; return; }
    const started = Date.now();
    const t = setInterval(() => {
      const left = Math.ceil((budgetMs - (Date.now() - started)) / 1000);
      setSecondsLeft(left <= 15 ? Math.max(0, left) : null);
      // G2: audible last-3-seconds ticks for YOUR OWN turn only (one per second)
      if (self && left <= 3 && left >= 1 && left < ticked.current) { ticked.current = left; sfx.lift(); haptic(20); }
    }, 250);
    return () => clearInterval(t);
  }, [active, budgetMs, stateVersion, self]);
  if (!active) return null;
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const urgent = secondsLeft !== null && secondsLeft <= 5;
  return (
    <>
      {!REDUCED && (
        <svg key={stateVersion} width={size} height={size} style={{ position: "absolute", top: -4, left: "50%", marginLeft: -size / 2, transform: "rotate(-90deg)", pointerEvents: "none" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(59,34,71,.14)" strokeWidth={4} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
            initial={{ strokeDashoffset: 0, stroke: "#c9992e" }}
            animate={{ strokeDashoffset: -c, stroke: ["#c9992e", "#d9a418", "#e0684b"] }}
            transition={{ duration: budgetMs / 1000, ease: "linear", times: [0, 0.72, 1] }}
            strokeDasharray={c} />
        </svg>
      )}
      {secondsLeft !== null && (
        <motion.span
          animate={urgent && !REDUCED ? { scale: [1, 1.25, 1] } : { scale: 1 }}
          transition={urgent ? { repeat: Infinity, duration: 0.8 } : undefined}
          style={{
            position: "absolute", top: -10, right: -16, background: urgent ? "#c62f12" : "var(--coral)", color: "#fff",
            fontSize: urgent ? 12.5 : 11, fontWeight: 900, borderRadius: 9, minWidth: 18, padding: "1px 3px", textAlign: "center",
            boxShadow: urgent ? "0 0 10px rgba(224,104,75,.8)" : "0 2px 5px rgba(0,0,0,.3)",
          }}>
          {secondsLeft}
        </motion.span>
      )}
    </>
  );
}

function SeatChip({ view: v, seat, big, bubbles }: { view: ExtendedView; seat: number; big?: boolean; bubbles: { id: number; seat: number; text: string }[] }) {
  const me = v.viewerSeat;
  const isTurn = v.turnSeat === seat && (v.phase === "TRICK_PLAY" || v.phase === "BIDDING");
  const isSetup = v.phase === "DECLARER_SETUP" && v.declarerSeat === seat;
  const active = isTurn || isSetup;
  const anyoneActive = v.phase === "TRICK_PLAY" || v.phase === "BIDDING" || v.phase === "DECLARER_SETUP";
  const team = v.revealedTeamMembers.includes(seat);
  const iAmTeam = v.revealedTeamMembers.includes(me);
  // THE TEAM MOMENT (playtest #4): once every partner is revealed, plates settle into team colors —
  // warm gold for the declarer's side, cool teal for defenders — cascading seat by seat.
  const teamsKnown = v.allPartnersRevealed;
  // v2.2 (2+ partners): a seat turns GOLD the moment IT is revealed — the first partner's flip
  // doesn't wait for the second. Defenders only settle to teal once every partner is known
  // (until then, an uncolored seat might still be the hidden partner).
  const side: "team" | "def" | null = team ? "team" : teamsKnown ? "def" : null;
  // one-shot flash when THIS seat joins the declarer side mid-round
  const wasTeam = useRef(team);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = wasTeam.current;
    wasTeam.current = team;
    if (team && !was) { setFlash(true); const t = setTimeout(() => setFlash(false), 1600); return () => clearTimeout(t); }
  }, [team]);
  const relation =
    seat === me ? (team && seat !== v.declarerSeat ? "partner (you)" : seat === v.declarerSeat ? "declarer (you)" : side === "def" ? "defender (you)" : null) :
    team && seat !== v.declarerSeat ? (iAmTeam ? "your partner" : "partner") :
    seat === v.declarerSeat ? (iAmTeam && me !== v.declarerSeat ? "your declarer" : "declarer") :
    side === "def" ? "defender" : null;
  const away = v.seatConnected?.[seat] === false;
  const avSize = big ? 34 : 27; // compact plates: cards are the stars, squares stay supporting cast

  return (
    <motion.div ref={(el) => { if (el) seatEls.set(seat, el); }}
      animate={{
        scale: active ? 1.1 : 1, y: active ? -3 : 0,
        opacity: anyoneActive && !active ? 0.87 : 1, // non-actors recede gently — dimmed, never "disabled"
        background: active ? "linear-gradient(170deg, #fffdf7, #fbf0d4)"
          : side === "team" ? "linear-gradient(170deg, #fdf6e3, #f6e5b8)"
          : side === "def" ? "linear-gradient(170deg, #eef6f4, #d8eae5)"
          : "linear-gradient(170deg, #fffdf7, #fffdf7)",
        borderColor: active ? "#c9992e" : side === "team" ? "#c9992e" : side === "def" ? "#2e8f83" : team ? SEAT_COLORS[seat % 7]! : "rgba(59,34,71,.14)",
        boxShadow: active
          ? ["0 0 14px rgba(201,153,46,.5), 0 2px 6px rgba(59,34,71,.25)", "0 0 30px rgba(201,153,46,.95), 0 2px 6px rgba(59,34,71,.25)", "0 0 14px rgba(201,153,46,.5), 0 2px 6px rgba(59,34,71,.25)"]
          : side === "team" // declarer's side stays visibly lit even off-turn — you always know who's with whom
            ? "0 0 12px rgba(201,153,46,.55), 0 2px 5px rgba(59,34,71,.25)"
            : "0 2px 5px rgba(59,34,71,.25)",
      }}
      transition={{
        ...SPRING,
        boxShadow: active ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : undefined,
        // the cascade: each seat flips to its team color a beat after the last (a moment, not a repaint)
        // team seats flip IMMEDIATELY on their own reveal; the defender cascade still waits for teamsKnown
        background: side === "team" ? { duration: 0.35 } : teamsKnown ? { delay: 0.35 + seat * 0.16, duration: 0.6 } : { duration: 0.3 },
        borderColor: side === "team" ? { duration: 0.35 } : teamsKnown ? { delay: 0.35 + seat * 0.16, duration: 0.6 } : { duration: 0.3 },
      }}
      style={{
        position: "relative", textAlign: "center", minWidth: big ? 112 : 84,
        borderRadius: 12, padding: big ? "6px 10px 5px" : "4px 7px 4px",
        borderWidth: 2.5, borderStyle: "solid",
      }}>
      {/* the unmissable JOIN flash: expanding gold rings + badge the moment this seat is revealed */}
      <AnimatePresence>
        {flash && !REDUCED && (
          <>
            {[0, 0.25, 0.5].map((d) => (
              <motion.div key={d} initial={{ opacity: 0.9, scale: 1 }} animate={{ opacity: 0, scale: 2.1 }} exit={{ opacity: 0 }}
                transition={{ duration: 1.1, delay: d, ease: "easeOut" }}
                style={{ position: "absolute", inset: -4, borderRadius: 14, border: "3px solid var(--gold)", pointerEvents: "none", zIndex: 11 }} />
            ))}
            <motion.div initial={{ scale: 0, rotate: -12 }} animate={{ scale: [0, 1.3, 1] }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }}
              style={{
                position: "absolute", top: -34, left: "50%", transform: "translateX(-50%)", zIndex: 12, whiteSpace: "nowrap",
                background: "var(--gold)", color: "#fff", fontSize: 11.5, fontWeight: 900, letterSpacing: 0.8,
                borderRadius: 9, padding: "3px 10px", boxShadow: "0 0 18px rgba(201,153,46,.9), 0 3px 8px rgba(0,0,0,.35)",
              }}>
              ⭐ JOINS THE TEAM
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* the unmissable pointer: bobbing marker above whoever must act */}
      <AnimatePresence>
        {active && !REDUCED && (
          <motion.div initial={{ opacity: 0, y: -6 }} exit={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, -7, 0] }}
            transition={{ y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" } }}
            style={{
              position: "absolute", top: -30, left: "50%", marginLeft: -11, zIndex: 9,
              width: 0, height: 0, borderLeft: "11px solid transparent", borderRight: "11px solid transparent",
              borderTop: "14px solid var(--gold)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))",
            }} />
        )}
      </AnimatePresence>
      {active && seat === me && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
          style={{
            position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", zIndex: 10, whiteSpace: "nowrap",
            background: "var(--coral)", color: "#fff", fontSize: 10.5, fontWeight: 900, letterSpacing: 1,
            borderRadius: 8, padding: "2px 8px", boxShadow: "0 2px 6px rgba(0,0,0,.3)",
          }}>
          YOUR TURN
        </motion.div>
      )}
      <AnimatePresence>
        {bubbles.filter((b) => b.seat === seat).map((b) => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 6, scale: 0.6 }} animate={{ opacity: 1, y: -8, scale: 1 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", background: "var(--card)", border: "1.5px solid var(--gold)", borderRadius: 12, padding: "2px 9px", whiteSpace: "nowrap", fontSize: 14, zIndex: 8, boxShadow: "0 3px 8px var(--shadow)" }}>
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>
      <div style={{ position: "relative", display: "inline-block" }}>
        <Face id={faceOf(v, seat)} size={avSize + 8} tint={SEAT_COLORS[seat % 7]} />
        <TimerRing active={active} self={active && seat === me}
          budgetMs={away ? (v.awayBudgetMs ?? 12000)
            : v.phase === "DECLARER_SETUP" ? ((v as any).setupBudgetMs ?? (v.turnBudgetMs ?? 45000) + 45000)
            : (v.turnBudgetMs ?? 45000)} size={avSize + 18} />
        {seat === v.declarerSeat && ( // the "declarer button" — poker's dealer-chip language
          <motion.span initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING}
            style={{
              position: "absolute", right: -14, bottom: -2, width: 18, height: 18, borderRadius: 9,
              background: "var(--coral)", color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: "18px",
              boxShadow: "0 2px 5px rgba(0,0,0,.35), inset 0 -1.5px 0 rgba(0,0,0,.25)", textAlign: "center",
            }}>
            D
          </motion.span>
        )}
      </div>
      <div style={{ fontWeight: 800, fontSize: big ? 13.5 : 12, color: SEAT_COLORS[seat % 7], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: big ? 130 : 98 }}>
        {seat === me ? "You" : firstName(v, seat)}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
        {away ? <b style={{ color: "var(--coral)" }}>💤 away</b> : <>{v.handCounts[seat]} card{v.handCounts[seat] === 1 ? "" : "s"}</>} · <b style={{ color: (v.perPlayerCapturedPoints[seat] ?? 0) > 0 ? "var(--ink)" : "var(--ink-soft)" }}>{v.perPlayerCapturedPoints[seat]} pts</b>
      </div>
      {relation && (
        <div style={{ fontSize: 10.5, fontWeight: 800, color: side === "def" ? "#2e8f83" : "var(--coral)", letterSpacing: 0.3, textTransform: "uppercase" }}>
          {relation}
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------ the oval table ------------------------------ */
/** Seat placement: viewer at 6 o'clock; play proceeds clockwise around the rim.
 *  θ(rel) = 90° + rel·(360/n)° on an ellipse — bottom → left → top → right, matching turn order. */
function seatAngle(rel: number, n: number): number {
  return ((90 + (rel * 360) / n) * Math.PI) / 180;
}
function seatPct(rel: number, n: number, rx: number, ry: number): { left: string; top: string } {
  const a = seatAngle(rel, n);
  return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
}

function PokerTable({ view: v, bubbles }: { view: ExtendedView; bubbles: { id: number; seat: number; text: string }[] }) {
  const me = v.viewerSeat;
  const n = v.handCounts.length;
  const rel = (seat: number) => (seat - me + n) % n;
  return (
    <div style={{ flex: 1, minHeight: 300, position: "relative", margin: "2px 0" }}>
      {/* rail */}
      <div style={{
        position: "absolute", inset: "6% 2%", borderRadius: "50% / 42%",
        background: "linear-gradient(160deg, #8a6a2f, #c9992e 45%, #7a5d28)",
        boxShadow: "0 10px 30px rgba(59,34,71,.35), inset 0 -3px 8px rgba(0,0,0,.25)",
      }} />
      {/* felt with vignette */}
      <div style={{
        position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%",
        background: "radial-gradient(ellipse at 50% 38%, #3a8a75 0%, #2e6f5e 55%, #235345 100%)",
        boxShadow: "inset 0 6px 26px rgba(0,0,0,.38), inset 0 -10px 40px rgba(0,0,0,.22)",
      }} />
      {/* betting line: the classic inner ring that frames where cards land */}
      <div style={{
        position: "absolute", inset: "22% 18%", borderRadius: "50% / 44%",
        border: "1.5px solid rgba(255,253,247,.14)", pointerEvents: "none",
      }} />
      {/* subtle center mark */}
      <WatermarkQueen />

      <TrickOnFelt view={v} />

      {/* felt center status: the table itself tells you where the action stands
          (the contract cluster moved OFF the felt after playtest — it fought the trick for space;
          trump + called cards live in the HUD plaque and the partner banner) */}
      <FeltStatus view={v} />

      {/* seat plates around the rim (viewer at bottom, pulled slightly inward so controls below stay clear) */}
      {Array.from({ length: n }, (_, seat) => seat).map((seat) => {
        const pos = seatPct(rel(seat), n, 44, seat === me ? 40 : 46);
        return (
          <div key={seat} style={{ position: "absolute", ...pos, transform: "translate(-50%,-50%)", zIndex: 4 }}>
            <SeatChip view={v} seat={seat} big={seat === me} bubbles={bubbles} />
          </div>
        );
      })}
    </div>
  );
}

// (ContractOnFelt retired after playtest — the cluster fought the trick ring for space.)

/** Center watermark — near-invisible texture on desktop; on small phones the emoji rendered as a
 *  pale floating square behind trick cards (mobile review #6), so fade it almost out there. */
function WatermarkQueen() {
  const wide = useWide();
  return (
    <div style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%,-50%)", fontSize: wide ? 42 : 30, opacity: wide ? 0.09 : 0.035, pointerEvents: "none", filter: "grayscale(60%)" }}>👸🏽</div>
  );
}

function FeltStatus({ view: v }: { view: ExtendedView }) {
  let line: string | null = null;
  if (v.phase === "BIDDING" && v.currentHighBid !== null && v.currentHighBidderSeat !== null) {
    line = `high bid ${v.currentHighBid} · ${v.currentHighBidderSeat === v.viewerSeat ? "you" : firstName(v, v.currentHighBidderSeat)}`;
  } else if (v.phase === "DECLARER_SETUP" && v.declarerSeat !== null && v.declarerSeat !== v.viewerSeat) {
    line = `${firstName(v, v.declarerSeat)} is setting up their bid…`;
  } else if (v.phase === "PAUSED") {
    line = "⏸ paused";
  } else if (v.phase === "ROUND_END" && v.roundNumber < v.N && v.hostSeat !== null && v.hostSeat !== undefined) {
    line = v.hostSeat === v.viewerSeat
      ? `round ${v.roundNumber} complete`
      : `waiting for ${firstName(v, v.hostSeat)} to start round ${v.roundNumber + 1}…`;
  }
  if (!line) return null;
  return (
    <div style={{
      position: "absolute", left: "50%", top: "38%", transform: "translate(-50%,-50%)", zIndex: 2,
      color: "rgba(255,253,247,.85)", fontSize: 17, fontWeight: 700, letterSpacing: 0.3,
      textShadow: "0 2px 6px rgba(0,0,0,.45)", pointerEvents: "none", whiteSpace: "nowrap",
    }}>
      {line}
    </div>
  );
}

/* trick cards land IN FRONT of their player — position is attribution */
function TrickOnFelt({ view: v }: { view: ExtendedView }) {
  const setLastTrickOpen = useStore((s) => s.setLastTrickOpen);
  const [linger, setLinger] = useState<{ plays: typeof v.currentTrick; winnerSeat: number } | null>(null);
  const trickCount = v.completedTricks.length;
  const prevCount = useRef(trickCount);
  const last = v.completedTricks.at(-1);
  useEffect(() => {
    if (trickCount > prevCount.current) {
      prevCount.current = trickCount;
      const lt = last;
      if (!lt) return;
      setLinger({ plays: lt.plays, winnerSeat: lt.winnerSeat });
      const holdMs = Math.round(1100 * tempo(v)); // tempo: late tricks resolve snappier
      const t = setTimeout(() => {
        setLinger(null);
        if (!REDUCED) {
          const from = centerOf(trickEl);
          const to = centerOf(seatEls.get(lt.winnerSeat) ?? null);
          useStore.getState().addFlights(lt.plays.map((p, i) => ({
            x0: from.x + (i - lt.plays.length / 2) * 26, y0: from.y,
            x1: to.x, y1: to.y, card: p.card, delay: i * 60,
          })));
        }
      }, holdMs);
      return () => clearTimeout(t);
    }
    prevCount.current = trickCount;
  }, [trickCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = linger ? linger.plays : v.currentTrick;
  const me = v.viewerSeat;
  const n = v.handCounts.length;
  const rel = (seat: number) => (seat - me + n) % n;
  const wide = useWide();
  // mobile review #2: on portrait phones the landing ring sat under the seat plates and rail —
  // pull trick cards toward the center and flatten the tilt.
  const rx = wide ? 26 : 20;
  const ryOther = wide ? 24 : 17.5;
  const ryMine = wide ? 17 : 14;
  const tiltAmp = wide ? 10 : 6;
  return (
    <div ref={(el) => { trickEl = el; }}
      onClick={() => { if (last) setLastTrickOpen(true); }}
      style={{ position: "absolute", inset: 0, cursor: last ? "pointer" : "default", zIndex: 3 }}>
      {linger && (
        <motion.div initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING}
          style={{
            position: "absolute", top: "32%", left: "50%", transform: "translateX(-50%)", zIndex: 6, whiteSpace: "nowrap",
            background: "var(--gold)", color: "#fff", fontWeight: 800, borderRadius: 20, padding: "5px 16px", fontSize: 15,
            boxShadow: "0 4px 14px rgba(0,0,0,.35)",
          }}>
          <Face id={faceOf(v, linger.winnerSeat)} size={19} /> {linger.winnerSeat === me ? "You take" : `${firstName(v, linger.winnerSeat)} takes`} the hand
          {(() => { const pts = linger.plays.reduce((a, p) => a + pv(p.card), 0); return pts > 0 ? ` +${pts}` : ""; })()}
        </motion.div>
      )}
      {shown.length === 0 && (
        <span style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%,-50%)", color: "rgba(255,253,247,.75)", fontStyle: "italic", fontSize: 14, whiteSpace: "nowrap" }}>
          {v.phase === "TRICK_PLAY" ? (v.turnSeat === me ? "your lead — drag up or double-tap a card" : "") : last ? "tap to review the last hand" : ""}
        </span>
      )}
      <AnimatePresence>
        {shown.map((p) => {
          const winner = linger && p.seat === linger.winnerSeat;
          // the card lands in front of its player: position IS attribution (broadcast-style)
          // U4: the bottom seat's plate sits higher (hand fan below) — pull MY landed card
          // further up-table so it never covers my seat plate / captured-points count.
          const pos = seatPct(rel(p.seat), n, rx, rel(p.seat) === 0 ? ryMine : ryOther);
          const a = seatAngle(rel(p.seat), n);
          const tilt = (Math.cos(a) * -tiltAmp).toFixed(1); // slight face-the-center tilt
          const from = seatPct(rel(p.seat), n, 44, 46);
          return (
            <motion.div key={`${p.seat}-${p.card.rank}${p.card.suit}`}
              initial={{ left: from.left, top: from.top, opacity: 0, scale: 0.7, rotate: Number(tilt) }}
              animate={{ left: pos.left, top: pos.top, opacity: 1, scale: winner && linger ? 1.16 : 1, rotate: Number(tilt) }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={SPRING_SOFT}
              style={{ position: "absolute", transform: "translate(-50%,-50%)", marginLeft: -26, marginTop: -37 }}>
              <div style={{ borderRadius: 9, boxShadow: `0 0 0 2.5px ${SEAT_COLORS[p.seat % 7]}, 0 4px 10px rgba(0,0,0,.35)` }}>
                <CardFace card={p.card} small highlight={!!winner && !!linger} />
              </div>
              {winner && (
                <div style={{ textAlign: "center", fontSize: 11, marginTop: 2, color: "#ffd97a", fontWeight: 800, textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>✓</div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------ my area (controls + hand; my seat plate lives on the rim) ------------------------------ */
function MyArea({ view: v, isHost, hideNext }: { view: ExtendedView; isHost: boolean; hideNext?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <Controls view={v} isHost={isHost} hideNext={hideNext} />
      <Hand view={v} />
    </div>
  );
}

function Controls({ view: v, isHost, hideNext }: { view: ExtendedView; isHost: boolean; hideNext?: boolean }) {
  const me = v.viewerSeat;
  if (hideNext && v.phase === "ROUND_END") return null; // U7: the verdict modal already offers "Play round N"
  if (v.phase === "BIDDING" && v.turnSeat === me) return <BidBox view={v} />;
  // DECLARER_SETUP: handled by the unified DeclarerSetupModal (win-the-bid + trump + partner picker)
  if (v.phase === "PAUSED" && isHost) return (
    <Row>
      <button style={btn} onClick={() => sendAction("HOST_RESOLVE_PAUSE", { action: "resume" })}>Resume</button>
      <button style={btnSec} onClick={() => sendAction("HOST_RESOLVE_PAUSE", { action: "end" })}>End game</button>
    </Row>
  );
  if (v.phase === "ROUND_END" && v.roundNumber < v.N) {
    return isHost ? (
      <Row>
        <motion.button initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}
          style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => sendAction("HOST_NEXT_ROUND", {})}>
          Play round {v.roundNumber + 1} ▸
        </motion.button>
      </Row>
    ) : null; // non-hosts: the felt says who we're waiting on
  }
  return null;
}

function BidBox({ view: v }: { view: ExtendedView }) {
  const cap = v.totalPoints ?? 150;
  const min = (v.currentHighBid ?? cap / 2) + 5;
  const [val, setVal] = useState(min);
  useEffect(() => setVal(min), [min]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setVal((x) => Math.max(min, x - 5));
      if (e.key === "ArrowRight") setVal((x) => Math.min(cap, x + 5));
      if (e.key === "Enter") sendAction("BID", { value: val });
      if (e.key.toLowerCase() === "p") sendAction("PASS", {});
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [min, val, cap]);
  return (
    <Row>
      <button style={btnSec} onClick={() => setVal((x) => Math.max(min, x - 5))}>−5</button>
      <b style={{ fontSize: 24, minWidth: 52, textAlign: "center" }}>{val}</b>
      <button style={btnSec} onClick={() => setVal((x) => Math.min(cap, x + 5))}>+5</button>
      <button style={btn} onClick={() => sendAction("BID", { value: val })}>Bid {val}</button>
      <button style={{ ...btnSec, marginLeft: 20 }} onClick={() => sendAction("PASS", {})}>Pass</button>
    </Row>
  );
}

// (SetupBox and the typed card input were retired in favor of DeclarerSetupModal.)

/* ------------------------------ hand ------------------------------ */
function Hand({ view: v }: { view: ExtendedView }) {
  const me = v.viewerSeat;
  const myTurn = v.phase === "TRICK_PLAY" && v.turnSeat === me;
  const ledSuit = v.currentTrick.length === 0 ? null : v.currentTrick[0]!.card.suit;
  const legal = useMemo(
    () => (myTurn ? new Set(legalPlays(v.ownHand as Card[], ledSuit as Suit | null).map((c) => `${c.rank}${c.suit}`)) : new Set<string>()),
    [myTurn, v.ownHand, ledSuit],
  );
  const [focus, setFocus] = useState(0);
  const [sortBy, setSortBy] = useState<"suit" | "rank">("suit");
  const RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUIT_DISPLAY: Suit[] = ["S", "H", "C", "D"];
  const hand = useMemo(() => {
    const h = (v.ownHand as Card[]).slice();
    const r = (c: Card) => RANK_ORDER.indexOf(c.rank);
    const s = (c: Card) => SUIT_DISPLAY.indexOf(c.suit);
    h.sort((a, b) => (sortBy === "suit" ? s(a) - s(b) || r(b) - r(a) : r(b) - r(a) || s(a) - s(b)));
    return h;
  }, [v.ownHand, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = hand.length;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!myTurn) return;
      if (e.key === "ArrowLeft") setFocus((f) => Math.max(0, f - 1));
      if (e.key === "ArrowRight") setFocus((f) => Math.min(n - 1, f + 1));
      if (e.key === "Enter") {
        const c = hand[focus];
        if (c && legal.has(`${c.rank}${c.suit}`)) { sendAction("PLAY_CARD", { card: c }); sfx.thock(); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [myTurn, focus, hand, legal, n]);

  const wide = useWide();
  // Bigger cards, responsive: generous on desktop, still 13-cards-wide safe on a 380px phone.
  const cardW = wide ? 78 : Math.min(68, Math.max(56, Math.floor((typeof innerWidth !== "undefined" ? innerWidth : 400) / (n * 0.62 + 1))));
  const overlap = -Math.round(cardW * 0.37);
  // v2.2 mobile fix: with 12+ cards (2-deck hands) the centered fan clips its left edge off-screen.
  // When the fan is wider than the viewport, left-align it and let it scroll horizontally.
  const fanWidth = cardW + (n - 1) * (cardW + overlap);
  const vw = typeof innerWidth !== "undefined" ? innerWidth : 400;
  const overflows = !wide && fanWidth > vw - 16;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      {n > 0 && ( // own row, never over a card (playtest #1: it hid the first card on mobile)
        <div style={{ alignSelf: "flex-end", paddingRight: 6, display: "flex", gap: 6, alignItems: "center" }}>
          {overflows && <span style={{ fontSize: 10, color: "var(--ink-soft)" }}>⟷ swipe the fan</span>}
          <button onClick={() => { setSortBy((x) => (x === "suit" ? "rank" : "suit")); sfx.lift(); }}
            style={{ ...btnSec, padding: "2px 8px", fontSize: 10.5, opacity: 0.75 }}>
            sort: {sortBy}
          </button>
        </div>
      )}
    <div style={{
      position: "relative", display: "flex", justifyContent: overflows ? "flex-start" : "center", alignItems: "flex-end",
      padding: overflows ? "2px 8px 2px" : "2px 0 2px", minHeight: cardW * 1.42 + 20, width: "100%",
      overflowX: overflows ? "auto" : "visible", WebkitOverflowScrolling: "touch" as any,
    }}>
      {(() => { const seen = new Map<string, number>(); return hand.map((c, i) => {
        const mid = (n - 1) / 2;
        const rot = n > 1 ? (i - mid) * Math.min(2.6, 26 / n) : 0; // gentler rotation: hit boxes ≈ visuals
        const lift = Math.abs(i - mid) * Math.min(1.6, 14 / n);
        const base = `${c.rank}${c.suit}`;
        const copy = seen.get(base) ?? 0; // 2-deck: two identical cards need distinct React keys
        seen.set(base, copy + 1);
        return (
          <div key={`${base}-${copy}`} style={{ marginLeft: i === 0 ? 0 : overlap, transform: `rotate(${rot}deg) translateY(${lift}px)`, zIndex: i, flexShrink: 0 }}>
            <DraggableCard card={c} width={cardW} playable={myTurn && legal.has(`${c.rank}${c.suit}`)}
              dimmed={myTurn && !legal.has(`${c.rank}${c.suit}`)} focused={myTurn && i === focus} />
          </div>
        );
      }); })()}
    </div>
    </div>
  );
}

function DraggableCard({ card, playable, dimmed, focused, width }: { card: Card; playable: boolean; dimmed: boolean; focused: boolean; width?: number }) {
  const [scope, animate] = useAnimate();
  const [armed, setArmed] = useState(false);
  const pushToast = useStore((s) => s.pushToast);
  useEffect(() => { if (!playable) setArmed(false); }, [playable]);
  return (
    <motion.div ref={scope} drag={playable} dragSnapToOrigin dragElastic={playable ? 0.6 : 0.05}
      whileDrag={{ scale: 1.15, rotate: 4, zIndex: 60 }}
      onDragStart={() => playable && sfx.lift()}
      onDragEnd={(_, info) => {
        if (playable && info.offset.y < -90) { sendAction("PLAY_CARD", { card }); sfx.thock(); haptic(10); }
        else if (playable) sfx.ret();
        else if (info.offset.y < -40) { animate(scope.current, { x: [0, -7, 7, -4, 0] }, { duration: 0.35 }); sfx.illegal(); pushToast(`Must follow ${GLYPH[useStore.getState().view?.currentTrick[0]?.card.suit ?? "S"]}`); }
      }}
      onClick={() => {
        if (!playable) return;
        if (armed) { sendAction("PLAY_CARD", { card }); sfx.thock(); haptic(10); }
        else { setArmed(true); sfx.lift(); setTimeout(() => setArmed(false), 4000); } // U2: 4s to confirm (was 2.2)
      }}
      role="button" aria-label={`${playable ? "Play" : ""} ${card.rank} of ${SUIT_WORD[card.suit]}${dimmed ? " (not legal now)" : ""}`}
      aria-disabled={dimmed || undefined}
      animate={{ y: armed ? -24 : focused ? -14 : playable ? -8 : 0, scale: armed ? 1.08 : 1, zIndex: armed ? 55 : undefined }}
      style={{
        position: "relative", cursor: playable ? "grab" : "default", touchAction: "none",
        // it's your turn: playable cards RISE and glow; unplayable ones recede but STAY READABLE —
        // (mobile review #1: 0.55 + grayscale made red ranks vanish on the cream table)
        opacity: dimmed ? 0.78 : 1,
        filter: dimmed ? "saturate(0.75) brightness(0.96)" : playable ? "drop-shadow(0 4px 10px rgba(201,153,46,.45))" : "none",
      }}>
      {armed && ( // unmistakable confirmation of WHICH card is armed (misplay protection)
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", background: "var(--gold)", color: "#fff", borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", zIndex: 56, boxShadow: "0 3px 8px rgba(0,0,0,.35)" }}>
          tap again to play {ck(card)} ▲
        </motion.div>
      )}
      {armed && ( // U2: the card rose 24px away from the finger — keep the ORIGINAL touch spot hot
        <div onClick={(e) => { e.stopPropagation(); sendAction("PLAY_CARD", { card }); sfx.thock(); haptic(10); }}
          style={{ position: "absolute", left: -6, right: -6, bottom: -30, height: 34, zIndex: 54 }} />
      )}
      <CardFace card={card} highlight={armed || focused} single width={width} />
    </motion.div>
  );
}

/* ------------------------------ cards ------------------------------ */
function CardFace({ card, small, highlight, single, width }: { card: Card; small?: boolean; highlight?: boolean; single?: boolean; width?: number }) {
  const w = width ?? (small ? 52 : 66); // bigger baseline; everything below scales from w
  const f = w / 64; // typography scale factor
  const color = red(card.suit) ? "var(--coral)" : "var(--ink)";
  const queen = isQS(card);
  const court = card.rank === "J" || card.rank === "Q" || card.rank === "K";
  const point = pv(card) > 0;
  return (
    <div style={{
      width: w, height: w * 1.42, background: queen ? "linear-gradient(160deg,#fffdf7,#f2e2bd)" : "linear-gradient(170deg,#fffefb,#faf4e6)",
      borderRadius: 9 * f + 3, position: "relative",
      border: `2px solid ${highlight ? "var(--gold)" : queen ? "var(--gold)" : "rgba(59,34,71,.22)"}`,
      boxShadow: highlight ? "0 6px 16px rgba(201,153,46,.5)" : "0 1.5px 4px var(--shadow)",
      color, userSelect: "none", overflow: "hidden",
    }}>
      {/* woodcut inner frame */}
      <div style={{ position: "absolute", inset: 3 * f, borderRadius: 5, border: "1px solid rgba(59,34,71,.10)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 2.5 * f, left: 4.5 * f, fontSize: 18 * f, fontWeight: 800, lineHeight: 0.98, fontFamily: "Georgia,serif" }}>
        {card.rank}<br /><span style={{ fontSize: 15.5 * f }}>{GLYPH[card.suit]}</span>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        {queen ? (
          <span style={{ fontSize: 29 * f }}>👸🏽</span>
        ) : court ? ( // court medallion: rank letter framed in suit color (woodcut stand-in)
          <span style={{
            width: 29 * f, height: 29 * f, borderRadius: "50%", display: "grid", placeItems: "center",
            border: `1.5px solid ${red(card.suit) ? "rgba(224,104,75,.55)" : "rgba(59,34,71,.4)"}`,
            fontSize: 18 * f, fontWeight: 900, fontFamily: "Georgia,serif",
          }}>
            {card.rank}
          </span>
        ) : (
          <span style={{ fontSize: 26 * f, opacity: 0.92 }}>{GLYPH[card.suit]}</span>
        )}
      </div>
      {point && !queen && ( // point cards carry a quiet value dot — scannable worth at a glance
        <span style={{ position: "absolute", bottom: 3 * f, left: 5 * f, fontSize: 10 * f, fontWeight: 900, color: "var(--gold)" }}>
          {pv(card)}
        </span>
      )}
      {!single && (
        <div style={{ position: "absolute", bottom: 3 * f, right: 5 * f, fontSize: 15 * f, fontWeight: 800, lineHeight: 1.05, transform: "rotate(180deg)", fontFamily: "Georgia,serif" }}>
          {card.rank}<br /><span style={{ fontSize: 13 * f }}>{GLYPH[card.suit]}</span>
        </div>
      )}
    </div>
  );
}
function BigCard({ card, glow }: { card: Card; glow?: boolean }) {
  return (
    <div style={{ display: "inline-block", filter: glow ? "drop-shadow(0 0 18px rgba(201,153,46,.9))" : "none" }}>
      <CardFace card={card} />
    </div>
  );
}

/* ------------------------------ activity sidebar (desktop): NOW + what's next + feed ------------------------------ */
function ActivitySidebar({ view: v, isHost }: { view: ExtendedView; isHost: boolean }) {
  const me = v.viewerSeat;
  const n = v.handCounts.length;
  const now = ((): { title: React.ReactNode; detail: React.ReactNode } => {
    switch (v.phase) {
      case "BIDDING": {
        const mine = v.turnSeat === me;
        return {
          title: mine ? "Your bid" : <><Face id={faceOf(v, v.turnSeat!)} size={18} /> {firstName(v, v.turnSeat!)} is bidding</>,
          detail: <>High bid <b>{v.currentHighBid}</b> ({v.currentHighBidderSeat === me ? "you" : firstName(v, v.currentHighBidderSeat!)}). The winner becomes declarer and picks trump.</>,
        };
      }
      case "DECLARER_SETUP": {
        const mine = v.declarerSeat === me;
        return {
          title: mine ? "Set up your bid" : <><Face id={faceOf(v, v.declarerSeat!)} size={18} /> {firstName(v, v.declarerSeat!)} is scheming</>,
          detail: mine
            ? (v.deckCount ?? 1) === 2
              ? <>Pick trump, then call {v.calledCount ?? 2} card{(v.calledCount ?? 2) > 1 ? "s" : ""} — <b>whoever plays the first copy</b> joins your team.</>
              : <>Pick trump, then call a card — whoever holds it becomes your secret partner.</>
            : <>They're choosing trump and calling partner card{(v.calledCount ?? 1) > 1 ? "s" : ""}. Both revealed together.</>,
        };
      }
      case "TRICK_PLAY": {
        const mine = v.turnSeat === me;
        const played = v.currentTrick.length;
        const lastCard = played === n - 1;
        return {
          title: mine ? "Your turn — play a card" : <><Face id={faceOf(v, v.turnSeat!)} size={18} /> {firstName(v, v.turnSeat!)} is playing</>,
          detail: <>
            Hand: <b>{played}/{n}</b> cards down.{" "}
            {lastCard ? <>Last card — <b>the winner takes the hand and leads next</b>.</>
              : <>Then <b>{(v.turnSeat! + 1) % n === me ? "you" : firstName(v, (v.turnSeat! + 1) % n)}</b>.</>}
            {v.allPartnersRevealed && v.Y !== null && <> Team needs <b>{v.Y}</b>.</>}
          </>,
        };
      }
      case "ROUND_END":
        return {
          title: isHost ? "Round complete — your call" : <>Waiting for {v.hostSeat != null ? firstName(v, v.hostSeat) : "the host"}</>,
          detail: isHost ? <>Start round {v.roundNumber + 1} when the table's done arguing.</> : <>They'll start round {v.roundNumber + 1}. Auto-starts if they doze.</>,
        };
      case "PAUSED":
        return { title: "⏸ Paused", detail: <>Waiting on the declarer. {isHost ? "You can resume or end the game." : "The host can resume or end."}</> };
      default:
        return { title: v.phase, detail: null };
    }
  })();

  return (
    <div style={{ width: 272, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ background: "var(--card)", border: "2px solid var(--gold)", borderRadius: 12, padding: "10px 12px", boxShadow: "0 2px 8px var(--shadow)" }}>
        <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)" }}>NOW</div>
        <div style={{ fontWeight: 800, fontSize: 15, margin: "3px 0" }}>{now.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>{now.detail}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "rgba(255,253,247,.6)", border: "1px solid rgba(59,34,71,.12)", borderRadius: 12, padding: "8px 10px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)", marginBottom: 4 }}>ACTIVITY</div>
        <ActivityFeed view={v} />
      </div>
      <ScoresMini view={v} />
    </div>
  );
}

const FEED_ICON: Record<string, string> = {
  ROUND_STARTED: "🎴", BID_PLACED: "📢", PLAYER_PASSED: "—", AUCTION_ENDED: "♛", TRUMP_CHOSEN: "🂠",
  CARDS_CALLED: "📜", CARD_PLAYED: "▸", PARTNER_REVEALED: "⭐", TRICK_WON: "🏆", ROUND_SCORED: "∑",
  PAUSED: "⏸", RESUMED: "▶", ROTATION_SKIPPED: "↷", GAME_ENDED: "🏁",
};

function ActivityFeed({ view: v }: { view: ExtendedView }) {
  const events = useStore((s) => s.events);
  const line = feedLine(v);
  return (
    <div aria-live="polite" style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
      {[...events].reverse().map((e) => {
        const l = line(e);
        if (!l) return null;
        const big = e.kind === "PARTNER_REVEALED" || e.kind === "ROUND_SCORED" || e.kind === "AUCTION_ENDED";
        return (
          <div key={e.seq} style={{
            fontSize: 12, lineHeight: 1.4, padding: big ? "4px 6px" : "1px 2px", borderRadius: 6,
            background: e.kind === "PARTNER_REVEALED" ? "rgba(201,153,46,.18)" : e.kind === "ROUND_SCORED" ? "rgba(46,111,94,.12)" : "transparent",
            fontWeight: big ? 700 : 400, color: big ? "var(--ink)" : "var(--ink-soft)",
          }}>
            <span style={{ display: "inline-block", width: 16, textAlign: "center" }}>{FEED_ICON[e.kind] ?? "·"}</span> {l}
          </div>
        );
      })}
    </div>
  );
}

function ScoresMini({ view: v }: { view: ExtendedView }) {
  const teamsKnown = v.allPartnersRevealed;
  const teamPts = teamsKnown ? v.revealedTeamMembers.reduce((a, s) => a + (v.perPlayerCapturedPoints[s] ?? 0), 0) : null;
  return (
    <div style={{ background: "var(--card)", border: "1px solid rgba(59,34,71,.12)", borderRadius: 12, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, color: "var(--ink-soft)", marginBottom: 4 }}>
        <span>SCORES</span><span style={{ letterSpacing: 0.4 }}>captured · total</span>
      </div>
      {v.totalScore.map((t, s) => (
        <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "1px 0" }}>
          <span><Face id={faceOf(v, s)} size={16} tint={SEAT_COLORS[s % 7]} /> {s === v.viewerSeat ? "You" : firstName(v, s)}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--ink-soft)" }}>{v.perPlayerCapturedPoints[s]}pts</span>
            <b style={{ color: t < 0 ? "var(--coral)" : "var(--ink)", minWidth: 32, textAlign: "right" }}>{t}</b>
          </span>
        </div>
      ))}
      {teamsKnown && v.Y !== null && teamPts !== null && (
        <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 800, color: "var(--coral)" }}>
          team {teamPts}/{v.Y}
          <div style={{ height: 7, background: "rgba(59,34,71,.15)", borderRadius: 4, overflow: "hidden", marginTop: 3 }}>
            <motion.div animate={{ width: `${Math.min(100, (teamPts / v.Y) * 100)}%` }}
              style={{ height: "100%", background: teamPts >= v.Y ? "var(--teal)" : "var(--gold)" }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared feed-line formatter (sidebar + mobile drawer). */
function feedLine(v: ExtendedView | null) {
  const isYou = (s: number) => v !== null && s === v.viewerSeat;
  const name = (s: number) => (v ? (isYou(s) ? "You" : firstName(v, s)) : `seat ${s}`);
  // verb agreement: "You play / Chip plays" — 'You plays' is the kind of detail that breaks the spell
  const verb = (s: number, first: string, third: string) => (isYou(s) ? first : third);
  return (e: GameEvent): string | null => {
    const d = e.data ?? {};
    switch (e.kind) {
      case "ROUND_STARTED": return `Round ${d.roundNumber} — ${name(d.defaultDeclarerSeat)} ${verb(d.defaultDeclarerSeat, "open", "opens")} the bidding at 75`;
      case "BID_PLACED": return `${name(d.seat)} ${verb(d.seat, "bid", "bids")} ${d.value}${d.value >= 150 ? "(!!)" : ""}`;
      case "PLAYER_PASSED": return d.auto ? `${name(d.seat)} dozed — auto-pass` : `${name(d.seat)} ${verb(d.seat, "pass", "passes")}`;
      case "AUCTION_ENDED": return `${name(d.declarerSeat)} ${verb(d.declarerSeat, "win", "wins")} the bid at ${d.Y}`;
      case "TRUMP_CHOSEN": return `Trump: ${GLYPH[d.suit]}`;
      case "CARDS_CALLED": return v && (v.deckCount ?? 1) === 2
        ? `Called: ${d.cards.map((c: Card) => ck(c)).join(" ")} — first to play one joins the team`
        : `Called: ${d.cards.map((c: Card) => ck(c)).join(" ")} — someone is secretly on the team`;
      case "CARD_PLAYED": return `${name(d.seat)} ${verb(d.seat, "play", "plays")} ${ck(d.card)}${isQS(d.card) ? " — thirty points of trouble" : ""}${d.auto ? " (auto)" : ""}`;
      case "PARTNER_REVEALED": return `${name(d.seat)} ${verb(d.seat, "are", "is")} with the declarer! (${ck(d.card)})`;
      case "TRICK_WON": return `${name(d.winnerSeat)} ${verb(d.winnerSeat, "take", "takes")} the hand${d.points ? ` (+${d.points})` : ""}`;
      case "ROUND_SCORED": return d.success ? `Bid MADE with ${d.declarerTeamPoints}` : `Bid FAILED at ${d.declarerTeamPoints}`;
      case "GAME_ENDED": return `Game over`;
      case "PAUSED": return `Paused — waiting on the declarer or host`;
      case "RESUMED": return `Play resumes`;
      case "ROTATION_SKIPPED": return `Rotation skipped a sleeping seat`;
      default: return null;
    }
  };
}

/* ------------------------------ drawer: totals + team bar + history ------------------------------ */
function BottomDrawer({ view: v }: { view: ExtendedView }) {
  const [open, setOpen] = useState(false);
  // team chase is meaningful as soon as the contract exists — declarer side pts are public by claim
  const teamPts = v.revealedTeamMembers.length > 0 ? v.revealedTeamMembers.reduce((a, s) => a + (v.perPlayerCapturedPoints[s] ?? 0), 0) : null;
  return (
    <div style={{ borderTop: "1.5px solid rgba(59,34,71,.15)", paddingTop: 4 }}>
      {/* mobile review #5: six tiny "avatar 0" chips were noise. One meaningful line instead:
          the team chase once the contract exists, else the score leaders; full scores live in history. */}
      <div onClick={() => setOpen((x) => !x)}
        style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", fontSize: 13, cursor: "pointer", padding: "2px 0" }}>
        {v.Y !== null && teamPts !== null ? (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 800, color: "var(--coral)" }}>team {teamPts}/{v.Y}</span>
            <div style={{ width: 110, height: 8, background: "rgba(59,34,71,.15)", borderRadius: 4, overflow: "hidden" }}>
              <motion.div animate={{ width: `${Math.min(100, (teamPts / v.Y) * 100)}%` }}
                style={{ height: "100%", background: teamPts >= v.Y ? "var(--teal)" : "var(--gold)" }} />
            </div>
          </motion.div>
        ) : (() => {
          const any = v.totalScore.some((t) => t !== 0) || v.perPlayerCapturedPoints.some((p) => p > 0);
          if (!any) return <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>scores appear here</span>;
          const lead = v.totalScore.map((t, s) => ({ t: t + (v.perPlayerCapturedPoints[s] ?? 0) * 0, s, cap: v.perPlayerCapturedPoints[s] ?? 0 }))
            .sort((a, b) => b.t - a.t || b.cap - a.cap).slice(0, 2);
          return lead.map(({ s, t, cap }) => (
            <span key={s} style={{ color: "var(--ink-soft)" }}>
              <Face id={faceOf(v, s)} size={17} /> {s === v.viewerSeat ? "you" : firstName(v, s)} <b style={{ color: t < 0 ? "var(--coral)" : "var(--ink)" }}>{t}</b>
              {cap > 0 && <span style={{ fontSize: 11 }}> (+{cap})</span>}
            </span>
          ));
        })()}
        <span style={{ color: "var(--ink)", opacity: 0.75, fontSize: 12, fontWeight: 700 }}>{open ? "▾ hide history" : "▸ history"}</span>
      </div>
      {open && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", fontSize: 12.5, padding: "3px 0" }}>
          {v.totalScore.map((t, s) => (
            <span key={s} style={{ color: "var(--ink-soft)" }}>
              <Face id={faceOf(v, s)} size={16} /> <b style={{ color: t < 0 ? "var(--coral)" : "var(--ink)" }}>{t}</b>
              {(v.perPlayerCapturedPoints[s] ?? 0) > 0 && <span style={{ fontSize: 11 }}> +{v.perPlayerCapturedPoints[s]}</span>}
            </span>
          ))}
        </div>
      )}
      {open && <EventLog />}
    </div>
  );
}

// (EmoteBar removed by request — the EMOTE transport stays server-side; bubbles still render if ever re-enabled.)

/* ------------------------------ theater ------------------------------ */
function useTheater(view: ExtendedView | null, setOverlay: (o: Overlay) => void, setBubbles: React.Dispatch<React.SetStateAction<{ id: number; seat: number; text: string }[]>>, confetti?: () => void) {
  const events = useStore((s) => s.events);
  const processed = useRef(0);
  const bubbleId = useRef(0);
  const wasMyTurn = useRef(false);

  useEffect(() => {
    if (!view) return;
    for (const e of events) {
      if (e.seq <= processed.current) continue;
      processed.current = e.seq;
      cue(e);
    }
    const mine = view.turnSeat === view.viewerSeat && view.phase === "TRICK_PLAY";
    if (mine && !wasMyTurn.current) { sfx.yourTurn(); haptic(30); }
    wasMyTurn.current = mine;

    function cue(e: GameEvent) {
      const d = e.data ?? {};
      const hold = (o: Overlay, ms: number) => { setOverlay(o); setTimeout(() => setOverlay(null), ms); };
      switch (e.kind) {
        case "ROUND_STARTED": {
          sfx.gather();
          if (!REDUCED) {
            const from = centerOf(trickEl);
            const seats: number[] = d.handCounts?.map((_: number, i: number) => i) ?? [];
            const per = Math.min(6, Math.ceil((d.handCounts?.[0] ?? 8) / 2));
            const fs: { x0: number; y0: number; x1: number; y1: number; delay: number }[] = [];
            for (let round = 0; round < per; round++) {
              for (const [j] of seats.entries()) {
                const to = centerOf(seatEls.get((d.defaultDeclarerSeat + j) % seats.length) ?? null);
                fs.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, delay: (round * seats.length + j) * 55 });
              }
            }
            setTimeout(() => useStore.getState().addFlights(fs), 60);
          }
          break;
        }
        case "BID_PLACED":
          if (d.value >= 150) { sfx.slam150(); hold({ type: "slam", seat: d.seat }, 1400); }
          else sfx.bid(d.value);
          break;
        case "PLAYER_PASSED": sfx.pass(); break;
        case "AUCTION_ENDED": {
          const self = useStore.getState().view?.viewerSeat === d.declarerSeat;
          // your own crowning is announced by the setup modal itself — no competing overlay
          setTimeout(() => { sfx.crown(); if (!self) hold({ type: "crown", seat: d.declarerSeat, Y: d.Y }, 2400); }, REDUCED ? 0 : 900);
          break;
        }
        case "CARDS_CALLED": sfx.stamp(); haptic(20); hold({ type: "contract", trump: (useStore.getState().view as ExtendedView | null)?.trump ?? "S", cards: d.cards }, 3200); break;
        case "CARD_PLAYED":
          if (!d.auto) sfx.thock();
          else {
            sfx.ret();
            const v2 = useStore.getState().view;
            if (v2 && d.seat !== v2.viewerSeat) useStore.getState().pushToast(`💤 ${firstName(v2, d.seat)} dozed — the table played for them`);
            // G1: when it happens to YOU, say so loudly — otherwise auto-plays feel like ghosts
            if (v2 && d.seat === v2.viewerSeat) { useStore.getState().pushToast(`⏰ Time ran out — the table played ${ck(d.card)} for you`); haptic([60, 40, 60]); }
          }
          if (isQS(d.card)) sfx.queen();
          break;
        case "PARTNER_REVEALED": {
          const v2 = useStore.getState().view!;
          const tier: "normal" | "final" | "solo" | "queen" =
            d.seat === v2.declarerSeat ? "solo" : isQS(d.card) ? "queen" : v2.allPartnersRevealed ? "final" : "normal";
          if (tier === "solo") sfx.stingDark(); else sfx.sting();
          haptic([40, 60, 40]);
          if (tier !== "normal") confetti?.(); // the BIG reveals earn a shower; ordinary ones stay clean
          hold({ type: "reveal", seat: d.seat, card: d.card, tier }, tier === "normal" ? 1500 : 2000);
          break;
        }
        case "TRICK_WON": { sfx.gather(); haptic(15); if (d.points > 0) for (let i = 0; i < Math.min(4, Math.ceil(d.points / 10)); i++) sfx.coin(i); break; }
        case "ROUND_SCORED": {
          if (d.success) { sfx.made(); confetti?.(); } else sfx.failed();
          const losers = (d.roundDelta as number[]).filter((x) => x < 0);
          const soloFail = !d.success && losers.length === 1;
          // playtest #7: the verdict STAYS — the player dismisses it when they're done reading
          setOverlay({ type: "round", success: d.success, pts: d.declarerTeamPoints, delta: d.roundDelta, solo: soloFail });
          break;
        }
        case "GAME_ENDED": sfx.fanfare(); confetti?.(); break;
        case "EMOTE": {
          sfx.emote();
          const id = ++bubbleId.current;
          setBubbles((b) => [...b, { id, seat: d.seat, text: EMOTES[d.emote] ?? "👋" }]);
          setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2200);
          break;
        }
      }
    }
  }, [events, view, setOverlay, setBubbles]);
}

/* ------------------------------ overlays ------------------------------ */
function SetPiece({ overlay, view, onDismiss }: { overlay: Overlay; view: ExtendedView; onDismiss: () => void }) {
  const persistent = overlay?.type === "round"; // the verdict waits for the reader
  return (
    <AnimatePresence>
      {overlay && (
        <motion.div key={JSON.stringify(overlay).slice(0, 40)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 50,
            pointerEvents: persistent ? "auto" : "none",
            background: overlay.type === "reveal" && overlay.tier === "solo" ? "rgba(20,10,25,.82)" : "rgba(59,34,71,.45)",
          }}>
          <motion.div initial={{ scale: 0.6, y: 24 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
            style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 14, padding: "18px 26px", textAlign: "center", maxWidth: 460, boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
            <OverlayContent overlay={overlay} view={view} onDismiss={onDismiss} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function OverlayContent({ overlay, view: v, onDismiss }: { overlay: NonNullable<Overlay>; view: ExtendedView; onDismiss?: () => void }) {
  const name = (s: number) => nameOf(v, s);
  const av = (s: number) => <Face id={faceOf(v, s)} size={22} />;
  switch (overlay.type) {
    case "slam":
      return <div style={{ fontSize: 24 }}><b>{av(overlay.seat)} {name(overlay.seat)} bids 150!</b><div style={{ fontSize: 15, color: "var(--ink-soft)" }}>The table goes quiet…</div></div>;
    case "crown":
      return <div style={{ fontSize: 22 }}>♛ <b>{name(overlay.seat)}</b> wins the bid<div style={{ fontSize: 30, fontWeight: 700, color: "var(--gold)" }}>{overlay.Y}</div></div>;
    case "contract":
      return (
        <div>
          <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>The bid is set</div>
          <div style={{ fontSize: 34, margin: "4px 0", color: red(overlay.trump) ? "var(--coral)" : "var(--ink)" }}>{GLYPH[overlay.trump]} trump</div>
          <div style={{ fontSize: 18 }}>calling {overlay.cards.map((c, i) => <b key={i} style={{ color: red(c.suit) ? "var(--coral)" : "var(--ink)", margin: "0 4px" }}>{ck(c)}</b>)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>someone at this table just became a secret partner…</div>
        </div>
      );
    case "reveal": {
      const headline =
        overlay.tier === "solo" ? <>…{name(overlay.seat)} is <b>ALONE</b>.</> :
        overlay.tier === "queen" ? <><b>The Queen herself!</b> {av(overlay.seat)} {name(overlay.seat)} is with the declarer!</> :
        overlay.tier === "final" ? <>{av(overlay.seat)} <b>{name(overlay.seat)}</b> is with the declarer — <b>the teams are set.</b></> :
        <>★ {av(overlay.seat)} <b>{name(overlay.seat)}</b> is with the declarer!</>;
      return (
        <div>
          <motion.div initial={{ rotate: -8, scale: 1.4 }} animate={{ rotate: 0, scale: 1 }} style={{ display: "inline-block" }}>
            <BigCard card={overlay.card} glow />
          </motion.div>
          <div style={{ fontSize: 20, marginTop: 8 }}>{headline}</div>
        </div>
      );
    }
    case "round":
      return (
        <div>
          {overlay.solo && (
            <motion.div initial={{ scale: 1.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} style={{ fontSize: 40 }}>
              👸🏽 <motion.span animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ duration: 1.4, delay: 0.3 }} style={{ display: "inline-block" }}>🙅</motion.span>
            </motion.div>
          )}
          <div style={{ fontSize: 30, fontWeight: 800, color: overlay.success ? "var(--teal)" : "var(--coral)" }}>
            {overlay.success ? "BID MADE" : overlay.solo ? "DOWN ALONE" : "BID FAILED"}
          </div>
          <div style={{ color: "var(--ink-soft)" }}>
            {(() => {
              const team = overlay.delta.map((d, s) => ({ d, s })).filter((x) => x.d !== 0);
              const teamNames = team.map((x) => name(x.s)).join(" & ");
              if (overlay.solo) return <>the Queen shakes her head slowly… <b>{teamNames}</b> ate it alone</>;
              return overlay.success
                ? <><b>{teamNames}</b> took {overlay.pts} points</>
                : <><b>{teamNames}</b> fell short at {overlay.pts} — the defenders held the line</>;
            })()}
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
            {overlay.delta.map((d, s) => (
              <span key={s} style={{ fontWeight: d !== 0 ? 800 : 400, fontSize: d !== 0 ? 16 : 13, color: d > 0 ? "var(--teal)" : d < 0 ? "var(--coral)" : "var(--ink-soft)" }}>
                <Face id={faceOf(v, s)} size={17} /> {name(s)}{s === v.viewerSeat ? " (you)" : ""}: {d > 0 ? "+" : ""}{d === 0 ? "±0 (defender)" : d}
              </span>
            ))}
          </div>
          <RoundInsights view={v} />
          <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center" }}>
            {v.hostSeat === v.viewerSeat && v.roundNumber < v.N && (
              <button style={{ ...btn, padding: "10px 20px" }}
                onClick={() => { sendAction("HOST_NEXT_ROUND", {}); onDismiss?.(); }}>
                Play round {v.roundNumber + 1} ▸
              </button>
            )}
            <button style={{ ...btnSec, padding: "10px 18px" }} onClick={onDismiss}>
              {v.hostSeat === v.viewerSeat ? "Look at the table" : "Close"}
            </button>
          </div>
        </div>
      );
  }
}

/** Playtest #7: one interesting truth from the round, mined from the event feed. */
function RoundInsights({ view: v }: { view: ExtendedView }) {
  const events = useStore((s) => s.events);
  // slice to this round only
  const startIdx = events.map((e) => e.kind).lastIndexOf("ROUND_STARTED");
  const round = startIdx >= 0 ? events.slice(startIdx) : events;
  const insights: string[] = [];
  // where did the Queen go?
  const qsIdx = round.findIndex((e) => e.kind === "CARD_PLAYED" && isQS(e.data.card));
  if (qsIdx >= 0) {
    const winner = round.slice(qsIdx).find((e) => e.kind === "TRICK_WON");
    if (winner) insights.push(`👸🏽 The Queen (30) went to ${winner.data.winnerSeat === v.viewerSeat ? "you" : firstName(v, winner.data.winnerSeat)}`);
  }
  // biggest single hand
  const biggest = round.filter((e) => e.kind === "TRICK_WON").reduce<GameEvent | null>((b, e) => (!b || e.data.points > b.data.points ? e : b), null);
  if (biggest && biggest.data.points >= 20) {
    insights.push(`💰 Biggest hand: ${biggest.data.winnerSeat === v.viewerSeat ? "you" : firstName(v, biggest.data.winnerSeat)} +${biggest.data.points}`);
  }
  // when was the partner unmasked?
  const revealIdx = round.findIndex((e) => e.kind === "PARTNER_REVEALED");
  if (revealIdx >= 0) {
    const handsBefore = round.slice(0, revealIdx).filter((e) => e.kind === "TRICK_WON").length;
    const who = round[revealIdx]!.data.seat;
    insights.push(handsBefore <= 1
      ? `⭐ ${who === v.viewerSeat ? "You were" : `${firstName(v, who)} was`} unmasked almost immediately`
      : `⭐ ${who === v.viewerSeat ? "You" : firstName(v, who)} stayed hidden for ${handsBefore} hands`);
  }
  if (insights.length === 0) return null;
  return (
    <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(59,34,71,.06)", borderRadius: 9, textAlign: "left" }}>
      {insights.slice(0, 3).map((t, i) => <div key={i} style={{ fontSize: 12.5, padding: "1px 0" }}>{t}</div>)}
    </div>
  );
}

/* ------------------------------ confetti (used SPARINGLY: verdicts + big reveals) ------------------------------ */
const CONFETTI_COLORS = ["#c9992e", "#e0684b", "#2e8f83", "#7b5ea7", "#e7c25c"];
function Confetti({ burst }: { burst: number }) {
  if (burst === 0 || REDUCED) return null;
  return (
    <div key={burst} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 58, overflow: "hidden" }}>
      {Array.from({ length: 22 }, (_, i) => {
        const x = 8 + Math.random() * 84;
        const drift = (Math.random() - 0.5) * 30;
        const size = 6 + Math.random() * 7;
        const round = Math.random() > 0.5;
        return (
          <motion.div key={i}
            initial={{ left: `${x}%`, top: "38%", opacity: 1, rotate: 0 }}
            animate={{ left: `${x + drift}%`, top: "105%", opacity: [1, 1, 0.7], rotate: (Math.random() - 0.5) * 720 }}
            transition={{ duration: 1.5 + Math.random() * 0.8, ease: [0.2, 0.6, 0.7, 1], delay: Math.random() * 0.25 }}
            style={{
              position: "absolute", width: size, height: round ? size : size * 1.6,
              borderRadius: round ? "50%" : 2,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            }} />
        );
      })}
    </div>
  );
}

/* ------------------------------ flights ------------------------------ */
function FlightLayer() {
  const flights = useStore((s) => s.flights);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 45 }}>
      <AnimatePresence>
        {flights.map((f) => (
          <motion.div key={f.id}
            initial={{ x: f.x0 - 20, y: f.y0 - 28, rotate: -10, opacity: 0.95, scale: 0.9 }}
            animate={{ x: f.x1 - 20, y: f.y1 - 28, rotate: 8, opacity: 0.2, scale: 0.55 }}
            exit={{ opacity: 0 }}
            transition={{ delay: f.delay / 1000, duration: 0.5, ease: [0.3, 0.7, 0.4, 1] }}
            style={{ position: "absolute" }}>
            {f.card ? <CardFace card={f.card as Card} small /> : <CardBack />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
function CardBack() {
  return (
    <div style={{
      width: 40, height: 56, borderRadius: 7,
      background: "repeating-linear-gradient(45deg, var(--ink) 0 4px, #4d2f5c 4px 8px)",
      border: "2px solid var(--gold)",
    }} />
  );
}

/* ------------------------------ partner status ------------------------------ */
function PartnerStatus({ view: v }: { view: ExtendedView }) {
  const me = v.viewerSeat;
  const wide = useWide();
  if (v.declarerSeat === null || v.calledCards.length === 0 || v.phase === "GAME_END") return null;
  const iAmDeclarer = v.declarerSeat === me;
  const partners = v.revealedTeamMembers.filter((s) => s !== v.declarerSeat);
  const calledStr = v.calledCards.map(ck).join(" + ");
  const holdCalled = v.calledCards.filter((c) => v.ownHand.some((h) => h.rank === c.rank && h.suit === c.suit));
  const names = (xs: number[]) => xs.map((s) => firstName(v, s)).join(" & "); // names only — faceOf returns an id, not a glyph

  const twoDeck = (v.deckCount ?? 1) === 2;
  let text: React.ReactNode; let strong = false;
  if (iAmDeclarer) {
    if (v.allPartnersRevealed) {
      strong = true;
      text = partners.length === 0
        ? <>You claimed your own called card{v.calledCount! > 1 ? "s" : ""} — <b>you are SOLO</b>. Everyone is against you.</>
        : <>Your partner{partners.length > 1 ? "s" : ""}: <b>{names(partners)}</b> 🤝</>;
    } else if (twoDeck) {
      // mobile review #3: the full sentence wrapped under the top seat plate — keep phones to one line
      text = wide
        ? <>{partners.length > 0 && <><b>{names(partners)}</b> is with you; </>}the <b>first player to play</b> {calledStr} joins your team — <b>nobody knows who yet</b>{holdCalled.length > 0 && <>. You hold {holdCalled.length > 1 ? "copies" : "a copy"} — play it first to go solo</>}.</>
        : <>{partners.length > 0 && <><b>{names(partners)}</b> + </>}<b>first to play</b> {calledStr} <b>joins you</b></>;
    } else if (holdCalled.length === v.calledCards.length) {
      text = <>You hold {calledStr} yourself — <b>you're going SOLO</b> (nobody knows yet).</>;
    } else {
      text = <>{partners.length > 0 && <><b>{names(partners)}</b> is with you; </>}whoever holds {calledStr} is your partner — <b>hidden until it's played</b> (they know; you don't).</>;
    }
  } else if (v.revealedTeamMembers.includes(me)) {
    strong = v.allPartnersRevealed;
    text = <>You're on <b>{firstName(v, v.declarerSeat)}</b>'s team 🤝 — you need <b>{v.Y}</b> together.</>;
  } else if (twoDeck && holdCalled.length > 0 && !v.allPartnersRevealed) {
    text = <>🎯 You hold {holdCalled.length > 1 ? "copies" : "a copy"} of {holdCalled.map(ck).join(" + ")} — <b>play it first and you join {firstName(v, v.declarerSeat)}'s team</b>. Or sit on it and hope the other copy lands…</>;
  } else if (!twoDeck && holdCalled.length > 0 && !v.allPartnersRevealed) {
    text = <>🤫 You hold {holdCalled.map(ck).join(" + ")} — <b>secretly with {firstName(v, v.declarerSeat)}</b>. Revealed when you play it.</>;
  } else {
    text = v.allPartnersRevealed
      ? <>Teams are known: <b>{names([v.declarerSeat, ...partners])}</b> vs. the rest. Hold them under <b>{v.Y}</b>.</>
      : twoDeck
        ? wide ? <>The <b>first player to play</b> {calledStr} joins the declarer. Watch every card…</> : <><b>First to play</b> {calledStr} <b>joins {firstName(v, v.declarerSeat)}</b></>
        : <>Someone secretly holds {calledStr}. Watch closely…</>;
  }
  return (
    <div style={{
      textAlign: "center", padding: "5px 10px", margin: "2px 0 4px", borderRadius: 8, fontSize: wide ? 13.5 : 12.5,
      background: strong ? "var(--gold)" : "rgba(255,253,247,.9)", color: strong ? "#fff" : "var(--ink)",
      border: "1px solid rgba(59,34,71,.12)", position: "relative", zIndex: 6, // above the top seat plate — never half-hidden
      whiteSpace: wide ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>
      {text}
    </div>
  );
}

/* ------------------------------ game end ------------------------------ */
function GameEnd({ view: v }: { view: ExtendedView }) {
  const events = useStore((s) => s.events);
  const name = (s: number) => nameOf(v, s);
  const ranked = v.totalScore.map((t, s) => ({ s, t })).sort((a, b) => b.t - a.t);
  const top = ranked[0]!.t;
  const reveals = events.filter((e) => e.kind === "PARTNER_REVEALED");
  const scores = events.filter((e) => e.kind === "ROUND_SCORED");
  const biggest = scores.reduce<{ round: number; d: number } | null>((best, e) => {
    const m = Math.max(...(e.data.roundDelta as number[]).map(Math.abs));
    return !best || m > best.d ? { round: e.data.roundNumber, d: m } : best;
  }, null);
  const beats = [
    reveals.length > 0 && `${name(reveals[reveals.length - 1]!.data.seat)} was revealed as a hidden partner`,
    biggest && biggest.d > 0 && `Biggest swing: ±${biggest.d} in round ${biggest.round}`,
    `${scores.filter((e) => e.data.success).length}/${scores.length} bids made tonight`,
  ].filter(Boolean) as string[];
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: "center", padding: 16, margin: "auto 0" }}>
      <h2 style={{ margin: "6px 0", fontSize: 26 }}>♛ Game over</h2>
      {ranked.map(({ s, t }, i) => (
        <motion.div key={s} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }}
          style={{ fontSize: t === top ? 22 : 15, fontWeight: t === top ? 800 : 400, color: t === top ? "var(--gold)" : "var(--ink)", padding: 2 }}>
          {t === top ? "♛ " : `${i + 1}. `}<Face id={faceOf(v, s)} size={t === top ? 24 : 18} /> {name(s)}{s === v.viewerSeat ? " (you)" : ""} — {t}
        </motion.div>
      ))}
      <div style={{ margin: "14px auto", maxWidth: 340, textAlign: "left", background: "var(--card)", border: "1px solid rgba(59,34,71,.15)", borderRadius: 10, padding: "10px 14px" }}>
        <b style={{ fontSize: 12, color: "var(--ink-soft)", letterSpacing: 1 }}>THE STORY</b>
        {beats.map((b, i) => <div key={i} style={{ fontSize: 14, marginTop: 4 }}>· {b}</div>)}
      </div>
      <button style={{ ...btn, padding: "12px 26px", fontSize: 16 }} onClick={() => location.reload()}>New table ▸</button>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>creates a fresh room — share the new code with the same crew</div>
    </motion.div>
  );
}

/* ------------------------------ log & misc ------------------------------ */
function EventLog() {
  const events = useStore((s) => s.events);
  const view = useStore((s) => s.view);
  const line = feedLine(view);
  return (
    <div aria-live="polite" style={{ maxHeight: 120, overflowY: "auto", fontSize: 12, color: "var(--ink-soft)", padding: "4px 8px" }}>
      {[...events].reverse().map((e) => { const l = line(e); return l ? <div key={e.seq}>{l}</div> : null; })}
    </div>
  );
}

function Toasts({ toasts }: { toasts: { id: number; text: string }[] }) {
  return (
    <div style={{ position: "fixed", bottom: 70, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 60 }}>
      {toasts.map((t) => (
        <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: "var(--ink)", color: "var(--parchment)", borderRadius: 8, padding: "8px 14px" }}>
          {t.text}
        </motion.div>
      ))}
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", padding: "4px 0", flexWrap: "wrap" }}>{children}</div>
);
const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "grid", placeItems: "center", height: "100%" }}>{children}</div>
);
const Banner = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: "var(--coral)", color: "#fff", textAlign: "center", padding: 6, zIndex: 70 }}>{children}</div>
);
