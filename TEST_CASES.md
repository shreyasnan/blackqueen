# Black Queen — Test Cases

Regression tests for the game engine. Each test lists a **deterministic setup**, an **exact action sequence**, and **explicit assertions** that MUST hold. A build that fails any REQUIRED test is not spec-compliant.

Spec references: `GAME_SPEC.md` v2.0 (bidding §8; trump/call §9; trick play §10; result §11; scoring §12; state machine §14.1; visibility §14.2). Protocol references: `MESSAGE_PROTOCOL.md` v1.5. Architecture references: `ARCHITECTURE.md` v1.5.

**Card notation:** `<rank><suit>`, suits `♣ ♦ ♥ ♠`, ranks `2..10,J,Q,K,A`. **Canonical order** (deck ordering / dealing, §3.1): suit `♣<♦<♥<♠`, then rank `2<…<A`. **Auto-play order** (timeout, §10) is different: `(pointValue↑, rank↑, suit↑)`. Seats are `0..n−1` clockwise.

---

## 1. Bidding — turn safety

### BID-001 — Escalation, defender outbid then default declarer reclaims
**Setup:** 4 players `Alice(0), Bob(1), Carol(2), Dave(3)`. Default declarer `Alice` → high bidder at binding **75** (§8.1). First on turn: `Bob` (§8.3).

| Step | On turn | Action | `currentHighBidderSeat`/`currentHighBid` | `activeSeats` after |
|--|--|--|--|--|
| 0 | — | initial | Alice / 75 | {Alice,Bob,Carol,Dave} |
| 1 | Bob | bid 80 | Bob / 80 | {Alice,Bob,Carol,Dave} |
| 2 | Carol | pass | Bob / 80 | {Alice,Bob,Dave} |
| 3 | Dave | pass | Bob / 80 | {Alice,Bob} |
| 4 | Alice | bid 85 | Alice / 85 | {Alice,Bob} |
| 5 | Bob | pass | Alice / 85 | {Alice} |

**Assertions:** (1) Alice starts high bidder at 75. (2) Bob's 80 accepted. (3) Carol/Dave passes permanent. (4) Alice's 85 accepted. (5) After Bob's pass, auction **ends immediately** (§8.3.1). (6) `Alice` final declarer, `Y==85`. (7) Alice never placed on turn again. (8) `activeSeats=={Alice}`. (9) `currentHighBidderSeat==Alice`. (10) Transition `BIDDING → TRUMP_SELECTION`. (11) No self-raise, no empty `activeSeats`, no zero-legal-action state.

### BID-002 — All others pass against standing 75
**Setup:** as BID-001. Sequence: Bob pass, Carol pass, Dave pass.
**Assertions:** After Dave's pass exactly one non-passed remains → auction ends. `Alice` declarer at `Y==75`. Alice never on turn. `activeSeats=={Alice}`. "All passed ⇒ no declarer" is **forbidden** (§8.1).

### BID-003 — 150 ends the auction immediately
**Setup:** as BID-001. Sequence: Bob bid 80, Carol bid 150.
**Assertions:** (1) Carol's 150 accepted. (2) Auction **ends immediately** on the 150 bid (§8.4(1)) — Dave and Alice are **not** placed on turn. (3) `Carol` final declarer, `Y==150`. (4) Transition straight to `TRUMP_SELECTION`. (5) No further bid is accepted this round.

### BID-004 — Multi-lap escalation (player on turn more than once)
**Setup:** as BID-001. Sequence: Bob 80, Carol 85, Dave 90, Alice 95, Bob 100, Carol pass, Dave pass, Alice pass.
**Assertions:** (1) Bidding loops past the first lap; **Bob and Alice are each placed on turn twice** (§8.3). (2) Every accepted bid is a strictly-greater multiple of 5. (3) After Alice's final pass only Bob remains non-passed → auction ends. (4) `Bob` declarer, `Y==100`. (5) Bob is never asked to bid against himself; when it would return to Bob as high bidder the auction has already ended (§8.3.1).

