# Black Queen — Playtest Audit (July 12, 2026)

**Setup:** Live playtest on production (blackqueen.shreyas-nangalia.workers.dev) via Chrome. Guest account, 6-player 2-deck table (300 pts, 2 partner cards), 5 bots. Played one full round end-to-end as declarer: won the standing 150, chose trump, called 10♣ + A♠, played through 17 tricks to a **BID MADE (160/150)** finish. Also exercised: lobby flows, pause/resume, invalid-start, the claim reveals, and the round-end screen.

**Verified working well:** the whole 2-deck economy (300 points conserved, standing 150, cap math), both ⭐ claim moments ("Botrick is with the declarer! (A♠)") with instant team-color flips and the partners banner, staged trump surviving a pause, the "Q♠ — thirty points of trouble" feed color, the round-end insight card, and per-seat capture tracking. The core v2.0 game is correct in production.

---

## 0. BLOCKER — v2.1 is not deployed (CI failed on your push)

Your push went up, but the **test job failed on commit `93108f4`, so deploy was skipped** — production still runs `ui-20-two-decks` (v2.0). The hand-size feature is not live.

**Cause (mine):** two v2.0 tests assumed the 2-deck default deals the whole deck; v2.1 changed that default to 12 cards. CONFIG-004 and CLAIM-001 needed `handSize` pinned explicitly (17), like I'd already done for KAT-002 but missed for these.

**Fixed:** both tests now pin `handSize`; the full vitest suite runs **77/77 green** (verified in a real vitest run this time, not just the harness). The fixes are already saved in your repo — just push:

```sh
cd ~/Documents/Claude/Projects/black\ queen
rm -f .git/HEAD.lock .git/index.lock
git add -A
git commit -m "fix tests: pin handSize=17 in v2.0 2-deck suites (v2.1 default is 12)"
git push
```

Then hard-refresh and confirm `ui-21-hand-size` on Home.

---

## Top gameplay issues

### G1 — "Away" fast-forward is a trap you can't escape (SEVERITY: HIGH)
After my first two timeouts, the server put me in away fast-forward (~12s turns) — correct per spec — but then it was nearly impossible to get back in: the two-tap play flow plus the short budget meant the auto-player beat my second tap **six turns in a row**, dumping my A♣/K♣/J♣ while I watched. And the UI never says you're in away mode.
**Suggested changes:**
- Show a prominent **"You're on auto-pilot — tap any card to take back control"** banner while away.
- Make **the first tap (arm) cancel the pending away auto-play** for that turn (arming proves presence — reset to the full turn budget immediately, not after a completed play).
- Consider requiring only ONE tap to play while in away-recovery.

### G2 — No visible turn countdown anywhere (SEVERITY: HIGH)
I never saw a ticking indicator — not on the seat plate, the YOUR TURN badge, or the NOW card. You only learn about the timer when it fires (auto-play or PAUSED). This amplifies G1 and G3.
**Suggested change:** countdown ring around your avatar (subtle >10s, amber <10s, pulsing red <5s) + a soft tick sound in the last 3 seconds. The seat-plate ring existed in an earlier build — it appears to have been lost in a layout pass.

