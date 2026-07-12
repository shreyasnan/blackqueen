# ♛ Black Queen

**A real-time multiplayer trick-taking card game with hidden, dynamically-formed teams.**

🎮 **Play now:** [blackqueen.shreyas-nangalia.workers.dev](https://blackqueen.shreyas-nangalia.workers.dev) — no account needed, join as a guest in one tap.

## The game

4–7 players. After an auction, the winning bidder secretly recruits partners by *calling a card* — whoever holds it is on their team, but nobody knows who that is (not even the bidder) until the card hits the table. The declarer's team must capture the bid's worth in points (Aces 15, Tens 10, Fives 5, and the Queen of Spades — 30). Everyone else's job: figure out who's with whom, and stop them.

The reveal — the moment a hidden partner is unmasked mid-hand — is the heart of the game, and the UI treats it that way.

## What's in this repo

The unusual part of this project is the **spec-first process**: the game was fully specified, adversarially reviewed, and locked *before* implementation — and the docs remain the source of truth.

| | |
|---|---|
| [`GAME_SPEC.md`](GAME_SPEC.md) | The rules, byte-level deterministic dealing, state machine, hidden-information model (v1.9.1) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Concurrency, timers, snapshots, recovery — one Durable Object per room as the single writer |
| [`MESSAGE_PROTOCOL.md`](MESSAGE_PROTOCOL.md) | The wire contract: actions, events, ordering guarantees, hidden-info-safe payloads |
| [`PLATFORM_SPEC.md`](PLATFORM_SPEC.md) | Identity (Clerk + HMAC guest tokens), rooms, invite codes, ephemeral teardown |
| [`UI_SPEC.md`](UI_SPEC.md) | The design system: table metaphor, set pieces, sound, the "waiting is playing" pillar |
| [`TEST_CASES.md`](TEST_CASES.md) | Normative regression suite incl. the KAT-001 dealing conformance vector |
| [`OPEN_RISKS.md`](OPEN_RISKS.md) | Every known exploit/griefing vector: closed, mitigated, or accepted with a trigger |
| [`blackqueen/`](blackqueen/) | The implementation (see its [README](blackqueen/README.md) for dev setup) |

## Stack

**TypeScript end to end.** A pure, zero-dependency game engine (`applyAction` + `playerView` are the only two entry points the server touches) · Cloudflare Workers + a Durable Object per room · React + Motion client with procedural SVG avatars and Web Audio–synthesized sound (no asset files) · Clerk auth with guest play · Vitest + fast-check property tests.

Key properties, enforced by tests in CI:
- **Deterministic dealing** — ChaCha20-based shuffle, reproducible from a seed tuple, locked by a known-answer vector.
- **Hidden information by construction** — clients only ever receive `playerView(state, seat)`; a property test serializes every view of thousands of randomized games and asserts no hidden card or unrevealed partner ever appears.
- **No stuck states** — every turn has a timeout default (auto-pass / auto-play / pause), proven by an auction-termination invariant.

## Develop & deploy

```sh
cd blackqueen && npm install && npm test          # engine + server suites
cd packages/client-react && npm install && npm run dev
```

Deploys are CI-driven: **push to `main`** → GitHub Actions runs the full suite → builds the client → ships to Cloudflare. Red tests block the deploy. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

---

*Built as a collaboration between [Shreyas Nangalia](https://github.com/shreyasnan) and Claude (Anthropic), from first spec review to production.*