---

## 2. Trick play

### TRICK-001 — Follow-suit enforcement
**Setup:** trump `♠`. Trick led by seat0 with `9♥` → led suit `♥`. On turn: seat1, hand `{K♥, 3♣, 7♦}` (holds a ♥).
**Sequence:** seat1 attempts `3♣` → then attempts `K♥`.
**Assertions:** (1) `3♣` is **rejected** (`ILLEGAL`, follow-suit violation, §10) — no state change, no `stateVersion` bump, reject delivered privately (`MESSAGE_PROTOCOL.md` §4). (2) `K♥` is **accepted**. (3) Only legal plays for seat1 were `{K♥}` (the only ♥ held).

### TRICK-002 — Void: any card allowed, no forced trump
**Setup:** trump `♠`. Led suit `♥` (seat0 played `9♥`). On turn: seat1, hand `{A♣, 2♦, 7♠}` (no ♥).
**Assertions:** (1) seat1 is void in ♥, so the legal set is the **entire hand** `{A♣, 2♦, 7♠}`. (2) Playing the discard `2♦` is **accepted**. (3) Playing the trump `7♠` would **also** be legal (no obligation to trump when void, §10). (4) There is no rule forcing `7♠`.

### TRICK-003 — Trump beats non-trump regardless of rank
**Setup:** 4 players, trump `♠`. Full trick in play order: seat0 `K♥` (leads, led=♥), seat1 `A♥`, seat2 `2♠` (void in ♥), seat3 `3♥`.
**Assertions:** (1) Winner = **seat2** with `2♠` — the lone trump beats `A♥` even though 2 < A (§10 winning rule 1). (2) `A♥` does not win despite being the highest led-suit card. (3) `capturedPoints[seat2] += 15` (the `A♥` point card is in the trick; Q♠/A/10/5 values credited per §10 — here `A♥`=15). (4) seat2 leads the next trick.

### TRICK-004 — Highest trump wins among multiple trumps
**Setup:** 4 players, trump `♠`. Trick in play order: seat0 `4♦` (leads, led=♦), seat1 `9♠` (void ♦), seat2 `J♠` (void ♦), seat3 `5♦`.
**Assertions:** (1) Two trumps played; winner = **seat2** with `J♠` (J > 9, §10 rule 1 + card-uniqueness tie safety). (2) `5♦` (led suit) cannot beat any trump. (3) No rank tie occurs (unique deck, §10). (4) `capturedPoints[seat2] += 5` (the `5♦` point card).

---

## 3. Reveal timing

### REVEAL-001 — Called card played mid-trick reveals before next player acts
**Setup:** 4 players, `C=1`. Declarer seat0, trump `♥`, called card `A♠`. Holder of `A♠` = **seat2** (unrevealed at trick start). Trick led by seat0; play order seat0, seat1, seat2, seat3.
**Sequence:** seat0 plays `x`; seat1 plays `y`; seat2 plays `A♠` (the called card); seat3 then plays.
**Assertions:** (1) The instant seat2's `A♠` play is **accepted**, `revealedTeamMembers` gains seat2 as part of the same atomic action (§9.3, §10 accepted-play steps). (2) On the wire, `PARTNER_REVEALED(seat2)` has a `seq` strictly **before** the `ViewUpdate`/turn-assignment placing seat3 on turn (`MESSAGE_PROTOCOL.md` §5.3). (3) seat3's `ClientView.revealedTeamMembers` **includes seat2 before seat3 acts**. (4) The reveal is **not** deferred to `TRICK_RESOLVE` (which performs no reveals). (5) Before seat2's play, no view **other than seat2's own** listed seat2 as a member (a viewer always sees their own membership, §14.2); every view already listed seat0 (declarer, seeded at `CALL_CARDS`, §9.3).

