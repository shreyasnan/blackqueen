# Black Queen — Implementation Plan

**Version:** 1.0 (executes `GAME_SPEC.md` v1.9.1, `ARCHITECTURE.md` v1.4, `MESSAGE_PROTOCOL.md` v1.3, `PLATFORM_SPEC.md` v1.1, gated by `TEST_CASES.md`)
**Stack:** TypeScript everywhere. Cloudflare Workers + Durable Objects (hosting), Clerk (identity), Vitest + `@cloudflare/vitest-pool-workers` (tests on `workerd`), fast-check (property tests), Wrangler (deploy).

**Governing principle:** the engine is a **pure, deterministic library with zero I/O** — no Durable Object, socket, timer, or Clerk import anywhere in it. Everything hard about this game (hidden information, determinism, turn safety) lives in pure functions that are trivial to test exhaustively; everything platform-specific is a thin shell around them. Milestones are ordered so the riskiest, most spec-constrained code is built and locked first.

---

## Repo structure (single repo, pnpm workspaces)

```
blackqueen/
  packages/
    engine/          # M1–M2: pure game logic. Zero runtime deps. The crown jewels.
      src/cards.ts         # Card type, §2.1 wire encoding, canonical order, point values
      src/deal.ts          # trim, ChaCha20, Fisher–Yates, round-robin (ARCH §5)
      src/bidding.ts       # §8 auction state machine + turn scheduler
      src/tricks.ts        # §10 validation, resolution, auto-play selection
      src/scoring.ts       # §11–§12 + pause-end scoring (§9.4)
      src/round.ts         # §14.1 state machine, applyAction(state, action) -> {state, events}
      src/view.ts          # §14.2 playerView(state, seat) -> ClientView
    protocol/        # M2: shared types — ClientAction, Event, ViewUpdate, Reject, Zod schemas
    server/          # M3–M4: Worker (front door) + RoomDO (apply loop, alarms, sockets, KV, R2)
    client/          # M5: web app (static assets on the Worker)
  test-vectors/      # KAT-001 seed + expected hands, checked into the repo
```

**The one interface that matters:** `applyAction(state, action) → { state', events[] } | rejection` and `playerView(state, seat)`. The RoomDO calls nothing else. If these two functions are right, the platform layer cannot corrupt the game.

---

## Milestone 0 — Scaffold & CI gate (small)
Repo, workspaces, lint/typecheck, CI running Vitest **on workerd** (`vitest-pool-workers`) from day one — the KAT must pass where the code runs (`PLATFORM_SPEC.md` §7 determinism caveat). Wrangler config with dev/prod environments; Clerk dev instance created (Google, Apple, email link ON; passwords/SMS OFF).
**Done when:** `pnpm test` runs a hello-world test inside workerd in CI.

## Milestone 1 — Deterministic core (`engine`: cards, deal, bidding, tricks, scoring)
Build order inside the milestone:
1. `cards.ts` + `deal.ts` first, and pass **KAT-001 immediately** — this validates the ChaCha20/rejection-sampling/Fisher–Yates pipeline before anything depends on it. (The vector is pre-verified; if the implementation disagrees, the implementation is wrong.)
2. `bidding.ts`: the §8.3.1 invariants as code (scheduler can never select the high bidder; termination check after every action). Tests BID-001…004, TO-001.
3. `tricks.ts`: validation predicate, trick resolution, per-seat point crediting, auto-play tuple `(pointValue↑, rank↑, suit↑)`. Tests TRICK-001…004, TO-002.
4. `scoring.ts`: shares, `roundDelta`, pause-end declarer-only failure (§9.4). Tests SCORE-4A…7, SCORE-EDGE, PAUSE-001 scoring assertions.
5. **Property tests (fast-check), the real gate:** for thousands of random seeds/action sequences — captured points always sum to 150; auction always terminates with exactly one declarer; every round plays exactly `deckSize/playerCount` tricks; an on-turn player always has ≥1 legal action; auto-play is always legal; replaying the same `(seed, actions)` is bit-identical.
**Done when:** all §1–§4, §6–§7 test cases + property suite green on workerd.

