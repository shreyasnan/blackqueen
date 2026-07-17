# Authoring a new game

This monorepo already ships two multiplayer, real‑time, trick‑taking card games — **Black Queen**
(hidden dynamically‑formed teams) and **28** (fixed partners, concealed trump). They share ~90% of
their structure. This guide extracts that shared skeleton so a third game is mostly *rules + a few
screens*, not a from‑scratch build.

Read this once, then use the companion **`game-scaffold` skill** (or copy an existing game package)
to stamp out the boilerplate.

---

## 0. The mental model

Four layers, each with a tiny, stable contract. Get these right and everything else follows.

```
engine/     pure, zero-I/O reducer         ← the rules live here and NOWHERE else
protocol/   Zod wire schemas               ← validates every client action
server/     RoomCore + Durable Object      ← the single writer; lobby, loop, persistence
client/     store + net + UI kit           ← renders playerView; all drama is event-driven
```

Golden rules that make games cheap to add:

1. **The engine is pure.** `applyAction(state, action) → {ok, state, events}` and
   `playerView(state, seat) → View` are the ONLY functions the server calls. No `Date.now()`, no
   randomness except the seeded deal, no I/O. This is what makes it testable and deterministic.
2. **The server is the only writer.** One Durable Object per room serializes every action. Clients
   are optimistic but authoritative truth is the DO.
3. **Clients only ever receive `playerView(state, seat)`.** Hidden information is impossible to leak
   because the client is never sent the full state. A property test asserts this.
4. **The UI renders from the view; all animation is event‑driven.** The server ships `events` with
   each step; a client "theater" hook turns events into sound, bubbles, confetti, set‑pieces.

---

## Part 1 — Engine + protocol + server

### 1.1 The cards module (`engine/src/cardsX.ts`)

Define the deck once. Everything downstream is generic over it.

```ts
export const SUITS = ["C","D","H","S"] as const;          // canonical order (display/tie-break)
export const RANKS_ASC = [...] as const;                   // WEAKEST → STRONGEST so index == strength
export const strength = (r) => RANKS_ASC.indexOf(r);       // higher = stronger
export function pointValue(c): number { ... }              // game-specific scoring values
export const teamOf = (seat) => ...                        // partnership model (or -1 / dynamic)
export const nextSeat = (seat) => (seat + 1) % PLAYER_COUNT;
export function canonicalDeck(): Card[] { ... }            // fixed pre-shuffle order
```

Both games are 32‑ or larger‑card decks with a single rank order per suit. If your game has a
different deck (jokers, multiple decks, stripped ranks) this is the only place it changes.

### 1.2 Deterministic deal (`engine/src/dealX.ts`) — copy almost verbatim

A 32‑bit seed → PRNG → Fisher–Yates → round‑robin deal. This is **identical** across games except
hand size. Keep the seeded shuffle so deals are reproducible and lockable by a known‑answer test.

```ts
export function mulberry32(seed) { ... }                   // or ChaCha20 (BQ) for stronger guarantees
export function shuffle(deck, rng) { ... }
export function deal(dealer, seed): { hands, firstReceiver } { ... }
```

> **Test vector:** lock one deal with a KAT (known‑answer test) so a refactor can never silently
> change dealing. See `TEST_CASES.md` (KAT‑001) for the pattern.

### 1.3 The reducer (`engine/src/roundX.ts`) — the heart, game‑specific

This is where your game actually lives. The *shape* is fixed; the contents are yours.

```ts
export interface State { phase: Phase; dealer; hands; turn; /* + game-specific fields */ }
export type Action = { type: "BID"; seat; value } | { type: "PLAY"; seat; card } | ...;
export interface Event { kind: string; [k: string]: unknown }
export type Result = { ok: true; state: State; events: Event[] } | { ok: false; error: string };

export function initRound(dealer, seed): State { ... }
export function currentActor(s): number { ... }            // whose action we're waiting on, or -1
export function applyAction(prev, action): Result {
  const s = clone(prev);                                   // JSON clone — never mutate prev
  switch (action.type) { ... }                             // validate turn/legality, push events
}
```

Conventions that pay off (both games follow them):