### REVEAL-002 — Declarer's own called card reveals on play
**Setup:** 4 players, `C=1`. Declarer seat0 **calls a card they hold** (`K♠`), trump `♥` (secret solo, §9.2). Nobody else is a member.
**Assertions (v1.8 semantics, §9.3):** (1) From acceptance of `CALL_CARDS` onward, `revealedTeamMembers == {seat0}` in **every** view — the declarer's role membership is public from the auction and is seeded into the set; it is never "unrevealed." (2) No view attributes the *called card* to anyone before it is played. (3) When seat0 plays `K♠`, `PARTNER_REVEALED(seat0)` fires atomically, before the next turn — it discloses that the called card is accounted for (this is what flips `allPartnersRevealed`), not new membership. (4) `allPartnersRevealed` is `false` before that play and `true` after. (5) No other reveal ever occurs this round.

---

## 4. Scoring (all share distributions, 4–7 players, success & failure)

Scoring is a pure function of `(playerCount, Y, declarerSeat, calledCard holders, per-seat capturedPoints)`. Each test states the captured team total as precondition; assert `success`, per-seat `roundDelta`, and that **defenders are exactly 0**. `S = C+1`; each share scores `±Y` (§12).

### SCORE-4A — 4p, distinct partner, success
`C=1,S=2`, `Y=85`, declarer seat0, `A♠` held by seat2. `declarerTeamPoints=90` (≥85).
**Assert:** `success=true`; `roundDelta`: seat0 `+85`, seat2 `+85`, seat1 `0`, seat3 `0`; team total `+170`; each delta added to `totalScore`.

### SCORE-4B — 4p, distinct partner, failure
As 4A but `declarerTeamPoints=70` (<85).
**Assert:** `success=false`; seat0 `−85`, seat2 `−85`, defenders `0`; team total `−170`.

### SCORE-4C — 4p, secret solo
`C=1,S=2`, `Y=100`, declarer seat0 **holds** the called card (`shareCount(seat0)=2`).
**Assert:** success (`points≥100`) → seat0 `+200`, all others `0`; failure (`points<100`) → seat0 `−200`, others `0`.

### SCORE-5 — 5p, partner vs solo
`C=1,S=2`, `Y=90`.
- **Partner:** declarer seat0, `10♥` held by seat3, `points=95` → seat0 `+90`, seat3 `+90`, seats1,2,4 `0`.
- **Solo:** declarer seat0 holds the called card → success → seat0 `+180` alone.

### SCORE-6 — 6p, all partner combinations, `Y=100`, `C=2,S=3`
- **Two distinct partners** (seat2, seat4), `points=110` → seat0 `+100`, seat2 `+100`, seat4 `+100`; seats1,3,5 `0`; total `+300`.
- **One player holds both** called cards (seat2, `shareCount=2`) → seat0 `+100`, seat2 `+200`; others `0`; total `+300`.
- **Declarer holds one, seat3 the other** → seat0 `+200` (`shareCount=2`), seat3 `+100`; others `0`; total `+300`.
- **Failure** (`points<100`) mirrors with negatives; defenders always `0`.

### SCORE-7 — 7p, `Y=120`, `C=2,S=3`
- **Two distinct partners** (seat2, seat5), success → seat0 `+120`, seat2 `+120`, seat5 `+120`; four defenders `0`; total `+360`.
- **Secret solo** (declarer holds both) → seat0 `±360` alone.

### SCORE-EDGE — exact-bid boundary
`Y=90`, `declarerTeamPoints=90` → `success=true` (≥ is inclusive, §11). `declarerTeamPoints=89` → `success=false`.

---

## 5. Hidden information

