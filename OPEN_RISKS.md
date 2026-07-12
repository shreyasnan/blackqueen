# Black Queen — Open Risks & Deferred Decisions

**Version:** 1.4 (companion to `GAME_SPEC.md` v1.9.1; adds §D-platform for `PLATFORM_SPEC.md` v1.0). v1.3 records the product-owner decisions: **R9 resolved** (failed-contract pause-end), **R12 closed except a narrow accepted host-declarer truncation residual**, **D1 resolved** (permanent pause), **D2 resolved** (table talk out-of-band), **D3 narrowed** (rotation skip; forfeiture still deferred), **D4 resolved** (shared victory final), **R1 trigger + mitigation pre-agreed**. v1.2 added R10/R11/R12 and the D7 warning-visibility update.
**Purpose:** track known strategic/griefing risks and unresolved product decisions that are intentionally **not** fixed in v1. Nothing here changes current gameplay; these are items to evaluate in playtests or resolve before/with a later spec version. Each entry notes status and what would trigger action.

---

## A. Griefing / exploit risks (gameplay is currently "as designed")

### R1 — Kamikaze bidding (drag innocents to −Y) — **decision recorded v1.9: ships unmitigated, trigger + mitigation pre-agreed**
A spiteful player wins the auction (e.g. bids 150 in a 7-player game), calls two cards **they do not hold**, and deliberately tanks the contract. The two players who merely held the called cards each eat `−Y` with no agency and no recourse; it is repeatable any round the griefer can win the auction.
- **Status:** confirmed by product owner (re-confirmed v1.9) to remain **unmitigated in v1**.
- **Pre-agreed trigger (v1.9):** **any** observed instance of deliberate use in playtests — a single occurrence suffices.
- **Pre-agreed mitigation (v1.9, to implement if triggered):** **asymmetric failure penalty** — on a failed contract whose called card(s) the declarer did not hold, the declarer's share scores heavier (e.g. `−2Y` per declarer share) while dragged partners score reduced (e.g. `−Y/2`). Chosen over banning don't-hold calls, which would kill legitimate aggressive play. Exact coefficients to be tuned at implementation time.

### R2 — Costless defender collusion / kingmaking — **as designed**
Defenders score 0 regardless of outcome, so a defender can dump Q♠ (30) into a friend-declarer's tricks at no personal cost, acting as free kingmaking machinery in a cumulative, winner-take-all game.
- **Status:** direct consequence of the confirmed "defenders score 0" decision (`GAME_SPEC.md` §12). Not a bug.
- **Trigger to revisit:** if playtests show collusion dominates competitive integrity.

### R3 — Solo meta / partner-gift degeneracy — **as designed**
Because standings are individual, calling a partner's card gifts them `+Y`; a strong hand is often better off calling its **own** card (secret solo, keeps all shares, gifts nobody). The rational meta in 4–5p may trend toward solos and deliberately weak calls, partly undermining the hidden-team fantasy.
- **Status:** consequence of confirmed "secret solo legal" + individual scoring. Not a bug.
- **Trigger to revisit:** if the hidden-team mechanic feels vestigial in practice.

### R4 — Underbid lock-in — **as designed**
Optimal defense against a keen default declarer is to never overbid (overbidding only lets them re-raise to a larger `Y`). Strong hands can get capped at `Y = 75` when they could make more. Flows from "the high bidder never bids against themselves" (`GAME_SPEC.md` §8.2).
- **Status:** confirmed — the high bidder cannot raise their own bid in v1.
- **Trigger to revisit:** if auctions feel degenerate ("pass unless you want it at 80").

### R5 — Forced-75 trap — **as designed**
When everyone passes against a weak default declarer, that declarer is bound to a 75 contract they never chose, must pick trump from a poor hand, and typically drags one innocent called-card holder to `−75`. Combined with uneven rotation for non-multiple-of-`playerCount` game lengths, some seats eat more of these.
- **Status:** consequence of the binding standing-75 (`GAME_SPEC.md` §8.1). Not a bug. Mitigated for fairness by the `N = 2 × playerCount` default (§13).

### R6 — Dead-rubber endgame — **as designed**
Contract scoring is binary (`≥ Y` or not); margin never matters. Once the round outcome is mathematically decided (often several tricks early), remaining play is strategically void and cards can be dumped freely (feeding R2 and cross-round signaling), yet the engine still forces the round to be played out.
- **Status:** inherent to binary contract scoring with no overtrick bonus (confirmed). Not a bug.
- **Trigger to revisit:** if "meaningless tail of the round" hurts pacing — a possible early-concede/claim mechanic could be added later.

