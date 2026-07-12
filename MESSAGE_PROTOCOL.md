# Black Queen — Message Protocol

**Version:** 1.6 (companion to `GAME_SPEC.md` v2.1). v1.6: room creation additionally accepts `handSize` (integer; clamped at start to the actual table's legal range per `GAME_SPEC.md` §3.2), and seated views carry `handSize` so clients derive the trimmed set without hardcoding tables. v1.5: room creation accepts `deckCount` (1|2; 2 only for 6–7 players) and, for 2-deck games, `calledCount` (1–3, default 2); seated views additionally carry `deckCount` and `totalPoints` so clients render bid ranges and contract math without hardcoding. The claim model (§9.3) changes no wire shapes — `PARTNER_REVEALED {seat, card}` now means "claimed". Previously v1.4 (companion to `GAME_SPEC.md` v1.9.1, `ARCHITECTURE.md` v1.4, `PLATFORM_SPEC.md` v1.2). v1.4 adds `HOST_NEXT_ROUND` (explicit round start with AFK fallback) and `EMOTE` (fixed set, rate-limited, order-insensitive) to §2, and notes the platform-decorated view fields: seated `ViewUpdate.view` additionally carries `seatNames[]`, `seatAvatars[]` (server-whitelisted face ids), `hostSeat`, `turnBudgetMs`, and `stagedTrumpOwn` (declarer's own staged trump only — §9.2-safe, fixes reconnect-during-setup). Guest authentication (HMAC token via `POST /api/guest`) is specified in `PLATFORM_SPEC.md` §1.0. v1.3 applied the v1.9 `PAUSED`-end score effect to the host-action rows (§2) and added the `ROTATION_SKIPPED` event (§3). v1.2 pinned the `Card` wire encoding (§2.1), collapsed declarer setup to a single non-declarer `DECLARER_SETUP` phase (§3), and declared the two `PAUSED` end paths equivalent (§2))
**Scope:** the client ↔ server wire contract — action envelope, idempotency, versioning, rejection delivery, rate limiting, view payloads, event ordering, and reconnection. No gameplay rules here; those are normative in `GAME_SPEC.md`. Transport fields carry **no** gameplay meaning.

Transport is assumed to be an ordered, reliable, bidirectional channel per connection (e.g. WebSocket). Ordering guarantees below are **per room**, enforced server-side (`ARCHITECTURE.md` §1), not by the socket.

---

## 1. Action envelope (client → server)

Every client action is wrapped:

```
ClientAction {
  roomId:       string
  playerId:     string
  actionId:     string   // client-unique per player per room (UUID); idempotency key
  stateVersion: uint64   // version the client decided against
  type:         "BID" | "PASS" | "CHOOSE_TRUMP" | "CALL_CARDS" | "PLAY_CARD" | "HOST_*"
  payload:      { ... }  // type-specific (see §2)
}
```

- **`playerId`** — the account identity (`accountId`) defined in `PLATFORM_SPEC.md` §1; transport-level session auth binds every socket to it (`PLATFORM_SPEC.md` §2.2), and it MUST match the seat's immutable binding (`PLATFORM_SPEC.md` §3.4).
- **`actionId`** — dedupe key. Re-sending the same `actionId` returns the original outcome (idempotent no-op); it is never applied twice (`ARCHITECTURE.md` §3). Clients SHOULD reuse the same `actionId` on retry.
- **`stateVersion`** — staleness guard. For any turn action, if it no longer matches the server's current version, the action is **rejected as stale** (`ARCHITECTURE.md` §2). Clients obtain the current version from the latest `ViewUpdate`/event.

## 2. Action payloads