### HID-001 — View never exposes unrevealed partners
**Setup:** 6 players, `C=2`, called cards `{K♦, Q♥}` held by seat2 (`K♦`) and seat4 (`Q♥`), both unrevealed; declarer seat0.
**Assert (before any called card is played, v1.8 semantics §9.3/§14.2):** (1) for every **non-holder** viewer (declarer seat0, defenders seat1/3/5): `ClientView.revealedTeamMembers == {seat0}` — the declarer only (public role membership, seeded at `CALL_CARDS`). For the holders' own views: seat2 sees `{seat0, seat2}`, seat4 sees `{seat0, seat4}` (a viewer always sees their own membership). **No view shows another unrevealed holder.** (2) No field reveals seat2/seat4 membership to anyone else. (3) `handCounts[*]` are present and **equal** across all still-active players (they carry no info). (4) `ownHand` present only for the viewer; no other hand contents appear.

### HID-002 — No team aggregation during play; per-seat points allowed
**Setup:** mid-round, several tricks played, at least one partner still unrevealed.
**Assert:** every `playerView` (a) **contains** `perPlayerCapturedPoints[seat]` for all seats (public/derivable), and (b) **does not contain** any team total, defender aggregate, team-keyed contract progress ("needs X"), `roundDelta`, or `success` — none exist as state before `ROUND_SCORING` (§10, §14.2). Assert the first message ever carrying `roundDelta`/`success`/team totals is `ROUND_SCORED` at `ROUND_END`.

### HID-003 — Rejections are private, no covert channel
**Setup:** any state with an on-turn player.
**Assert:** an illegal action produces a `Reject` delivered **only to the acting client**; no other client receives any message; `stateVersion` unchanged; rate-limited per `MESSAGE_PROTOCOL.md` §4. No table-visible signal (content, ordering, or timing) results (`ARCHITECTURE.md` §6a).

---

## 6. Timeout behavior

### TO-001 — Bidding timeout → auto-pass
**Setup:** mid-auction; on-turn player seat2 (not the high bidder) exceeds the turn timer.
**Assert:** engine applies an **auto-pass** for seat2 (always legal, §8.6); seat2 removed from `activeSeats` permanently; a server `actionId` is attached; `stateVersion` bumps; auction proceeds/terminates normally. The high bidder is never auto-passed (never on turn).

### TO-002 — Trick timeout → auto-play **least-valuable** legal card `(pointValue↑, rank↑, suit↑)`
Ordering is **point-value-major** (§10) so an AFK seat never sheds a point card while a zero-value legal card exists.
- **Must-follow case:** trump `♠`, led `♥`; on-turn hand `{Q♥, 5♥, 2♣, A♠}`. Legal = `{Q♥, 5♥}`. Point values: `Q♥=0`, `5♥=5`. Auto-play = **`Q♥`** (lower point value wins; **not** `5♥`). Assert `Q♥` played.
- **Void, point-vs-nonpoint (the bug-fix case):** led `♥`; hand `{A♣, 2♦}` (no ♥). Point values: `A♣=15`, `2♦=0`. Auto-play = **`2♦`**. The old suit-major rule would have wrongly played `A♣` (`♣<♦`), donating 15 points — assert `A♣` is **NOT** chosen.
- **Void, tie-break by rank then suit:** led `♥`; hand `{A♣, 2♣, 10♦}`. Values `15/0/10` → min value is `2♣` (0). Auto-play = **`2♣`**.
- Assert the auto-played card runs the accepted-play atomic steps (including reveal if it is a called card).

### TO-003 — Trump/partner timeout → PAUSED (no auto-select)
**Setup:** declarer on turn in `TRUMP_SELECTION` (and separately `CALLING_PARTNERS`) exceeds the timer + grace.
**Assert:** (1) the engine **does not** fabricate a trump suit or called card (§9.4). (2) The room transitions to **`PAUSED`** after the combined `turnTimerMs + graceMs` budget. (3) On resume, control returns to the same *game* state and same declarer — with a **new** `stateVersion` (`PAUSED` entry and resume each bump normally, `ARCHITECTURE.md` §2) and a fresh turn budget. (4) No gameplay value was invented.

---

## 7. Multi-player configuration

### CONFIG-001 — Deck, shares per player count (§3, §9.2, §12)
Assert exactly:

| Players | deckSize | perPlayer | removed cards | `C` | `S` |
|--|--|--|--|--|--|
| 4 | 52 | 13 | (none) | 1 | 2 |
| 5 | 50 | 10 | `2♣, 2♦` | 1 | 2 |
| 6 | 48 | 8 | `2♣, 2♦, 2♥, 2♠` | 2 | 3 |
| 7 | 49 | 7 | `2♣, 2♦, 2♥` | 2 | 3 |

Also assert: all 13 point cards (4×A, 4×10, 4×5, Q♠) are present for **every** count (150 total), and the canonical deck order + round-robin deal from a fixed `shuffleSeed` reproduces identical hands across runs/implementations (§3.1).

### CONFIG-002 — Game-length fairness warning (§13)
**Assert:** default `N == 2 × playerCount`. For a custom `N` with `N mod playerCount != 0` (e.g. 5 players, `N=12`), the engine surfaces the **uneven-rotation warning**; for `N mod playerCount == 0` it does not. Tie at final standings → **shared victory** (co-winners), no secondary tie-breaker.

### KAT-001 — Known-answer deal vector (REQUIRED conformance) (§3.1, `ARCHITECTURE.md` §5)
Locks the entire deterministic dealing pipeline (canonical deck, ChaCha20 keying, LE `uint32` draws, rejection sampling, descending Fisher–Yates, round-robin deal). **Any** conforming implementation MUST reproduce these hands exactly.

**Inputs:**
- `playerCount = 4`, `defaultDeclarerSeat = 0`, seating order = seats `0,1,2,3` clockwise.
- `shuffleSeed` = the 32 bytes `00 01 02 03 … 1e 1f` (i.e. byte `i` = `i`).
- ChaCha20 nonce = 12 zero bytes, initial counter = 0 (`ARCHITECTURE.md` §5).

**Expected hands (exact):**

| Seat | 13 cards (deal order) |
|--|--|
| 0 | `3♥ 2♦ 9♣ Q♥ 5♦ A♠ A♦ 7♦ 4♠ Q♦ 3♠ 4♣ 2♠` |
| 1 | `7♣ 8♣ J♠ A♥ 9♠ 10♦ 8♦ 6♣ 9♥ 10♣ Q♠ 10♥ K♥` |
| 2 | `6♦ 7♠ 6♠ 8♠ 3♦ Q♣ J♣ 5♠ 5♣ K♠ 8♥ J♦ J♥` |
| 3 | `A♣ K♣ 6♥ 2♣ 4♥ 7♥ 10♠ K♦ 9♦ 5♥ 4♦ 2♥ 3♣` |

**Assertions:** (1) each seat's hand matches exactly (order-independent set equality is sufficient, but deal order is as shown). (2) Union is all 52 cards, no duplicates. (3) All 13 point cards present (150 total). (4) Re-running with the same inputs yields byte-identical hands. (5) Changing **only** `defaultDeclarerSeat` (e.g. to 1) rotates which seat receives each dealt card — confirming the deal depends on the full tuple `(playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed)`, not the seed alone.

---

## 8. Recovery (snapshot exactness)

### REC-001 — Mid-trick crash restores exact state
**Setup:** a trick with 2 of 4 cards played (including one that fired a `PARTNER_REVEALED`); simulate a crash; restore from the latest snapshot (`ARCHITECTURE.md` §8).
**Assert:** (1) restored `currentTrick.plays` contains exactly the 2 played cards in order; (2) the already-revealed partner remains in `revealedTeamMembers`; (3) the on-turn seat is the 3rd player; (4) per-seat `capturedPoints` and all `totalScore`s match pre-crash; (5) no card is lost or double-counted; (6) play resumes with no ambiguity.

