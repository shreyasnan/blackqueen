# Black Queen — implementation

Implements `../GAME_SPEC.md` v1.9.1 / `../ARCHITECTURE.md` v1.4 / `../MESSAGE_PROTOCOL.md` v1.3 / `../PLATFORM_SPEC.md` v1.1, gated by `../TEST_CASES.md`.

## Layout

- `packages/engine` — **pure, zero-I/O game logic.** `applyAction(state, action)` + `playerView(state, seat)` are the only entry points the server uses. ChaCha20 deal pipeline (KAT-001 verified), bidding, tricks, scoring, §14.1 state machine, hidden-info projection.
- `packages/protocol` — Zod schemas for the wire contract (§2.1 Card encoding enforced at parse).
- `packages/server` — `RoomCore` (transport-agnostic room logic: lobby, apply loop, versioning, idempotency, emission rules) + `RoomDO` (Durable Object adapter: hibernating WebSockets, alarms, snapshots, KV codes, R2 audit) + `worker.ts` (Clerk JWT via JWKS, routing, static assets).
- `packages/client/dist/index.html` — single-file client; renders only from `ClientView`, applies events in strict `seq` order with gap buffering (§5.2).

## Test status (all green)

`npm test` → 54 tests: KAT-001 conformance, CONFIG-001, BID-001…004 + rejections + TO-001, TRICK-001…004, TO-002, SCORE-4A…7/EDGE, RANK-001, PAUSE-001+ENDEQ-001, REC-002, ROT-001, REVEAL-001/002, HID-001/002, PHASE-001/002 (engine + wire level), PLAT-001/002 equivalents, MIG-001, full-game smoke, and property suites (randomized full games ×30: 150-point conservation, auction termination, always-playable, structural view-leak walker at every step for every viewer, bit-identical replay).

## Local dev (no Clerk needed)

```sh
npm install
npm test
cd packages/server
# set DEV_AUTH=1 in wrangler.toml [vars], then:
npx wrangler dev
# open http://localhost:8787 in 4 browser tabs, Dev sign-in with 4 names, create/join/start
```

## Current UI build ritual

The client shows a `BUILD_TAG` (bottom of the tagline on Home) — bump it in `packages/client-react/src/App.tsx` with every UI change, rebuild, deploy, hard-refresh, and confirm the tag. Latest: **`ui-11-busts-turnflow`** (bust avatars, turn pointer + countdown, activity sidebar, guest play, explicit rounds). A prebuilt `dist/` may already be present (built in Claude's sandbox) — in that case `npx wrangler deploy` alone ships it.

One-time secret for guest play: `npx wrangler secret put GUEST_SECRET` (any long random string).

## Deploy checklist (needs your accounts)

1. **Cloudflare:** `npx wrangler kv namespace create CODES` → paste id into `wrangler.toml`; `npx wrangler r2 bucket create blackqueen-audit` and add a **30-day lifecycle rule** (ARCH §5 retention); `npx wrangler deploy`.
2. **Clerk:** create app; enable **Google, Apple, Email magic link**; disable passwords/SMS (PLATFORM_SPEC §1.1). Set `CLERK_JWKS_URL` in `wrangler.toml` to `https://<instance>.clerk.accounts.dev/.well-known/jwks.json`. Remove `DEV_AUTH`.
3. **Clerk webhook:** point `user.deleted` + session revocation at `/api/webhooks/clerk` (handler is a stub — wire Svix verification + socket-close before public launch, PLATFORM_SPEC §1.2/§2.2).
4. **CI:** run `npm test` plus the same suite under `@cloudflare/vitest-pool-workers` so KAT-001 is asserted on workerd (PLATFORM_SPEC §7 determinism caveat).

## Known v1 gaps (tracked, deliberate)

- Clerk webhook handler is an acknowledging stub (P-item in OPEN_RISKS).
- Socket re-auth interval (PLATFORM_SPEC §2.2) not yet enforced server-side.
- Client is functional-minimal; no animations/polish.
- workerd-pool CI job not yet configured (tests currently run on Node; engine is runtime-agnostic pure TS).