| `type` | Actor | `payload` | Validated by |
|--------|-------|-----------|--------------|
| `BID` | on-turn bidder | `{ value: int }` (multiple of 5, `> currentHighBid`, `≤ 150`) | `GAME_SPEC.md` §8.2 |
| `PASS` | on-turn bidder (not high bidder) | `{}` | §8.2 |
| `CHOOSE_TRUMP` | declarer | `{ suit: "♣"|"♦"|"♥"|"♠" }` | §9.1 |
| `CALL_CARDS` | declarer | `{ cards: Card[] }` (length `C`, in-play, distinct) | §9.2 |
| `PLAY_CARD` | on-turn player | `{ card: Card }` | §10 validation predicate |
| `HOST_END_GAME` | host | `{}` | **only in `PAUSED` or `ABORTED`.** Arbitrary mid-round host termination in any other state is rejected. Score effect **differs by state (v1.9)**: from `PAUSED` → the abandoned contract scores as a failure charged to the declarer alone (declarer `−(S×Y)`, all others `0`, `GAME_SPEC.md` §9.4); from `ABORTED` → no `roundDelta` (round voided, §14.1) |
| `HOST_RESTART_ROUND` | host | `{}` | **only in `ABORTED`.** Re-deals the same `roundNumber`/declarer with a **fresh `shuffleSeed`** (never reuses prior hands, `ARCHITECTURE.md` §8). No `fromSnapshot` deal replay |
| `HOST_RESOLVE_PAUSE` | host | `{ action: "resume" | "end" }` | only in `PAUSED`. `"resume"` → back to the paused state (no score effect); `"end"` → `GAME_END` with v1.9 `PAUSED`-end scoring (declarer `−(S×Y)`, all others `0`, `GAME_SPEC.md` §9.4) |
| `HOST_NEXT_ROUND` | host | `{}` | **only when the round has ended and `roundNumber < N`.** Starts the next round explicitly (rounds no longer auto-advance); a shell-side timeout (`turnTimerMs + graceMs`) auto-starts it if the host is AFK, so the table can't be stalled |
| `EMOTE` | any seated player | `{ emote: "hello"\|"wellplayed"\|"uhoh"\|"trusted"\|"laugh"\|"gg" }` | fixed non-informational set (UI_SPEC §8, D2 amendment). **Not order-sensitive:** no stale-version guard, no `stateVersion` bump. Rate-limited 1/10s/player (`RATE_LIMITED` beyond). Broadcast as an `EMOTE` event `{seat, emote}` |

**End-path equivalence (normative).** In `PAUSED`, `HOST_END_GAME {}` and `HOST_RESOLVE_PAUSE { action: "end" }` are **exactly equivalent**: same score semantics, same state transition, same emitted event sequence (ending with `GAME_ENDED`). Implementations MUST route both through one code path; any observable divergence between them is a defect.

### 2.1 `Card` wire encoding (normative)

A `Card` is serialized as a two-field object `{ suit, rank }` with:
- `suit`: one of the ASCII strings `"C" | "D" | "H" | "S"` (clubs, diamonds, hearts, spades). Unicode suit glyphs (♣♦♥♠) appear in documentation only, never on the wire.
- `rank`: one of the ASCII strings `"2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A"` (ten is `"10"`, not `"T"`).

Any other encoding is non-conformant; the `TEST_CASES.md` §7 known-answer vector is expressed in this encoding. This applies to every `Card` on the wire: `CALL_CARDS`/`PLAY_CARD` payloads, `ClientView.ownHand`/`tricks`/`calledCards`, and all `Event.data`.

Server-generated timeout actions (auto-pass, auto-play) use the same internal shape with a server `actionId` and are applied through the same loop (`ARCHITECTURE.md` §6); clients see them only as resulting events.

## 3. Server → client messages

```
ViewUpdate {
  roomId, stateVersion, phase,          // phase = current state-machine state (§14.1),
                                        // EXCEPT: see the DECLARER_SETUP collapse below
  view: ClientView                       // GAME_SPEC.md §14.2 projection for THIS player
}
```