### G3 — Declarer setup can PAUSE the whole table on a first read (SEVERITY: MEDIUM-HIGH)
As a first-time declarer reading the new claim-model copy and scanning a 52-identity grid, I hit the timeout and paused the game for everyone. The 2-deck partner picker is a genuinely bigger decision than v1; the budget doesn't scale.
**Suggested changes:** give DECLARER_SETUP its own longer budget (e.g. 90s once per game for a player's first-ever declare, 60s otherwise), show the countdown inside the modal, and at T-10s flash "choose or the table pauses."

### G4 — Auto-play donates the declarer's contract (SEVERITY: MEDIUM, by design but worth softening)
Spec-correct "least valuable legal card" is a disaster for an away declarer — it fed 65 points to a defender in one trick. A failed contract via disconnection feels bad for the whole team.
**Suggested change (spec change, so your call):** keep least-valuable for defenders, but for the declarer/partners consider "lowest card of the longest non-point suit, prefer winning the trick if the trick holds ≥15 points and a sure winner exists." Alternatively leave the engine pure and treat this as further motivation for G1/G2.

### G5 — 2-deck round length: your 10–12-card instinct is right (OBSERVATION)
The 17-card round took ~8 minutes even with instant bots; with 6 humans it'd be 15–20 minutes per round × 8 rounds. Ship the v2.1 default of 12 (blocked on issue 0) and consider defaulting N to `1 × playerCount` rounds for 2-deck games instead of `2×`.

---

## Top UI issues

### U1 — Start game button silently does nothing in an under-filled 2-deck lobby (SEVERITY: HIGH)
With 4/6 players in a 2-deck room, "Start game" is enabled, clicking it does **nothing** — no toast, no hint. The server rejects correctly, but the client swallows the error.
**Suggested change:** disable the button below 6 players with inline copy "2-deck games need 6–7 players — add 2 more"; and surface any `/start` error as a toast (belt and braces).

### U2 — Card play interactions fight each other (SEVERITY: HIGH)
Three overlapping issues:
1. **Tap-to-arm is invisible as a mechanic** — nothing tells you a second tap plays; the armed card just rises 24px. New players will tap once, wait, and time out (exactly what I did).
2. **The arm animation moves the card away from your cursor/finger**, so the confirming second tap in the same spot can hit the *neighboring* card and arm that instead.
3. The center-table hint says "your lead — drag a card up" only for leads, never mentioning tap-tap.
**Suggested changes:** show a floating "tap again to play ▲" chip above an armed card; expand the armed card's hit area to include its original bounds; lengthen the disarm window (2.2s → 4s); update the hint to "drag up **or double-tap**."

### U3 — Stale v1 partner copy in the sidebar during 2-deck setup (SEVERITY: MEDIUM)
The NOW card during declarer setup reads "Pick trump, then call a card — whoever **holds** it becomes your secret partner." In 2-deck games membership is claim-based (first to *play*) and never secret. The modal itself has the right copy; the sidebar contradicts it.
**Suggested change:** branch the NOW copy on `deckCount`: "…whoever **plays the first copy** joins your team — could be anyone."

### U4 — Played cards overlap seat plates at the bottom seat (SEVERITY: MEDIUM)
Your own played card lands partially on top of your seat plate/avatar, hiding your captured-points count mid-trick (screenshot: my Q♣/10♥ sat on the "You" plate). The radial positioning is too tight for the bottom seat.
**Suggested change:** pull the bottom seat's trick-card anchor ~40px up-table (its radial offset needs to be asymmetric because the hand fan pushes the seat plate up).

### U5 — Hand cards are invisible to accessibility tools (SEVERITY: MEDIUM, latent)
The hand renders as anonymous divs — no `role="button"`, no `aria-label` ("Play the King of Hearts"), nothing in the accessibility tree. Screen-reader play is impossible and automated testing is harder than it should be.
**Suggested change:** `role="button"`, `aria-label`, and `aria-disabled` on each card; the arrow-key/Enter handler already exists, so this is mostly labels.

### U6 — Post-pause modal state loses your picks (SEVERITY: LOW)
Staged trump correctly survives pause/resume (nice), but partner-card picks do not — after resume I had to re-pick both cards with the timer already running.
**Suggested change:** keep `picked` in the store keyed by round number instead of component state, so resume restores it.

### U7 — Minor polish list
- "1 cards" / "0 cards" on seat plates — needs pluralization.
- The round-end modal floats over a second identical "Play round 2" button behind it — hide the table-level button while the modal is up.
- The stale-bundle cache: after this deploy, index.html still served the old JS to a warm browser until a query-string bust. Consider `Cache-Control: no-cache` on index.html specifically (assets are hashed, so they can stay immutable).
- Old hashed bundles accumulate in `dist/assets/` (three now). Harmless, but a build-time clean would keep the repo tidy.

---

## Suggested priority order

1. **Push the test fix (issue 0)** — everything v2.1 is stuck behind it.
2. G1+G2 together (away-mode banner + countdown ring) — they're one "presence" feature and fix the single worst play experience.
3. U1 (silent start failure) and U2 (tap-to-play affordance) — both are first-session killers.
4. G3 (declarer setup budget), U3 (copy fix) — quick wins, ship with the above.
5. U4–U7 + G4/G5 as the next polish pass.
