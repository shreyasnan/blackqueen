// The table — composition pass (UI_SPEC v1.1 §4): a real table you sit at.
// Structure: HUD (status) → table zone (opponents arc + trick felt) → YOUR seat + hand → drawer.
// Renders ONLY from ClientView; all drama is event-driven (theater hook).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimate } from "motion/react";
import { useStore, ExtendedView, GameEvent } from "./store";
import { sendAction, api, disconnect, getRoomId } from "./net";
import { legalPlays } from "@engine/tricks"; // the ONE permitted engine function (UI_SPEC §14)
import type { Card, Suit } from "@engine/cards";
import { btn, btnSec, inp } from "./App";
import { sfx, haptic, isMuted, toggleMute } from "./audio";
import { useCardScale, toggleLargeCards, isLargeCards } from "./prefs";
import { Face } from "./faces";

const GLYPH: Record<string, string> = { C: "♣", D: "♦", H: "♥", S: "♠" };
const SUIT_WORD: Record<string, string> = { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" }; // U5: aria labels
const SUITS: Suit[] = ["C", "D", "H", "S"];
const AVATARS = ["🦊", "🦉", "🐱", "🦡", "🐰", "🦝", "🐸", "🐻", "🐼", "🦁"];
const SEAT_COLORS = ["#e0684b", "#2e8f83", "#c9992e", "#7b5ea7", "#4a7fb5", "#b5527f", "#6b8e3f", "#2f9fd0", "#9c6b3f", "#7d7d3f"];
// Quick-chat set (broadcast-only, fixed — keeps the hidden-team game clean; no free text, no targeting).
const EMOTES: Record<string, { face: string; label: string; bubble: string }> = {
  abbe:       { face: "😏", label: "Abbe!",       bubble: "😏 Abbe!" },
  jaldi:      { face: "⚡", label: "Jaldi chal",  bubble: "⚡ Jaldi chal" },
  mast:       { face: "🔥", label: "Mast",        bubble: "🔥 Mast!" },
  gg:         { face: "🤝", label: "Good game",   bubble: "🤝 Good game" },
  newpartner: { face: "🙄", label: "New partner", bubble: "🙄 I need a new partner" },
  kya:        { face: "🤦", label: "Kya kar?",    bubble: "🤦 Kya kar raha hai" },
  waah:       { face: "👏", label: "Waah!",       bubble: "👏 Waah!" },
  chalo:      { face: "⏩", label: "Chalo chalo", bubble: "⏩ Chalo chalo" },
  oof:        { face: "😬", label: "Oof",         bubble: "😬 Oof" },
  bakwaas:    { face: "😤", label: "Bakwaas",     bubble: "😤 Bakwaas" },
};
// quick-chat tray order (2 columns); the two long lines span both columns
const CHAT_ORDER = ["abbe", "jaldi", "mast", "gg", "newpartner", "kya", "waah", "chalo", "oof", "bakwaas"];
const WIDE_CHAT = new Set(["newpartner", "kya"]);

/** Tap-to-open quick-chat tray: a bottom sheet of phrase chips. Broadcast-only, fixed set — no free
 *  text, no targeting, so it can't become a covert signaling channel in a hidden-team game. */
function QuickChatSheet() {
  const [open, setOpen] = useState(false);
  const lastSent = useRef(0);
  const send = (key: string) => {
    setOpen(false);
    const now = Date.now();
    if (now - lastSent.current < 700) return; // local debounce (server enforces the real rate limit)
    lastSent.current = now;
    sendAction("EMOTE", { emote: key });
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
                  const phrase = em.bubble.slice(em.face.length + 1); // full phrase, emoji prefix stripped
                  return (
                    <button key={key} type="button" onClick={() => send(key)}
                      style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--card)", border: "1px solid rgba(59,34,71,.1)", borderRadius: 13, padding: "11px 12px", fontSize: 14.5, color: "var(--ink)", cursor: "pointer", boxShadow: "0 1px 3px rgba(40,20,50,.05)", textAlign: "left", gridColumn: WIDE_CHAT.has(key) ? "span 2" : undefined }}>
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
  | { type: "slam"; seat: number; value: number }
  | { type: "round"; success: boolean; pts: number; delta: number[]; solo?: boolean }
  | null;

// #4: hold the round verdict until the final trick has visibly resolved, so the "BID MADE/FAILED"
// modal doesn't slam over the last card played. The live event path schedules it after a short beat;
// the state-derived (reconnect) path fills instantly, but stands down if a live verdict is scheduled.
const ROUND_VERDICT_DELAY = 1500;

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
  const [lbOpen, setLbOpen] = useState(false);
  const [gameEndAck, setGameEndAck] = useState(false); // #3: show the final verdict before the standings
  const [muted, setMuted] = useState<Set<number>>(new Set()); // seats whose reactions you've muted (long-press their plate)
  const toggleMute = (s: number) => setMuted((m) => { const n = new Set(m); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const wide = useWide();
  useTheater(view, setOverlay, setBubbles, () => setBurst((b) => b + 1), muted);
  const [, force] = useState(0);
  // Playtest #2 fix: the round verdict is DERIVED FROM STATE, not only from the live event —
  // reconnect/refresh/late-join during ROUND_END still shows the "BID MADE/FAILED" screen.
  const dismissedRound = useRef(0);
  const shownRound = useRef(0);
  // The round verdict is DERIVED FROM STATE (survives reconnect/refresh) and scheduled ONCE per round.
  // #4: it's deferred ~1.5s so the final trick resolves on the felt before the modal covers it —
  // a single source (this effect) drives sound + confetti + overlay, so there's no live/reconnect race.
  useEffect(() => {
    const v2 = view;
    if (!v2) return;
    const delta = v2.lastRoundDelta;
    // #3: the natural end of the LAST round jumps straight to GAME_END — show its verdict too, so the
    // final hand isn't swallowed by the standings screen. Pause/abort ends go straight to standings.
    const finalEnd = v2.phase === "GAME_END" && v2.roundNumber >= v2.N;
    if ((v2.phase === "ROUND_END" || finalEnd) && delta && dismissedRound.current !== v2.roundNumber && shownRound.current !== v2.roundNumber) {
      shownRound.current = v2.roundNumber;
      const success = v2.lastRoundSuccess ?? false;
      const pts = v2.revealedTeamMembers.reduce((s, seat) => s + (v2.perPlayerCapturedPoints[seat] ?? 0), 0);
      const solo = !success && delta.filter((x) => x < 0).length === 1;
      setTimeout(() => {
        if (success) { sfx.made(); setBurst((b) => b + 1); } else sfx.failed();
        setOverlay({ type: "round", success, pts, delta, solo });
      }, ROUND_VERDICT_DELAY);
    }
    if (v2.phase !== "ROUND_END" && v2.phase !== "GAME_END") { if (dismissedRound.current !== v2.roundNumber) dismissedRound.current = 0; shownRound.current = 0; }
  }, [view]);
  if (!view) return <Center>Connecting…</Center>;
  const isHost = view.hostSeat === view.viewerSeat;

  // Natural final-round end lingers on the table (last trick + verdict) until dismissed; other ends
  // (pause/abort, or after the verdict is acknowledged) go straight to the standings.
  const naturalFinalEnd = view.phase === "GAME_END" && view.roundNumber >= view.N && view.lastRoundDelta != null;
  if (view.phase === "GAME_END" && (gameEndAck || !naturalFinalEnd)) {
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
          <HUD view={view} onMute={() => force((x) => x + 1)} onLeaderboard={() => setLbOpen(true)} />
          <PartnerStatus view={view} />
          {/* ---- THE TABLE: top-down oval, seats around the rim, cards land in front of their player ---- */}
          <PokerTable view={view} bubbles={bubbles} muted={muted} onToggleMute={toggleMute} />
          {/* ---- your controls + hand below the rail ---- */}
          <MyArea view={view} isHost={isHost} hideNext={overlay?.type === "round"} />
        </div>
        {wide && <ActivitySidebar view={view} isHost={isHost} />}
      </div>
      {view.phase !== "GAME_END" && <QuickChatSheet />}
      <LastTrickModal view={view} />
      <LeaderboardModal view={view} open={lbOpen} onClose={() => setLbOpen(false)} />
      <DeclarerSetupModal view={view} />
      <SetPiece overlay={overlay} view={view} onDismiss={() => { dismissedRound.current = view.roundNumber; setOverlay(null); if (view.phase === "GAME_END") setGameEndAck(true); }} />
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
// #1: the partner picker only offers honors + point cards — calling a low pip is never meaningful,
// and dropping them frees room for larger, high-contrast buttons.
const RANKS_PICK: Card["rank"][] = ["A", "K", "Q", "J", "10", "5"];
const suitTone = (suit: string) => (suit === "H" ? "#c73a3a" : suit === "D" ? "#d97b28" : "var(--ink)");

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
  // #1: two steps — pick trump, then pick partner card(s). Resume/refresh lands on the card step if trump is already staged.
  const [step, setStep] = useState<1 | 2>(() => (stagedTrump ? 2 : 1));
  useEffect(() => { if (open) { setPickedRaw(pickCache.get(v.roundNumber) ?? []); setStep(stagedTrump ? 2 : 1); } }, [open, v.roundNumber]);
  if (!open) return null;

  const twoDeck = (v.deckCount ?? 1) === 2;
  const C = v.calledCount ?? (v.playerCount <= 5 ? 1 : 2);
  const trimmed = new Set(deadIdentities(v.playerCount, v.deckCount ?? 1, (v as any).handSize));
  const inHand = (c: Card) => v.ownHand.some((h) => h.rank === c.rank && h.suit === c.suit);
  const isPicked = (c: Card) => picked.some((p) => p.rank === c.rank && p.suit === c.suit);
  const toggle = (c: Card) => {
    sfx.lift();
    setPicked((ps) => isPicked(c) ? ps.filter((p) => !(p.rank === c.rank && p.suit === c.suit))
      : ps.length >= C ? [...ps.slice(1), c] : [...ps, c]); // picking beyond C swaps the oldest
  };

  // suggestion (#1): the highest-ranked callable card you DON'T hold — best odds of landing a real partner.
  let suggested: Card | null = null;
  outer: for (const r of RANKS_PICK) for (const s of SUITS) {
    const c: Card = { suit: s, rank: r };
    if (!trimmed.has(`${r}${s}`) && !inHand(c)) { suggested = c; break outer; }
  }
  const isSuggested = (c: Card) => !!suggested && suggested.rank === c.rank && suggested.suit === c.suit;

  // risk (#5): each called card you hold a copy of adds a scoring share (declarer share + one per held call).
  const heldCount = picked.filter(inHand).length;
  const shares = 1 + heldCount;
  const handSorted = [...v.ownHand].sort((a, b) =>
    SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || RANKS_DESC.indexOf(a.rank) - RANKS_DESC.indexOf(b.rank));
  const SUIT_NAMES: Record<string, string> = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ position: "absolute", inset: 0, zIndex: 52, display: "grid", placeItems: "center", background: "rgba(59,34,71,.55)" }}>
      <motion.div initial={{ scale: 0.85, y: 16 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT}
        style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 16, padding: "16px 20px", textAlign: "center", boxShadow: "0 14px 44px rgba(0,0,0,.45)", width: "min(460px, 96vw)" }}>

        {/* the moment */}
        <div style={{ fontSize: 20 }}>♛ <b>You win the bid</b> <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700 }}>· step {step} of 2</span></div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "var(--gold)", lineHeight: 1.1 }}>{v.Y}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>your team must capture {v.Y} of {v.totalPoints ?? 150} points</div>

        {step === 1 ? (
          /* ---- step 1: trump (switchable until you call, §9.1) ---- */
          <>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "var(--ink-soft)", margin: "6px 0 6px" }}>
              CHOOSE THE TRUMP SUIT
            </div>
            <Row>
              {SUITS.map((s) => {
                const chosen = stagedTrump === s;
                return (
                  <motion.button key={s} whileTap={{ scale: 0.88 }}
                    onClick={() => { if (!chosen) { stageTrump(s); sendAction("CHOOSE_TRUMP", { suit: s }); sfx.lift(); } setStep(2); }}
                    style={{
                      ...btnSec, fontSize: 30, padding: "12px 18px", borderRadius: 12,
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
              <button onClick={() => setStep(2)} style={{ ...btn, padding: "10px 24px", fontSize: 15, marginTop: 12 }}>
                Next: pick your card ▸
              </button>
            )}
          </>
        ) : (
          /* ---- step 2: partner card(s) — your hand is visible, picker is honors + points only ---- */
          <>
            <button onClick={() => setStep(1)} style={{ ...btnSec, padding: "5px 12px", fontSize: 12.5, borderRadius: 8, marginBottom: 8 }}>
              ‹ trump <b style={{ color: stagedTrump && red(stagedTrump) ? "var(--coral)" : "var(--ink)" }}>{stagedTrump ? GLYPH[stagedTrump] : "?"}</b> — change
            </button>

            {/* #1a: your own hand, always visible while you choose */}
            <div style={{ background: "rgba(59,34,71,.05)", borderRadius: 8, padding: "6px 8px", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: "var(--ink-soft)", marginBottom: 4 }}>YOUR HAND</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "center" }}>
                {handSorted.map((c, i) => (
                  <span key={i} style={{ fontSize: 12.5, fontWeight: 800, padding: "2px 5px", borderRadius: 5, background: "var(--card)", border: "1px solid rgba(59,34,71,.15)", color: suitTone(c.suit) }}>
                    {ck(c)}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "var(--ink-soft)", margin: "2px 0 4px" }}>
              SELECT {C > 1 ? `${C} PARTNER CARDS` : "YOUR PARTNER CARD"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
              {twoDeck
                ? <>two copies of every card exist — <b>whoever plays the first copy joins your team</b> (maybe even you)</>
                : <>whoever holds {C > 1 ? "them" : "it"} secretly joins your team — pick a card you hold to go solo</>}
            </div>

            {SUITS.map((s) => {
              const suitColor = suitTone(s);
              return (
                <div key={s} style={{ display: "flex", gap: 5, justifyContent: "center", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ width: 78, textAlign: "right", paddingRight: 6, fontSize: 12.5, color: suitColor, fontWeight: 800 }}>
                    {SUIT_NAMES[s]} <span style={{ fontSize: 15 }}>{GLYPH[s]}</span>
                  </span>
                  {RANKS_PICK.map((r) => {
                    const c: Card = { suit: s, rank: r };
                    const dead = trimmed.has(`${r}${s}`);
                    const sel = isPicked(c);
                    const sug = isSuggested(c) && !sel;
                    const held = inHand(c);
                    return (
                      <button key={r} disabled={dead} onClick={() => toggle(c)} title={held ? "you hold a copy of this card" : undefined}
                        style={{
                          position: "relative", width: 40, height: 44, borderRadius: 9, fontWeight: 800, cursor: dead ? "default" : "pointer",
                          display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1,
                          border: sel ? "2px solid var(--ink)" : sug ? "2px dashed var(--gold)" : "1px solid rgba(59,34,71,.2)",
                          background: sel ? "var(--gold)" : dead ? "transparent" : "var(--card)",
                          color: sel ? "#fff" : dead ? "rgba(59,34,71,.15)" : suitColor,
                          padding: 0,
                        }}>
                        <span style={{ fontSize: 15 }}>{r}</span>
                        <span style={{ fontSize: 10, opacity: 0.85 }}>{GLYPH[s]}</span>
                        {held && !dead && <span style={{ position: "absolute", top: 3, right: 4, width: 6, height: 6, borderRadius: 6, background: sel ? "#fff" : "var(--coral)" }} />}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {suggested && picked.length < C && (
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
                💡 Suggested: <b style={{ color: suitTone(suggested.suit) }}>{ck(suggested)}</b> — a strong card you don't hold
              </div>
            )}

            {/* the confirmation that ends all ambiguity: your selection as a REAL card, big */}
            <div style={{ minHeight: 92, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 8 }}>
              {picked.length === 0
                ? <span style={{ fontSize: 12, color: "var(--ink-soft)", fontStyle: "italic" }}>tap a card above — it'll show here full size</span>
                : picked.map((c) => (
                  <motion.div key={ck(c)} initial={{ scale: 0.6, y: 8 }} animate={{ scale: 1, y: 0 }} transition={SPRING}>
                    <CardFace card={c} width={58} highlight />
                    {inHand(c) && <div style={{ fontSize: 9.5, fontWeight: 800, color: "var(--coral)", marginTop: 2 }}>{twoDeck ? "YOU HOLD A COPY" : "IN YOUR HAND 🎭"}</div>}
                  </motion.div>
                ))}
            </div>

            {/* #5: double/triple-partner risk when you call a card you already hold a copy of */}
            <div style={{ minHeight: 34, fontSize: 11.5, fontWeight: 700, color: "var(--coral)", lineHeight: 1.3, padding: "0 4px" }}>
              {heldCount > 0 && (twoDeck
                ? <>⚠ {shares === 3 ? "TRIPLE PARTNER" : "DOUBLE PARTNER"} — you hold a copy of {heldCount === 1 ? "one partner card" : "both partner cards"}. Play {heldCount === 1 ? "it" : "them"} first and you carry {shares} shares: win big (+{shares}×{v.Y}) or lose big (−{shares}×{v.Y}).</>
                : <>picking your own card — SOLO play: you keep all {shares} share{shares > 1 ? "s" : ""} and gift nobody a partner slot.</>)}
            </div>

            <button disabled={picked.length !== C} onClick={() => { sendAction("CALL_CARDS", { cards: picked }); pickCache.delete(v.roundNumber); sfx.thock(); }}
              style={{ ...btn, padding: "11px 26px", fontSize: 15, opacity: picked.length === C ? 1 : 0.4, marginTop: 2 }}>
              {picked.length === C ? `Select ${picked.map(ck).join(" + ")} ▸` : `pick ${C - picked.length} more`}
            </button>
          </>
        )}
        <SetupCountdown view={v} />
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
                <div style={{ borderRadius: 9, boxShadow: `0 0 0 2.5px ${SEAT_COLORS[p.seat % SEAT_COLORS.length]}`, transform: winner ? "scale(1.1)" : "none" }}>
                  <CardFace card={p.card} small highlight={winner} />
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: 700, color: winner ? "var(--gold)" : SEAT_COLORS[p.seat % SEAT_COLORS.length] }}>
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

/** The gameplay stage: a dark room lit by one warm source above center. The bloom (top) and vignette
 *  (periphery) are painted here once so every panel, seat, and card below sits in the same light. */
const Shell = ({ children, wide }: { children: React.ReactNode; wide: boolean }) => (
  <div style={{ height: "100dvh", position: "relative", overflow: "hidden",
    background: "radial-gradient(135% 95% at 50% 4%, #23241c 0%, #16170f 58%, #0c0d08 100%)" }}>
    {/* overhead bloom — a soft warm ceiling glow, slowly breathing */}
    <div className="bq-bloom" aria-hidden style={{ position: "absolute", top: "-14%", left: "50%", transform: "translateX(-50%)", width: "min(760px,120%)", height: "42%", background: "radial-gradient(ellipse at center, rgba(255,244,222,.13), rgba(255,244,222,0) 70%)", pointerEvents: "none", zIndex: 0 }} />
    {/* peripheral vignette — the room falls off into shadow at the edges */}
    <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 105% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5) 100%)", pointerEvents: "none", zIndex: 0 }} />
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: wide ? 1400 : 1100, margin: "0 auto", padding: "6px 10px 4px", position: "relative", zIndex: 1 }}>
      {children}
    </div>
  </div>
);

/* ------------------------------ HUD: what matters, where you look ------------------------------ */
function HUD({ view: v, onMute, onLeaderboard }: { view: ExtendedView; onMute: () => void; onLeaderboard: () => void }) {
  const wide = useWide();
  const stagedLocal = useStore((s) => s.stagedTrump);
  const stagedTrump = stagedLocal ?? v.stagedTrumpOwn ?? null;
  const stagedConfirmed = useStore((s) => s.stagedConfirmed);
  const me = v.viewerSeat;
  const isDeclarer = v.declarerSeat === me;
  // Whose turn it is now lives in the center of the table (FeltStatus), not in a top banner.

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "4px 2px", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button aria-label="leave table" title="Leave the table"
          style={{ ...btnSec, padding: "4px 8px", fontSize: 12, borderRadius: 8, flexShrink: 0 }}
          onClick={() => {
            const inGame = v.phase !== "GAME_END";
            const msg = inGame
              ? "Leave the table? The game continues — the table plays your cards until you come back (reopen the same link to rejoin)."
              : "Leave the table?";
            if (!window.confirm(msg)) return;
            const rid = getRoomId();
            if (rid) void api(`/api/rooms/${rid}/leave`, {}).catch(() => { /* best effort */ });
            disconnect();
            useStore.getState().resetToHome();
          }}>
          ↩
        </button>
        <div style={{ fontSize: 13, color: "rgba(242,234,214,.82)", fontWeight: 700, letterSpacing: 0.4, whiteSpace: "nowrap" }}>
          ROUND {v.roundNumber}<span style={{ opacity: 0.5 }}>/{v.N}</span>
        </div>
      </div>
      <div />
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
        <button aria-label="leaderboard" title="Leaderboard — everyone's score" onClick={onLeaderboard}
          style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>
          {wide ? "🏆 scores" : "🏆"}
        </button>
        <button aria-label="large cards" title="Bigger cards" style={{ ...btnSec, padding: "4px 9px", fontSize: 13, borderRadius: 8, flexShrink: 0, fontWeight: 800, background: isLargeCards() ? "var(--gold)" : undefined, color: isLargeCards() ? "#1c1c1a" : undefined }} onClick={() => { toggleLargeCards(); onMute(); }}>
          🅐
        </button>
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

/** #2: everyone's running score, on demand — names + faces (not just same-tint icons). */
function LeaderboardModal({ view: v, open, onClose }: { view: ExtendedView; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const ranked = v.totalScore.map((t, s) => ({ s, t })).sort((a, b) => b.t - a.t);
  const leader = ranked[0]?.t ?? 0;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(59,34,71,.55)" }}>
      <motion.div initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} transition={SPRING_SOFT} onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--parchment)", border: "3px solid var(--gold)", borderRadius: 16, padding: "16px 18px", width: "min(360px, 92vw)", boxShadow: "0 14px 44px rgba(0,0,0,.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>🏆 Leaderboard</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>after round {v.roundNumber} / {v.N}</div>
        </div>
        {ranked.map((r, i) => {
          const you = r.s === v.viewerSeat;
          return (
            <div key={r.s} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10, marginBottom: 4,
              background: you ? "rgba(201,153,46,.18)" : i === 0 ? "rgba(201,153,46,.08)" : "transparent",
              border: you ? "1.5px solid var(--gold)" : "1px solid transparent",
            }}>
              <span style={{ width: 18, textAlign: "center", fontWeight: 800, fontSize: 13, color: "var(--ink-soft)" }}>{i + 1}</span>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: SEAT_COLORS[r.s % SEAT_COLORS.length], flexShrink: 0 }} />
              <Face id={faceOf(v, r.s)} size={26} tint={SEAT_COLORS[r.s % SEAT_COLORS.length]} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: you ? 800 : 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {nameOf(v, r.s)}{you && <span style={{ color: "var(--gold)", fontWeight: 800 }}> (you)</span>}
              </span>
              <b style={{ fontSize: 16, minWidth: 42, textAlign: "right", color: r.t === leader && leader !== 0 ? "var(--gold)" : "var(--ink)" }}>{r.t}</b>
            </div>
          );
        })}
        <button onClick={onClose} style={{ ...btnSec, width: "100%", marginTop: 8, padding: "9px 0", fontSize: 14 }}>Close</button>
      </motion.div>
    </motion.div>
  );
}

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