- **Clone at the top**, mutate the copy, return it. Purity for free.
- **Every branch validates `action.seat === currentActor(s)`** and returns `fail("...")` otherwise.
- **Push an `Event` for anything the UI should react to** (`BID`, `PLAY`, `TRICK_WON`, `ROUND_SCORED`,
  `TRUMP_REVEALED`, …). Events are how the client animates.
- **Every phase has a terminal path and a timeout default** so no state can get stuck. Prove it with
  an invariant test (auction always terminates, etc.).

### 1.4 Per‑seat view (`engine/src/viewX.ts`) — the hidden‑info firewall

`playerView(state, seat)` returns ONLY what `seat` may legally see. Opponents' cards become counts;
concealed info (trump, hidden partners) is masked unless this seat is entitled to it.

```ts
export function playerView(s, seat): View {
  return {
    phase: s.phase, you: seat, actor: currentActor(s),
    hand: s.hands[seat].slice(),                            // YOUR cards only
    handCounts: s.hands.map(h => h.length),                // everyone else = counts
    trumpSuit: (revealed || iAmBidder) ? s.trumpSuit : null,// masked info
    legal: s.phase === "PLAY" && iAmActor ? legalPlay(s, seat) : null,
    // ...what YOU may do right now: minBid, canPass, canReveal, etc.
  };
}
```

> **Property test (copy it):** serialize `playerView` for every seat over thousands of random games
> and assert no hidden card or unrevealed secret ever appears. This one test is worth a hundred code
> reviews.

### 1.5 Bots (`engine/src/botsX.ts`) — game‑specific, but same contract

```ts
export function botAction(s, seat): Action | null {        // null if not this seat's turn
  if (currentActor(s) !== seat) return null;
  // heuristics per phase: sensible bid, cheapest winning card, dump low, etc.
}
```

Start dumb and legal (v1). The contract lets you swap in a search‑based bot later without touching
callers. The **server** also keeps a `safeFallback(seat)` — a guaranteed‑legal move — as an
anti‑stall backstop, so even a buggy bot can't freeze a table.

### 1.6 Protocol (`protocol/src/index.ts`) — copy the envelope, change the actions

```ts
export const ActionXSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BID"), payload: z.object({ value: z.number().int() }) }),
  z.object({ type: z.literal("PLAY"), payload: z.object({ card: CardXSchema }) }),
  z.object({ type: z.literal("EMOTE"), payload: z.object({ emote: z.string().max(24) }) }),
  z.object({ type: z.literal("HOST_NEXT_DEAL"), payload: z.object({}).strict() }),
  // ...
]);
export function parseActionX(raw): ActionX & { actionId; playerId; stateVersion } {
  const env = z.object({ type, playerId, actionId, stateVersion, payload }).parse(raw);
  return { ...ActionXSchema.parse({ type: env.type, payload: env.payload }), ...env };
}
```

The `{playerId, actionId, stateVersion, payload}` envelope is **identical** in both games. `actionId`
enables idempotency (dedupe replays); `stateVersion` lets the client guard stale renders.

### 1.7 Server RoomCore (`server/src/coreX.ts`) — 90% copy, glue is game‑specific

`RoomCore` is transport‑agnostic room logic. The **generic** parts (copy them):

- **Lobby:** `create`, `join`, `leave`, `addBot`, `removeBot`, `startGame`, Crockford invite codes.
- **Seat model:** `seatOf`, `accountOfSeat`, `seatNames`, `seatAvatars`, host tracking.
- **Game loop:** `runBots()` (bounded inline loop — bots resolve synchronously, never on a fragile
  timer chain), `botActOnce`, `safeFallback`, `onTimeout`, `nextDeadlineDelay` (only a *human* turn
  needs a wall‑clock deadline).
- **Apply/broadcast:** `applyEngine(a)` → update state, capture `events`, bump `stateVersion`,
  `pushViews()` (send `viewFor(account)` to each non‑bot member).
- **Match structure:** `dealNumber` / `N`, `advanceDeal`, score accumulation.
- **Persistence:** `serialize()` / `static restore()`.

The **game‑specific** glue: `toEngine(action, seat)` (protocol → engine action), the scoring line in
`applyEngine` (`teamScores[...] += result.gamePoints`), seat count, and any redeal handling.

