// Per-seat projection for Teen Patti. The hidden-information firewall: a player sees their OWN cards
// only once they've looked (seen); a blind player is sent no cards at all (not even their own).
// Opponents' cards never appear except in a showdown reveal that the engine has made public.

import { Card } from "./cardstp.js";
import { State, currentActor, legalActions, Reveal } from "./roundtp.js";
import { evaluate, CAT_NAME } from "./cardstp.js";

export interface PlayerView {
  active: boolean; packed: boolean; seen: boolean; allIn: boolean; bet: number; stack: number;
}
export interface ViewTP {
  phase: State["phase"];
  you: number; dealer: number; actor: number;
  pot: number; stake: number; boot: number;
  players: PlayerView[];
  yourCards: Card[] | null;        // null while you're blind
  yourHand: string | null;         // e.g. "Pair" — only when you've seen
  countLive: number;
  sideshow: { requester: number; target: number } | null;
  reveal: { seat: number; cards: Card[]; hand: string }[] | null; // populated at showdown
  result: { winner: number; pot: number; byFold: boolean; tie: boolean; winners: number[]; deltas: number[] } | null;
  // what YOU may do right now (null unless it's your action)
  legal: {
    canSee: boolean; bets: number[]; canPack: boolean; canShow: boolean; showCost: number;
    canSideshow: boolean; sideshowTarget: number | null;
    // when a sideshow was requested OF you:
    answerSideshow: boolean; sideshowRequester: number | null;
  } | null;
}

const mapReveal = (r: Reveal[]) => r.map((x) => ({ seat: x.seat, cards: x.cards, hand: x.rank.name }));

export function playerView(s: State, seat: number): ViewTP {
  const me = s.players[seat]!;
  const iSee = me.seen;
  const revealMe = s.result?.reveal?.some((r) => r.seat === seat) ?? false;
  const yourCards = iSee || revealMe ? me.cards.slice() : null;
  const yourHand = yourCards ? CAT_NAME[evaluate(yourCards).cat] : null;

  const actor = currentActor(s);
  const iAmActor = actor === seat;
  let legal: ViewTP["legal"] = null;
  if (s.phase === "SIDESHOW" && s.sideshow?.target === seat) {
    legal = { canSee: false, bets: [], canPack: false, canShow: false, showCost: 0, canSideshow: false, sideshowTarget: null, answerSideshow: true, sideshowRequester: s.sideshow.requester };
  } else if (s.phase === "BETTING" && iAmActor) {
    const a = legalActions(s, seat);
    const target = a.canSideshow ? prevLiveSeat(s, seat) : null;
    legal = { ...a, sideshowTarget: target, answerSideshow: false, sideshowRequester: null };
  }

  return {
    phase: s.phase,
    you: seat, dealer: s.dealer, actor,
    pot: s.pot, stake: s.stake, boot: s.boot,
    players: s.players.map((p) => ({ active: p.active, packed: p.packed, seen: p.seen, allIn: p.allIn, bet: p.bet, stack: p.stack })),
    yourCards, yourHand,
    countLive: s.players.filter((p) => p.active && !p.packed).length,
    sideshow: s.sideshow,
    reveal: s.result?.reveal ? mapReveal(s.result.reveal) : null,
    result: s.result ? { winner: s.result.winner, pot: s.result.pot, byFold: s.result.byFold, tie: s.result.tie, winners: s.result.winners, deltas: s.result.deltas } : null,
    legal,
  };
}

function prevLiveSeat(s: State, from: number): number {
  const n = s.players.length;
  let k = (from - 1 + n) % n;
  for (let i = 0; i < n; i++) { const p = s.players[k]!; if (p.active && !p.packed && k !== from) return k; k = (k - 1 + n) % n; }
  return from;
}
