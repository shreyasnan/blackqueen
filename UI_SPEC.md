# Black Queen — UI/UX Specification

**Version:** 1.1 (companion to `GAME_SPEC.md` v1.9.1, `MESSAGE_PROTOCOL.md` v1.3; replaces the M5 minimal client)
**v1.1** absorbs two reviews: a design-lead critique (drama, pacing, readability, retention) and a game-feel/joy pass (humor, character, warmth). Headline changes: waiting-is-playing pillar (§1), concentrated art bet + Queen personality bible (§2), first-open experience + retention endgame (§3), trick tethering + tension strip + last-trick review (§4), hand fidgets (§5), reveal variance tiers + tempo system + spectacular failure + rare ceremonies (§6), sonic logo + silence design (§7), **new §8: Personality & Humor** (reactive avatars, table toys, writing voice), **curated emotes moved INTO scope** (product decision, §11), stream mode + connection UX (§10), smile-count playtest gates (§14).
**Product decisions (owner):** playful & illustrated; **React + TypeScript + Motion**; responsive **browser** app, desktop and mobile equal; gesture-first; sound + optional haptics; mouse/touch/trackpad/keyboard all first-class; **no native app**; **engine strictly separate from UI layers**. **New (v1.1): six fixed non-informational emotes are in scope** — see §11 rationale.

---

## 1. Design pillars

1. **The table is the app.** One screen matters. Everything else is a short corridor into it.
2. **Hidden identity is the drama — stage it.** Make suspicion legible; make the reveal theatrical.
3. **Cards feel like objects.** Weight, arc, settle. Never click-and-teleport.
4. **Waiting is playing.** *(v1.1)* Players are idle most of the game. Idle time gets first-class design: toys to touch, history to study, characters to watch. If the waiting player is bored, the game is broken — no set piece fixes that.
5. **Losing must be the funniest part.** *(v1.1)* Kitchen-table games run on delicious catastrophe. Disasters get the best animations; the biggest laugh of the night should be someone's −360.
6. **Playful, never childish; charming, never noisy.** Humor through character reaction and writing, not through clutter. Rare beats > constant beats: anything that happens 100% of the time is furniture.
7. **The server is the truth; the UI is a theater.** Render `ClientView`, animate the event stream, never predict hidden information (§14.2 is a security property).
8. **Session shape is a design surface.** *(v1.1)* A game runs ~40 minutes; mobile attention runs ~10. Mid-game re-entry (backgrounded tab, switched device) must be seamless and *re-orienting*: a returning player gets a 2s "where we are" recap ribbon, not a cold table.

## 2. Art direction — "Playful & illustrated," executed as woodcut

- **Style bet (v1.1 — narrowed):** high-contrast **two-color woodcut/linocut** linework — plum ink + gold accent on warm parchment (midnight-plum variant for dark mode). Chosen because it is *ownable*, ages well, and is genuinely achievable in in-house SVG — geometric-but-warm was an unpriced risk; woodcut turns the constraint into the style. Texture: paper grain, offset-print misregistration on badges. No gradients-as-decoration, no glassmorphism.
- **Concentrate the art budget on ONE extraordinary asset: the Queen of Spades.** If anything is commissioned, it's her. One great Queen carries the brand; eight adequate animals dilute it. She is the app icon, the loading mark, and a *character* (§8).
- **The table surface** is the most-stared-at artwork in the product and is designed as such: a subtly illustrated woodcut tabletop with corner vignettes (the sleeping cat lives here, §8), readable at 20% attention, never competing with cards.
- **Seats are characters:** 8 illustrated animal avatars (fox, owl, cat, badger…) in the same woodcut grammar, tinted per-seat. Avatar + seat color + name is the identity triple everywhere. Avatars are *actors*, not stickers — their reactive animation set is §8 and is load-bearing for the game's comedy and its fake-tell social play.
- **Card faces:** courts get woodcut character faces in-family with the Queen; pips are clean with hand-cut wobble. Four-color deck variant ships day one (§10).

## 3. Screens (the complete set)

