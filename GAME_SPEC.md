# Black Queen — Game Specification

**Version:** 1.9.1 (implementation-ready — approved for build; 1.9.1 adds the previously unspecified `seatAssignment` policy, §2/§16)
**Status:** All product decisions resolved; approved for build. The v1.9 decision pass closed the stall-escape exploit, added the abandoned-seat rotation skip, and settled table-talk, timeout, and tie policies — full details in the changelog (§17) and `OPEN_RISKS.md`.

**Contents:** [Overview](#1-overview) · [Players](#2-players) · [Deck](#3-deck-composition) · [Ranking](#4-card-ranking) · [Points](#5-point-cards) · [Round structure](#6-round-structure-overview) · [Default declarer](#7-default-declarer-selection) · [Bidding](#8-bidding) · [Trump & partners](#9-trump-selection--calling-partners) · [Trick play](#10-trick-play) · [Round result](#11-determining-the-round-result) · [Scoring](#12-scoring) · [Game end](#13-game-end) · [Data model](#14-developer-data-model-reference) · [Edge cases](#15-edge-cases--clarifications) · [Config](#16-configurable-values-set-at-game-start--implementation-defaults) · [Changelog](#17-changelog)

**Scope split:** `GAME_SPEC.md` now contains only rules that affect gameplay semantics; the concurrency, versioning, reconnection, timeout-mechanism, rejection-delivery, and snapshot layers live in `ARCHITECTURE.md` and `MESSAGE_PROTOCOL.md`; account identity, authentication, sessions, room creation/joining, invite codes, and post-game teardown live in `PLATFORM_SPEC.md` (this spec begins at `LOBBY` with 4–7 authenticated, seated players); known strategic/griefing risks and deferred decisions live in `OPEN_RISKS.md`.

---

## 1. Overview

Black Queen is a trick-taking card game with **hidden, dynamically-formed teams**. After bidding, the winning bidder (the *declarer*) secretly recruits partners by naming one or more cards; whoever holds a named card is on the declarer's team, but their identity stays hidden until that card is played. Defenders must infer the alliances during play.

The declarer's team wins the round if it captures at least the bid value in card points.

---

## 2. Players

- Supported: **4 to 7 players**.
- 3 or fewer players are **not supported**.
- Seating is fixed for the game. All turn order and rotation are expressed **clockwise** around this fixed seating; the spec never uses "left" or "right" as a direction.
- **Seat assignment (v1.9.1, normative):** seats are assigned at game start by the `seatAssignment` policy (§16): default **random** — a server-side uniform permutation drawn from the same audited CSPRNG class as the round-1 declarer selection (`ARCHITECTURE.md` §5), never client-influenced; alternative **host-arranged** (host explicitly orders the seats in `LOBBY`, visible to all before start). Join order is **never** used implicitly. The final seating is broadcast to all players before `ROUND_START`.

---

## 3. Deck Composition

The base deck is a standard 52-card deck. To deal an even hand to every player, remove only **low, non-point cards** (2s, then 3s, then 4s). Point cards (Aces, 10s, 5s, Q♠) are **never** removed, so the 150-point total is always preserved.

**Removal rule (deterministic):** remove the lowest ranks first, one card per suit, taking suits in the fixed priority order **♣ → ♦ → ♥ → ♠**. Continue until the deck size is divisible by the number of players.

| Players | Cards removed | Removed cards | Deck size | Cards per player |
|--------:|--------------:|---------------|----------:|-----------------:|
| 4 | 0 | (none) | 52 | 13 |
| 5 | 2 | 2♣, 2♦ | 50 | 10 |
| 6 | 4 | 2♣, 2♦, 2♥, 2♠ | 48 | 8 |
| 7 | 3 | 2♣, 2♦, 2♥ | 49 | 7 |

There is **no kitty / no undealt cards**. Every card in the trimmed deck is dealt to a player.

> **Invariant:** All 13 point cards (4 Aces, 4 Tens, 4 Fives, Q♠) are always in play → 150 points every round.

### 3.1 Dealing

The deal is **fully reproducible from the tuple `(playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed)`** — the deal depends on the default declarer seat (round-robin starts there) and on the fixed player↔seat mapping, not on `shuffleSeed` alone. The pipeline below is normative; any conforming implementation produces identical hands from identical inputs (enabling audit and cross-implementation replay). The exact PRNG construction (ChaCha20 keying, byte draw, endianness, Fisher–Yates direction, rejection sampling) is pinned in `ARCHITECTURE.md` §5 and locked by the known-answer vector in `TEST_CASES.md` §7.

1. **Canonical deck order.** Start from the trimmed card set (§3) sorted into a canonical index order: primary key **suit** in the order `♣ < ♦ < ♥ < ♠`, secondary key **rank** ascending `2 < 3 < … < 10 < J < Q < K < A`. This yields a deterministic array `deck[0 … deckSize−1]`.
2. **Shuffle seed.** Per round, the **server** generates a `shuffleSeed` (see `ARCHITECTURE.md` for generation and retention). The seed is **never chosen by, nor visible to, any participant (including the host) during play** — it is not the round-1 declarer selection value of §16, and it is not exposed until game end at the earliest. It is retained server-side with shuffle metadata for debugging/audit.
3. **Deterministic shuffle.** Apply an in-place **Fisher–Yates** shuffle to `deck`, drawing indices from a **named, seeded, portable PRNG** (the reference algorithm is **ChaCha20**; see `ARCHITECTURE.md`). Same seed + same `deckSize` ⇒ same permutation on every platform.
4. **Normative dealing procedure — round-robin, clockwise, starting at the default declarer.** Deal one card at a time from the front of the shuffled `deck`: the first card to the **default declarer's seat**, the next clockwise, and so on, cycling `deckSize / playerCount` times until the deck is empty. (The dealing procedure is fixed and normative — the resulting hands depend on it, so it is not left to implementer choice.)
5. After dealing, the deck is empty. Each hand is **private** to its owner; other players see only card counts (§14.2).

The trim step (§3) is deterministic and public — every player can compute the exact card *set* in play from the player count alone — but the *distribution* of that set into hands depends on the server-only `shuffleSeed`.

---

## 4. Card Ranking

Within a suit, high to low:

```
A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2
```

- A trump card beats any non-trump card.
- Among trump cards, normal rank order applies.
- Rank is only used to compare cards **of the same suit** (or among trumps); see §10 for trick resolution.

---

## 5. Point Cards

| Card | Value each | Count | Subtotal |
|------|-----------:|------:|---------:|
| Ace | 15 | 4 | 60 |
| Ten | 10 | 4 | 40 |
| Five | 5 | 4 | 20 |
| Queen of Spades (Q♠) | 30 | 1 | 30 |
| **Total** | | **13** | **150** |

All other cards are worth 0 points. Q♠ is worth 30 whether or not Spades is the trump suit.

---

## 6. Round Structure (overview)

Each round proceeds in this order:

1. **Select default declarer** (§7)
2. **Deal** (§3)
3. **Bidding** (§8)
4. **Trump selection**, then **calling partner card(s)** (§9)
5. **Trick play** — one card per player per trick, until hands are empty (§10)
6. **Reveal** happens naturally as called cards are played (§9.3)
7. **Scoring** (§12)

A game is a fixed number of rounds `N` (§13).

---

## 7. Default Declarer Selection

- Each round has a **default declarer**, who begins bidding holding a standing bid of **75**.
- The role **rotates one seat clockwise** each round.
- **Abandoned-seat skip (v1.9, normative).** A seat is **abandoned** for rotation purposes if it had **no connected client at any moment during the immediately preceding round** (connection tracking: `ARCHITECTURE.md` §7). When rotation would hand the default-declarer role to an abandoned seat, the role **skips it** and passes one further seat clockwise (repeating as needed past consecutive abandoned seats). The skipped seat still plays the round normally (auto-played per §10). If **every** seat is abandoned, skipping is suspended and normal rotation applies (no infinite loop; the room will pause at the declarer decision and await host resolution anyway). Each skip **MUST be announced to all players** and noted with the §13 uneven-rotation warning semantics, since it shifts the score-relevant standing-75 distribution. Rationale: without this, an abandoned seat inherits the binding 75 every `playerCount` rounds, immediately stalls at `TRUMP_SELECTION`, and forces a host intervention per rotation (`OPEN_RISKS.md` D3).
- **Round 1 selection:** the round-1 default declarer is chosen by the configured `round1DefaultDeclarerSelection` policy (default: random — see §16). This selection value is distinct from the shuffle seed (§3.1) and carries no hidden-hand information.
- **Even distribution holds only when `N` is a multiple of `playerCount`.** With clockwise rotation, the role is distributed **exactly evenly iff `N mod playerCount == 0`**; otherwise the `N mod playerCount` seats starting at the round-1 seat each get one extra default-declarer round. Because the standing 75 is a real asset/liability, this asymmetry is score-relevant — hence the game-length default in §13 is a multiple of `playerCount`.

---

## 8. Bidding

Bidding determines the final declarer and the contract value `Y`.

### 8.1 Standing bid
- The default declarer begins as the **current high bidder** with a **binding** standing bid of **75**. If the auction ends with no higher bid, the default declarer is the final declarer at `Y = 75`.
- Because a binding bid always exists, an **all-pass outcome is impossible**.

### 8.2 Legal actions
On the turn of the player `p` who is *on turn*, exactly one action is legal:
- **Bid `v`**, where `v` is a multiple of 5, `v > currentHighBid`, and `v ≤ 150`; **or**
- **Pass** — permitted **only if `p` is not the current high bidder**.

A player who is the current high bidder is **never placed on turn** (see 8.4), so "pass while high bidder" can never arise. Passing is **permanent**: a passed player takes no further part in this round's auction. A player never bids against themselves.

**Turn-scheduler invariant (normative).** The turn scheduler **MUST NEVER assign a turn to the current high bidder.** The only player who may be placed on turn is a **non-passed player who is not the current high bidder**. This invariant, together with 8.4, guarantees the auction cannot stall, cannot assign an illegal turn, and cannot reach a state where the on-turn player has no legal action:
- **Exactly one legal actor at every step.** Whenever the auction has not ended, there is at least one non-passed player who is not the high bidder (proof below), and the scheduler places exactly that next such player (clockwise) on turn. That player always has a legal action — at minimum **Pass** (legal because they are not the high bidder), and possibly a **Bid** if `currentHighBid < 150`.
- **Liveness / no deadlock.** Let `k` = number of non-passed players. The high bidder is always one non-passed player, so the pool of *eligible actors* is exactly `k − 1`. Each **Pass** strictly decreases `k` by 1; a **Bid** strictly increases `currentHighBid` by ≥ 5 (bounded above by 150) and hands the high-bidder role to the bidder. Because both the number of non-passed players and the headroom `150 − currentHighBid` are finite and every action decreases one of them, the auction **always terminates**.
- **Termination is caught deterministically:** when `k − 1 = 0` (only the high bidder remains non-passed) the auction ends by 8.4(2); a bid of 150 ends it by 8.4(1). At termination no player is on turn, so no illegal or empty turn is ever produced.

### 8.3 Turn order
- The first player on turn is the player **immediately clockwise from the default declarer**.
- Turns proceed **clockwise, skipping passed players**, and **loop for as many laps as needed**. A player may be placed on turn multiple times as the auction escalates.

### 8.3.1 Turn-safety invariants (normative)
- After **every accepted bid or pass**, evaluate auction termination (§8.4) **before** assigning the next turn.
- If exactly **one non-passed player remains**, **end the auction immediately**.
- The turn scheduler **MUST NEVER** assign a turn to the **current high bidder**.
- The current high bidder **MUST NEVER** bid against themselves.
- The bidding state **MUST NEVER** have an on-turn player with **zero legal actions**.

### 8.4 Ending the auction
The engine evaluates these after every action, in order:
1. If a player bids **150**, the auction ends immediately; that player is the final declarer with `Y = 150`.
2. Otherwise, after each **pass**, if exactly **one non-passed player remains**, the auction ends; that player is the final declarer and their current high bid is `Y`. They are **not** placed on turn again.
3. Otherwise, advance to the next non-passed player clockwise.

The final declarer may or may not be the original default declarer.

### 8.5 Invalid actions
Any action outside the legal set of 8.2 (wrong player, non-multiple-of-5, not strictly higher, `> 150`, or a pass by the high bidder) is **rejected deterministically** and the same player is re-prompted. A rejected action changes no game state. (Rejections are delivered privately to the acting client and rate-limited — see `MESSAGE_PROTOCOL.md`.)

### 8.6 Timeout default action (gameplay effect)
If the on-turn bidder fails to act within the configured turn timer (mechanism in `ARCHITECTURE.md`), the engine **auto-passes** on their behalf. This is always safe and legal: by the §8.3.1 invariant the on-turn player is never the current high bidder, so **Pass** is always a legal action for them. Auto-pass is permanent like any pass and cannot strand the auction.

---

## 9. Trump Selection & Calling Partners

Performed by the final declarer, **in this order**:

### 9.1 Trump selection (first)
The declarer names one of the four suits as **trump** for the round. The choice is **final once accepted**: a second `CHOOSE_TRUMP` after acceptance (i.e. while in `CALLING_PARTNERS`) is rejected as `ILLEGAL` like any out-of-state action (§8.5 semantics); the declarer cannot revise trump after seeing nothing new anyway — no information arrives between the two decisions.

### 9.2 Calling partner card(s) (second)
The declarer then names the **called card(s)**. The number depends on player count:

| Players | Called cards `C` | Scoring shares `S = C + 1` |
|--------:|-----------------:|---------------------------:|
| 4 | 1 | 2 |
| 5 | 1 | 2 |
| 6 | 2 | 3 |
| 7 | 2 | 3 |

The declarer **announces the trump suit and the called-card identities publicly.** Every player immediately learns the trump suit and exactly which card(s) were called. **Only the mapping of called cards to their holders is hidden.** (Although §14.1 lists `TRUMP_SELECTION` and `CALLING_PARTNERS` as separate states, both are performed by the same actor with no other player acting between them; the trump choice and the called cards are broadcast together, on transition out of `CALLING_PARTNERS`, so no partial information leaks in between.)

**Disclosure gating (normative, closes a phase side channel):** until the `CALL_CARDS` action is accepted, the trump suit is visible **only to the declarer's own view**; every other player's `ClientView.trump` is null. Furthermore, the two internal states `TRUMP_SELECTION` and `CALLING_PARTNERS` are exposed to non-declarer clients as a **single indistinguishable phase** (wire value `DECLARER_SETUP`, see `MESSAGE_PROTOCOL.md` §3): non-declarer clients MUST NOT be able to observe the internal `TRUMP_SELECTION → CALLING_PARTNERS` transition, whether via a phase field, a `stateVersion` bump visible to them, an event, or `PAUSED` metadata (a pause during either sub-state is reported to non-declarer clients only as "paused during declarer setup"). Otherwise the transition itself would leak how long the declarer deliberated over trump vs. calls — the exact information the broadcast-together rule exists to hide.

**Mechanism (normative):** an accepted `CHOOSE_TRUMP` is **staged** server-side — it advances the internal sub-state but does **not** bump the room `stateVersion` and emits nothing to any client (the declarer's own client echoes the staged choice locally). The staged trump and the called cards are then applied and versioned as a **single transition** when `CALL_CARDS` is accepted. Consequently the version/event stream observable by any client is bit-identical whether or not trump has been chosen yet — so neither a `stateVersion` jump nor a `PAUSED` entered mid-setup can disclose which sub-state the room was in. (The staged choice is included in the crash-recovery snapshot; `ARCHITECTURE.md` §2/§8.)

**Legality of called cards (validated, else declarer re-prompted):**
- A called card **must be a card that is in play** (i.e. not one of the trimmed-out cards). This guarantees every called card is held by exactly one player, so no partner slot is ever "dead."
- The declarer **may call a card they hold themselves**. In that case the declarer owns that card's scoring share in addition to the declarer share (see §12). Calling one's own card(s) to play a partnerless **"secret solo"** (±2Y in 4–5p, ±3Y in 6–7p) is an **intended, legal, high-variance strategy** — not an exploit.
- When `C = 2`, the two called cards must be **distinct**.
- Trump selection is validated as one of the four suits.
Any violation is rejected deterministically and the declarer re-prompted; no state changes.

### 9.3 Team formation & reveal
- A player who holds a called card is a **member of the declarer's team**. All other players are **defenders**.
- **The declarer is always a team member and their membership is public from the auction.** Normatively: `revealedTeamMembers` includes `declarerSeat` from the moment `CALL_CARDS` is accepted (it is never "unrevealed"), and no `PARTNER_REVEALED` event fires for the declarer's *declarer role*. If the declarer plays a called card they hold (secret solo), `PARTNER_REVEALED` **does** fire for that play like any other called-card play — it discloses that this called card is now accounted for, which is what `allPartnersRevealed` gates on.
- Non-declarer team membership is **hidden** until revealed by play.
- **Reveal is atomic with the card play.** When an accepted card play (§10) is a called card, the engine reveals that player as a team member **as part of the same play action**, *before* the next player in that trick is placed on turn. The reveal is broadcast to all clients immediately. This reveal is **never deferred to trick resolution** (`TRICK_RESOLVE` performs no reveals).
- Because reveal happens the instant the card is placed, every player who acts later **in the same trick** already sees the revealed membership.
- The game never explicitly labels partners in the UI before their card is played; defenders infer alliances from play.
- If the declarer called a card they hold, that membership becomes public the moment the declarer plays that card, by the same atomic rule.
- **Reveal-at-scoring:** every card is played before scoring (§10, §11), so by round end **every** called card has been played and every partner already revealed during play. Round-end scoring (§12) therefore reveals no *new* membership; it only confirms the team. Clients must still not display per-player round deltas until the round has fully ended (see §14.2).

### 9.4 Timeout during trump selection / partner calling (paused, not auto-selected)
Unlike bidding and trick play, **the engine does NOT auto-select a trump suit or called card(s) on timeout.** A hand-independent default that leaked nothing (e.g. a fixed suit) would be strategically arbitrary, and a hand-dependent default would leak the declarer's hand — both were rejected, and **`PAUSED` is the confirmed permanent behavior (decided v1.9**, `OPEN_RISKS.md` D1 resolved; the abuse case is handled by the failed-contract pause-end rule below**)**. Instead, after the full configured turn budget (`turnTimerMs + graceMs`, a single combined budget — `ARCHITECTURE.md` §6) expires the room enters **`PAUSED`** (a non-terminal hold managed per `ARCHITECTURE.md` §6–§8) and waits for the declarer to act or the host to resolve. No trump/called-card value is ever fabricated by the engine.

**`PAUSED` entry conditions are exhaustive (normative).** A room enters `PAUSED` **only** via declarer-decision timeout in `TRUMP_SELECTION` or `CALLING_PARTNERS` as above. Disconnects in every other state do **not** pause: after the reconnect grace they resolve via the state's timeout default action (auto-pass §8.6, auto-play §10). There is **no host- or operator-initiated pause** in v1 — an on-demand pause lever would let a host truncate the game at a moment of their choosing (end-when-ahead, `OPEN_RISKS.md` R12), and even with the v1.9 failed-contract pause-end scoring below, early termination itself is a lever worth withholding.

**Score effect of ending from `PAUSED` (normative — changed in v1.9).** Because `PAUSED` is entered **only** via declarer-decision timeout (entry conditions above are exhaustive), an end-from-`PAUSED` is always the consequence of a declarer failing to act. If the host resolves a `PAUSED` room by **ending the game** (rather than resuming), the abandoned contract is scored as a **failure charged entirely to the declarer**:

- the declarer receives `roundDelta = −(S × Y)` (the full team penalty — `S = C + 1` is known from the player count, §9.2);
- **every other player receives `0`** — no partner exists yet at this point (`PAUSED` can only occur before `CALL_CARDS` is accepted, so no called-card holders have been determined, and no innocent seat can be dragged into the penalty);
- the round then ends; final standings are computed from all `totalScore`s including this delta.

This closes the stall-escape exploit (`OPEN_RISKS.md` R9, now resolved): stalling out of a bad contract is strictly worse than playing it (`−(S × Y)` guaranteed vs. `−(S × Y)` worst case with a chance to make it, and the loss lands on the declarer alone instead of a future partner). Resuming instead returns control to the paused state with no score effect — a genuinely disconnected declarer is protected by the host choosing **resume**/wait; **end** is the host's judgment that the declarer has abandoned the contract. (Note the contrast with `ABORTED`-end, §14.1, which still applies **no** deltas — corruption is nobody's fault; a stalled declarer decision is the declarer's.)

---

## 10. Trick Play

- The **final declarer leads the first trick.**
- Play proceeds **clockwise**; each player plays exactly one card per trick.
- The winner of a trick **collects all its cards** and **leads the next trick**.
- The **led suit** is the suit of the **first card played** in the trick. A trump lead sets the led suit to the trump suit.

**Following suit.**
- A player **must follow the led suit** if they hold at least one card of it.
- If a player has **no card of the led suit**, they may play **any card** — a trump or a card of any other suit. There is **no obligation to trump** when void.

**Leading trump.** A player may lead a trump card at any time. There is no "trump broken" restriction.

**Point cards.** There is **no restriction** on point cards — they may be led or played at any time.

**Winning a trick.**
1. If any trump cards were played, the **highest trump** wins.
2. Otherwise, the **highest card of the led suit** wins.
3. Cards of a non-led, non-trump suit can never win a trick.

**Card uniqueness / tie safety (defensive, normative).** The deck contains **exactly one of every card**; two cards can never share both suit and rank. Consequently, when comparing the candidate cards in a trick (all trumps, or all cards of the led suit), **no two candidates can ever be equal in rank**, so a trick always has a **single, unambiguous winner** — ties in rank cannot occur. If the engine ever observes two identical cards in play (same suit and rank), or a rank tie among trick candidates, the state is **invalid and its behavior is undefined**; this indicates state corruption (e.g. a dealing or shuffling defect). Implementations **SHOULD** treat such a condition as a **fatal error** and halt/flag the game rather than attempt to resolve it, since any resolution would be arbitrary. This is a safety guard, not a gameplay rule — it can never trigger in a correct game.

**Point collection (per-seat accumulation — normative).** Point cards are accumulated **per player (seat)**, never per team, during play. When a trick is won, the value of its point cards is added to `capturedPoints[winnerSeat]`. The engine does **NOT** maintain or compute any team-level total during play. Team totals are a **derived quantity computed only at scoring time** (`ROUND_SCORING`, §11–§12) by summing the per-seat captured points of the declarer-team members. This representation is deliberate: per-seat totals are public/derivable (§14.2), whereas a running team total would leak hidden membership, so it must not exist as live state.

**Last trick.** The final trick of a round is played and resolved **identically to every other trick** — there is no last-trick bonus or special rule.

**Play validation (deterministic).** A play by player `p` of card `c` is legal iff **all** of:
1. `p` is the player currently on turn, and
2. `p` holds `c`, and
3. if `p` holds at least one card of the led suit, then `c` is of the led suit (follow-suit obligation). If `p` holds no card of the led suit, any held card is legal.

The leader of a trick has no led suit to follow, so any held card is legal (including trump). Any illegal play is **rejected deterministically** and the same player is re-prompted; rejected plays change no state. (Rejection delivery/rate-limiting: `MESSAGE_PROTOCOL.md`.)

**Timeout default action (gameplay effect).** If the on-turn player fails to play within the configured turn budget (mechanism in `ARCHITECTURE.md` §6), the engine **auto-plays the least-valuable legal card**, chosen deterministically as the **minimum over the player's legal plays by the tuple `(pointValue ↑, rank ↑, suit ↑)`**, where:
- `pointValue` is the card's §5 point value (`A=15, 10=10, 5=5, Q♠=30, all others 0`),
- `rank` ascending is `2 < 3 < … < 10 < J < Q < K < A`,
- `suit` ascending is `♣ < ♦ < ♥ < ♠`.

This ordering is **point-value-major on purpose**: it never sheds a point card while a zero-value legal card exists, so an inactive/AFK seat does not systematically donate points. The tuple is a **total order over distinct cards** (the deck is unique, §10), so the choice is unambiguous and fully deterministic. A legal move always exists (follow suit if able, else any card), so this default is always defined. The auto-played card runs the same accepted-play atomic steps below — including reveal if it is a called card.

> **Known, accepted information effect:** because the rule is public and deterministic, an auto-play discloses a constraint on the timed-out player's hand (the played card is provably their tuple-minimum legal card; an off-suit auto-play proves they are void in the led suit — though voidness is equally proven by any manual off-suit play). This is inherent to *any* deterministic default and is accepted for v1; it is recorded in `OPEN_RISKS.md` alongside the related deliberate-timeout ("blameless AFK") strategy.

**Accepted-play atomic steps.** When a play is accepted, the engine performs, in order, as one indivisible action: (1) remove `c` from `p`'s hand and place it in the trick; (2) if `c` is a called card, reveal `p` as a team member and broadcast it (§9.3); (3) determine whether the trick is complete (`playerCount` cards played). Only after these steps is the next player placed on turn (or the trick resolved). The reveal in step 2 is therefore visible to every later player in the same trick.

**Round completion guarantee.** A round consists of exactly `deckSize / playerCount` tricks; every dealt card is played exactly once. The engine **cannot enter round scoring until all tricks are complete** — every hand is empty. Consequently every called card is guaranteed to have been played (and its holder revealed) before scoring. An interrupted game is **resumable** from its exact mid-trick state and never skips ahead to scoring.

---

## 11. Determining the Round Result

After **all tricks are complete** (every hand empty — see §10 Round completion guarantee), and only then, the team total is computed:

- `declarerTeamPoints = Σ capturedPoints[seat]` over all seats `seat` that are declarer-team members (the declarer plus every called-card holder). This is the **first and only** point at which point cards are aggregated by team.
- The contract **succeeds** if `declarerTeamPoints ≥ Y`.
- Otherwise the contract **fails**.

Defender-held points are irrelevant to the result except insofar as points the defenders capture are points the declarer's team did **not** capture. (Because all 150 points are always captured by someone, `declarerTeamPoints = 150 − Σ capturedPoints[defenderSeat]`; the engine computes it directly from the per-seat totals.)

---

## 12. Scoring

Let:
- `Y` = the winning bid,
- `C` = number of called cards,
- `S = C + 1` = number of scoring shares.

**Shares.** The declarer's team has:
- one share for the **declarer role**, plus
- one share per **called card**.

A player's share count = (1 if they are the declarer) + (number of called cards they hold).

**Per-round scoring.**
- If the contract **succeeds**: each share scores **`+Y`**. Team total = **`+(S × Y)`**.
- If the contract **fails**: each share scores **`−Y`**. Team total = **`−(S × Y)`**.
- **Defenders always score 0.** The only scoring event in a round is the declarer team's gain or loss. The game is *not* zero-sum.

> **Design rationale (intended, not a gap):** Defender status is per-round only. Over the game, every player rotates through the default-declarer role and can also be pulled onto a team by holding a called card, so no one is a permanent defender. Because the winner is decided on **cumulative** score across `N` rounds, a defender is always incentivized to hold the declarer team below its bid — denying the opponents a positive swing improves the defender's *relative* standing even though their own absolute score is unchanged. Rewarding defenders directly is therefore **explicitly out of scope** for v1.

A single player receives `±Y` multiplied by the number of shares they own. So a declarer who also holds one called card owns 2 shares and scores `±2Y`.

### 12.1 Worked examples

**5-player game (`C = 1`, `S = 2`), bid `Y = 90`:**

- *Success, declarer and the called card held by different players:* declarer `+90`, partner `+90`. Team total `+180`. Defenders 0.
- *Failure, same holdings:* declarer `−90`, partner `−90`. Team total `−180`.
- *Declarer holds the called card:* declarer owns both shares → `+180` on success, `−180` on failure. No separate partner.

**6-player game (`C = 2`, `S = 3`), bid `Y = 100`:**

- *Two other players each hold one called card:* declarer `+100`, partner A `+100`, partner B `+100`. Team total `+300` (or `−300` on failure).
- *One player holds both called cards:* declarer `+100`, that partner `+200` (two shares). Team total `+300`.
- *Declarer holds one called card, another player holds the other:* declarer `+200` (two shares), partner `+100`. Team total `+300`.
- *Declarer holds both called cards:* declarer owns all three shares → `+300` on success, `−300` on failure.

**4-player game (`C = 1`, `S = 2`), bid `Y = 75`:**

- *Success, declarer + one distinct partner:* declarer `+75`, partner `+75`, two defenders `0` each. Team total `+150`.
- *Failure:* declarer `−75`, partner `−75`, defenders `0`. Team total `−150`.
- *Declarer calls own card (secret solo):* declarer owns both shares → `±150` alone; all three others `0`.

**7-player game (`C = 2`, `S = 3`), bid `Y = 120`:**

- *Two distinct partners:* declarer `+120`, partner A `+120`, partner B `+120`; four defenders `0`. Team total `+360` (or `−360` on failure).
- *Declarer holds both called cards (secret solo):* declarer `±360` alone; six defenders `0`.

> Do **not** assume the team total is always `3Y`. It is `2Y` for 4–5 players and `3Y` for 6–7 players. Defenders **always** score exactly `0`, regardless of points they captured.

---

## 13. Game End

- A game runs a **fixed number of rounds `N`**, chosen **before the game starts** (§16).
- **Fairness recommendation:** `N` **SHOULD be a multiple of `playerCount`** so the default-declarer role (and its binding standing 75) is distributed exactly evenly (§7). The **default is `N = 2 × playerCount`** (two full rotations).
- **Custom `N` is allowed**, but if `N mod playerCount ≠ 0` the implementation **MUST warn** — **visibly to all players, not only the host** (§16) — that the default-declarer role — a real score-relevant asset/liability — will be **unevenly distributed** (the first `N mod playerCount` seats in rotation get one extra turn as default declarer).
- After `N` rounds, the player with the **highest cumulative score** wins.
- **Ties (v1):** if two or more players are tied for the highest cumulative score, they **share the victory** (co-winners). There is no secondary tie-breaker in v1; all previously-listed alternatives are removed. The same rule applies to every rank below first: **final standings use standard competition ranking** ("1224" — tied players share the higher rank; the next rank is offset by the tie size), so all implementations display identical standings.
- **Extension** is **out of scope for v1** (see §16). The `GAME_END` state is terminal in v1.

---

## 14. Developer Data Model (reference)

A suggested minimal state representation for implementation.

```
Card        { suit: ♠|♥|♦|♣, rank: 2..10|J|Q|K|A }
Player      { id, seatIndex, hand: Card[], roundScore: int, totalScore: int }

RoundState {
  roundNumber: int
  players: Player[]                 // in clockwise seat order
  deck: Card[]                      // trimmed per §3 (all dealt; empty after deal)
  defaultDeclarerSeat: int
  bidding: {
    currentHighBid: int             // starts at 75
    currentHighBidderSeat: int      // starts at defaultDeclarerSeat
    activeSeats: int[]              // seats that have not passed
    turnSeat: int
  }
  declarerSeat: int                 // final declarer
  Y: int                            // winning bid
  trump: suit
  calledCards: Card[]               // length C (1 or 2), all in-play, distinct
  revealedTeamMembers: Set<seat>    // seeded with {declarerSeat} when CALL_CARDS is accepted (§9.3);
                                    // grows as called cards are played (§9.3);
                                    // surfaced to clients under the SAME name in ClientView (§14.2)
  bidHistory: (seat, action)[]      // full auction record (bids + passes), public (§14.2)
  completedTricks: Trick[]          // all resolved tricks this round, public (§14.2)
  currentTrick: { ledSuit, plays: (seat, Card)[] }
  capturedPoints: int[bySeat]        // PER-SEAT point-card totals; index by seat.
                                     // Accumulated during play (§10); per-seat values are
                                     // public/derivable (§14.2). NO team total is stored.
  trickLeaderSeat: int
}
```

- **Naming:** the revealed-membership set is called `revealedTeamMembers` **everywhere** (state and `ClientView`); the former `revealedPartners` name is retired to avoid divergence. (Contents differ per viewer: the `ClientView` copy is the authoritative set **plus** the viewer's own membership if they are an unrevealed holder, §14.2.)
- **`Player.roundScore` lifecycle:** initialized to `0` at `ROUND_START`; set to `roundDelta(seat)` at `ROUND_SCORING`; added into `totalScore` at the same step; it is a per-round scratch value, reset again at the next `ROUND_START`.
- **Transport-only fields** (e.g. `stateVersion`, `actionId`) are **not** part of gameplay state; they are defined in `MESSAGE_PROTOCOL.md` and must not affect any gameplay computation here.

**Derived values.**
- `C = (playerCount <= 5) ? 1 : 2`
- `S = C + 1`
- `shareCount(seat) = (seat == declarerSeat ? 1 : 0) + countCalledCardsHeldBy(seat)`
- `declarerTeamPoints = Σ capturedPoints[seat] for seat where declarerTeamMember(seat)`  // computed only at ROUND_SCORING
- `success = declarerTeamPoints >= Y`
- `roundDelta(seat) = declarerTeamMember(seat) ? (success ? +Y : −Y) * shareCount(seat) : 0`

### 14.1 State Machine

States and the single actor + legal actions in each:

| State | Actor | Legal action(s) | Transition(s) |
|-------|-------|-----------------|---------------|
| `LOBBY` | host | configure `N`, `round1DefaultDeclarerSelection`, `seatAssignment`, turn-timer; start. **The host does NOT set the shuffle seed** (server-only, per-round, §3.1) | 4–7 players present → `ROUND_START` |
| `ROUND_START` | engine | select default declarer (round 1: `round1DefaultDeclarerSelection`; else rotate +1 clockwise); reset per-round scratch | → `DEALING` |
| `DEALING` | engine | server-seeded shuffle + normative round-robin deal (§3.1) | → `BIDDING` |
| `BIDDING` | on-turn player | bid `v` \| pass (per §8.2); **timeout → auto-pass (§8.6)** | one bidder remaining, or 150 bid → `TRUMP_SELECTION` |
| `TRUMP_SELECTION` | declarer | choose trump suit; **timeout → grace period → `PAUSED` (no auto-select, §9.4)** | → `CALLING_PARTNERS` |
| `CALLING_PARTNERS` | declarer | name `C` called card(s) (§9.2); **timeout → grace period → `PAUSED` (no auto-select, §9.4)** | valid → `TRICK_LEAD` |
| `TRICK_LEAD` | trick leader | play any held card; **accepted-play atomic steps run here** — place card, **reveal if called card** (§9.3), check trick completion (§10); **timeout → auto-play least-valuable legal card `(pointValue↑, rank↑, suit↑)` (§10)** | card played → `TRICK_FOLLOW` |
| `TRICK_FOLLOW` | next player clockwise | play a legal card; **accepted-play atomic steps run here** — place card, **reveal if called card** (§9.3), check trick completion (§10); **timeout → auto-play least-valuable legal card `(pointValue↑, rank↑, suit↑)` (§10)** | trick has `playerCount` cards → `TRICK_RESOLVE`; else stay `TRICK_FOLLOW` |
| `TRICK_RESOLVE` | engine | determine winner; add the trick's point value to `capturedPoints[winnerSeat]` (**per-seat only, §10 — no team-level total exists during play**). **Performs no reveals** — all reveals already happened at play time | hands non-empty → `TRICK_LEAD` (winner leads); hands empty → `ROUND_SCORING` |
| `ROUND_SCORING` | engine | **guard: entered only when all hands are empty** (§10). Compute `declarerTeamPoints` (first team aggregation, §11), then `success`, then `roundDelta` for all seats, add to totals | → `ROUND_END` |
| `ROUND_END` | engine | confirm team (already revealed during play), show per-player deltas | `roundNumber < N` → `ROUND_START`; else → `GAME_END` |
| `GAME_END` | engine | rank by total; co-winners share ties (§13) | **terminal** (no extension in v1) |
| `PAUSED` | — (host) | non-terminal hold entered **only** when a declarer decision (`TRUMP_SELECTION`/`CALLING_PARTNERS`) times out past grace (§9.4 — the exhaustive entry list; disconnects elsewhere auto-resolve, never pause). Host may **resume** (no score effect) or **end the game** (§9.4 v1.9: the abandoned contract scores as a **failure charged to the declarer alone** — declarer `−(S × Y)`, all others `0` — then standings are computed) → `GAME_END` | resume to the paused state, or → `GAME_END` |
| `ABORTED` | host | entered on unrecoverable state corruption (§10 fatal guard). **No score deltas for the incomplete round; the round does not auto-advance** | host may **end the game** (standings from last completed round) → `GAME_END`, or **restart the round** — which **re-deals with a FRESH `shuffleSeed`** (same `roundNumber`, same default declarer; the prior dealt hands are never reused, `ARCHITECTURE.md` §8) → `DEALING` |

`PAUSED` and `ABORTED` are the only non-linear states; their mechanism (grace timers, snapshots, freeze) is defined in `ARCHITECTURE.md`. **Score effect is normative here:** entering `ABORTED` applies **no** `roundDelta` for the in-progress round and never skips ahead to the next round.

Every player-actor state has exactly **one** actor on turn and a **fully enumerated** legal-action set; the engine states are deterministic computations with no choice. Apart from the timeout/`PAUSED`/`ABORTED` transitions above, there are no other transitions; any input not matching the current state's legal set is rejected (§8.5, §9.2, §10).

### 14.2 Information Visibility

The server holds the full authoritative state; each client sees only a **personalized projection** of it. This section is normative for any correct client/server implementation.

**What each player may see:**
- Their **own hand** in full.
- **Other players' hands only as card counts** (the number of cards each player holds), never the identities of those cards.
- **Public game facts:** player count and seating order, the deterministic trimmed card set (§3), the full bid history and `Y`, the declarer's identity, the trump suit **(public only from acceptance of `CALL_CARDS` onward — before that it is visible only to the declarer, §9.2 disclosure gating)**, and the **called-card identities** (§9.2).
- The contents of the **current and completed tricks** (all cards already played are public).
- **Revealed** team memberships: a player is shown as a team member once one of their called cards has been played (§9.3). The player themselves always knows their own membership.

**What the server must NOT expose:**
- The **holder mapping of unrevealed called cards** — i.e. whether any *other* player holds a called card before that card is played. This includes never leaking it via card counts, timing, or any side channel.
- Any player's hand contents to any other player.
- The **shuffle seed** and any RNG internals (server-only, §3.1).
- Any aggregation that requires **unrevealed-partner attribution** — see the corrected rule below.

**Point-leak rule (normative) — corrected in v1.6, reconciled in v1.7.** The threat is **not** per-player captured points. Every trick's winner and full contents are public (§14.2), and the winner is determined by a public rule, so **each player's own captured-point total is already derivable from public data** — forbidding the server to display it would be unenforceable (any client can compute it) and would not protect anything. The genuinely secret quantity is anything that requires attributing points to a **team whose membership is not yet fully revealed.** Therefore:

The gating condition is **whether all partners are revealed**, not the round boundary. Define `allPartnersRevealed` = **all `C` called cards have been played** (§9.3; equivalently, `PARTNER_REVEALED` has fired `C` times this round — the declarer's role membership is public from the auction and does not enter this condition). Then:

- **Always permitted during play (public / derivable):** the cards on the table and in completed tricks, each trick's winner, and **per-seat captured-point totals** (a HUD showing "Dave has captured 45 points" is information-theoretically harmless and is allowed at all times).
- **Forbidden while `allPartnersRevealed == false` (would leak hidden membership):**
  - **Team point totals** (declarer-team aggregate or defender aggregate),
  - **Contract progress** keyed to a team (e.g. "declarer team: 78 / needs 90", "points remaining for the team"),
  - **Per-player score deltas** `roundDelta` (because defenders score 0, a nonzero delta *is* a membership tag) and `success`.
- **Permitted once `allPartnersRevealed == true`:** team point totals and team-keyed contract progress **MAY** be exposed — at that point membership is fully public and a client can derive them itself from per-seat points + known membership, so withholding them is unenforceable and pointless. This can occur mid-round (once the last called card is played) or at latest by round end.
- **`roundDelta` and `success` remain server-only until `ROUND_END`** regardless, because they depend on the final `declarerTeamPoints` which is not computed until `ROUND_SCORING` (§11–§12). They are first disclosed in the `ROUND_SCORED` event.

Internally, no team total exists as live state during play (§10, §14 data model): points live only as per-seat `capturedPoints[seat]`. `declarerTeamPoints`, `success`, and `roundDelta` are computed **only at `ROUND_SCORING`**. A client that wishes to *display* a team total after `allPartnersRevealed` derives it from the public per-seat totals; the server does not need to push a team field. This constraint is binding on `playerView` (below): it is the single choke point through which all client-visible data must pass.

**Required implementation concept — personalized player view.** Implementations MUST expose a pure function

```
playerView(authoritativeState, viewerSeat) -> ClientView
```

that returns only the information the viewer is permitted to see per the rules above. `ClientView` contains: `ownHand`, `handCounts[seat]`, public facts (bids, `Y`, declarer, trump — null for non-declarer viewers until `CALL_CARDS` is accepted (§9.2 disclosure gating) — and calledCards), `tricks` (current + completed), `perPlayerCapturedPoints[seat]` (public/derivable, permitted during play), and `revealedTeamMembers` (⊆ team; always includes `viewerSeat` if the viewer is a member, and always includes `declarerSeat` from acceptance of `CALL_CARDS` onward, §9.3). It MUST NOT contain other players' hands, unrevealed partner ownership, the shuffle seed, team point totals or team-keyed contract progress **while any partner is unrevealed** (permitted once `allPartnersRevealed`, above), or any pre-`ROUND_END` per-player `roundDelta`/`success`. The server sends only `playerView(...)` outputs to clients; the raw authoritative state never leaves the server. (The transport wrapper — `stateVersion` and delivery — is defined in `MESSAGE_PROTOCOL.md`; it carries no gameplay meaning.)

**Spectators are out of scope for v1.** `playerView` is defined only for a **seated** `viewerSeat`; no spectator/observer projection is specified in v1. Implementations that add spectators later MUST define a separate, hidden-information-safe view (it cannot simply reuse a seated view, and must never expose unrevealed membership).

---

## 15. Edge Cases & Clarifications

- **Declarer calls own card:** legal; declarer accrues the extra share (§9.2, §12).
- **Both called cards held by one player (6–7p):** that player accrues both called-card shares (§12.1).
- **Called cards are always played before scoring:** a completed round empties every hand (§10 Round completion guarantee), so a called card can never remain unplayed at scoring. Every partner is therefore revealed during play. (Team membership is still fundamentally determined by who *holds* the called card, but by round end that holder has always played it.)
- **Interrupted / resumed game:** the round cannot advance to `ROUND_SCORING` until all tricks are complete; a game interrupted mid-trick (crash, disconnect) resumes from its exact snapshot state (`ARCHITECTURE.md` §8). Note `PAUSED` itself can only be entered from the declarer-setup states (§9.4) — a mid-trick interruption is handled by snapshots and auto-play, never by `PAUSED`.
- **Trim never reaches 3s/4s (for 4–7 players):** the removal rule (§3) lists "2s, then 3s, then 4s" for generality, but the maximum removal across supported counts is 4 cards (6 players), so **only 2s are ever removed**; the 3s/4s clause is unreachable at 4–7 players and exists only to define behavior if the supported range is ever widened.
- **Void player:** may discard any card, including a point card, with no obligation to trump (§10).
- **Q♠ when Spades is trump:** Q♠ behaves as an ordinary trump of rank Q (below K♠ and A♠), and is still worth 30 points.
- **All-pass:** impossible by construction — the standing bid of 75 guarantees a declarer (§8).
- **Bid reaches 150:** bidding ends immediately (§8).
- **Comparing cards across suits:** only same-suit (or trump) comparisons matter; off-suit non-trump cards cannot win (§10).
- **Hand of only trump:** when on lead, the player leads trump (legal). When following a non-trump lead, the player is void and may play any card, i.e. a trump (§10). Always has a legal move.
- **Hand of one card (last trick):** the player plays it; it is legal because either it follows the led suit, or the player is void and any card is legal. Never a stuck state.
- **Illegal move attempt:** rejected deterministically per §8.5 / §9.2 / §10; the same actor is re-prompted; no state changes. **There is no forfeiture rule in v1.** Inactivity is handled by the turn timer: auto-pass in bidding (§8.6), auto-play the least-valuable legal card `(pointValue↑, rank↑, suit↑)` in trick play (§10), and `PAUSED` for trump/partner-calling (§9.4).
- **Maximum player count:** 7 is the supported maximum. The trim rule could produce even hands for 8 (remove four 2s → 48/8=6), but 8+ is **out of scope** for v1 and must be rejected at `LOBBY`.
- **Every point captured is credited:** captured points across all tricks always sum to 150; only the declarer team's captured total is compared to `Y` (§11).

---

## 16. Configurable Values (set at game start / implementation defaults)

These are intentionally left as configuration, not rules:

1. **`round1DefaultDeclarerSelection`** — how the round-1 default declarer is picked. Default: **random**. (Alternative: fixed seat.) Clockwise rotation thereafter is fixed (§7). **This is NOT the shuffle seed** — the shuffle seed is server-generated per round, never host-configurable, never exposed during play (§3.1).
2. **Number of rounds `N`** — default **`2 × playerCount`**; SHOULD be a multiple of `playerCount`; custom values allowed with a mandatory uneven-rotation warning (§13). **Validation (normative): `N` must be an integer with `1 ≤ N ≤ 10 × playerCount`; any other value is rejected at `LOBBY`.** (`N = 0` would produce a degenerate instant `GAME_END` in which every player "shares victory" at 0.)
3. **Turn timer** — per-turn time limit and grace period driving the timeout default actions (auto-pass §8.6 / auto-play §10 / `PAUSED` §9.4). Duration is configurable; the *default actions themselves are normative*, not configurable. **Validation (normative): the combined budget `turnTimerMs + graceMs` must be ≥ 10 000 ms**, and `reconnectGraceMs` must satisfy `1 000 ms ≤ reconnectGraceMs ≤ turnTimerMs + graceMs`; violating configs are rejected at `LOBBY` (a near-zero budget turns every declarer decision into an instant `PAUSED` and every turn into an auto-action). The combined budget is the **single** escalation clock — disconnects never start a competing timer (`ARCHITECTURE.md` §7). Timer mechanism: `ARCHITECTURE.md`.
4. **`seatAssignment`** — how players map to seats at game start (§2). Default: **random** (server-side, audited CSPRNG per `ARCHITECTURE.md` §5). Alternative: **host-arranged** (explicit, lobby-visible ordering). Join order is never used implicitly.
5. **Uneven-rotation warning visibility** — when `N mod playerCount ≠ 0`, the §13 warning **MUST be shown to every player** (e.g. in the lobby before ready-up), not only to the host who chose `N` — otherwise the person configuring the asymmetry is the only one warned about it.

**Removed / out of scope in v1:** secondary tie-breakers (ties are shared victories only, §13 — **decided v1.9: no tie-breaker will be added for casual play**; revisit only for ranked modes); post-game extension (`GAME_END` is terminal); spectator views (§14.2).

**Table talk (decided v1.9): out-of-band.** The client ships **no chat transport**; the rules neither forbid nor police verbal claims about hidden membership (truthful *or* false — bluffing "I hold the called card" is a legitimate social play). Groups self-police on their own channels. This stance is recorded in `OPEN_RISKS.md` D2 (resolved); revisit only if public matchmaking is added.

Remaining deferred decisions (kamikaze mitigation trigger) are tracked in `OPEN_RISKS.md`.

---

## 17. Changelog

- **v1.9** — Product-decision pass (all six open decisions resolved by product owner):
  - **Pause-end scoring (§9.4, §14.1) — scoring change, approved:** ending a `PAUSED` room (always caused by declarer-decision timeout; entry is exhaustive) scores the abandoned contract as a failure charged to the declarer alone: declarer `roundDelta = −(S×Y)`, all others `0` (no partner can exist yet — `PAUSED` precedes `CALL_CARDS`). Stalling is now strictly dominated by playing the contract; R9 closed. `ABORTED`-end unchanged (still voids — corruption is nobody's fault).
  - **Rotation skip (§7) — new rule, approved:** the default-declarer role skips seats with no connected client at any point during the preceding round (skip announced to all; all-abandoned fallback defined); removes the once-per-rotation hostage pause (D3 partially resolved — full forfeiture still out of scope).
  - **Table talk (§16):** out-of-band, decided (D2 resolved).
  - **D1/D4 resolved:** `PAUSED` (never auto-select) confirmed permanent; shared victory confirmed as the only tie rule.
  - **R1 kamikaze:** ships unmitigated; trigger (any observed deliberate use in playtests) and mitigation (asymmetric penalty: heavier declarer share on failed don't-hold calls) pre-agreed and recorded.
  - Companions: `ARCHITECTURE.md` v1.3 (round-connection tracking, pause-end scoring mechanism note), `MESSAGE_PROTOCOL.md` v1.3 (`HOST_END_GAME`/`HOST_RESOLVE_PAUSE` score-effect rows updated, `ROTATION_SKIPPED` event), `OPEN_RISKS.md` v1.3 (R9/D1/D2/D4 closed, D3 narrowed, R1 decision recorded), `TEST_CASES.md` (PAUSE-001 updated; ROT-001 added).
- **v1.8** — Adversarial-review gap closure (**no core-mechanic change**):
  - **State machine (§14.1):** `TRICK_RESOLVE` reworded to per-seat crediting (`capturedPoints[winnerSeat]`); the former "credit points to winner's team" contradicted the §10/§14.2 no-live-team-total rule.
  - **Trump disclosure gated (§9.2, §14.2):** trump is declarer-only until `CALL_CARDS` is accepted; non-declarer clients see `TRUMP_SELECTION`/`CALLING_PARTNERS` as one indistinguishable `DECLARER_SETUP` phase (closing the phase-transition timing side channel; `MESSAGE_PROTOCOL.md` §3/§5.3 aligned).
  - **`PAUSED` entries exhaustive (§9.4, §14.1):** only declarer-decision timeouts pause; disconnects elsewhere auto-resolve; the undefined "operator hold" is removed (it combined with `PAUSED`-end voiding into an end-when-ahead exploit; `ARCHITECTURE.md` §7 aligned).
  - **Reveal semantics pinned (§9.3, §14.2):** `revealedTeamMembers` seeded with `declarerSeat` at `CALL_CARDS`; `PARTNER_REVEALED` fires per called-card play (incl. a declarer's own); `allPartnersRevealed` ≡ all `C` called cards played.
  - **Config validation (§13, §16):** `N` integer in `[1, 10 × playerCount]`; `turnTimerMs + graceMs ≥ 10 s`; uneven-rotation warning must be visible to all players.
  - **Standings (§13):** standard competition ranking for ties below first. **Data model (§14):** added `bidHistory` and `completedTricks` (required by `ClientView`). **§10:** documented the deterministic auto-play inference effect as known/accepted.
  - **Mechanism addition:** `CHOOSE_TRUMP` is staged without a `stateVersion` bump and applied atomically with `CALL_CARDS` (§9.2), closing the version-jump side channel that would otherwise disclose the declarer-setup sub-state during a pause.
  - Companion docs: `ARCHITECTURE.md` v1.2 (no operator hold, host migration skips the awaited actor, pinned round-1 selection RNG + audit), `MESSAGE_PROTOCOL.md` v1.2 (pinned `Card` wire encoding, `DECLARER_SETUP` wire phase, end-path equivalence note), `OPEN_RISKS.md` (player-timing covert channel, blameless-AFK, end-when-ahead closure note), `TEST_CASES.md` (§9 gap-closure tests: PHASE-001/002, ENC-001, CFG-003, MIG-001, ENDEQ-001, RANK-001; REVEAL-002/HID-001 updated to v1.8 declarer-reveal semantics; KAT-001 independently re-verified).
- **v1.7** — Pre-implementation hardening (no gameplay-rule change).
  - **Point attribution:** points accumulate **per seat** (`capturedPoints[seat]`); no team total exists as live state; `declarerTeamPoints`/`success`/`roundDelta` derived **only at `ROUND_SCORING`** (§10–§12, §14).
  - **Auto-play ordering fixed (§10, §14.1):** an AFK/timeout play now selects the **least-valuable** legal card by `(pointValue↑, rank↑, suit↑)` — the previous suit-major "canonical" rule shed point cards (e.g. `A♣` before `2♦`) and made inactive seats donate points.
  - **`PAUSED`-end scoring defined (§9.4, §14.1):** host-ending a paused game applies no `roundDelta` for the in-progress round; standings from the last completed round (same as `ABORTED`-end).
  - **`ABORTED` round-restart no longer replays the deal (§14.1):** a restart re-deals with a **fresh `shuffleSeed`** (same round/declarer); prior hands are never reused.
  - **Determinism pinned (§3.1):** reproducibility tuple corrected to `(playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed)`; full PRNG/shuffle byte-level spec + known-answer vector live in `ARCHITECTURE.md` §5 / `TEST_CASES.md` §7.
  - **Team-total visibility reconciled (§14.2):** team totals/contract-progress are gated on `allPartnersRevealed` (permitted once all partners are revealed, forbidden before), while `roundDelta`/`success` stay server-only until `ROUND_END`. Cross-document terminology aligned. Companion docs updated: `ARCHITECTURE.md` (snapshot-after-every-action, deterministic message timing, pinned PRNG, fresh-seed restart, grace timing), `MESSAGE_PROTOCOL.md` (strict client apply-order, trump-withholding, `HOST_END_GAME` allowed states), `OPEN_RISKS.md` (stall-escape, hostage loop, host-SPOF), `TEST_CASES.md` (full suite + KAT vector).
- **v1.6** — External-review correction pass, applied conservatively.
  - **Dealing (§3.1):** pinned a fully reproducible pipeline — canonical deck order, server-only per-round shuffle seed (not host-configurable/visible, distinct from the round-1 selection value), named seeded PRNG (ChaCha20) + Fisher–Yates, and a normative round-robin clockwise deal starting at the default declarer; deleted the false "deal order does not affect the resulting state." **LOBBY seed disambiguation (§14.1, §16):** host sets `round1DefaultDeclarerSelection` and the turn timer, never the shuffle seed.
  - **Liveness (§8.6, §9.4, §10, §14.1):** added configurable turn-timer default actions — bidding auto-pass, trick auto-play lowest legal card by canonical order; trump/partner-calling do NOT auto-select but enter `PAUSED` after grace.
  - **`ABORTED`/`PAUSED` states (§14.1):** added; abort applies no round score deltas and never auto-advances; host ends game or restarts round from a valid snapshot.
  - **Point-leak rule corrected (§14.2):** per-player captured points are public/derivable and now permitted during play; only unrevealed-partner-attributed aggregations (team totals, contract progress, per-player deltas) stay hidden until `ROUND_END`.
  - **Game length (§13):** `N` defaults to `2 × playerCount`, SHOULD be a multiple of `playerCount`, custom allowed with a mandatory uneven-rotation warning.
  - **Ties (§13):** shared victory only; all undefined tie-breakers removed.
  - **Extension:** out of scope; `GAME_END` terminal.
  - **Spectators:** out of scope; `playerView` seated-only.
  - **Consistency:** unified `revealedTeamMembers` naming, defined `Player.roundScore` lifecycle, noted the unreachable 3s/4s trim clause, noted trump+call broadcast-together timing.
  - **Scope split:** concurrency/versioning/reconnection/timeout-mechanism/rejection-delivery/snapshots moved to `ARCHITECTURE.md` and `MESSAGE_PROTOCOL.md`; known strategic/griefing risks and deferred decisions in `OPEN_RISKS.md`.
- **v1.5** — Added the concise normative bidding turn-safety invariant list (§8.3.1): evaluate termination after every accepted action before assigning a turn; end immediately when one non-passed player remains; never place the high bidder on turn; never bid against oneself; never leave an on-turn player with zero legal actions. Added `TEST_CASES.md` with the required bidding regression tests (BID-001 escalation scenario and BID-002 all-pass-vs-standing-75 variant).
- **v1.4** — Safety-hardening pass (no gameplay change). §8.2: added the normative turn-scheduler invariant (never place the current high bidder on turn) plus an explicit exactly-one-legal-actor / no-deadlock / always-terminates proof. §14.2: added the normative no-point-leak rule prohibiting exposure of team totals, per-player captured points, or any membership-revealing aggregation during play (server-side only until `ROUND_END`). §10: added the defensive card-uniqueness / tie-safety guard (unique deck ⇒ no rank ties ⇒ single winner; duplicate-card state is undefined and SHOULD be treated as a fatal error).
- **v1.3** — Final correction pass. Removed "left" as a direction throughout — turn order is expressed only **clockwise** (bidding begins with the player immediately clockwise from the default declarer, §8.3). Made partner reveal **atomic with the accepted card play** and broadcast before the next player in the trick acts; `TRICK_RESOLVE` performs no reveals (§9.3, §10, §14.1). Guaranteed **every card is played before round scoring** and that `ROUND_SCORING` cannot be entered until all tricks are complete; removed the obsolete "called card never played" edge case; interrupted games are resumable (§10, §11, §15). Added **§14.2 Information Visibility** with own-hand-only visibility, card-count-only for other hands, public called-card identities with private holders, no pre-round-end per-player deltas, server-only seed/state, and a required `playerView(state, viewerSeat)` projection function.
- **v1.2** — Locked two design decisions as intended (not gaps): defenders score 0 (rationale added in §12 — per-round status, cumulative-score incentive), and the partnerless "secret solo" via calling one's own card is legal and intended (§9.2).
- **v1.1** — Engine-audit determinism pass. Added §3.1 dealing (seeded server-authoritative shuffle). Rewrote §8 bidding to remove the default-declarer "pass" contradiction (the high bidder is never on turn and never passes; the standing 75 is binding), and added explicit multi-lap turn order, auction-end evaluation order, and invalid-action handling. Made called-card identities explicitly public with only holders hidden (§9.2); specified immediate on-play reveal and reveal-at-scoring (§9.3). Added led-suit definition, last-trick clause, and full play-validation predicate (§10). Added 4- and 7-player worked scoring examples (§12.1). Added §14.1 state machine and expanded edge cases (only-trump hand, one-card hand, illegal-move handling, max player count).
- **v1.0** — Resolved all draft ambiguities: deck trimming (low non-point cards only, deterministic suit order), 4–7 player support, called-card count by player size, default-declarer bidding model with clockwise rotation, trump-then-call order, in-play-only called cards (declarer may call own), on-play partner reveal, full trick-play rules (no forced trump, free trump leads, unrestricted point cards), share-based scoring with defenders scoring 0, fixed-`N` game length. Added developer data model, worked examples, and edge cases.
