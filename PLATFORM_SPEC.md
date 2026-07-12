# Black Queen — Platform Specification (Identity, Auth, Rooms)

**Version:** 1.1 (companion to `GAME_SPEC.md` v1.9.1, `ARCHITECTURE.md` v1.4, `MESSAGE_PROTOCOL.md` v1.3). v1.1 binds the implementation to the chosen vendors: **Clerk** for identity/auth/email (product-owner decision, 2026-07-10) and **Cloudflare Workers + Durable Objects** for hosting (§7). The *requirements* of §1–§3 are unchanged; what changes is who fulfills them.
**Scope:** everything *around* the game engine that the game docs deliberately exclude: account identity and authentication, session management, room creation/discovery/joining, the lobby-to-engine handoff, and post-game teardown. The game engine (`GAME_SPEC.md`) begins at `LOBBY` with 4–7 authenticated, seated players and ends at `GAME_END`; this document specifies how players get to that boundary and what happens after it.

**Product decisions locked for v1 (product owner, 2026-07-10):**
1. **Identity:** lightweight accounts (OAuth + email magic link). No guest play, no passwords.
2. **Discovery:** private rooms only, joinable by invite code/link. No public listing, no matchmaking.
3. **Persistence:** rooms are ephemeral — a room is destroyed shortly after `GAME_END`. No player-facing game history or stats in v1.

---

## 1. Identity & accounts

### 1.0 Guest identity (v1.2 amendment — product decision changed to hybrid)
The v1 "no guest play" decision is amended: **guests may play without an account.** Mechanism: the Worker mints an **HMAC-signed guest token** (`guest.<uuid>.<hmac>`, key = `GUEST_SECRET` Worker secret); the token lives only in the guest's browser (localStorage) and authenticates exactly like a session at the transport layer, so a guest's seat binding (§3.4) is just as hijack-proof as an account's. Properties: nothing stored server-side, no PII at all, identity does not survive the browser (cleared storage = new person), no cross-device play. `accountId` = the guest UUID; all room-layer rules (seat binding, one-socket supersede, ephemeral teardown) apply unchanged. Guests choose the same face/nickname identity (§1.1a) — persisted locally only. Rationale: zero-friction join for one-night players; Clerk accounts remain the path for anyone who wants a persistent identity.