## Milestone 2 — Round state machine + hidden information (`round.ts`, `view.ts`, `protocol`)
- `round.ts`: the §14.1 machine as a pure reducer, including staged `CHOOSE_TRUMP` (no version bump), reveal-atomicity ordering of emitted events, `PAUSED`/`ABORTED` transitions, rotation skip input (`wasConnectedThisRound[]` comes in as action metadata — the engine stays I/O-free).
- `view.ts`: `playerView` — the single choke point. Property test: **serialize every view at every step of thousands of random games and assert no unrevealed holder mapping, no other-hand contents, no seed, no pre-gate team totals ever appear** (grep-the-JSON style leak test; this is the hidden-info guarantee made mechanical).
- `protocol`: Zod schemas for every message (§2.1 card encoding enforced at parse time).
**Done when:** REVEAL-001/002, HID-001…003, PHASE-001/002 (engine-level parts), CFG-001…003, ROT-001, REC-002 assertions green + view leak property test green.

## Milestone 3 — RoomDO + transport (`server`)
- RoomDO: apply loop (validate → apply → snapshot to `ctx.storage` per `stateVersion` → emit), WebSocket hibernation with `accountId`/seat attachments, DO alarm per turn deadline, `seq` event stream, private rejects + rate limiting, reconnect handshake.
- Worker front door: JWT verification (JWKS), WS upgrade routing, KV code→DO lookup.
- **Integration tests on workerd:** PHASE-001/002 wire-level, REC-001 (kill DO mid-trick, restore from snapshot), TO-001…003 driven by real alarms, PLAT-001 (seat-binding auth), idempotency/stale-version races (two sockets, same action).
**Done when:** a full 4-player game runs end-to-end over real sockets in a test, including an AFK player and a mid-game reconnect.

## Milestone 4 — Platform layer (rooms, Clerk lifecycle)
Room lifecycle (`OPEN→IN_GAME→ENDED→destroyed`, timers via alarms), invite codes + regeneration + uniform errors, seat assignment (random CSPRNG / host-arranged), host migration incl. awaited-actor exclusion (MIG-001), Clerk webhooks (`user.deleted`, session revocation → close sockets), socket re-auth interval, displayName storage/snapshot, R2 audit writes with lifecycle rule, ENDED teardown (PLAT-002/003).
**Done when:** PLAT-001…003, MIG-001, ENDEQ-001 green; a room can be created, filled via code, played, and verifiably vanish.

## Milestone 5 — Client
Clerk SDK sign-in → lobby (create/join, config with §16 validation + all-player warning) → game table UI driven purely by `ClientView` + events (strict §5.2 apply-order: buffer gapped `seq`, `ViewUpdate` checkpoints) → per-seat point HUD, reveal animations, `DECLARER_SETUP` opacity for non-declarers, timer display, standings (competition ranking).
**Client rule:** render *only* from `ClientView` — the client never computes game state, so it can never disagree with the server or leak anything the server didn't send.
**Done when:** 4 humans (or 1 human + scripted bots) complete a full game in browsers against the deployed dev environment.

## Milestone 6 — Hardening & playtest readiness
Load/soak (many rooms, forced disconnects, DO eviction under way), fuzz the socket boundary with malformed frames, the RANK/ENDEQ edge cases, ops dashboards (Clerk + CF analytics), R2 lifecycle verification, then a real playtest group. Feed observations into the pre-agreed OPEN_RISKS triggers (R1 kamikaze, R3 solo meta, P3 rematch demand).

---

## Sequencing & first PRs
Dependencies are strictly M0 → M1 → M2 → M3 → M4 → M5 → M6; within M3/M4 some parallelism is possible once the `applyAction`/`playerView` interface is frozen (end of M2 — freeze it explicitly; protocol changes after that require a spec version bump).

First three PRs, in order: (1) scaffold + workerd CI; (2) `cards.ts` + `deal.ts` + KAT-001 green; (3) `bidding.ts` + BID-001…004. Everything after that has momentum and a proven deterministic foundation.

**Definition of done for v1 overall:** every test in `TEST_CASES.md` green in CI on workerd; property suites green; one full playtest game completed by real humans; no OPEN_RISKS item without a status.