### REC-002 — ABORTED applies no score deltas; restart re-deals fresh
**Setup:** force the §10 duplicate-card fatal guard mid-round (round `r`, some `totalScore`s already accrued from rounds `< r`).
**Assert:** (1) transition to `ABORTED`; (2) **no** `roundDelta` applied for round `r`; (3) no auto-advance; (4) last valid snapshot + diagnostic log (incl. `shuffleSeed`) preserved; (5) host **end** → `GAME_END`, standings from `totalScore` as of round `r−1`; (6) host **restart** → new `DEALING` for the **same `roundNumber` r and same `defaultDeclarerSeat`** with a **fresh `shuffleSeed`**; the restarted hands MUST differ from the aborted deal (prior hands never reused) (`ARCHITECTURE.md` §8).

### PAUSE-001 — Ending from PAUSED scores the abandoned contract as a declarer-only failure (v1.9)
**Setup:** 4 players (`C=1, S=2`), declarer seat2 at `Y=85`, prior `totalScore`s nonzero from earlier rounds. Declarer times out in `TRUMP_SELECTION` → room enters `PAUSED` (§9.4); host issues `HOST_RESOLVE_PAUSE {action:"end"}`.
**Assert:** (1) transition `PAUSED → GAME_END`. (2) `roundDelta`: **seat2 `−170`** (`−(S×Y) = −(2×85)`), every other seat **`0`** — no partner can exist (no `CALL_CARDS` was accepted). (3) Final standings from all `totalScore`s **including** this delta. (3a) Contrast case: the same end from **`ABORTED`** still applies **no** delta (REC-002 unchanged). (4) `HOST_END_GAME`/end is accepted **only** from `PAUSED` or `ABORTED` — the same request in an active state (e.g. `TRICK_FOLLOW`) is **rejected** (`MESSAGE_PROTOCOL.md` §2). (5) `HOST_RESOLVE_PAUSE {action:"resume"}` instead returns to `TRUMP_SELECTION` with no score effect and a fresh turn budget (`ARCHITECTURE.md` §6).

---

## 9. v1.8 gap-closure tests

### PHASE-001 — Declarer-setup phase collapse & trump gating (REQUIRED)
**Setup:** 4 players, auction ends, declarer seat0. Observe all four clients' message streams through `CHOOSE_TRUMP` and `CALL_CARDS`.
**Assert:** (1) After `CHOOSE_TRUMP(♥)` is accepted: **no message of any kind** is emitted to seats 1–3 (no `Event`, no `ViewUpdate`, no `stateVersion` change anywhere in the room — staged apply, `ARCHITECTURE.md` §2). (2) Seats 1–3 report wire phase **`DECLARER_SETUP`** for the entire trump+call window and can never observe the internal `TRUMP_SELECTION → CALLING_PARTNERS` transition. (3) `ClientView.trump` is `null` for seats 1–3 until `CALL_CARDS` is accepted; the declarer's own view/echo shows `♥`. (4) On `CALL_CARDS` acceptance: exactly one versioned transition; `TRUMP_CHOSEN` then `CARDS_CALLED` at consecutive `seq`; all views now show trump + called cards. (5) From this instant, `revealedTeamMembers == {seat0}` in every view **except** an unrevealed called-card holder's own view, which additionally contains that holder's own seat (§14.2).

### PHASE-002 — Pause during setup does not disclose sub-state (REQUIRED)
**Setup:** run twice: (a) declarer times out in `TRUMP_SELECTION`; (b) declarer chooses trump, then times out in `CALLING_PARTNERS`.
**Assert:** the message streams received by seats 1–3 in (a) and (b) are **indistinguishable** — same phase (`DECLARER_SETUP`→`PAUSED`), same `stateVersion` values, same event kinds. In particular (b)'s accepted `CHOOSE_TRUMP` caused no version bump, so the `PAUSED` notification carries the same version in both runs. On resume of (b), the staged trump is still held (snapshot round-trip, `ARCHITECTURE.md` §8).