1. **First-open / Welcome** *(v1.1)* — before any auth wall: one illustrated panel, five words of pitch ("Hidden teams. Trust no one."), and a 30-second **attract loop** (a hand of the game playing itself, sped up, with a reveal moment) behind the Sign-in button. A joiner arriving by invite link sees "🦊 Nia invited you to a table" with the same panel. Then Clerk components, restyled via appearance API.
2. **Home** — *Create table* / *Join with code* / resume-in-progress banner. One gear: sound, haptics, theme, colorblind, text size, handedness.
3. **Lobby** — invite code as hero (huge, one-tap copy, share sheet). Joined players pop in as avatar chips that *fidget* while waiting (§8). Host: Start (charges up when 4+ seated), game length (uneven-rotation warning shown to everyone, written in plain fun language), seating drag UI if host-arranged. Turn-timer setting shows a live preview of the ring speed.
4. **Table** — the game (§4–§9).
5. **Round interstitial** — overlay, not a screen change (§6).
6. **Game end — the retention surface** *(v1.1, rebuilt)*:
   - **Podium** with competition ranks; co-winners share the top step with a split-crown gag; the winner's avatar **tips its hat to the table** (endings radiate warmth, not ranking).
   - **The story recap:** 3 auto-generated beats from the event log — "Round 4: Nia revealed as the hidden partner", "Biggest swing: Marcus's −200 solo", "Q♠ changed hands 3 times." This is the screenshot.
   - **Shareable result card** (client-rendered image: podium + story beat + woodcut frame).
   - **Session scoreboard:** cumulative across rematches tonight ("Game 3 — Priya leads the evening 2–1").
   - **Play again:** one tap → fresh room, same members auto-invited (P3 mitigation); everyone's "rematch?" tap raises their avatar's paw.

**Corridor rule:** invite link → seated in ≤ 3 taps.

## 4. The table — layout & readability

- **Mobile portrait:** opponents fan across the top arc as avatar chips (name, card-count ring, captured-points badge, turn glow). Trick center. Own hand as thumb-reachable fan. **Desktop/landscape:** radial around-the-table with hover states; designed as a real layout, including an over-the-shoulder-friendly zoom (friends spectate on laptops).
- **Trick attribution (v1.1 — hard requirement):** at 6–7 players, angle alone will not read. Every played card is **tethered to its seat**: seat-colored card edge + a brief flick-line from chip to card on play. And a **last-trick review** affordance — tap/click the (empty) trick area or press T to see the previous trick laid out with seat labels. Table stakes for a trick-taker; exempt from the no-replay anti-scope.
- **Tension strip (v1.1):** the ribbon carries a persistent glanceable per-seat captured-points strip (public data, §14.2) — the score drawer is for detail, never the only copy. Once `allPartnersRevealed`, the strip *transforms* into the team-vs-defenders progress bar with a "teams are known" flourish — the drawer beat from v1.0, promoted to always-visible.
- **Shared rules:** actor's seat glows/pulses; turn timer is a draining ring on the actor's avatar (amber final 10s, visible to all); called cards always visible as mini-cards; trump badge ("?" during `DECLARER_SETUP`).
- **Score drawer:** swipe up / S — full totals, per-seat detail, round history sparkline.
- **Connection UX (v1.1):** a disconnected seat gets a "dozed off" treatment (avatar asleep, §8) + "Nia lost connection…" state; reconnection shimmer; a returning player gets the 2s re-orientation recap (§1.8). During `PAUSED`, the table shows exactly who is awaited and what the host can do ("Waiting on Nia · host can resume or end") — never an unexplained freeze.

## 5. Interaction — input matrix & hand feel

Every action has all four input paths; no action is gesture-only.

| Action | Touch | Mouse/trackpad | Keyboard |
|---|---|---|---|
| Inspect card | tap (lifts + zooms) | hover | arrows move focus |
| Play card | **drag past commit line** or swipe up on selected | drag (no double-click-to-play — misplay bait, removed v1.1) | Enter on focused |
| Cancel | drag back / tap away / 300ms flight-window tap | drag back / Esc | Esc |
| Bid | stepper wheel (flick, 5s) + Bid; Pass wide & separated | same + scroll wheel | ←/→, Enter, P |
| Trump | 4 suit tiles → confirm | click → confirm | 1–4 → Enter |
| Call cards | rank+suit grid (in-play only) → confirm | same | typeahead → Enter |
| Emote *(v1.1)* | long-press own avatar → radial 6 | click own avatar | E then 1–6 |
| Last trick | tap trick area | click trick area | T |
| Score drawer | swipe up/down | click chip | S |