### 1.1 Account model — **delegated to Clerk**
- Identity is provided by **Clerk**. An **account** is a Clerk user; **`accountId` = the Clerk user ID** (stable, never reused). `playerId` as used in `MESSAGE_PROTOCOL.md` §1 and `ARCHITECTURE.md` **is this `accountId`.** There is exactly one player identity concept in the system; the app maintains **no parallel user table**.
- **Login methods (v1, exhaustive — configured in the Clerk dashboard, everything else disabled):**
  - **OAuth:** Google and Apple.
  - **Email magic link** (Clerk's email-link strategy; Clerk sends the email — no app-side email infrastructure).
  - **Passwords, phone/SMS, and username login are DISABLED.** No password exists anywhere in the system, per the original decision.
- Method linking (one user, multiple methods) and duplicate-claim rejection are Clerk-native behavior; the app adds nothing.
- **`displayName`:** stored app-side (room-layer storage, §7), keyed by `accountId` — **not** in Clerk metadata (it's game data, and keeping it app-side avoids coupling render paths to Clerk reads). 1–20 Unicode characters, chosen at first sign-in, editable, **not unique**. Server MUST filter control characters and normalize (NFC). Snapshotted at seat claim (§3.4); mid-game renames never propagate into a live room.

### 1.2 Stored PII & compliance (normative)
- **Clerk holds all PII** (email, OAuth subjects, login timestamps). The app stores only `accountId` and `displayName`. No profile photos, contact imports, or analytics identity joins in v1.
- **Deletion:** account deletion = Clerk user deletion. The app MUST consume Clerk's **`user.deleted` webhook** and, on receipt: tombstone the `accountId` app-side (audit-log consistency, `ARCHITECTURE.md` §5), erase the `displayName`, and treat the account in any live room as a permanent disconnect (engine auto-play rules apply). Webhook handling MUST be idempotent and signature-verified (Clerk/Svix signatures).
- The `ARCHITECTURE.md` §5 audit log (seeds, deals) is **operations-only** and keyed by `accountId`, never by name/email; its 30-day default purge is unchanged. Ephemeral rooms (§4) mean no *player-facing* history exists regardless.

## 2. Sessions & authentication

### 2.1 Sessions — **Clerk-managed**
- Sessions are Clerk sessions: long-lived server-side session (Clerk dashboard TTL, default ≈ our original 90-day intent) minting **short-lived session JWTs (~60 s)** that the Clerk SDK auto-refreshes on the client.
- **Revocation stance (supersedes v1.0's "no JWTs" rule):** v1.0 required opaque tokens for instant revocation. With Clerk, the short JWT lifetime bounds the revocation window to ≤ ~60 s, which is **accepted** — nothing in this game is sensitive enough that a sub-minute zombie window matters, and Clerk's "sign out everywhere" (session revocation) still exists. Long-lived *sockets* are handled separately below.
- Every HTTP API call and every WebSocket connection is authenticated by a valid Clerk session JWT, verified in the Worker via Clerk's JWKS (cacheable, no per-request Clerk API call). **There is no unauthenticated game traffic of any kind.**

### 2.2 Socket authentication & reconnect
- A WebSocket upgrade request carries a fresh Clerk session JWT; the Worker verifies it (JWKS) and resolves `accountId` **before** forwarding the socket to the room Durable Object (§8). The DO binds the socket to that `accountId`; no room message is accepted on an unbound socket.
- **Long-lived sockets vs 60 s JWTs (normative):** the JWT authenticates the *connect*, not each frame. To keep revocation meaningful on sockets that outlive the token: (a) the client MUST send a refreshed JWT over the socket at least every **5 minutes**, and the DO re-verifies it; a socket without a valid re-verification for 10 minutes is closed (treated as a disconnect — engine timing rules apply); (b) the app SHOULD consume Clerk's session-revocation webhooks and proactively close that account's sockets.
- The `ReconnectRequest` of `MESSAGE_PROTOCOL.md` §6 is authenticated by this transport-level identity; its `playerId` field MUST match the socket's bound `accountId` — a mismatch is rejected and logged (anti-hijack rule: **only the account bound to a seat can ever reconnect into it**, §3.4).
- One active socket per `(accountId, roomId)`. A second connect for the same pair **supersedes** the first (old socket closed with an explicit "superseded" close code) — device switching works without a support path.
- Session expiry mid-game is a disconnect; re-login within the engine's timing rules resumes normally (`ARCHITECTURE.md` §7).

### 2.3 Rate limits (minimums, normative)
- Login/magic-link abuse limits: **Clerk-native** (bot protection + attack protection enabled in dashboard); the app adds none.
- Socket connects: 30 / minute / account, enforced in the Worker/DO. Room-layer limits (§3) are enforced in the DO (its serialized execution makes counters trivial). Everything else inherits the per-player action rate limits in `MESSAGE_PROTOCOL.md` §4.

## 3. Rooms — lifecycle before the game

### 3.1 Room states
```
OPEN (lobby, joinable) → IN_GAME (engine owns it) → ENDED (results visible) → destroyed
```
- **`OPEN`:** created by any account; joinable via invite code; host configures §16 game options. Auto-destroyed if it does not start within **60 minutes** of creation (configurable).
- **`IN_GAME`:** entered at game start; the engine state machine (`GAME_SPEC.md` §14.1) governs everything; the platform layer only carries transport and enforces seat↔account binding. Joining is impossible; only bound accounts may (re)connect.
- **`ENDED`:** entered at `GAME_END` (including host-ends from `PAUSED`/`ABORTED`). Final standings remain viewable to bound accounts for **15 minutes**, then the room and all its player-facing state are **destroyed** (decision 3: ephemeral). Nothing about the game is queryable afterward except the ops audit log.

### 3.2 Creation & host
- Any authenticated account may create a room (rate limit: 10 rooms / hour / account). The creator is the **host** — the same host role referenced by `GAME_SPEC.md` §14.1 and `ARCHITECTURE.md` §8a; host migration rules there apply unchanged once `IN_GAME`.
- In `OPEN`, if the host disconnects past 5 minutes, host migrates to the earliest-joined connected member (pre-game analogue of `ARCHITECTURE.md` §8a); if the room empties, it is destroyed.

### 3.3 Invite codes & joining
- Each room has one active **invite code**: **6 characters from the 32-character Crockford alphabet** (no `I L O U` ambiguity; ~10^9 space), generated server-side, also expressed as a join link (`…/join/<code>`).
- Codes are single-room, die with the room, and are **revocable**: the host may regenerate the code at any time in `OPEN` (kicked-player hygiene); old codes stop working instantly.
- **Join-attempt rate limit (normative, anti-enumeration):** 10 failed code attempts / minute / account and 100 / minute / IP; failures return a uniform "invalid or expired code" (no distinction between never-existed / expired / full / in-game — codes must not be probeable).
- Joining an `OPEN` room binds the account as a **member** (max 7; 8th join attempt rejected). Members may **leave** freely in `OPEN` (unbinding fully). The **host may kick** members in `OPEN` only — there is deliberately **no mid-game kick** (the engine has no forfeiture, `GAME_SPEC.md` §15; a mid-game kick would be a new griefing lever aimed at hidden partners).
- An account may be a member of at most **4 rooms** simultaneously (abuse bound; configurable).

### 3.4 Seats & game start
- Game start (host action, requires 4–7 connected members) executes, in order: (1) freeze membership; (2) run the `seatAssignment` policy (`GAME_SPEC.md` §2/§16 — random via audited CSPRNG, or host-arranged); (3) **bind each seat to its `accountId` immutably for the life of the game** and snapshot each `displayName`; (4) broadcast the seating; (5) hand off to the engine at `ROUND_START`.
- The seat↔account binding is the security anchor for everything in `GAME_SPEC.md` §14.2: `playerView(state, viewerSeat)` is only ever sent over a socket whose session resolves to that seat's bound `accountId`. **No other principal can ever receive a seat's view.**

## 4. Post-game (ephemeral teardown)
- At `GAME_END`, the platform shows final standings (competition ranking, `GAME_SPEC.md` §13) to bound accounts for the 15-minute `ENDED` window, then destroys the room, its membership, seat bindings, and invite code.
- **No rematch flow in v1** (consequence of the ephemeral decision): players wanting another game create a fresh room. *Flagged as the most likely v1.1 request* — a "rematch" button is cheap (new room, same members auto-invited) and its absence will be felt; see `OPEN_RISKS.md` P3.
- No stats, leaderboards, or cross-game records exist in v1 (would contradict ephemerality and pull toward the persistent-groups model that was explicitly not chosen).

## 5. Configuration (platform layer)

| Key | Default | Bounds |
|---|---|---|
| Session TTL | Clerk dashboard (target ≈ 90 days) | managed in Clerk, not app config |
| `socketReauthIntervalMin` / `socketReauthGraceMin` | 5 / 10 | fixed floor (§2.2) |
| `lobbyIdleTimeoutMin` | 60 | 5–1440 |
| `endedRoomTtlMin` | 15 | 1–60 |
| `maxRoomsPerAccount` | 4 | 1–20 |
| `roomCreatesPerHour` | 10 | 1–100 |
| `codeAttemptsPerMinAccount` | 10 | fixed floor |

## 6. Out of scope (v1, explicit)
Public room discovery/browsing, matchmaking, friends/blocklists, chat transport (decided out-of-band, `GAME_SPEC.md` §16), spectators (`GAME_SPEC.md` §14.2), rematch (§4), player stats/history, profile media, and any moderation tooling beyond pre-game kick + code regeneration. Adding public discovery later **reopens** the table-talk decision (D2) and requires report/block tooling first.

## 7. Deployment architecture — Cloudflare Workers (normative)

The hosting decision maps onto the game architecture with almost no translation:

- **One Durable Object class `RoomDO`; one instance per room.** A DO executes single-threaded with a serialized event loop — it **is** the "single logical writer per room" that `ARCHITECTURE.md` §1 mandates. The entire apply loop (validate → apply → snapshot → emit, `ARCHITECTURE.md` §1/§8), the room state machine, turn timers, and all room-layer state (§3) live inside the room's DO. Cross-room parallelism is automatic (separate DOs). **No room state exists outside its DO.**
- **WebSockets terminate on the RoomDO**, using the **WebSocket Hibernation API** (sockets survive DO eviction without paying for idle duration; hibernatable sockets carry the bound `accountId` + seat as serialized attachments so identity survives hibernation).
- **Turn timers** (`ARCHITECTURE.md` §6) use the **DO Alarms API**: one alarm per room set to the current turn's `turnTimerMs + graceMs` deadline; the alarm handler runs the timeout default action through the same apply loop. Alarms survive hibernation/eviction — an AFK timeout fires even if every socket is idle.
- **Snapshots** (`ARCHITECTURE.md` §8, after every accepted action) write to **DO transactional storage** (`ctx.storage`), which is strongly consistent and private to the room's single writer — the snapshot-per-`stateVersion` history is a keyed write per action. Room destruction (§3.1/§4) = `deleteAll()` + alarm clear.
- **Stateless Worker (front door):** verifies Clerk JWTs (JWKS), serves the HTTP API (room create, code join → resolves code to DO id), routes WebSocket upgrades to the right `RoomDO`, and hosts the Clerk webhook endpoint (§1.2). The client app ships as static assets on the same Worker.
- **Invite-code → room lookup:** a small **Workers KV** namespace (`code → DO id`, TTL = room lifetime) for the join path, written/invalidated by the RoomDO on create/regenerate/destroy. KV's eventual consistency is acceptable here (worst case: a just-regenerated code works a few extra seconds at another edge — within the P1 accepted risk); the DO remains the authority and re-checks the code on join.
- **Audit log** (`ARCHITECTURE.md` §5): the RoomDO appends round records `{roundNumber, playerCount, seatingOrder, defaultDeclarerSeat, shuffleSeed}` to **R2** with a **30-day lifecycle rule** (matching the retention default). R2 is ops-only; no player-facing read path exists (§4).
- **RNG:** `crypto.getRandomValues()` in the DO satisfies the CSPRNG requirements of `ARCHITECTURE.md` §5 (shuffle seed, round-1 selection, seat assignment).
- **Determinism caveat (normative):** the ChaCha20/Fisher–Yates deal pipeline (`ARCHITECTURE.md` §5) MUST be implemented in portable code inside the DO and validated against KAT-001 in CI on the Workers runtime (`workerd`) itself — conformance is asserted where the code actually runs, not just in Node.

## 8. Platform risks (tracked in `OPEN_RISKS.md` §D-platform)
- **P1 — Invite-code leakage:** a code posted publicly lets strangers fill a room before friends join. Mitigations in v1: host kick (pre-game) + code regeneration. Accepted.
- **P2 — Account sharing:** two humans alternating one account/seat is undetectable and equivalent to table-talk; out-of-band by D2's logic. Accepted.
- **P3 — No rematch friction:** ephemeral rooms force re-create/re-invite after every game. Accepted for v1; strongest candidate for v1.1.
- **P4 — Email deliverability:** magic-link login depends on Clerk's email delivery; OAuth (Google/Apple) is the primary path, email the fallback. Monitor via Clerk dashboard.
- **P5 — Vendor coupling (Clerk + Cloudflare):** accepted; outage behavior and exit paths in `OPEN_RISKS.md` §D-platform.
- **P6 — JWT revocation window (~60 s):** accepted trade-off vs. v1.0's opaque-token rule (§2.1); socket re-auth every 5 min bounds long-lived connections (§2.2).
