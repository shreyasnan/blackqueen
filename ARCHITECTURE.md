# Black Queen — Architecture

**Version:** 1.6 (companion to `GAME_SPEC.md` v2.2; v1.6: the shell grants declarer-setup phases +45s over the normal combined budget before firing the §9.4 PAUSED timeout — setup is a bigger decision than a turn; the view carries `setupBudgetMs` so clients render an honest ring. Previously v1.5; v1.5: the §5 dealing pipeline is parameterized by `deckCount` — canonical order gains a copy-index tertiary key, and **KAT-002** (2-deck, 6p) joins KAT-001 as a REQUIRED conformance vector. Previously v1.4; v1.4 adds the deployment binding — one Cloudflare Durable Object per room as the single writer, per `PLATFORM_SPEC.md` §7; v1.3 applies the v1.9 `PAUSED`-end failed-contract scoring (§8) and adds per-round connection tracking for the rotation skip (§7). v1.2 removed the undefined "operator hold" `PAUSED` entry, excluded the awaited actor from host migration, and pinned the round-1 declarer-selection RNG + audit)
**Scope:** the server-side runtime concerns that `GAME_SPEC.md` deliberately excludes — concurrency, determinism/reproducibility, timers, pause/abort, reconnection, and snapshots. Nothing here changes gameplay semantics; where a runtime event has a gameplay effect (a timeout auto-action, an abort's score effect), the **normative rule lives in `GAME_SPEC.md`** and this document only specifies the mechanism. The wire format lives in `MESSAGE_PROTOCOL.md`.

---

## 1. Authority & concurrency model

- **Single authoritative server per game (room).** The server owns the full `GameState`; clients hold only `playerView` projections (`GAME_SPEC.md` §14.2). Clients never compute authoritative results.
- **Single total order of actions per game.** All accepted actions for one room are applied on a **single logical writer**. (Deployment binding, v1.4: this is implemented as **one Cloudflare Durable Object per room** — its serialized event loop is the single writer; timers via DO alarms, snapshots via DO transactional storage, sockets via the hibernation API. Full mapping: `PLATFORM_SPEC.md` §7.) No two actions for the same room are ever applied concurrently. Every "atomic step" and scheduler invariant in the spec presupposes exactly this serialization.
- **Apply loop:** dequeue action → validate against current state and the on-turn actor → if legal, apply as one indivisible transition (including any reveal, per `GAME_SPEC.md` §10) and increment `stateVersion` → emit resulting events. If illegal, reject privately (no state change, no version bump).
- Cross-room parallelism is unconstrained; the ordering guarantee is **per room** only.

## 2. State versioning

- The server maintains a monotonically increasing **`stateVersion`** (uint64) per room, incremented by exactly 1 on every accepted, state-changing action. Engine-internal transitions (e.g. `TRICK_RESOLVE`) that change visible state also bump it.
- **Single exception — staged `CHOOSE_TRUMP` (`GAME_SPEC.md` §9.2 disclosure gating):** an accepted `CHOOSE_TRUMP` is staged without a version bump or any emission; the staged trump + `CALL_CARDS` apply as **one** versioned transition when `CALL_CARDS` is accepted. This keeps the client-observable version stream identical across the two declarer-setup sub-states (no side channel). The staged value **is** written to the snapshot (§8) so a crash mid-setup restores it. No stale-guard exception is needed: because staging bumps nothing, the version the declarer decided against **is** still the current version when `CALL_CARDS` arrives. A repeated `CHOOSE_TRUMP` after one has been staged is rejected `ILLEGAL` (`GAME_SPEC.md` §9.1 — trump is final once accepted).
- **`PAUSED` / `RESUMED` bump normally:** entering `PAUSED` and resuming from it are visible state changes and each increments `stateVersion` (resume restores the same *game* state at a *new* version). The staged-`CHOOSE_TRUMP` rule above is the **only** no-bump exception.
- Every outbound `playerView` / event carries the `stateVersion` it reflects (see `MESSAGE_PROTOCOL.md`).
- **Stale-action guard:** a client action carries the `stateVersion` it was decided against. If it no longer matches the current version at apply time and the action is order-sensitive (any turn action), the server **rejects it as stale** rather than applying it to a changed state. This closes the "bid lands just after the auction already terminated" race and the "acted on a stale view at a turn boundary" race.

## 3. Idempotency

- Every client action carries a client-generated **`actionId`** (unique per player per room).
- The server keeps a dedupe set of applied `actionId`s per room. A repeat of an already-applied `actionId` is a **no-op that re-returns the original result** (idempotent), never a second application. This makes client retries after a network timeout safe (no double-play, no double-bid).

## 4. Rejections (private, rate-limited)

- Rejections (`GAME_SPEC.md` §8.5 / §9.2 / §10; stale/duplicate/illegal) are delivered **only to the acting client**, never broadcast. This removes the covert-channel risk where deliberate illegal attempts could signal hidden-partner status to the table.
- Rejections are **rate-limited per player** (token bucket; suggested default 5 rejects / 10 s, then throttle). Exceeding the limit throttles or disconnects the offender; it never mutates game state.
- Because rejections change no state and bump no version, they cannot be used to probe or perturb the authoritative state.

## 5. Determinism & reproducibility (dealing)

Implements `GAME_SPEC.md` §3.1 so a deal is reproducible from `(playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed)`. The deal depends on `defaultDeclarerSeat` (round-robin starts there) and the player↔seat mapping — **not** on `shuffleSeed` alone.

- **Canonical deck order:** suit `♣ < ♦ < ♥ < ♠`, then rank `2 < … < A`, over the trimmed set → array `deck[0 … deckSize−1]`. Platform-independent.
- **PRNG — fully pinned (normative):**
  - Algorithm: **ChaCha20** (RFC 8439), used as a keystream generator.
  - `shuffleSeed` is exactly **32 bytes**. **Key** = the 32-byte `shuffleSeed`. **Nonce** = 12 bytes, all zero. **Initial block counter** = 0. (No per-index rekeying; one continuous keystream per deal.)
  - **Byte draw:** consume the keystream in order; each random value for an index is **4 bytes** interpreted as a **little-endian** `uint32`.
  - **Unbiased range reduction (rejection sampling):** to pick a uniform integer in `[0, m]` (inclusive), let `bound = floor(2^32 / (m+1)) * (m+1)`; draw `uint32` values, **rejecting** any `≥ bound`, and return `value mod (m+1)` for the first accepted draw. This removes modulo bias deterministically (the reject/accept sequence is part of the pinned output).
  - **Shuffle:** in-place **Fisher–Yates, descending** — `for i = deckSize−1 down to 1: j = uniform(0, i); swap(deck[i], deck[j])`. Direction and bound are fixed so the permutation is bit-exact across implementations.
- **Deal:** round-robin, one card at a time from `deck[0]` upward, starting at `defaultDeclarerSeat`, clockwise, `deckSize / playerCount` cycles, per `GAME_SPEC.md` §3.1.
- **Seed generation:** `shuffleSeed` is generated **server-side per round** from a CSPRNG (32 random bytes). It is **never** chosen by or shown to any participant (including the host) during play. It is **not** the `round1DefaultDeclarerSelection` value.
- **Conformance:** the known-answer vector in `TEST_CASES.md` §7 (fixed seed + player count + default declarer seat → exact hands) is a REQUIRED test; two implementations that both pass it deal identically.
- **Round-1 default-declarer selection (when `round1DefaultDeclarerSelection = random`):** drawn server-side from the **same CSPRNG class as `shuffleSeed` generation** — never from a client- or host-influenced source — as a uniform integer in `[0, playerCount−1]` via the §5 rejection-sampling rule. The drawn value and its entropy source are **written to the audit log** with the round-1 record, so post-game audit can verify the selection was made server-side. (The value itself is public the moment round 1 starts; only its *generation* must be unbiased and auditable — `GAME_SPEC.md` §7 notes it carries no hidden-hand information.)
- **Retention:** the server retains `{roundNumber, playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed}` in an audit log for debugging/replay (the deal is recomputable from these, so raw hands need not be stored). Retention is server-only; if ever surfaced, **after game end** at the earliest, per the operator's data policy. Recommended window: configurable (default 30 days), then purge.

## 6. Turn timer & inactivity

Drives the gameplay-normative default actions in `GAME_SPEC.md` (§8.6, §9.4, §10). This document specifies only the mechanism.

- **Config:** `turnTimerMs` (per-turn soft limit) and `graceMs` (additional grace). Both configurable per room; defaults suggested `turnTimerMs = 30000`, `graceMs = 15000`.
- **Escalation threshold (normative):** for **every** actor state, the inactivity escalation fires at **`turnTimerMs + graceMs`** after the actor was placed on turn (a single combined budget; the soft `turnTimerMs` is only a UI "your time is running low" signal and has no gameplay effect). There is no separate earlier auto-action at `turnTimerMs`.
- **Away fast-forward (v1.5 amendment, from playtest):** if the awaited actor's socket is **disconnected** at the time their turn is armed (or they disconnect mid-turn), the escalation threshold for that turn is **`min(12 000 ms, budget)`** instead — a visibly-absent player's turns resolve quickly rather than dragging every hand to the full budget. Reconnecting restores the standard budget from the next arm. The default action itself is unchanged (auto-pass/auto-play; §6 above); connection status is surfaced to all clients as a public table fact (`seatConnected[]`).
- **At `turnTimerMs + graceMs`, by state:**
  - `BIDDING` → apply **auto-pass** for the on-turn player (always legal; `GAME_SPEC.md` §8.6).
  - `TRICK_LEAD` / `TRICK_FOLLOW` → apply **auto-play least-valuable legal card** by `(pointValue↑, rank↑, suit↑)` (`GAME_SPEC.md` §10). (Point-value-major so AFK seats do not donate point cards.)
  - `TRUMP_SELECTION` / `CALLING_PARTNERS` → **do not auto-select.** Transition the room to `PAUSED` (`GAME_SPEC.md` §9.4). The engine never fabricates a trump or called card.
- **Resume from `PAUSED`:** the turn timer **restarts fresh** — the returning/covering actor gets a full `turnTimerMs + graceMs` budget; elapsed pre-pause time is discarded.
- Timeout-driven actions flow through the same single-writer apply loop and bump `stateVersion` like any action; they carry a server-generated `actionId`.

## 6a. Deterministic message timing (no side channel)

Event emission and turn assignment MUST be **deterministic and independent of any hidden state**. Specifically, the server MUST NOT vary the *content, ordering, or wall-clock timing* of emitted events based on whether an acting player is a hidden partner, holds a called card, or on any other secret. The per-action work (validate → apply → emit) follows the same code path for every seat, so an observer measuring inter-event latency learns nothing about membership. This closes wall-clock timing as a covert channel (complements the private-rejection rule in §4). Batching, if used, MUST be membership-independent (e.g. fixed tick cadence), never data-dependent on secrets.

## 7. Reconnection & PAUSED

- **Single escalation clock (normative):** the **only** trigger for a timeout default action or `PAUSED` entry is the §6 threshold — `turnTimerMs + graceMs` after the actor was placed on turn — and it runs identically whether the actor is connected or not. A disconnect never starts a second, competing timer: `reconnectGraceMs` (configurable; default 30000; MUST be `≤ turnTimerMs + graceMs`, validated with the §16 lobby bounds) governs only how long the server keeps the seat's session warm for a seamless resume (re-sending the current `playerView` at the latest `stateVersion` on reconnect). A player who reconnects before the §6 threshold simply resumes their turn with whatever budget remains.
- **After the §6 threshold:** apply the state-appropriate default (auto-pass / auto-play / `PAUSED` for declarer setup). There is **no forfeiture in v1** — a disconnected player is auto-played for, not removed.
- **Per-round connection tracking (v1.9, for the §7 rotation skip):** the server records, per seat per round, a boolean `wasConnectedThisRound` — set `true` the moment the seat has an authenticated connected client at any instant during the round (`ROUND_START` through `ROUND_END` inclusive), reset at each `ROUND_START`. A seat with `wasConnectedThisRound == false` for the immediately preceding round is **abandoned** for default-declarer rotation (`GAME_SPEC.md` §7); each skip emits `ROTATION_SKIPPED` (`MESSAGE_PROTOCOL.md` §3). The flag is part of the snapshot (§8).
- **`PAUSED` (non-terminal):** entered **only** when a declarer decision (`TRUMP_SELECTION`/`CALLING_PARTNERS`) exceeds grace — this list is exhaustive (`GAME_SPEC.md` §9.4). There is **no host/operator-initiated pause in v1**: an on-demand pause lever would give the host an end-the-game-early button (end-when-ahead, `OPEN_RISKS.md` R12); even under the v1.9 failed-contract pause-end scoring, early truncation is a lever deliberately withheld. While paused, no turn timer runs and no actions are accepted except the awaited actor's decision or a host resolution. Resuming returns to the exact paused *game* state; `PAUSED` entry and resume each bump `stateVersion` normally (§2). Non-declarer clients are told only that the room is "paused during declarer setup," never which of the two sub-states it paused in (`GAME_SPEC.md` §9.2 disclosure gating).
- **Reconnect handshake:** client presents `(roomId, playerId, lastSeenStateVersion)`; server replies with the current `playerView` (full snapshot projection) at the current version. Wire details in `MESSAGE_PROTOCOL.md`.

## 8. Snapshots & ABORTED

- **Snapshots — after every accepted action.** The server persists a **last-valid-state snapshot after every accepted, state-changing action** (every bid, pass, trump choice, card call, and — critically — **every single card play during trick play**), not only on entry to engine states. Each snapshot is the full authoritative `GameState` **at a specific `stateVersion`**, so the snapshot set is a gap-free, per-version history. **One keying exception:** a staged `CHOOSE_TRUMP` (§2) is snapshotted without a version bump, producing a second snapshot at the same `stateVersion`; the later snapshot **supersedes** the earlier at that version (recovery restores "latest snapshot at the highest version"), so recovery is still unambiguous. Recovery restores that snapshot and replays nothing (the snapshot is authoritative and complete).
  - **Sufficiency for exact recovery.** A snapshot contains everything needed to resume with zero ambiguity: all hands, `currentTrick.plays` (so a partially-played trick is restored card-for-card, including the on-turn seat as the next unfilled position), `revealedTeamMembers`, per-seat `capturedPoints`, `bidding` sub-state, `trump` (**including a staged, not-yet-versioned `CHOOSE_TRUMP`**, §2), `calledCards`, `trickLeaderSeat`, `roundNumber`, and all `totalScore`s. No visible state is derived from transient memory, so nothing can be lost or reconstructed ambiguously. In particular, mid-trick crashes never lose already-played cards or an already-fired partner reveal.
  - **Checkpoint minimum:** entry to each engine state remains a snapshot point too; the per-action rule above is a superset. Snapshots older than the current round MAY be retained to enable `HOST_RESTART_ROUND` from a round-start snapshot.
- **`ABORTED` (from the §10 fatal guard):** on detecting unrecoverable state corruption (e.g. a duplicate-card / rank-tie invariant violation, `GAME_SPEC.md` §10), the server:
  1. **Freezes the room** (halts the apply loop; accepts no further game actions).
  2. **Preserves** the last valid snapshot and writes a **diagnostic log** (offending state, `shuffleSeed`, action that triggered it, `stateVersion`).
  3. Applies **no score deltas** for the incomplete round and does **not** auto-advance to the next round (normative in `GAME_SPEC.md` §14.1).
  4. Exposes a **host resolution**: either **end the game** (final standings from `totalScore` as of the last completed round) or **restart the round**.
- **Round restart re-deals with a FRESH seed (normative, `GAME_SPEC.md` §14.1).** A restart does **NOT** replay the round-start snapshot's hands — doing so would re-deal the identical cards after players had already seen bids and plays, leaking information. Instead the engine begins a new `DEALING` for the **same `roundNumber` and same `defaultDeclarerSeat`**, generating a **new `shuffleSeed`**. The previously dealt hands are discarded and never reused. Cumulative `totalScore` from prior completed rounds is preserved; no delta from the aborted round is applied.
- **Ending from `PAUSED` differs from an `ABORTED`-end (v1.9).** An `ABORTED`-end voids the in-progress round (no `roundDelta` — corruption is nobody's fault). An end from `PAUSED` — always the consequence of a declarer-decision timeout — scores the abandoned contract as a **failure charged to the declarer alone**: declarer `roundDelta = −(S × Y)`, all other seats `0`, applied before final standings (`GAME_SPEC.md` §9.4). The engine computes this from `declarerSeat`, `Y`, and `S = C + 1` (player count); no called-card holders exist yet, so no other seat can be affected.
- Corruption should be impossible in a correct engine; `ABORTED` exists so a halted game has a **defined** outcome instead of undefined cumulative scores.

## 8a. Host availability (single point of failure)

`PAUSED`/`ABORTED` resolution and `HOST_END_GAME` require the host, but the host may **be** the stuck/disconnected declarer. v1 does not fully solve this; the required behavior is:
- **Host migration (minimum viable):** if the host is disconnected past `reconnectGraceMs` while a room is `PAUSED`/`ABORTED`, host authority **migrates deterministically to the lowest-seat currently-connected player, excluding the awaited actor** (the seat whose stalled decision caused the `PAUSED`). Without the exclusion, the stalling declarer would adjudicate their own stall — and could end the game unilaterally (paying the §9.4 penalty but truncating everyone else's remaining rounds; `OPEN_RISKS.md` R9/R12). If every connected player is excluded or none is connected, the room stays frozen (snapshot preserved) until an eligible player returns.
- Fuller policies (voting quorum to resolve without a host, auto-end after an idle ceiling) are a **deferred product decision** — see `OPEN_RISKS.md` (host-SPOF entry). The consequence of not implementing migration is that a room can be stranded by a single absent host; the minimum-viable rule above is RECOMMENDED for v1.

## 9. What is NOT here

Gameplay rules (bidding, trick resolution, scoring, reveal timing, timeout *default actions*, abort *score effect*) are normative in `GAME_SPEC.md`. Wire/message shapes are in `MESSAGE_PROTOCOL.md`. Strategic/design risks and deferred product decisions are in `OPEN_RISKS.md`.