- **Gesture physics:** dragged cards follow with velocity-based rotation; past the commit line (~40% to center) → spring-snap + *thock*; released early → springs back with a soft return sound. Illegal cards physically resist the line, shake + "must follow suit ♥" toast on release (client pre-checks with the engine's `legalPlays`; server stays authoritative).
- **Hand fidgets (v1.1):** drag-to-rearrange your fan (order is local, persisted); long-press hand → sort toggle (by suit / by rank) with a satisfying riffle; idle cards breathe very slightly. Fidgeting is the sanctioned waiting activity — it must feel *good*, not tolerated.
- **Suspicion tools (v1.1):** tap any seat chip → **dossier popover**: cards they've played this round (public), points captured, reveals. No probabilities, no inference help — just organized memory. This is the detective's notebook; the *inference* stays in heads.

## 6. Motion design — set pieces, variance, tempo

All animation is driven by the event stream in `seq` order. 60fps, transform/opacity only.

- **Tempo system (v1.1, global):** animation timings scale with round maturity — trick 1 resolves at 1.0×, the last trick at ~0.7× durations; between-round pacing accelerates similarly across the evening (first deal of the night is ceremonial, later deals brisk). When a round is mathematically dead (R6 dead-rubber), everything runs fast; when a live contract comes down to the last trick, resolution *slows down*. Fatigue-proofing > any asset.
- **Dealing:** round-robin fly from center deck, < 2.5s, skippable; your cards flip and self-sort with a fan-snap. **Rare ceremony (v1.1):** ~1-in-50 deals, a variant plays — trick-shot shuffle, or the Queen deals personally. Players who've seen it tell players who haven't.
- **Bidding (v1.1 — promoted to a poker moment):** bids ripple as woodcut speech bubbles; passes = avatar folds arms and dims (who's-still-in is always visible). Bids ≥ 120 get a **slam-zoom** on the bidder; a 150 stops the table (vignette, beat, gasp sting). Auction end: **one-second held breath** — table stills — then the **declarer is crowned** with a stamp and the standing bubble becomes the contract.
- **Declarer setup:** non-declarers see the declarer's avatar genuinely *acting* — shuffling their cards, tapping the table (one opaque phase, §9). Contract stamp: trump badge + called cards slam down together; slight table shake — this defines everyone's next ten minutes.
- **Trick play:** cards arc in, tethered (§4); trick win = winner's card flips on top, pile gathers and flies to the winner with a whoosh; coin ticks **pitch-rise per point card** in the gather (Balatro grammar).
- **THE REVEAL — variance tiers (v1.1):** the signature moment, now escalating instead of identical:
  1. *Ordinary reveal* — freeze, gold flare, banner sweep, sting, team ring. (~1.2s)
  2. *Reveal on a trick-winning play* — tier 1 + the gather is gilded.
  3. *Final partner revealed* — bigger: both team rings pulse in sync, banner reads "The teams are set." and the tension strip transforms (§4) in the same beat.
  4. *Solo self-reveal* — the biggest: the table goes dark, single spotlight, "…Nia is ALONE." (secret solo declarer playing their own called card).
  - *Jackpot variant:* the called card **is Q♠** → the Queen herself sweeps the banner.
  - Before every tier: 250ms of **acoustic dead air** (§7). Reveals land between turns by spec guarantee; they are never skippable.
- **Round end:** contract MADE → team-colored stamp + gold burst from team seats. FAILED → defenders get a quiet smug beat and the team's cards slump. **Spectacular failure (v1.1):** a failed *secret solo* — the biggest loss in the game — earns the best animation in the product: the soloist's cards explode, the Queen shakes her head slowly, tiny sad trombone. Catastrophe must be delicious.
- **Q♠ capture:** the Queen reacts **only when it matters** (capture swings or seals a contract; ~the biggest 30% of her moments) — rare is what makes her screenshot-worthy. Otherwise the 30-point badge simply lands heavy.
- **Pause/abort:** table dims; the corner cat wakes up confused; clear who's awaited + host controls (§4). Nothing jitters while paused.

## 7. Sound & haptics

- **Sonic logo first (v1.1):** the **reveal sting is the brand** — a two-note motif crafted like a logo, echoed softened at app open and in the win fanfare. It's the thing players hum. Budget disproportionate care here.
- **Silence design (v1.1):** the table has a faint ambient bed (paper, room tone) precisely so it can go **dead silent** for the 250ms before a reveal sting and during the auction's held breath. Quiet is a sound effect.
- **Palette (~20 one-shots, warm woody percussion + soft mallets):** riffle, lift, commit *thock*, soft return, illegal thud, bid pop (pitch rises with value; 150 = near-comic + gasp), pass whiff, crown stamp, contract slam, gather whoosh, coin ticks (pitch-rising), **reveal sting** (+ dark variant for tier 4), Q♠ chime, sad trombone (spectacular failure), made-stamp fanfare / failed wah, your-turn nudge (after 5s idle), final-trick tension loop-let (only when the contract is still live), end fanfare, emote pops.
- **Rules:** no background music v1. Sounds fire on events/gestures only. One-tap master mute persists; fully playable silent (every audio cue has a visual twin). Web Audio sprite, decoded once, unlocked on first gesture.
- **Haptics** (`navigator.vibrate`, progressive): 10ms commit, 20ms trick win, 40ms double reveal, 30ms your-turn; intensity setting incl. off; silently absent where unsupported.

## 8. Personality & humor (v1.1 — new, load-bearing)

- **Avatars are actors.** Each animal has a reactive set (~10 states): sweat as bidding passes their comfort zone, peek smugly at cards, wince at point losses, faint theatrically at −200+, fold arms on pass, doze when AFK (this *is* the connection state, §4), raise a paw for rematch, celebrate, sulk, and an idle fidget loop. Reactions are driven by **public events only** — never by hand contents — so they're comedy and *fake tells*, never information leaks. (In a deduction game, an avatar that "looks guilty" over nothing is gameplay.)
- **The Queen's personality bible.** She is the silent judge of the table. Five expressions, deployed **rarely**: eyebrow-raise at a 150 bid; covers her eyes when a revealed partner's card betrays the declarer's trick; slow-clap when a secret solo lands; slow head-shake over a spectacular failure; wink on a contract-swinging capture. Never more than ~2 appearances per round. She reacts to *moments*, not events.
- **Table toys.** The deck can be poked (shuffles indignantly). The corner cat sleeps, opens one eye when tapped, and stars in the pause screen. Your own cards can be flicked to spin. Two or three doodads, no more — toys, not clutter. This plus hand fidgets (§5) and dossiers is the waiting-is-playing pillar in practice.
- **Writing voice.** Every player-facing string gets a humor pass — flavor over protocol: log lines editorialize lightly ("Nia drops the Queen. *Thirty points of trouble.*"), auto-actions get warmth ("Marcus is off making tea. The table plays on."), warnings get plain language ("Heads up: with 9 rounds, seats 1–2 hold the hot potato an extra time."). Tone: dry, warm, never mocking a *player* — the game mocks situations, not people. All strings live in one reviewed file.
- **Emotes (v1.1 — decision changed, in scope):** six fixed, curated, **non-informational** reactions on a long-press radial: 👋 *Hello!* · 👏 *Well played* · 😬 *Uh oh* · 🎭 *I trusted you!!* · 😂 *(laugh)* · 🫡 *Good game*. Rate-limited (1 per 10s), mutable per-player, no directionality, no free text. Rationale recorded in `OPEN_RISKS.md` D2 note: table-talk is already allowed out-of-band, so voice chat strictly dominates emotes as a signaling channel — the previous ban blocked the warm version while permitting the powerful one. A laugh button in a betrayal game is a comedy engine.

## 9. Spec-driven UX constraints (unchanged correctness rules)

- `DECLARER_SETUP` is one opaque phase for non-declarers: one acting loop, no trump hint, no sub-state progress. Declarer's staged trump renders as a local echo marked "staged — hidden from others."
- Per-seat captured points always visible; **team totals/progress only after `allPartnersRevealed`** (the strip transformation, §4). Round deltas/`success` appear only at the interstitial on `ROUND_SCORED`.
- Rejections are private toasts; no table-visible error theater. Avatar reactions key on **public events only** (§8).
- Ghost-hand + "(auto)" tag + dozing avatar for timeout plays — auto-play is public information and must read as such.
- Reveal fires for the declarer's own called card too (tier 4).

## 10. Accessibility, comfort & viewing

- `prefers-reduced-motion`: set pieces collapse to ≤150ms crossfades (reveal keeps banner, drops flare); tempo system disabled.
- **Colorblind mode** (four-color deck + shape-coded seat rings), **text-size scaling**, **left-handed fan mirror** *(v1.1)*, touch targets ≥ 44px, list-mode hand with Play buttons.
- Full keyboard play + focus-visible; ARIA live region narrates the event log — written once, it doubles as stream commentary.
- **Stream mode (v1.1 — required):** one toggle that hides your own hand behind card backs (tap-to-peek) for screen-sharing. Friends *will* play over Discord streams; in a hidden-information game, leaking your hand to the table is fatal, so this ships in v1. (Full spectator views remain out of scope per `GAME_SPEC.md` §14.2.)

## 11. What the UI will NOT have (anti-scope, revised)

- ❌ Free-text chat or directional/targeted reactions (the six fixed emotes of §8 are the entire social surface; D2 stance otherwise unchanged).
- ❌ Team-total UI before `allPartnersRevealed`; any partner-prediction or probability helpers — inference is the game.
- ❌ Coins, gems, shops, ads, battle passes, streaks-with-rewards, or any meta-economy. (The session scoreboard is memory, not currency.)
- ❌ Full spectator rendering or a replay theater (the last-trick review and end-of-game story recap are explicitly exempt).
- ❌ Background music (v1); autoplaying audio pre-gesture.
- ❌ Confirm dialogs for plays; undo of any kind.
- ❌ Tutorial screens. Onboarding is contextual (§12) — coach marks the first game only, plus **bespoke standing-75 handling**: the first time a player becomes default declarer, a one-beat interstitial explains "You start as the bidder at 75 — you can't pass. Here's what that means." This is the game's most confusing rule and gets dedicated treatment, not a generic tooltip.
- ❌ Dark-pattern nudges; portrait-only or desktop-only features.

## 12. Onboarding (v1.1 — expanded)

First-open attract loop (§3) → contextual coach, 6 beats max, first game only, each pointing at a live element as it becomes relevant: your hand & how to play a card · following suit (fires on first illegal drag, turning the rejection into the lesson) · the bidding ribbon & **standing-75 interstitial** (§11) · what the called card means ("someone secretly holds this — maybe you") · the reveal (post-hoc: "that's how teams come out") · the tension strip when it transforms. Glossary popovers on `Y`, trump, called card, solo — available forever via long-press on ribbon terms. Never shown again after game one; replayable from settings.

## 13. Performance budgets

JS ≤ 250KB gz (React + Motion ≈ 60KB); SVG pack ≤ 150KB; audio sprite ≤ 350KB (grew for variants; holds). First interactive < 3s on mid-range Android/4G. Route-split: table bundle preloads during lobby. 60fps set pieces on a 2021 mid-ranger; transform/opacity only; trick DOM capped at `playerCount` cards. PWA basics: manifest, icon, offline shell for the corridor (no offline gameplay).

## 14. Technical architecture & milestones

Architecture unchanged from v1.0 (binding): `client-react` with `net/` (seq-ordered application, ported 1:1), `state/` (zustand, server truth only), **`theater/`** (pure event-stream → animation/sound/haptic/avatar-reaction cue mapper — no game rules, unit-tested; variance tiers and the tempo system live here as pure functions of the event feed), `components/`, `motion/` (one spring config = one app-wide feel), `audio/`, `assets/` (swappable art package). Engine imports: **types + `legalPlays` only.** Vite → `packages/client/dist`; Worker/wrangler untouched.

- **UI-M1 — Foundation:** scaffold; net/state ported; ugly-but-correct table both layouts; all four input paths complete a game. *Gate: full game on phone + desktop.*
- **UI-M2 — Cards feel real:** woodcut card faces; fan + fidgets + sort; drag/commit physics; deal/trick/gather + tethering + last-trick review; tension strip. *Gate: playing a card feels good ten times in a row.*
- **UI-M3 — The drama:** reveal tiers, auction held-breath + crowning, contract stamp, interstitial, strip transformation, ghost hand, spectacular failure. *Gate: a bystander watching a reveal asks what game this is.*
- **UI-M4 — The comedy:** avatar actor sets, the Queen's five moments, table toys, writing pass, emotes, sound sprite + sonic logo + haptics, game-end retention surface, Clerk restyle, coach + standing-75 interstitial. *Gate: **≥5 out-loud laughs per playtest game** (count them — that's the metric).*
- **UI-M5 — Comfort & ship:** colorblind/text-size/handedness/list mode, keyboard pass, ARIA narration, stream mode, connection UX polish, budget audit, cross-browser (iOS Safari!), PWA manifest; old client deleted. *Gate: silent + reduced-motion both feel finished; budgets green on a real mid-range phone.*
- **UI-M6 — Tuning week (v1.1):** zero new features. Springs, timings, pitch curves, tempo coefficients, Queen appearance rates, ceremony rarity. Feel is made here. *Gate: the team stops being able to agree on further changes — then ship.*

## 15. Changelog

- **v1.1** — Absorbed design-lead review (downtime pillar, reveal variance tiers, trick tethering + last-trick review, auction drama, tension strip, retention endgame, art concentration on woodcut + the Queen, standing-75 onboarding, tempo system, sonic logo, stream mode, connection UX, session scoreboard) and game-feel review (avatars as actors with public-event-only reactions, Queen personality bible, table toys, spectacular failure, rare ceremonies, writing voice, warm endings, smile-count gate). **Decision change:** six fixed non-informational emotes in scope (D2 rationale note). Removed double-click-to-play. Added UI-M6 tuning week.
- **v1.0** — Initial UI/UX spec.
