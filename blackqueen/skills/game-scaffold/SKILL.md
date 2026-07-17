---
name: game-scaffold
description: >-
  Scaffold a new real-time multiplayer card game in the Black Queen monorepo by
  cloning the proven engine/protocol/server/client structure. Use when the user
  wants to "add a new game", "create another card game", "start a game like 28",
  scaffold game packages, or wire a new game into the router/DO/chooser. Produces
  enginX/protocolX packages, server coreX/doX, client storeX/netX/GameX, plus all
  wiring (worker routes, wrangler DO binding, App chooser entry) with TODOs.
---

# Scaffold a new card game

This repo runs multiplayer trick‑taking card games that share one skeleton across four layers:
`engine/` (pure reducer), `protocol/` (Zod wire schemas), `server/` (RoomCore + Durable Object),
`client/` (store + net + UI kit). **28** is the cleanest reference — clone it, don't build fresh.

**Always read `GAME_AUTHORING.md` at the repo root first** — it is the source of truth for the
contract, the reusable UI kit, and the hard‑won fixes. This skill is the executable runbook for it.

## Inputs to collect first

Ask the user (via the question tool) before writing anything:

1. **Game name + short id.** e.g. name "Rung", id `rung`, route prefix `/api/rung`, KV prefix `crung:`,
   DO class `RoomRungDO`, env binding `ROOMSRUNG`.
2. **Deck** — suits, rank order (weakest→strongest), point values, total points.
3. **Players & partnerships** — seat count; fixed teams (`seat % k`), dynamic/hidden, or none.
4. **Phase flow** — the bidding/trump/play/scoring states and their transitions.
5. **Scoring** — how a deal maps to game points; match length (`N` deals).

## Procedure

Work in this order; copy from the `*28` files and rewrite the rules‑specific parts.

### Engine + protocol
- Create `packages/engine<id>/src/`: `cards<id>.ts`, `deal<id>.ts`, `round<id>.ts`, `view<id>.ts`,
  `bots<id>.ts`, `index.ts`. Copy `engine28` as the base.
  - `cards`: the deck, `strength`, `pointValue`, `teamOf`, `nextSeat`, `canonicalDeck`.
  - `deal`: keep the seeded `mulberry32` + Fisher–Yates deal verbatim (change hand size only).
  - `round`: rewrite `State`, `Action`, `Phase`, `initRound`, `currentActor`, `applyAction`. Rules:
    clone at top, validate `action.seat === currentActor(s)`, push an `Event` for anything the UI
    animates, give every phase a terminal/timeout path.
  - `view`: `playerView(s, seat)` returns YOUR hand + everyone else's counts + masked secrets + what
    you may do now. **Never** include hidden cards/secrets a seat isn't entitled to.
  - `bots`: `botAction(s, seat)` — legal, simple heuristics; `null` if not this seat's turn.
- Create `packages/protocol<id>/src/index.ts` from `protocol28`; change only the action union. Keep
  the `{playerId, actionId, stateVersion, payload}` envelope + `parseAction<id>`.
- Register both packages in root `package.json` `workspaces` and `tsconfig`.
- Copy `engine28/test/round28.test.ts`: deck sanity, deal (no dupes), a full bot playout that
  terminates + conserves points, and the hidden‑info property test over all seats.

### Server
- `packages/server/src/core<id>.ts` from `core28.ts`: change `toEngine`, the scoring line in
  `applyEngine`, and seat count. **Keep** `runBots` inline‑bounded, `safeFallback`, and the
  **EMOTE `stateVersion++`** fix.
- `packages/server/src/do<id>.ts` from `do28.ts`: rename class `Room<Id>DO`, KV prefix `c<id>:`.
- `worker.ts`: `export { Room<Id>DO }`; add `ROOMS<ID>?` to `WorkerEnv`; add `toDO<id>` forwarder;
  add the route block mirroring the `/api/28/...` one (create, join, and the
  `(ws|state|start|addbot|removebot|leave|config)` regex).
- `wrangler.toml`: add a `[[durable_objects.bindings]]` for the class and a new `[[migrations]]` tag
  with `new_sqlite_classes = ["Room<Id>DO"]`.

### Client
- `packages/client-react/src/store<id>.ts`, `net<id>.ts`, `Game<id>.tsx` from the 28 versions.
  - **Keep the net pacing pump exactly** (one frame / `PACE_MS`; set the timer even when the queue is
    momentarily empty; ignore straggler frames once `roomId` is cleared).
  - **Keep the trick‑linger fix** (key the linger effect only on the completed‑trick signature).
  - **Keep the swipe structure** (fan rotate on a static wrapper; only the inner card is `drag`gable).
  - Reuse `CardFace`, `Face`, `sfx`, and the felt theme tokens; write only the controls + set‑pieces.
- `App.tsx`: import `Game<id>`; add a `"g<id>"` screen; add a `GamePicker` card; handle
  `?join<id>=CODE` if you want invite links; render `<Game<id>>` for that screen.
- **Bump `BUILD_TAG`** in `App.tsx` so the sign‑in page confirms the deploy.

### Verify
- `tsc --noEmit` in `client-react`; `vitest run packages/engine<id>`; play a full match vs bots;
  confirm the leave flow doesn't loop and bots pace one‑by‑one.

## Guardrails

- Do NOT put rules anywhere but the engine; the server only calls `applyAction` + `playerView`.
- Do NOT send full state to clients — only `playerView`.
- Preserve the isolation between games (separate DO namespaces, KV prefixes, stores/net modules).
- Building may fail in a sandbox (esbuild); `tsc --noEmit` is the reliable check there.