### ENC-001 — Card wire encoding (`MESSAGE_PROTOCOL.md` §2.1)
**Assert:** every `Card` on the wire (payloads, `ClientView`, `Event.data`) serializes as `{suit: "C"|"D"|"H"|"S", rank: "2"..."10"|"J"|"Q"|"K"|"A"}`; ten is `"10"` not `"T"`; unicode glyphs are rejected in inbound payloads (`ILLEGAL`).

### CFG-003 — LOBBY validation bounds (`GAME_SPEC.md` §16)
**Assert:** (1) `N = 0`, `N = -1`, `N = 3.5`, and `N = 10 × playerCount + 1` are each **rejected at `LOBBY`**; `N = 1` and `N = 10 × playerCount` are accepted (with the uneven-rotation warning where applicable). (2) A config with `turnTimerMs + graceMs < 10 000` is rejected. (3) When `N mod playerCount ≠ 0`, the warning is delivered to **every** player's client, not only the host's. (4) 8+ players rejected at `LOBBY` (§15).

### MIG-001 — Host migration excludes the awaited actor (`ARCHITECTURE.md` §8a)
**Setup:** 4 players; declarer **seat0 is also the host** and stalls into `PAUSED`; seat0 stays connected but the host-disconnect path is exercised by disconnecting seat0's socket past `reconnectGraceMs`; seats 1–3 connected.
**Assert:** host authority migrates to **seat1** (lowest-seat connected **excluding seat0**, the awaited actor). Variant: only seat0 connected → **no migration occurs**; room stays frozen. The awaited actor can never acquire the authority to adjudicate their own stall.

### ENDEQ-001 — End-path equivalence (`MESSAGE_PROTOCOL.md` §2)
**Setup:** identical `PAUSED` state, two runs: run A issues `HOST_END_GAME {}`, run B issues `HOST_RESOLVE_PAUSE {action:"end"}`.
**Assert:** both runs produce identical state transitions, identical final standings, and identical event sequences (ending `GAME_ENDED`), byte-for-byte apart from `actionId`.

### RANK-001 — Competition ranking below first (`GAME_SPEC.md` §13)
**Setup:** final `totalScore`s: seatA 300, seatB 300, seatC 150, seatD 150, seatE −75.
**Assert:** standings are A=1, B=1 (co-winners), C=3, D=3, E=5 ("1224" standard competition ranking — no rank 2 or 4 exists).

### ROT-001 — Rotation skips fully-abandoned seats (v1.9, `GAME_SPEC.md` §7)
**Setup:** 5 players. Seat3's client disconnects during round 2 and never reconnects. Rotation would make seat3 the default declarer in round 4 (say).
**Assert:** (1) `wasConnectedThisRound[seat3] == false` for round 3 (`ARCHITECTURE.md` §7). (2) At round 4's `ROUND_START`, the default-declarer role **skips seat3** to seat4; `ROTATION_SKIPPED { skippedSeats:[3], newDefaultDeclarerSeat:4 }` is broadcast. (3) Seat3 still receives a hand and is auto-played per §10. (4) If seat3 reconnects at any instant during round 4, `wasConnectedThisRound[seat3] == true` → seat3 is **eligible again** for the next rotation pass. (5) All-abandoned fallback: if every seat is abandoned, no skip occurs (normal rotation; the room will pause at the declarer decision).

---

## 10. Platform layer (`PLATFORM_SPEC.md` v1.0)

### PLAT-001 — Seat binding is the view-security anchor (REQUIRED)
**Setup:** game `IN_GAME`; account X bound to seat0, account Y bound to seat1. Y opens a second socket and sends `ReconnectRequest { roomId, playerId: X's accountId, … }`.
**Assert:** (1) rejected and logged — `playerId` must match the socket session's `accountId` (§2.2). (2) At no point is any `playerView(state, seat0)` payload ever written to a socket not authenticated as X (§3.4). (3) A second socket from X for the same room **supersedes** the first (old socket closed with the "superseded" code); the game continues without engine involvement.