function SeatChip({ view: v, seat, big, bubbles, muted, onToggleMute }: { view: ExtendedView; seat: number; big?: boolean; bubbles: { id: number; seat: number; text: string }[]; muted?: boolean; onToggleMute?: (s: number) => void }) {
  const me = v.viewerSeat;
  const muteHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => { if (muteHold.current) { clearTimeout(muteHold.current); muteHold.current = null; } };
  const preselect = useStore((s) => s.preselect);
  const setPreselect = useStore((s) => s.setPreselect);
  const showQueued = seat === me && preselect && v.phase === "TRICK_PLAY" && v.turnSeat !== me;
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
    // A partner JOINS; the declarer is seeded into the team at CALL_CARDS and must NOT flash "joins the
    // team" (they're the one who called, not a revealed partner) — the contract overlay announces the bid.
    if (team && !was && seat !== v.declarerSeat) { setFlash(true); const t = setTimeout(() => setFlash(false), 1600); return () => clearTimeout(t); }
  }, [team]);
  const relation =
    seat === me ? (team && seat !== v.declarerSeat ? "partner (you)" : seat === v.declarerSeat ? "bidder (you)" : side === "def" ? "defender (you)" : null) :
    team && seat !== v.declarerSeat ? (iAmTeam ? "your partner" : "partner") :
    seat === v.declarerSeat ? (iAmTeam && me !== v.declarerSeat ? "your bidder" : "bidder") :
    side === "def" ? "defender" : null;
  // Never show your OWN seat as away — if you're looking at the screen you're clearly here (the server's
  // socket flag can lag on mobile after backgrounding). Only other seats show 💤 on disconnect.
  const away = seat !== me && v.seatConnected?.[seat] === false;
  const wideChip = useWide();
  // v3 seats: a circular avatar with a team-colored RING, and a small dark pill for the text —
  // smaller and rounder, so more felt shows through (was a chunky rounded-square box).
  const faceSize = big ? 42 : 34;
  const ringD = faceSize + 10;
  // The active player catches a soft warm rim from the overhead light (restrained ivory, not gold).
  const ringColor = side === "def" ? "var(--teal)" : side === "team" ? "var(--gold)" : active ? "#efe3c4" : team ? SEAT_COLORS[seat % SEAT_COLORS.length]! : "rgba(242,234,214,.28)";
  const ringGlow = active
    ? (side === "def"
        ? ["0 0 10px rgba(46,125,107,.5)", "0 0 22px rgba(46,125,107,.95)", "0 0 10px rgba(46,125,107,.5)"]
        : ["0 0 10px rgba(242,232,212,.4)", "0 0 20px rgba(232,214,176,.85)", "0 0 10px rgba(242,232,212,.4)"])
    : side === "team" ? "0 0 10px rgba(194,162,74,.5)"
    : side === "def" ? "0 0 7px rgba(46,125,107,.4)"
    : "0 3px 8px rgba(0,0,0,.5)";
  const nameTint = side === "def" ? "#bfeede" : side === "team" ? "#ffe6a6" : "#f2ead6";
  const roleColor = side === "def" ? "#8fe0cd" : "#ffcf85";

  return (
    <motion.div ref={(el) => { if (el) seatEls.set(seat, el); }}
      onPointerDown={() => { if (seat === me || !onToggleMute) return; muteHold.current = setTimeout(() => { onToggleMute(seat); haptic(20); }, 500); }}
      onPointerUp={clearHold} onPointerLeave={clearHold} onPointerCancel={clearHold}
      animate={{ scale: active ? 1.08 : 1, y: active ? -2 : 0, opacity: anyoneActive && !active ? 0.86 : 1 }}
      transition={SPRING}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", maxWidth: wideChip ? undefined : "42vw" }}>
      {muted && (
        <span title="reactions muted — long-press to unmute" aria-label="reactions muted"
          style={{ position: "absolute", top: -4, left: -4, zIndex: 12, background: "var(--ink)", color: "#fff", borderRadius: 9, width: 18, height: 18, fontSize: 10, display: "grid", placeItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>🔇</span>
      )}
      {showQueued && preselect && (
        <div onClick={() => setPreselect(null)} title="queued to auto-play — tap to undo"
          style={{ position: "absolute", bottom: "108%", left: "50%", transform: "translateX(-50%)", zIndex: 13, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 8.5, fontWeight: 900, color: "var(--teal)", letterSpacing: 0.5, marginBottom: 2 }}>⏳ QUEUED</div>
          <div style={{ borderRadius: 7, boxShadow: "0 0 0 2px var(--teal), 0 3px 8px rgba(0,0,0,.3)" }}>
            <CardFace card={preselect} width={30} />
          </div>
        </div>
      )}
      {/* JOIN flash: expanding gold rings around the avatar the moment this seat is revealed */}
      <AnimatePresence>
        {flash && !REDUCED && (
          <>
            {[0, 0.25, 0.5].map((d) => (
              <motion.div key={d} initial={{ opacity: 0.9, scale: 1 }} animate={{ opacity: 0, scale: 2.1 }} exit={{ opacity: 0 }}
                transition={{ duration: 1.1, delay: d, ease: "easeOut" }}
                style={{ position: "absolute", top: 0, left: "50%", marginLeft: -(ringD + 6) / 2, width: ringD + 6, height: ringD + 6, borderRadius: "50%", border: "3px solid var(--gold)", pointerEvents: "none", zIndex: 11 }} />
            ))}
            <motion.div initial={{ scale: 0, rotate: -12 }} animate={{ scale: [0, 1.3, 1] }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }}
              style={{
                position: "absolute", top: -30, left: "50%", transform: "translateX(-50%)", zIndex: 12, whiteSpace: "nowrap",
                background: "var(--gold)", color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: 0.6,
                borderRadius: 9, padding: "3px 10px", boxShadow: "0 0 18px rgba(201,153,46,.9), 0 3px 8px rgba(0,0,0,.35)",
              }}>
              ⭐ JOINS THE TEAM
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* bobbing pointer above whoever must act */}
      <AnimatePresence>
        {active && !REDUCED && (
          <motion.div initial={{ opacity: 0, y: -6 }} exit={{ opacity: 0 }} animate={{ opacity: 1, y: [0, -6, 0] }}
            transition={{ y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" } }}
            style={{ position: "absolute", top: -20, left: "50%", marginLeft: -10, zIndex: 9, width: 0, height: 0, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: "13px solid var(--gold)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))" }} />
        )}
      </AnimatePresence>
      {active && seat === me && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING}
          style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", zIndex: 10, whiteSpace: "nowrap", background: "var(--coral)", color: "#fff", fontSize: wideChip ? 10 : 9, fontWeight: 900, letterSpacing: wideChip ? 1 : 0.6, borderRadius: 8, padding: wideChip ? "2px 8px" : "1.5px 6px", boxShadow: "0 2px 6px rgba(0,0,0,.3)" }}>
          YOUR TURN
        </motion.div>
      )}
      <AnimatePresence>
        {bubbles.filter((b) => b.seat === seat).map((b) => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 6, scale: 0.6 }} animate={{ opacity: 1, y: -8, scale: 1 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "var(--card)", border: "1.5px solid var(--gold)", borderRadius: 12, padding: "2px 9px", whiteSpace: "nowrap", fontSize: 14, zIndex: 8, boxShadow: "0 3px 8px var(--shadow)" }}>
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* circular avatar with the team ring */}
      <div style={{ position: "relative", display: "inline-block" }}>
        <motion.div animate={{ borderColor: ringColor, boxShadow: ringGlow }}
          transition={{ boxShadow: active ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : { duration: 0.3 },
            borderColor: side === "team" ? { duration: 0.35 } : teamsKnown ? { delay: 0.35 + seat * 0.16, duration: 0.6 } : { duration: 0.3 } }}
          style={{ width: ringD, height: ringD, borderRadius: "50%", border: "2.5px solid", borderColor: ringColor, background: "var(--parchment)", overflow: "hidden", display: "grid", placeItems: "center" }}>
          <Face id={faceOf(v, seat)} size={faceSize} tint={SEAT_COLORS[seat % SEAT_COLORS.length]} />
        </motion.div>
        <TimerRing active={active} self={active && seat === me}
          budgetMs={away ? (v.awayBudgetMs ?? 12000)
            : v.phase === "DECLARER_SETUP" ? ((v as any).setupBudgetMs ?? (v.turnBudgetMs ?? 45000) + 45000)
            : (v.turnBudgetMs ?? 45000)} size={ringD + 8} />
        {seat === v.declarerSeat && (
          <motion.span initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING}
            style={{ position: "absolute", right: -3, bottom: -1, width: 18, height: 18, borderRadius: 9, background: "var(--coral)", color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: "18px", boxShadow: "0 2px 5px rgba(0,0,0,.35), inset 0 -1.5px 0 rgba(0,0,0,.25)", textAlign: "center" }}>
            B
          </motion.span>
        )}
      </div>

      {/* compact dark pill: name · count · role — readable over both felt and rail */}
      <div style={{ background: "rgba(24,44,38,.62)", borderRadius: 10, padding: big ? "3px 11px" : "2px 8px", maxWidth: wideChip ? 150 : "40vw", boxShadow: "0 2px 6px rgba(0,0,0,.28)" }}>
        <div style={{ fontWeight: 700, fontSize: big ? 13 : 12, color: nameTint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
          {seat === me ? "You" : firstName(v, seat)}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,253,247,.8)", whiteSpace: "nowrap", lineHeight: 1.25 }}>
          {away ? <b style={{ color: "#ff9b8a" }}>💤 away</b> : <>{v.handCounts[seat]} · {v.perPlayerCapturedPoints[seat]}pts</>}
        </div>
        {relation && (
          <div style={{ fontSize: 8.5, fontWeight: 800, color: roleColor, letterSpacing: 0.4, textTransform: "uppercase", lineHeight: 1.3 }}>{relation}</div>
        )}
      </div>
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

function PokerTable({ view: v, bubbles, muted, onToggleMute }: { view: ExtendedView; bubbles: { id: number; seat: number; text: string }[]; muted: Set<number>; onToggleMute: (s: number) => void }) {
  const me = v.viewerSeat;
  const n = v.handCounts.length;
  const rel = (seat: number) => (seat - me + n) % n;
  const wide = useWide();
  // mobile review #3 (round 2): rx 44% pushed the side plates' text off the viewport — tuck them in.
  const seatRx = wide ? 44 : 39;
  return (
    <div style={{ flex: 1, minHeight: 300, position: "relative", margin: "2px 0", paddingTop: 22 }}>
      {/* paddingTop pushes the seats down so the top seat's turn-pointer clears the partner banner */}
      {/* natural wood rail — lit on the top edge, shaded below (light from above) */}
      <div style={{
        position: "absolute", inset: "6% 2%", borderRadius: "50% / 42%",
        background: "linear-gradient(180deg, var(--wood-a) 0%, var(--wood-b) 44%, var(--wood-c) 100%)",
        boxShadow: "0 14px 30px rgba(0,0,0,.55), inset 0 2px 1px rgba(255,222,170,.32), inset 0 -4px 6px rgba(0,0,0,.5)",
      }} />
      {/* center-lit felt: bright under the overhead light, sinking to shadow at the rim */}
      <div style={{
        position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%",
        background: "radial-gradient(ellipse at 50% 34%, var(--felt-a) 0%, var(--felt-b) 52%, var(--felt-c) 100%)",
        boxShadow: "inset 0 8px 30px rgba(0,0,0,.45), inset 0 -12px 44px rgba(0,0,0,.32)",
      }} />
      {/* soft pool of light on the felt, directly beneath the source */}
      <div aria-hidden style={{
        position: "absolute", inset: "8.5% 4%", borderRadius: "50% / 42%", pointerEvents: "none",
        background: "radial-gradient(60% 44% at 50% 30%, rgba(255,248,225,.10), rgba(255,248,225,0) 62%)",
      }} />
      {/* betting line: the classic inner ring that frames where cards land */}
      <div style={{
        position: "absolute", inset: "22% 18%", borderRadius: "50% / 44%",
        border: "1.5px solid rgba(255,246,220,.12)", pointerEvents: "none",
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
        const pos = seatPct(rel(seat), n, seatRx, seat === me ? 40 : 46);
        return (
          <div key={seat} style={{ position: "absolute", ...pos, transform: "translate(-50%,-50%)", zIndex: 4 }}>
            <SeatChip view={v} seat={seat} big={seat === me} bubbles={bubbles} muted={muted.has(seat)} onToggleMute={onToggleMute} />
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
  // The table's own status line — replaces the old top banner. Shows whose turn it is (bidding /
  // trick play), plus the running high bid during the auction.
  const me = v.viewerSeat;
  const mine = v.turnSeat === me;
  let main: string | null = null;
  let sub: string | null = null;
  if (v.phase === "BIDDING") {
    main = mine ? "Your bid" : v.turnSeat != null ? `${firstName(v, v.turnSeat)} is bidding` : null;
    if (v.currentHighBid != null && v.currentHighBidderSeat != null) {
      sub = `high bid ${v.currentHighBid} · ${v.currentHighBidderSeat === me ? "you" : firstName(v, v.currentHighBidderSeat)}`;
    }
  } else if (v.phase === "DECLARER_SETUP") {
    main = v.declarerSeat != null && v.declarerSeat !== me ? `${firstName(v, v.declarerSeat)} is picking trump & a partner…` : null;
  // #6: during trick play the center gets covered by cards — whose turn it is lives on the seat plate
  // (the bobbing pointer + YOUR TURN badge + glow), so no center label here.
  } else if (v.phase === "PAUSED") {
    main = "⏸ Paused";
  } else if (v.phase === "ROUND_END" && v.roundNumber < v.N && v.hostSeat != null) {
    main = v.hostSeat === me ? `Round ${v.roundNumber} complete` : `Waiting for ${firstName(v, v.hostSeat)}…`;
  }
  if (!main) return null;
  return (
    <div style={{ position: "absolute", left: "50%", top: "33%", transform: "translate(-50%,-50%)", zIndex: 2, pointerEvents: "none", textAlign: "center", whiteSpace: "nowrap" }}>
      <div style={{ display: "inline-block", background: "rgba(35,20,45,.34)", color: mine ? "#ffe6a6" : "rgba(255,253,247,.96)", fontSize: 15.5, fontWeight: 700, letterSpacing: 0.3, padding: "3px 13px", borderRadius: 14, textShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
        {main}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 12.5, color: "rgba(255,253,247,.8)", textShadow: "0 1px 3px rgba(0,0,0,.4)" }}>{sub}</div>}
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
  // mobile review #2 (round 2): the ring must scale with the trick size — 4-5 players can hug
  // the center, but 6-7 cards there just pile up. Wider ring + smaller cards for big tables.
  const big = n >= 6;
  const rx = wide ? 26 : big ? 24 : 20;
  const ryOther = wide ? 24 : big ? 21 : 17.5;
  const ryMine = wide ? 17 : 14;
  const tiltAmp = wide ? 10 : 6;
  const trickW = wide ? 52 : big ? 44 : 48; // smaller cards on phones, smallest at 6-7p
  return (
    <div ref={(el) => { trickEl = el; }}
      onClick={() => { if (last) setLastTrickOpen(true); }}
      // while the winner banner lingers, this layer rises ABOVE the seat plates — the trick
      // container is a stacking context, so the banner was painting UNDER neighboring plates
      style={{ position: "absolute", inset: 0, cursor: last ? "pointer" : "default", zIndex: linger ? 6 : 3 }}>
      {linger && (
        <motion.div initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING}
          style={{
            position: "absolute", top: "26%", left: "50%", transform: "translateX(-50%)", zIndex: 8, whiteSpace: "nowrap",
            background: "var(--gold)", color: "#fff", fontWeight: 800, borderRadius: 20, padding: "5px 16px", fontSize: wide ? 15 : 13.5,
            boxShadow: "0 4px 14px rgba(0,0,0,.35)",
            maxWidth: "88%", overflow: "hidden", textOverflow: "ellipsis", // never clips off-screen (mobile review)
          }}>
          <Face id={faceOf(v, linger.winnerSeat)} size={19} /> {linger.winnerSeat === me ? "You take" : `${firstName(v, linger.winnerSeat)} takes`}{wide ? " the hand" : " it"}
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
              <div style={{ borderRadius: 9, boxShadow: `0 0 0 2.5px ${SEAT_COLORS[p.seat % SEAT_COLORS.length]}, 0 4px 10px rgba(0,0,0,.35)` }}>
                <CardFace card={p.card} small highlight={!!winner && !!linger} width={trickW} />
              </div>
              {/* attribution chip: border color alone asks players to memorize six seat colors */}
              <div style={{
                textAlign: "center", fontSize: 9.5, fontWeight: 800, marginTop: 1, color: "#fff",
                background: SEAT_COLORS[p.seat % SEAT_COLORS.length], borderRadius: 6, padding: "0px 4px",
                maxWidth: trickW + 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginLeft: "auto", marginRight: "auto", width: "fit-content", opacity: 0.92,
              }}>
                {p.seat === me ? "you" : firstName(v, p.seat)}
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
  // stepper tiles carry a barely-there tint (mauve − / neutral readout / green +); Bid & Pass are equal-weight CTAs.
  const tile = (a: string, b: string): React.CSSProperties => ({
    background: `linear-gradient(180deg,${a},${b})`, color: "var(--ivory)", border: 0, borderRadius: 10,
    padding: "9px 12px", fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
  });
  const cta = (a: string, b: string): React.CSSProperties => ({
    flex: 1, background: `linear-gradient(180deg,${a},${b})`, color: "var(--ivory)", border: 0, borderRadius: 11,
    padding: "11px", fontWeight: 700, fontSize: 15, cursor: "pointer",
    boxShadow: "0 5px 11px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.13), inset 0 -2px 4px rgba(0,0,0,.25)",
  });
  return (
    <div style={{ background: "linear-gradient(180deg,#1c211b,#12160f)", borderRadius: 15, padding: "10px", width: "min(560px,96vw)", boxShadow: "0 9px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05)", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button aria-label="lower bid" style={tile("#2f2833", "#221d27")} onClick={() => setVal((x) => Math.max(min, x - 5))}>−5</button>
          <div style={{ ...tile("#282a22", "#1d1f18"), minWidth: 48, textAlign: "center", fontSize: 17, cursor: "default", color: "#f3ecd8" }}>{val}</div>
          <button aria-label="raise bid" style={tile("#26301f", "#1c2417")} onClick={() => setVal((x) => Math.min(cap, x + 5))}>+5</button>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 7 }}>
          <button style={cta("#33543a", "#22412a")} onClick={() => sendAction("BID", { value: val })}>Bid {val}</button>
          <button style={cta("#3c2a52", "#2a1c3e")} onClick={() => sendAction("PASS", {})}>Pass</button>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "#8f8a78", textAlign: "center" }}>Min bid {min} · Raise by 5</div>
    </div>
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
  // ---- PRE-SELECT: queue a card while awaiting your turn; it auto-plays the instant your turn lands ----
  const preselect = useStore((s) => s.preselect);
  const setPreselect = useStore((s) => s.setPreselect);
  const pushToast = useStore((s) => s.pushToast);
  const sameCard = (a: Card | null | undefined, b: Card) => !!a && a.rank === b.rank && a.suit === b.suit;
  const preselectMode = v.phase === "TRICK_PLAY" && !myTurn && v.ownHand.length > 0;
  const commit = (card: Card) => {
    if (myTurn) { sendAction("PLAY_CARD", { card }); sfx.thock(); haptic(10); }
    else if (preselectMode) { setPreselect(sameCard(preselect, card) ? null : card); sfx.lift(); haptic(8); }
  };
  // when your turn arrives, play the queued card if it's (still) legal — else drop it and hand you control
  useEffect(() => {
    if (!myTurn || !preselect) return;
    if (legal.has(`${preselect.rank}${preselect.suit}`)) { sendAction("PLAY_CARD", { card: preselect }); sfx.thock(); haptic(12); }
    else pushToast("Your queued card can't follow this trick — your turn.");
    setPreselect(null);
  }, [myTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  // drop the queue if that card is no longer in your hand (played, or a fresh deal)
  useEffect(() => {
    if (preselect && !v.ownHand.some((c) => sameCard(preselect, c))) setPreselect(null);
  }, [v.ownHand]); // eslint-disable-line react-hooks/exhaustive-deps
  // -1 = no keyboard focus: the first card must NOT look pre-selected on touch devices
  // (mobile review: the leftmost card appeared auto-chosen). Arrow keys summon focus.
  const [focus, setFocus] = useState(-1);
  const sortBy: "suit" | "rank" = "suit"; // fixed suit sort — the toggle button was removed
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
      if (e.key === "ArrowLeft") setFocus((f) => (f < 0 ? n - 1 : Math.max(0, f - 1)));
      if (e.key === "ArrowRight") setFocus((f) => (f < 0 ? 0 : Math.min(n - 1, f + 1)));
      if (e.key === "Enter" && focus >= 0) {
        const c = hand[focus];
        if (c && legal.has(`${c.rank}${c.suit}`)) { sendAction("PLAY_CARD", { card: c }); sfx.thock(); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [myTurn, focus, hand, legal, n]);

  const wide = useWide();
  const scale = useCardScale();
  // Bigger cards, responsive: generous on desktop, still 13-cards-wide safe on a 380px phone.
  const cardW = Math.round((wide ? 78 : Math.min(68, Math.max(56, Math.floor((typeof innerWidth !== "undefined" ? innerWidth : 400) / (n * 0.62 + 1))))) * scale);
  const overlap = -Math.round(cardW * 0.37);
  // v2.2 mobile fix: with 12+ cards (2-deck hands) the centered fan clips its left edge off-screen.
  // When the fan is wider than the viewport, left-align it and let it scroll horizontally.
  const fanWidth = cardW + (n - 1) * (cardW + overlap);
  const vw = typeof innerWidth !== "undefined" ? innerWidth : 400;
  const overflows = fanWidth > vw - 16;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      {overflows && (
        <div style={{ alignSelf: "flex-end", paddingRight: 6, fontSize: 10, color: "rgba(242,234,214,.6)" }}>⟷ swipe the fan</div>
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
          <div key={`${base}-${copy}`} style={{ marginLeft: i === 0 ? 0 : overlap, transform: `rotate(${rot}deg) translateY(${lift}px)`, zIndex: sameCard(preselect, c) ? 56 : i, flexShrink: 0 }}>
            <DraggableCard card={c} width={cardW}
              interactive={(myTurn && legal.has(`${c.rank}${c.suit}`)) || preselectMode}
              variant={myTurn ? "play" : "preselect"}
              preselected={sameCard(preselect, c)}
              onCommit={commit}
              dimmed={myTurn && !legal.has(`${c.rank}${c.suit}`)} focused={myTurn && focus >= 0 && i === focus} />
          </div>
        );
      }); })()}
    </div>
    </div>
  );
}

function DraggableCard({ card, interactive, variant, preselected, dimmed, focused, width, onCommit }: {
  card: Card; interactive: boolean; variant: "play" | "preselect"; preselected?: boolean;
  dimmed: boolean; focused: boolean; width?: number; onCommit: (card: Card) => void;
}) {
  const [scope] = useAnimate();
  const [armed, setArmed] = useState(false);
  const isPlay = variant === "play";
  useEffect(() => { if (!interactive) setArmed(false); }, [interactive]);
  const fire = () => { onCommit(card); setArmed(false); };
  return (
    <motion.div ref={scope} drag={interactive} dragSnapToOrigin dragElastic={0.6}
      whileDrag={{ scale: 1.15, rotate: 4, zIndex: 60 }}
      onDragStart={() => interactive && sfx.lift()}
      onDragEnd={(_, info) => {
        if (!interactive) return;
        if (info.offset.y < -90) fire();                    // swipe up: play / queue (or un-queue via toggle)
        else if (preselected && info.offset.y > 60) fire(); // swipe down on a queued card: un-queue
        else sfx.ret();
      }}
      onClick={() => {
        if (!interactive) return;
        if (armed) fire();
        else { setArmed(true); sfx.lift(); setTimeout(() => setArmed(false), 4000); } // 4s to confirm
      }}
      role="button"
      aria-label={`${isPlay ? "Play" : "Queue"} ${card.rank} of ${SUIT_WORD[card.suit]}${dimmed ? " (not legal now)" : ""}${preselected ? " (queued — tap to undo)" : ""}`}
      aria-disabled={dimmed || undefined}
      animate={{ y: preselected ? -20 : armed ? -24 : focused ? -14 : (interactive && isPlay) ? -8 : 0, scale: armed ? 1.08 : preselected ? 1.04 : 1, zIndex: (armed || preselected) ? 55 : undefined }}
      style={{
        position: "relative", cursor: interactive ? "pointer" : "default", touchAction: "none",
        opacity: dimmed ? 0.78 : 1,
        filter: dimmed ? "saturate(0.75) brightness(0.96)"
          : preselected ? "drop-shadow(0 5px 12px rgba(46,143,131,.7))"
          : (interactive && isPlay) ? "drop-shadow(0 4px 10px rgba(201,153,46,.45))" : "none",
      }}>
      {preselected && (
        <div style={{ position: "absolute", top: -3, right: -3, zIndex: 57, background: "var(--teal)", color: "#fff", borderRadius: 9, width: 18, height: 18, fontSize: 11, display: "grid", placeItems: "center", boxShadow: "0 1px 4px rgba(0,0,0,.35)" }}>⏳</div>
      )}
      {armed && !preselected && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", background: isPlay ? "var(--gold)" : "var(--teal)", color: "#fff", borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", zIndex: 56, boxShadow: "0 3px 8px rgba(0,0,0,.35)" }}>
          tap again to {isPlay ? "play" : "queue"} {ck(card)} ▲
        </motion.div>
      )}
      {armed && ( // keep the original touch spot hot after the card rises
        <div onClick={(e) => { e.stopPropagation(); fire(); }}
          style={{ position: "absolute", left: -6, right: -6, bottom: -30, height: 34, zIndex: 54 }} />
      )}
      <CardFace card={card} highlight={armed || focused || !!preselected} single width={width} />
    </motion.div>
  );
}

/* ------------------------------ cards ------------------------------ */
// `deck` switches the point/court semantics: Black Queen (default) vs 28 (J3-92-A1-10:1, no Q♠ art).
export function CardFace({ card, small, highlight, single, width, deck }: { card: Card; small?: boolean; highlight?: boolean; single?: boolean; width?: number; deck?: "bq" | "28" | "tp" }) {
  const w = width ?? (small ? 52 : 66); // bigger baseline; everything below scales from w
  const f = w / 64; // typography scale factor
  const color = red(card.suit) ? "#b23324" : "#1c1c1a"; // real-card ink: deep red / near-black
  const is28 = deck === "28";
  const isTP = deck === "tp"; // plain playing cards: no point dots, no Queen art
  const pv28 = (c: Card) => (c.rank === "J" ? 3 : c.rank === "9" ? 2 : c.rank === "A" || c.rank === "10" ? 1 : 0);
  const ptVal = isTP ? 0 : is28 ? pv28(card) : pv(card);
  const queen = !is28 && !isTP && isQS(card);
  const court = !is28 && (card.rank === "J" || card.rank === "Q" || card.rank === "K");
  const point = ptVal > 0;
  return (
    <div style={{
      width: w, height: w * 1.42,
      // aged-ivory stock with fine paper grain, lit from above (bright top, soft ambient-occlusion base)
      backgroundImage: queen
        ? "radial-gradient(120% 90% at 50% 0%, #fbf5e6, #f0e2bd 92%)"
        : "repeating-linear-gradient(92deg, rgba(120,96,60,.04) 0 1px, transparent 1px 3px), radial-gradient(120% 90% at 50% 0%, #f7f0e2, #e8decb 92%)",
      borderRadius: 9 * f + 3, position: "relative",
      border: `${queen || highlight ? 2 : 1}px solid ${highlight ? "var(--gold)" : queen ? "var(--gold)" : "rgba(90,70,45,.24)"}`,
      boxShadow: highlight ? "0 8px 18px rgba(194,162,74,.5), inset 0 1px 0 rgba(255,255,255,.7)" : "0 6px 13px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.72)",
      color, userSelect: "none", overflow: "hidden",
    }}>
      {/* woodcut inner frame */}
      <div style={{ position: "absolute", inset: 3 * f, borderRadius: 5, border: "1px solid rgba(90,70,45,.1)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 2.5 * f, left: 4.5 * f, fontSize: 18 * f, fontWeight: 800, lineHeight: 0.98, fontFamily: "Georgia,serif" }}>
        {card.rank}<br /><span style={{ fontSize: 15.5 * f }}>{GLYPH[card.suit]}</span>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        {queen ? (
          <span style={{ fontSize: 29 * f }}>👸🏽</span>
        ) : court ? ( // court medallion: rank letter framed in suit color (woodcut stand-in)
          <span style={{
            width: 29 * f, height: 29 * f, borderRadius: "50%", display: "grid", placeItems: "center",
            border: `1.5px solid ${red(card.suit) ? "rgba(178,51,36,.5)" : "rgba(28,28,26,.4)"}`,
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
          {ptVal}
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
          detail: <>High bid <b>{v.currentHighBid}</b> ({v.currentHighBidderSeat === me ? "you" : firstName(v, v.currentHighBidderSeat!)}). The winner becomes the bidder and picks trump.</>,
        };
      }
      case "DECLARER_SETUP": {
        const mine = v.declarerSeat === me;
        return {
          title: mine ? "Set up your bid" : <><Face id={faceOf(v, v.declarerSeat!)} size={18} /> {firstName(v, v.declarerSeat!)} is scheming</>,
          detail: mine
            ? (v.deckCount ?? 1) === 2
              ? <>Pick trump, then select {v.calledCount ?? 2} partner card{(v.calledCount ?? 2) > 1 ? "s" : ""} — <b>whoever plays the first copy</b> joins your team.</>
              : <>Pick trump, then select a partner card — whoever holds it becomes your secret partner.</>
            : <>They're choosing trump and a partner card{(v.calledCount ?? 1) > 1 ? "s" : ""}. Both revealed together.</>,
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
        return { title: "⏸ Paused", detail: <>Waiting on the bidder. {isHost ? "You can resume or end the game." : "The host can resume or end."}</> };
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
      <ScoresMini view={v} />
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
          <span><Face id={faceOf(v, s)} size={16} tint={SEAT_COLORS[s % SEAT_COLORS.length]} /> {s === v.viewerSeat ? "You" : firstName(v, s)}</span>
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

// (Activity feed + mobile history drawer removed by request — the leaderboard button covers scores.)
// (EmoteBar removed by request — the EMOTE transport stays server-side; bubbles still render if ever re-enabled.)

/* ------------------------------ theater ------------------------------ */
function useTheater(view: ExtendedView | null, setOverlay: (o: Overlay) => void, setBubbles: React.Dispatch<React.SetStateAction<{ id: number; seat: number; text: string }[]>>, confetti?: () => void, muted?: Set<number>) {
  const events = useStore((s) => s.events);
  const processed = useRef(0);
  const bubbleId = useRef(0);
  const wasMyTurn = useRef(false);
  const lastTrump = useRef<Suit>("S"); // captured from TRUMP_CHOSEN so the contract modal shows the real trump

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
        case "BID_PLACED": {
          // #3: the "table goes quiet" slam is for an all-in (full-pot) bid — in single-deck that's 150,
          // in two-deck it's 300. Show the ACTUAL bid, not a hardcoded 150.
          const tp = useStore.getState().view?.totalPoints ?? 150;
          if (d.value >= tp) { sfx.slam150(); hold({ type: "slam", seat: d.seat, value: d.value }, 1400); }
          else sfx.bid(d.value);
          break;
        }
        case "PLAYER_PASSED": sfx.pass(); break;
        case "AUCTION_ENDED": {
          const self = useStore.getState().view?.viewerSeat === d.declarerSeat;
          // your own crowning is announced by the setup modal itself — no competing overlay
          setTimeout(() => { sfx.crown(); if (!self) hold({ type: "crown", seat: d.declarerSeat, Y: d.Y }, 2400); }, REDUCED ? 0 : 900);
          break;
        }
        case "TRUMP_CHOSEN": lastTrump.current = d.suit as Suit; break; // arrives right before CARDS_CALLED
        case "CARDS_CALLED": sfx.stamp(); haptic(20); hold({ type: "contract", trump: lastTrump.current, cards: d.cards }, 3200); break;
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
        // ROUND_SCORED verdict (sound + confetti + overlay) is handled by the state-derived effect in
        // Table() so it can be deferred past the final trick — see #4. Nothing to cue live here.
        case "GAME_ENDED": sfx.fanfare(); confetti?.(); break;
        case "EMOTE": {
          if (muted?.has(d.seat)) break; // this seat's reactions are muted for you
          sfx.emote();
          const id = ++bubbleId.current;
          setBubbles((b) => [...b, { id, seat: d.seat, text: EMOTES[d.emote]?.bubble ?? "👋" }]);
          setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2200);
          break;
        }
      }
    }
  }, [events, view, setOverlay, setBubbles, muted]);
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
      return <div style={{ fontSize: 24 }}><b>{av(overlay.seat)} {name(overlay.seat)} bids {overlay.value}!</b><div style={{ fontSize: 15, color: "var(--ink-soft)" }}>The table goes quiet…</div></div>;
    case "crown":
      return <div style={{ fontSize: 22 }}>♛ <b>{name(overlay.seat)}</b> wins the bid<div style={{ fontSize: 30, fontWeight: 700, color: "var(--gold)" }}>{overlay.Y}</div></div>;
    case "contract":
      return (
        <div>
          <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>The bid is set</div>
          <div style={{ fontSize: 28, margin: "4px 0", color: red(overlay.trump) ? "var(--coral)" : "var(--ink)" }}>
            <b>{SUIT_WORD[overlay.trump]}</b> {GLYPH[overlay.trump]} <span style={{ fontSize: 16, color: "var(--ink-soft)" }}>is trump</span>
          </div>
          <div style={{ fontSize: 18 }}>{overlay.cards.length > 1 ? "partner cards: " : "partner card: "}{overlay.cards.map((c, i) => <b key={i} style={{ color: red(c.suit) ? "var(--coral)" : "var(--ink)", margin: "0 4px" }}>{ck(c)}</b>)}</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>someone at this table just became a secret partner…</div>
        </div>
      );
    case "reveal": {
      const headline =
        overlay.tier === "solo" ? <>…{name(overlay.seat)} is <b>ALONE</b>.</> :
        overlay.tier === "queen" ? <><b>The Queen herself!</b> {av(overlay.seat)} {name(overlay.seat)} is with the bidder!</> :
        overlay.tier === "final" ? <>{av(overlay.seat)} <b>{name(overlay.seat)}</b> is with the bidder — <b>the teams are set.</b></> :
        <>★ {av(overlay.seat)} <b>{name(overlay.seat)}</b> is with the bidder!</>;
      return (
        <div>
          <motion.div initial={{ rotate: -8, scale: 1.4 }} animate={{ rotate: 0, scale: 1 }} style={{ display: "inline-block" }}>
            <BigCard card={overlay.card} glow />
          </motion.div>
          <div style={{ fontSize: 20, marginTop: 8 }}>{headline}</div>
        </div>
      );
    }
    case "round": {
      const isFinal = v.roundNumber >= v.N;
      const target = v.Y; // the contract they were chasing (may be null after teardown)
      const need = target != null ? <> of the <b>{target}</b> they needed</> : null;
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
          <div style={{ color: "var(--ink-soft)", lineHeight: 1.4 }}>
            {(() => {
              const team = overlay.delta.map((d, s) => ({ d, s })).filter((x) => x.d !== 0);
              const teamNames = team.map((x) => name(x.s)).join(" & ");
              if (overlay.solo) return <>the Queen shakes her head slowly… <b>{teamNames}</b> went down alone at <b>{overlay.pts}</b>{need}</>;
              return overlay.success
                ? <><b>{teamNames}</b> made it — <b>{overlay.pts}</b> points{need} ✓</>
                : <><b>{teamNames}</b> fell short at <b>{overlay.pts}</b>{need}.</>;
            })()}
          </div>
          {v.lastRoundEarlyEnd && (
            <div style={{ marginTop: 5, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" }}>
              ⚡ Ended early — the outcome was already decided.
            </div>
          )}
          {/* declutter: only the scoring seats — every defender is ±0, so we don't list them */}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
            {overlay.delta.map((d, s) => d === 0 ? null : (
              <span key={s} style={{ fontWeight: 800, fontSize: 16, color: d > 0 ? "var(--teal)" : "var(--coral)" }}>
                <Face id={faceOf(v, s)} size={17} /> {name(s)}{s === v.viewerSeat ? " (you)" : ""}: {d > 0 ? "+" : ""}{d}
              </span>
            ))}
          </div>
          {isFinal && (
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 800, color: "var(--gold)" }}>
              🏁 That was the final round — the game is over.
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center" }}>
            {v.hostSeat === v.viewerSeat && v.roundNumber < v.N && (
              <button style={{ ...btn, padding: "10px 20px" }}
                onClick={() => { sendAction("HOST_NEXT_ROUND", {}); onDismiss?.(); }}>
                Play round {v.roundNumber + 1} ▸
              </button>
            )}
            <button style={{ ...btnSec, padding: "10px 18px" }} onClick={onDismiss}>
              {isFinal ? "See final standings ▸" : v.hostSeat === v.viewerSeat ? "Look at the table" : "Close"}
            </button>
          </div>
        </div>
      );
    }
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
  // mobile review (round 2) #6: don't keep chanting "you need 150 together" after the round ended —
  // the strip flips to the verdict while the table sits in ROUND_END.
  if (v.phase === "ROUND_END") {
    if (v.lastRoundSuccess === null) return null;
    const made = v.lastRoundSuccess;
    return (
      <div style={{
        textAlign: "center", padding: "5px 10px", margin: "2px 0 10px", borderRadius: 8, fontSize: wide ? 13.5 : 12.5,
        fontWeight: 800, background: made ? "var(--gold)" : "var(--ink)", color: made ? "#fff" : "var(--parchment)",
        position: "relative", zIndex: 6,
      }}>
        {made ? <>✅ Bid MADE — {firstName(v, v.declarerSeat)}'s side got there</> : <>❌ Bid failed — the defenders held the line</>}
      </div>
    );
  }
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
        ? <>You picked your own partner card{v.calledCount! > 1 ? "s" : ""} — <b>you are SOLO</b>. Everyone is against you.</>
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
        ? wide ? <>The <b>first player to play</b> {calledStr} joins the bidder. Watch every card…</> : <><b>First to play</b> {calledStr} <b>joins {firstName(v, v.declarerSeat)}</b></>
        : <>Someone secretly holds {calledStr}. Watch closely…</>;
  }
  return (
    <div style={{
      textAlign: "center", padding: "5px 10px", margin: "2px 0 10px", borderRadius: 8, fontSize: wide ? 13.5 : 12.5,
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
      <h2 style={{ margin: "6px 0", fontSize: 26, color: "var(--ivory)" }}>♛ Game over</h2>
      {ranked.map(({ s, t }, i) => (
        <motion.div key={s} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }}
          style={{ fontSize: t === top ? 22 : 15, fontWeight: t === top ? 800 : 400, color: t === top ? "var(--gold)" : "var(--ivory)", padding: 2 }}>
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