**`phase` collapse for declarer setup (normative, `GAME_SPEC.md` §9.2 disclosure gating).** For every client **other than the declarer**, the internal states `TRUMP_SELECTION` and `CALLING_PARTNERS` are both reported as the single wire phase **`DECLARER_SETUP`**, and no `ViewUpdate` or `Event` may be emitted to **any** client on the internal `TRUMP_SELECTION → CALLING_PARTNERS` transition. Mechanism: an accepted `CHOOSE_TRUMP` is **staged** — no `stateVersion` bump, no emission; the declarer's client echoes the choice locally (the server MAY send a private ack that carries no version change). Trump + calls apply as one versioned transition at `CALL_CARDS` (`GAME_SPEC.md` §9.2, `ARCHITECTURE.md` §2). This makes the observable version/`seq` stream identical whether or not trump has been chosen. A `PAUSED` entered from either sub-state is reported to non-declarer clients without distinguishing which. Otherwise the phase field would leak how long the declarer deliberated over trump vs. calls — the timing information the `TRUMP_CHOSEN` withholding rule (§5.3) exists to hide. Correspondingly, `ClientView.trump` is `null` for non-declarer viewers until `CALL_CARDS` is accepted.

```

Event {
  roomId, stateVersion, seq,             // seq = per-room monotonic event counter
  kind: "BID_PLACED" | "PLAYER_PASSED" | "AUCTION_ENDED" | "TRUMP_CHOSEN"
      | "CARDS_CALLED" | "CARD_PLAYED" | "PARTNER_REVEALED" | "TRICK_WON"
      | "ROUND_SCORED" | "GAME_ENDED" | "PAUSED" | "RESUMED" | "ABORTED"
      | "ROTATION_SKIPPED",                 // v1.9: default-declarer role skipped an
                                            // abandoned seat (GAME_SPEC.md §7); data =
                                            // { skippedSeats: int[], newDefaultDeclarerSeat: int }
  data: { ... }                          // hidden-info-safe; see §5
}

Reject {                                 // PRIVATE to the acting client only (§4)
  roomId, actionId, reason:
    "ILLEGAL" | "STALE_VERSION" | "NOT_YOUR_TURN" | "DUPLICATE" | "RATE_LIMITED",
  currentStateVersion: uint64
}
```

- **`ClientView`** is exactly the `playerView(state, viewerSeat)` output of `GAME_SPEC.md` §14.2: `ownHand`, `handCounts[seat]`, public facts (bids, `Y`, declarer, trump — `null` for non-declarer viewers until `CALL_CARDS` is accepted (§3 phase collapse) — calledCards), `tricks`, `perPlayerCapturedPoints[seat]` (permitted at all times during play), `revealedTeamMembers`. It MUST NOT contain other hands, unrevealed partner ownership, the shuffle seed, team totals / team-keyed contract progress **while any partner is unrevealed** (permitted once `allPartnersRevealed`, §14.2), or pre-`ROUND_END` `roundDelta`/`success`.
- **Spectators are out of scope (v1):** `ClientView` is defined only for seated players.

## 4. Rejections — private & rate-limited

- A `Reject` is sent **only to the acting client**, never broadcast (`ARCHITECTURE.md` §4). This is essential: broadcasting rejections would create a covert signaling channel for hidden partners (`OPEN_RISKS.md`).
- Rejections are **rate-limited per player** (token bucket; suggested 5 / 10 s). `RATE_LIMITED` is returned past the limit; repeated abuse throttles/disconnects. Rejections never change state or `stateVersion`.

## 5. Event ordering & the reveal guarantee

### 5.1 Ordering model — `seq` and `stateVersion`
- Every room message (`ViewUpdate` and `Event`) carries the **`stateVersion`** it reflects; every `Event` additionally carries a strictly increasing per-room **`seq`**. `seq` orders the message stream; `stateVersion` identifies the authoritative state it corresponds to. They advance together and are **monotonic per room** (a message with `stateVersion` v is emitted at or after the action that produced v; `seq` never decreases).
- A `ViewUpdate` at `stateVersion` v represents the complete authoritative projection as of v; any `Event` with the same `stateVersion` describes the transition that produced v.