### PLAT-002 — Invite codes are not enumerable
**Assert:** (1) failed joins return one uniform error for never-existed, expired, full, and in-game codes. (2) The 11th failed attempt in a minute from one account is rate-limited. (3) Host code-regeneration in `OPEN` invalidates the old code on the very next attempt. (4) Join attempt on an `IN_GAME` or `ENDED` room fails uniformly.

### PLAT-003 — Ephemeral teardown
**Setup:** game reaches `GAME_END` at time T.
**Assert:** (1) bound accounts can view final standings until T + `endedRoomTtlMin`. (2) After teardown, the room, seats, membership, and code resolve to the uniform not-found error for **everyone**, including former members. (3) The ops audit log (`ARCHITECTURE.md` §5) still contains the round records, keyed by `accountId` only. (4) An unstarted `OPEN` room is destroyed at `lobbyIdleTimeoutMin`.

---

## 11. v2.0 — Two-deck mode (`GAME_SPEC.md` v2.0)

### CONFIG-004 — 2-deck trim, points, bid range (REQUIRED)
Assert exactly: 6p/2-deck → 102 cards, 17 each, removed {2♣ ×1, 2♦ ×1}; 7p/2-deck → 98 cards, 14 each, removed {2♣ ×2, 2♦ ×2, 2♥ ×1, 2♠ ×1}. All 26 point cards present (two Q♠) → 300 total. Standing bid 150, bid cap 300, bids multiples of 5. `deckCount=2` with 4–5 players **rejected at LOBBY**. `calledCount` accepted 1–3 (default 2) for 2-deck; rejected as config for 1-deck.

### TIE-001 — first-played copy wins (REQUIRED)
**Setup:** 2 decks, trump ♠, led ♥. Plays in order: seat0 `K♥`, seat1 `K♥` (second copy), seat2 `9♥`, seat3 `3♥`.
**Assert:** winner = **seat0** (earlier copy; strictly-higher displacement). Variant with two identical trumps: seat1 `Q♠`, seat3 `Q♠` → seat1 wins. Corruption guard fires only at > `deckCount` copies of one identity.

### CLAIM-001 — first copy played claims; second copy is ordinary (REQUIRED)
**Setup:** 2 decks, called card `A♣`; copies held by seat2 and seat5 (or one seat holding both).
**Assert:** (1) when seat5 plays the first `A♣`, `PARTNER_REVEALED{seat5}` fires atomically pre-next-turn; `claimedBy=[5]`; seat5's shares include the card. (2) When seat2 later plays the other `A♣`: **no event, no membership, no share**. (3) `allPartnersRevealed` flips on claim count, not copies played. (4) Pre-claim, NO view lists seat2 or seat5 as members (claim model: membership is public-or-nonexistent).

### CLAIM-002 — declarer self-claim (solo path)
Declarer plays the first copy of their own called card → declarer claims (PARTNER_REVEALED fires for declarer), shareCount(declarer) = 2 with C=1.

### KAT-002 — 2-deck known-answer deal vector (REQUIRED conformance)
Same pipeline as KAT-001 with `deckCount=2`, `playerCount=6`, `defaultDeclarerSeat=0`, seed bytes `00..1f`; canonical order (suit, rank asc, copy index) with consecutive copies. Expected hands: generated by the reference implementation and frozen in `packages/engine/test/deal.test.ts` (KAT-002 block); any conforming implementation must reproduce them exactly.

### Re-parameterized suites
§1 bidding (base 150 / cap 300 in 2-deck), §4 scoring at `totalPoints=300`, §5 leak oracle under the claim model (pre-claim holders are NOT members and never appear), property suites extended over `deckCount ∈ {1,2}` (300-point conservation; ties never ambiguous; replay determinism).

> **KAT-001 verification note:** the §7 known-answer hands were independently re-derived (ChaCha20 RFC 8439, zero nonce, counter 0, LE `uint32` draws, rejection sampling, descending Fisher–Yates, round-robin from seat 0) and **match exactly**. The vector is confirmed correct as printed.