### R7 — Rejection-channel signaling — **mitigated in v1 (architecture)**
If illegal-action rejections were observable to the table, an unrevealed partner could attempt N illegal plays as a prearranged code to signal membership.
- **Status:** **closed** by design: rejections are private to the acting client and rate-limited (`ARCHITECTURE.md` §4, `MESSAGE_PROTOCOL.md` §4). Listed here so it isn't reintroduced.

### R9 — Stall-escape via PAUSED (dodging a bad contract) — **RESOLVED in v1.9**
A declarer bound to a contract they didn't want could refuse to choose trump, stall into `PAUSED`, and (if the host ended) escape with the round voided.
- **Resolution (product-owner approved):** ending from `PAUSED` now scores the abandoned contract as a **failure charged to the declarer alone** — declarer `−(S×Y)`, all others `0` (`GAME_SPEC.md` §9.4). Stalling is strictly dominated by playing. Genuine interruptions are protected by the host choosing **resume**.
- **Residual feel-bad (accepted):** a declarer who genuinely crashes *and* whose group chooses to end (not wait/resume) eats the penalty. Judged rare and preferable to the exploit; the mid-trick equivalent doesn't exist (`PAUSED` is unreachable mid-trick).

### R10 — Player-chosen action timing as a covert partner channel — **flagged, unmitigated in v1**
`ARCHITECTURE.md` §6a closes *server-side* timing side channels, but nothing constrains how long a *player* deliberates before acting. A prearranged convention ("if I hold a called card I act within 3 s, otherwise I wait 15+ s") signals hidden membership legally, every round, and is stronger than the rejection channel that was deliberately closed (R7). Related to but distinct from D2 (table talk): this needs no chat transport at all.
- **Status:** unmitigable at the rules layer without hurting legitimate play (forcing fixed decision windows or server-added jitter both degrade UX). **No mitigation in v1.**
- **Candidate mitigations (later):** simultaneous-commit UX for the first play of a trick; randomized reveal delay; social/moderation tooling.
- **Trigger to revisit:** playtest evidence of timing conventions in coordinated groups.

