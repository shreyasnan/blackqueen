// Determinized Monte-Carlo (PIMC) search bot for TRICK PLAY.
// For each legal card, sample many worlds consistent with what THIS seat can see (own hand, cards
// already played, suit voids, revealed team membership, own called-card holdings), play each world
// out to round end with a fast greedy policy, and pick the card with the best average payoff for the
// bot's own side. Data-free, deterministic (seeded), and cheap for 8–10 card hands.
//
// Reuses the pure engine (applyAction) to simulate, so bot play stays perfectly rules-consistent.

import {
  GameState, RoundData, Card, Suit, SUITS, applyAction, canonicalDeck,
  legalPlays, cardEq, pointValue, rankIndex, trickWinner, trickPoints, TrickPlay,
} from "@blackqueen/engine";

/** Seeded PRNG (mulberry32) — the ONLY source of randomness, so a decision is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const suitI = (s: Suit) => SUITS.indexOf(s);
/** Total order for "the lowest / cheapest card". */
const lowCmp = (a: Card, b: Card) =>
  pointValue(a) - pointValue(b) || rankIndex(a.rank) - rankIndex(b.rank) || suitI(a.suit) - suitI(b.suit);

/** Suits each seat has shown void in (played off-suit when a suit was led). */
function voidSuits(round: RoundData, playerCount: number): Set<Suit>[] {
  const voids: Set<Suit>[] = Array.from({ length: playerCount }, () => new Set<Suit>());
  const scan = (plays: TrickPlay[]) => {
    if (plays.length === 0) return;
    const led = plays[0]!.card.suit;
    for (const p of plays) if (p.card.suit !== led) voids[p.seat]!.add(led);
  };
  for (const t of round.completedTricks) scan(t.plays);
  scan(round.currentTrick);
  return voids;
}

/** Remove one instance of `card` from `pool` in place. */
function removeOne(pool: Card[], card: Card): void {
  const i = pool.findIndex((c) => cardEq(c, card));
  if (i >= 0) pool.splice(i, 1);
}

/** Deal the unseen cards to the OTHER seats respecting hand sizes and known voids. Null if it can't. */
function sampleHands(state: GameState, botSeat: number, voids: Set<Suit>[], rnd: () => number): Card[][] | null {
  const round = state.round!;
  const pc = state.playerCount;
  const full = canonicalDeck(pc, state.deckCount, state.handSize).slice();
  for (const c of round.hands[botSeat]!) removeOne(full, c);
  for (const t of round.completedTricks) for (const p of t.plays) removeOne(full, p.card);
  for (const p of round.currentTrick) removeOne(full, p.card);
  const need = round.hands.map((h, s) => (s === botSeat ? 0 : h.length));
  if (need.reduce((a, b) => a + b, 0) !== full.length) return null; // accounting mismatch — bail

  for (let attempt = 0; attempt < 24; attempt++) {
    const pool = full.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    const hands: Card[][] = round.hands.map((h, s) => (s === botSeat ? h.slice() : []));
    let ok = true;
    for (const card of pool) {
      const elig: number[] = [];
      for (let s = 0; s < pc; s++) {
        if (s === botSeat || hands[s]!.length >= need[s]! || voids[s]!.has(card.suit)) continue;
        elig.push(s);
      }
      if (elig.length === 0) { ok = false; break; }
      hands[elig[Math.floor(rnd() * elig.length)]!]!.push(card);
    }
    if (ok && hands.every((h, s) => h.length === (s === botSeat ? round.hands[botSeat]!.length : need[s]!))) return hands;
  }
  return null;
}

/** Fast greedy rollout policy: take a point trick with the cheapest winner, else shed the lowest card. */
function rolloutCard(round: RoundData, seat: number, deckCount: number): Card {
  const led = round.currentTrick.length === 0 ? null : round.currentTrick[0]!.card.suit;
  const legal = legalPlays(round.hands[seat]!, led);
  if (legal.length === 1) return legal[0]!;
  if (round.currentTrick.length > 0 && trickPoints(round.currentTrick) > 0) {
    const wins = legal.filter((c) => trickWinner([...round.currentTrick, { seat, card: c }], round.trump!, deckCount) === seat);
    if (wins.length > 0) return wins.slice().sort(lowCmp)[0]!;
  }
  return legal.slice().sort(lowCmp)[0]!;
}

/** Play a state to round end with the greedy policy; return the payoff for the bot's side. */
function playout(start: GameState, botSeat: number, onDeclarerSide: boolean): number {
  let s = start;
  let guard = 0;
  while (s.phase === "TRICK_PLAY" && s.round && guard++ < 120) {
    const seat = s.round.turnSeat;
    if (seat == null) break;
    const r = applyAction(s, { type: "PLAY_CARD", seat, card: rolloutCard(s.round, seat, s.deckCount) });
    if (!r.ok) break; // unreachable — rolloutCard is always legal
    s = r.state;
  }
  const delta = s.lastRoundResult?.roundDelta;
  if (!delta) return 0;
  // declarer side: maximize your own share delta. defender: reward the declarer team FAILING.
  return onDeclarerSide ? (delta[botSeat] ?? 0) : -delta.reduce((a, b) => a + b, 0);
}

/** Pick a trick-play card by determinized Monte-Carlo search. Null → caller should fall back.
 *  `samples` caps the world count; `budgetMs` caps wall-clock so a single move stays snappy (and the
 *  synchronous test loop stays bounded) even for large 6–7 player 2-deck games. */
export function mcTrickPlay(real: GameState, botSeat: number, samples: number, seed: number, budgetMs = 250): Card | null {
  const round = real.round;
  if (!round || real.phase !== "TRICK_PLAY") return null;
  const led = round.currentTrick.length === 0 ? null : round.currentTrick[0]!.card.suit;
  const myLegal = legalPlays(round.hands[botSeat]!, led);
  if (myLegal.length <= 1) return myLegal[0] ?? null;

  const botHand = round.hands[botSeat]!;
  const onDeclarerSide = botSeat === round.declarerSeat
    || round.revealedTeamMembers.includes(botSeat)
    || round.calledCards.some((cc) => botHand.some((h) => cardEq(h, cc)));

  const rnd = mulberry32(seed >>> 0);
  const voids = voidSuits(round, real.playerCount);
  const scores = myLegal.map(() => 0);
  let valid = 0;
  const deadline = Date.now() + budgetMs;

  for (let n = 0; n < samples; n++) {
    if (n > 0 && Date.now() > deadline) break; // always run at least one world, then respect the budget
    const hands = sampleHands(real, botSeat, voids, rnd);
    if (!hands) continue;
    valid++;
    const world: GameState = { ...real, round: { ...round, hands } };
    for (let mi = 0; mi < myLegal.length; mi++) {
      const r = applyAction(world, { type: "PLAY_CARD", seat: botSeat, card: myLegal[mi]! });
      if (!r.ok) { scores[mi]! -= 1e6; continue; }
      scores[mi]! += playout(r.state, botSeat, onDeclarerSide);
    }
  }
  if (valid === 0) return null;

  let best = 0;
  for (let i = 1; i < myLegal.length; i++) if (scores[i]! > scores[best]!) best = i;
  return myLegal[best]!;
}