> **Two hard‑won fixes baked into 28's core — keep them:**
> - **EMOTE must bump `stateVersion`.** Broadcasts that don't change game state still need a version
>   bump or the client's version‑dedupe drops the frame and reactions never show.
> - **Bots resolve inline in a bounded loop**, not via per‑move alarms. One stuck move can't freeze
>   the table.

### 1.8 Durable Object adapter (`server/src/doX.ts`) — copy, rename the namespace

Thin adapter around `RoomCore`: its own DO class, its own storage, its own invite‑code KV prefix
(`cX:`), the same serialized‑writer + websocket model. Isolate it from other games' namespaces so
they evolve independently.

---

## Part 2 — Client UI/UX kit

The client is where the "so much work" felt heavy — but almost all of it is reusable. Treat
`Table.tsx` (Black Queen) and `Game28.tsx` (28) as the reference implementations.

### 2.1 Store (`client/src/storeX.ts`) — copy the shape

zustand store with: `view`, `stateVersion`, `connection`, `roomInfo`, `toasts`, **`flights`**
(card‑flight animation), **`lastTrickOpen`**, and setters. The view *is* the game; keep local‑only
state (drag echoes, modal open flags) separate from server truth.

### 2.2 Net layer (`client/src/netX.ts`) — copy wholesale, it's subtle