### 5.2 Client conformance (normative — MUST)
Clients are held to these rules so they can never render inconsistent state:
1. **Apply in strict order.** A client MUST apply `Event`s in ascending `seq` and MUST NOT apply an `Event` whose `seq` is not exactly one greater than the last applied `seq`. Out-of-order or gapped events MUST be **buffered** until the missing lower-`seq` events arrive (or a fresh full `ViewUpdate`/reconnect snapshot supersedes them). Reordering or skipping is forbidden.
2. **Never render stale state.** A client MUST ignore any message whose `stateVersion` is **older than** the highest `stateVersion` it has already rendered. It MUST NOT display a view derived from a superseded `stateVersion`.
3. **`ViewUpdate` is a checkpoint.** A `ViewUpdate` at `stateVersion` v replaces the client's model wholesale as of v; buffered events with `stateVersion ≤ v` are discarded, and the client resumes applying events with `seq` following that `ViewUpdate`.
4. **Act only on the latest.** When submitting a turn action, the client MUST use the `stateVersion` of the latest state it has rendered (§1); the server's stale-version guard (`ARCHITECTURE.md` §2) rejects anything else. A client MUST NOT act on a view it knows to be superseded.
5. **Idempotent redelivery.** Because reconnect may replay events (§6), clients MUST treat re-applying an already-applied `seq` as a no-op.

These rules make client rendering a pure function of the ordered `(seq, stateVersion)` stream, so no out-of-order delivery, duplicate, or turn-boundary race can produce a state the server did not authorize.

### 5.3 Reveal guarantee & hidden-info-safe payloads
- **Trump withheld until called cards are set (normative, aligns `GAME_SPEC.md` §9.2).** Although trump is chosen in `TRUMP_SELECTION` (before `CALLING_PARTNERS`), the server **withholds the `TRUMP_CHOSEN` event** and emits it **immediately before `CARDS_CALLED`, at consecutive `seq`**, when the declarer exits `CALLING_PARTNERS`. Clients therefore learn the trump suit and the called cards together, with no observable gap — matching the "broadcast together" rule and leaking no timing information about how long the declarer deliberated over trump vs. calls.
- **Reveal-before-next-turn (normative in `GAME_SPEC.md` §9.3):** when an accepted `PLAY_CARD` is a called card, the server emits `PARTNER_REVEALED` **before** the `ViewUpdate`/turn-assignment that puts the next player on turn. On the wire this means `CARD_PLAYED` → `PARTNER_REVEALED` → (next-turn `ViewUpdate`) occupy consecutive `seq` values in exactly that order, so every later actor in the same trick already sees the reveal.
- `Event.data` is filtered to be **hidden-information-safe**: `TRICK_WON` reports the winning *seat*, its captured cards, and the resulting **per-seat** `capturedPoints[winnerSeat]` (public/derivable) but **no team attribution or team total**; `ROUND_SCORED` (only at `ROUND_END`) is the first message carrying per-player `roundDelta`, `success`, and derived team totals.

## 6. Reconnection handshake

```
Client → ReconnectRequest { roomId, playerId, lastSeenStateVersion }
Server → ViewUpdate { ... current stateVersion, full ClientView } [+ replay of missed Events by seq, optional]
```

- The server responds with the current `playerView` at the current `stateVersion` (a full projection acts as a snapshot). Optionally it replays missed `Event`s by `seq` for smooth UI.
- Grace windows, `PAUSED`, and no-forfeiture behavior are in `ARCHITECTURE.md` §7.

## 7. Non-goals (v1)

Spectator streams, cross-room presence, chat/table-talk transport (see `OPEN_RISKS.md` for the table-talk policy question), and any seed exposure are out of scope. Gameplay semantics are never encoded in transport fields.