### R11 — Blameless-AFK / deliberate timeout as a strategic action — **flagged, accepted in v1**
The trick auto-play rule (`GAME_SPEC.md` §10) is public and deterministic, so deliberately timing out is a costless, deniable way to (a) let the engine shed a card "for you" with social deniability, or (b) avoid the informational content of a free choice. It also discloses hand constraints (the auto-played card is provably the player's tuple-minimum legal card) — now acknowledged in-spec (§10 note).
- **Status:** inherent to any deterministic timeout default; accepted for v1.
- **Trigger to revisit:** if deliberate timeouts become a visible meta (pair with a per-player timeout counter or escalating penalties).

### R12 — End-when-ahead via induced `PAUSED` — **substantially closed in v1.8**
The v1.7 docs allowed `PAUSED` "on reconnect grace" / "operator hold," which combined with the `PAUSED`-end round-voiding rule into an on-demand round-deletion tool: a host could induce a pause and end the game whenever ahead. v1.8 closes the inducement vectors: `PAUSED` entry is **exhaustively** limited to declarer-decision timeouts (`GAME_SPEC.md` §9.4), operator hold is removed (`ARCHITECTURE.md` §7), and host migration excludes the awaited actor (`ARCHITECTURE.md` §8a).
- **v1.9 update:** the score-dodging half is **eliminated** — ending from `PAUSED` no longer voids anything; the stalling declarer eats `−(S×Y)` (R9).
- **Narrow residual (accepted):** a **host who is also the current declarer** and is far enough ahead can still stall→pause→end to *truncate the game early*, paying `−(S×Y)` but denying the table its remaining rounds. It is costly, fully visible (everyone sees who stalled and who ended), and self-limiting socially. Mitigation would need a non-host end policy (vote quorum / idle auto-end, D8). **Accepted for v1.**
- **Trigger to revisit:** any playtest occurrence, or implementation of D8's quorum policy.

### R13 — Claim-timing meta (2-deck) — **by design, watch in playtests**
Under the claim model (`GAME_SPEC.md` §9.3), a copy-holder chooses when to play their copy: rush it to lock membership with a strong declarer, or stall hoping the other copy claims first. Follow-suit obligations limit stalling (you may be forced to play it), and timeout auto-play can claim for you.
- **Status:** intended strategy — it IS the 2-deck game. Risk: optimal play may favor extreme hoarding of copies, flattening the drama.
- **Trigger to revisit:** playtests where copies are systematically held to the last legal moment.

### R14 — Tie-rule learnability (2-deck) — **accepted, UI-mitigated**
"First-played copy wins" surprises players who assume the later identical card matters. Veterans gain an edge over newcomers.
- **Mitigation:** the UI visually slides the losing copy UNDER the winning one and the feed says "second ♠K — first one holds"; the coach layer (future) should call it out once.
- **Status:** accepted; standard convention in double-deck card games.

### R8 — Host seed exploit — **closed in v1**
Earlier ambiguity let one reading have the host set the shuffle seed (→ precompute all hands).
- **Status:** **closed**: the shuffle seed is server-only, per-round, never host-configurable or visible during play (`GAME_SPEC.md` §3.1). The LOBBY-configurable value is only `round1DefaultDeclarerSelection` (§16).

---

## B. Deferred product decisions (need your input before a later version)

### D1 — Trump / partner-calling timeout default action — **RESOLVED v1.9: permanent pause, never auto-select**
Both auto-resolve variants (hand-independent = arbitrary bad contract; hand-dependent = hand leak) were rejected. `PAUSED` + host resolve is the confirmed permanent behavior; the abuse case is closed by the R9 failed-contract pause-end rule (`GAME_SPEC.md` §9.4).

### D2 — Table-talk / communication policy — **RESOLVED v1.9: out-of-band** (amended by UI_SPEC v1.1)
The client ships no chat transport; verbal claims about hidden membership (truthful or bluffed) are neither forbidden nor policed — groups self-police on their own channels (`GAME_SPEC.md` §16). Documented social norm: bluffing is legitimate play.
- **Amendment (UI_SPEC v1.1):** six **fixed, curated, non-informational emotes** (rate-limited 1/10s, per-player mutable, no free text, no directionality) are in scope. Rationale: table-talk is already permitted out-of-band, so voice chat strictly dominates emotes as a signaling channel — banning emotes blocked the warm variant while permitting the powerful one. The no-free-text, no-directionality constraints are what keep this consistent with the out-of-band stance.
- **Revisit trigger:** introduction of public matchmaking (strangers need enforced rules → moderation tooling, and the emote set gets re-audited as a covert channel among strangers).

### D3 — Forfeiture policy & abandoned-seat hostage loop — **NARROWED in v1.9 (rotation skip); full forfeiture still out of scope**
- **Resolved part (v1.9):** the hostage loop is closed — the default-declarer role now **skips** any seat with no connected client at any point during the preceding round (`GAME_SPEC.md` §7; connection tracking `ARCHITECTURE.md` §7; skip announced via `ROTATION_SKIPPED`). An abandoned seat is auto-played for indefinitely and never inherits the binding 75, so the game proceeds with **zero host intervention**.
- **Still deferred:** true forfeiture (removing the seat, redistributing/redealing) remains out of scope — it changes deck math and round structure. The skip rule also introduces a mild fairness wrinkle (remaining players absorb the skipped seat's default-declarer turns; announced via the §13 warning semantics), accepted for v1.
- **Trigger to revisit:** playtests with real disconnects showing the auto-played seat distorts outcomes (e.g. free point donations to its trick winners).

### D4 — Secondary tie-breakers — **RESOLVED v1.9: shared victory is final for casual play**
Product owner confirmed no tie-breaker will be added; ties at equal cumulative score share the victory (`GAME_SPEC.md` §13, competition ranking below first). **Revisit trigger:** only if a ranked/ladder mode is ever added (a ladder needs a total order).

### D5 — Post-game extension — **out of scope in v1**
`GAME_END` is terminal (`GAME_SPEC.md` §13). If extension returns, define: does it re-seed or continue the default-declarer rotation, and from which seat?

### D6 — Spectator mode — **out of scope in v1**
No spectator projection defined (`GAME_SPEC.md` §14.2). A future spectator view must be independently hidden-information-safe (cannot reuse a seated view; must never expose unrevealed membership).

### D8 — Host single point of failure — **partial rule in v1, full policy deferred**
`PAUSED`/`ABORTED` resolution and `HOST_END_GAME` all require the host, but the host may **be** the stuck/disconnected declarer, deadlocking the room.
- **v1 minimum (recommended, in `ARCHITECTURE.md` §8a):** if the host is disconnected past grace while a room is `PAUSED`/`ABORTED`, host authority **migrates to the lowest-seat connected player, excluding the awaited actor** (v1.8 — otherwise a stalling declarer could inherit the power to void their own round); if no eligible player is connected the room stays frozen with its snapshot until someone returns.
- **Open question (deferred):** richer policies — a **voting quorum** to resolve without any host, or an **auto-end after an idle ceiling** — are not specified. Consequence if migration is skipped entirely: a single absent host can strand a room indefinitely.
- **Trigger to revisit:** load/soak testing of disconnect scenarios.

### D7 — Custom game length warning UX — **spec-mandated, UX undefined**
`GAME_SPEC.md` §13 requires a warning when `N mod playerCount ≠ 0` (uneven default-declarer rotation). **As of v1.8 the warning MUST be visible to all players, not only the host** (§13/§16) — the host is the one choosing the asymmetry and could otherwise rig rotation against a specific seat (fixed round-1 seat + `N = playerCount + 1`) with no one else warned. The exact surfacing (blocking confirm vs. inline note; whether non-hosts must acknowledge) remains a UX decision.

---

## D-platform. Platform-layer risks (companion to `PLATFORM_SPEC.md` v1.1 §8)

- **P5 — Vendor coupling (Clerk + Cloudflare)** — accepted with eyes open: Clerk outage = no logins (existing sessions/sockets keep working for their TTL; a mid-game table survives a brief Clerk outage); Durable Objects are single-homed per room, so a CF regional incident can stall live rooms (snapshots make them resumable). Neither justifies self-hosting auth or multi-cloud for a v1 game. Exit paths: identity is one `accountId` string (re-mappable); room logic is portable TypeScript behind the apply-loop interface.
- **P6 — JWT revocation window (~60 s)** — accepted; supersedes the v1.0 opaque-token rule (`PLATFORM_SPEC.md` §2.1). Long-lived sockets are covered by the 5-minute re-auth rule (§2.2).

- **P1 — Invite-code leakage** — accepted (host kick pre-game + code regeneration; uniform join errors + rate limits prevent enumeration).
- **P2 — Account sharing / seat proxying** — accepted (undetectable; equivalent in effect to out-of-band table talk, D2).
- **P3 — No rematch flow (ephemeral rooms)** — accepted for v1; **strongest v1.1 candidate** (new room + auto-invite of prior members is cheap). Trigger: first playtest group asking "play again?".
- **P4 — Magic-link email deliverability** — OAuth is primary, email fallback; monitor bounces.
- Adding **public discovery/matchmaking** later reopens D2 (table talk) and requires block/report tooling first (`PLATFORM_SPEC.md` §6).

## C. Test-coverage gaps (tracked against `TEST_CASES.md`)

Historical gap list (from when `TEST_CASES.md` covered only §8 bidding); retained for traceability — see the status line at the end for current coverage:
- **Reveal atomicity** (`GAME_SPEC.md` §9.3): a called card played mid-trick reveals the holder before the next player acts.
- **No-point-leak** (§14.2, corrected): per-player captured points permitted; team totals / deltas absent from `playerView` before `ROUND_END`.
- **150-instant-end** bidding; **multi-lap escalation**; **rejection/re-prompt** (private, no state change).
- **Trick resolution:** trump beats led suit; highest-trump wins; void discard.
- **Scoring:** all player counts; secret solo; declarer-holds-both.
- **Timeout auto-actions:** bidding auto-pass; trick auto-play least-valuable legal card `(pointValue↑, rank↑, suit↑)`; trump/call → `PAUSED`.
- **ABORTED:** no score deltas applied; no auto-advance.
- **Status:** **largely addressed in `TEST_CASES.md` (v1.8 suite)** — plus §9 gap-closure tests added in v1.8: declarer-setup phase collapse + staged-trump no-leak (PHASE-001/002), Card wire encoding (ENC-001), LOBBY config bounds + warning visibility (CFG-003), host-migration exclusion (MIG-001), end-path equivalence (ENDEQ-001), competition ranking (RANK-001). Prior coverage: — reveal atomicity (REVEAL-001/002), point-leak permissions (HID-002), 150-instant-end (BID-003), multi-lap escalation (BID-004), rejection privacy (HID-003), trick resolution (TRICK-001–004), scoring across all counts (SCORE-4…7), timeout auto-actions (TO-001–003), ABORTED no-deltas (REC-002), and the deterministic known-answer deal vector (KAT-001). Remaining: broaden with fuzz/property tests before sign-off.