- Auth reuse (`getAuth` from the shared `net.ts` — guests/Clerk carry across games).
- REST helper `apiX`, websocket `connectX`/`disconnectX`, reconnect with backoff.
- **The pacing pump** — this is the piece that makes bot play *watchable*. The server ships a burst
  of `ViewUpdate` frames; the pump applies **at most one per `PACE_MS`** so moves land one‑by‑one,
  applies the first immediately for responsiveness, and stops gating the instant a frame is "your
  turn" or the deal ends. **Gotchas baked in — keep them:**
  - The pump must set its timer *after applying a non‑terminal frame even when the queue is momentarily
    empty*, or bursts that arrive as separate socket messages all apply instantly (looked like "bots
    play all at once").
  - Once the player has **left** (`roomId` cleared), ignore straggler frames in `enqueue`/`apply`/
    `onmessage`, or a late `ViewUpdate` re‑applies the ENDED view and traps them on game‑over.

### 2.3 The UI kit — generic vs. game‑specific

**Generic (copy/adapt, rarely change):**

| Component | Role |
|---|---|
| `Shell` | dark room, overhead bloom, vignette — every screen sits in the same light |
| `PokerTable` + `seatPct`/`seatAngle` | oval felt, seats around the rim, viewer at 6 o'clock |
| `SeatChip` | circular avatar, team/seat ring, turn pointer, "YOUR TURN", bidder badge, emote bubbles, away state |
| `TimerRing` | countdown ring + last‑15s digits + last‑3s ticks for your own turn |
| `TrickOnFelt` | cards land in front of their player; winner banner lingers, then flies to winner |
| `Hand` + `DraggableCard` | fanned hand; **fan rotation on a static wrapper, drag on the inner card** (mixing them makes the swipe stiff) |
| `CardFace` | the shared card renderer (already supports `deck="bq" \| "28"`) |
| `HUD`, quick‑chat sheet, `Confetti`, `FlightLayer`, `Toasts`, scores/leaderboard + last‑trick modals |
| `useTheater` hook | turns `events` → `sfx`, bubbles, confetti, flights, set‑pieces |
| `audio.ts` `sfx` palette, `faces.tsx` avatars | fully synthesized sound, procedural SVG faces — **shared as‑is** |

**Game‑specific (write these per game):**

- The **controls** below the felt (bid bar, raise bar, reveal button, next‑deal) — small.
- The **set‑pieces** in `useTheater` (which events get a crown/reveal/verdict overlay).
- The **view→props wiring** (your view field names) and the **team/seat coloring** rules.

> **Two more fixes baked into 28 — keep them:**
> - **Trick‑linger effect must key only on the completed‑trick signature**, never on the live trick
>   length — otherwise the next card cancels the "clear" timer and the finished trick freezes on the felt.
> - **Swipe smoothness:** put the fan's `rotate`/`translateY` on a static wrapper `<div>` and let only
>   the inner `motion.div` be `drag`gable (snap‑to‑origin, `dragElastic` ~0.6, no `dragConstraints`).

### 2.4 Shared theme tokens

CSS variables (`--gold`, `--teal`, `--coral`, `--parchment`, `--wood-a/b/c`, `--felt-a/b/c`,
`--ink`, `--ivory`, …) are defined globally and used by both games. New games get the felt look for
free; only pick per‑team accent colors.

---

## Part 3 — New‑game checklist

Say the new game is **Rung** (`X = rung`, route prefix `/api/rung`, KV prefix `crung:`). Steps:

**Engine + protocol**
1. `packages/enginerung/` — `cardsrung.ts`, `dealrung.ts`, `roundrung.ts`, `viewrung.ts`,
   `botsrung.ts`, `index.ts`. Start by copying `engine28`, then rewrite `round`/`view`/`bots`.
2. `packages/protocolrung/` — copy `protocol28`, change the action union.
3. Add both to the root `package.json` `workspaces` array and to `tsconfig` refs.
4. **Tests:** copy `engine28/test/round28.test.ts` — deck sanity, deal (no dupes), a full‑round
   bot playout that conserves points and terminates, and the hidden‑info property test.

**Server**
5. `packages/server/src/corerung.ts` — copy `core28.ts`, change `toEngine`, scoring, seat count.
6. `packages/server/src/dorung.ts` — copy `do28.ts`, rename class `RoomRungDO`, KV prefix `crung:`.
7. `worker.ts`: `export { RoomRungDO }`; add `ROOMSRUNG?` to `WorkerEnv`; add a `toDORung` forwarder;
   add the route block (mirror the `/api/28/...` block — `POST /api/rung/rooms`, `/rooms/join`, and
   the `(ws|state|start|addbot|removebot|leave|config)` regex).
8. `wrangler.toml`: add a `[[durable_objects.bindings]]` (`name = "ROOMSRUNG"`, `class_name =
   "RoomRungDO"`) and a new `[[migrations]]` tag with `new_sqlite_classes = ["RoomRungDO"]`.

**Client**
9. `packages/client-react/src/storerung.ts`, `netrung.ts`, `Gamerung.tsx` — copy the 28 versions,
   rename, rewire the view fields and controls/set‑pieces.
10. `App.tsx`: import `Gamerung`; add a `"grung"` screen; add a card to `GamePicker`; handle the
    `?joinrung=CODE` invite param if you want deep links; render `<Gamerung>` when `screen==="grung"`.
11. **Bump `BUILD_TAG`** in `App.tsx` (shown on the sign‑in page) so you can confirm the deploy landed.

**Verify**
12. `tsc --noEmit` in `client-react`; `vitest run packages/enginerung`; play a full match vs bots;
    check the leave flow doesn't loop and bots pace one‑by‑one.

---

## Appendix — environment gotchas (from building 28)

- **Building here:** `npm run dev` / `build` uses Vite (esbuild). If esbuild segfaults in a sandbox,
  it's a corrupt/arch‑mismatched binary — `tsc --noEmit` still validates types; build on your real machine.
- **Git on a mounted folder** can refuse to unlink `.git/*.lock` ("Operation not permitted"); commit
  from your own terminal, clearing any stale `HEAD.lock`/`index.lock` first.

---

## Roadmap — the framework extraction (future)

Once a third game confirms the patterns, extract the generic pieces into shared packages so games
become thin plug‑ins rather than copies:

- **`packages/game-kit`** — `deal`/PRNG, the `Result`/`Event` reducer types, a `RoomCore` base class
  parameterized by an engine interface (`initRound`, `applyAction`, `playerView`, `botAction`,
  `currentActor`, `score`), the DO adapter, and the protocol envelope parser.
- **`packages/ui-kit`** — `Shell`, `PokerTable`, `SeatChip`, `TimerRing`, `TrickOnFelt`, `Hand`/
  `DraggableCard`, `CardFace`, `HUD`, quick‑chat, `useTheater`, `Confetti`, `FlightLayer`, `audio`,
  `faces`, and the net pacing pump — each taking a small game‑specific config/props object.

A new game then implements: a cards module, a reducer + view + bots, a protocol action union, a
`toEngine` + scoring glue, and a thin `Game.tsx` (controls + set‑pieces). Everything else is imported.
