# CHOP · FINAL DESIGN
### "Slash the latest real Bitcoin block like Beat Saber — 70 seconds, real transactions, seal it forever on your chain."

Synthesised 2026-07-27 from six deep-research tracks (3 Grok deep-research passes + 4 research agents + a prior 6-agent design/roast workflow). Supersedes `chop-block-is-the-level.md`.

---

## 0. THE DECISIVE FINDING — score geometry, not timing

**Mobile web is an 85–110ms input-to-photon platform before we write a line of code.** Native flagship phones measure 86–88ms end-to-end (GameBench); the browser adds a frame. Meanwhile timing-scored rhythm games run judgment windows of **15–59ms** (DDR 15, Arcaea 25, Deemo 50). Worse: `AudioContext.outputLatency` is **unimplemented in WebKit**, so on iOS — where every browser is WebKit — our latency compensation currently returns **0** against a real output path routinely over 100ms, and **178ms on Bluetooth**. iOS Low Power Mode silently halves rAF to 30fps and is undetectable. Over 91% of surveyed mobile players play **muted**.

**A timing-accuracy game is not buildable on this platform.** Every attempt will feel unfair, and no engineering saves it.

**But Beat Saber — whose 115-point score we already borrowed — does not score timing at all.** Its 115 = 70 (100° approach swing) + 30 (60° follow-through) + 15 (cut through centre). A player scores *identically* hitting early or late in the window. It is a pure **geometry** model — and geometry is the one thing a browser measures perfectly.

**Therefore: the kerf directional cut is not a stylistic flourish. It is the only defensible scoring axis on mobile web, and it converts our worst technical liability into our design identity.**

- **Timing** = a single generous **±110–130ms gate**. Hit or miss. Never scored.
- **Score** = **70** axis match against the kerf (angular error with generous falloff) + **30** follow-through past the block + **15** centrality of the cut line.
- Consequence: uncompensated iOS latency, Bluetooth, muted play and Low Power Mode all become **non-issues**.

---

## 1. THE VERB

You are the blade that confirms the block. Transactions from the block just mined pour down a lit **3-lane × 2-row** corridor to a **strike plane** low on screen, inside the thumb arc. Each cube carries a **kerf** — a bright groove showing the one axis the blade must travel. Cut along the grain; it splits along that plane; the block's UNCONFIRMED counter drops. Cut the coinbase last and you **seal** the block.

### The parity inversion (the key mechanical insight)

In VR, Beat Saber's ≥135° angle change *avoids* a reset, because a forehand ends where a backhand starts. **A thumb has no forehand/backhand — it has a stroke and a lift.** So the geometry inverts:

- A **180° reversal** (up→down, left→right) is the **free** motion — one continuous stroke, no lift.
- A **same-direction repeat** (up→up) is the **expensive** one — it is a *jack* (osu!mania's term, named for the jackhammer), requiring a lift and re-place.

**Rule: minimum angle change, not maximum. The cheapest, most flowing chart is a straight oscillation on one axis.** This turns "flow" from hand-authored art into something a generator can obey mechanically.

**Corollary — the cut IS the movement:** a DOWN cut leaves the thumb low, so the next note belongs in the **bottom row**. Lane/row placement follows the stroke.

### Input
**4 cardinal directions, never 8.** No mainstream mobile rhythm game ships 8; Beatstar (the closest structural sibling) uses 4 on a 3-lane portrait highway. A direction misread must **never** cause a miss — Chrome rAF-aligns `pointermove` and Safari lacks `getCoalescedEvents()`, so a fast flick can be a single sample.

**Mandatory:** adopt `getCoalescedEvents()` (feature-detected) in the pointermove handler and feed **every** sample into the trail and cut test. This is the highest-impact single code change for the core verb.

---

## 2. CHART GENERATION — choreography, not entropy

**Principle: do not generate notes — generate an ARRANGEMENT of hand-authored motifs.** Real block data is *entropy*, and entropy charted directly is exactly what "too Fruit Ninja, stale after seconds" feels like. TaikoNation (FDG'21): "just placing notes at appropriate times is not sufficient — patterning is a fundamental component of highly-rated charts." Humans use a **small vocabulary with high reuse** over a **swinging density arc**; per-note randomness produces the opposite on both axes.

**Layer 0 — extract `MUSIC_GRID`.** `music.js` already knows every onset: 136 BPM, 40-bar cycle, 16th = 110.3ms, beat = 441.2ms, bar = 1764.7ms. Refactor `scheduleStep()`'s event decisions into a pure table consumed by **both** the scheduler and the chart generator. One source of truth, two consumers. Regression-guard by diffing 40 bars of scheduled events before/after.

**Layer 1 — motif library.** ~12 hand-authored 1-bar motifs (oscillation runs, reversal pairs, lane sweeps, whale-and-escort). The generator *arranges* motifs across the density arc; the block's hash seeds selection and variation.

**Layer 2 — the block sets the character, not the notes:**
- `tx_count` → overall density band
- `feeRange` percentile ladder → dust/mid/whale mix (sampled with `pow(r, 2.2)` so the mix mirrors reality: ~66/22/12)
- `utxoSetChange` → motif family (a consolidation block "sweeps sideways")
- block interval → **tempo band 126–146 BPM** (a 42-minute block is a slow grinder; a 12-second block is frantic)
- `hash` → deterministic seed for variation

**Fairness invariants (validator-enforced, not vibes):**
- Vision-block rule: avoid the middle two columns 95% of the time; never place behind a face note within one approach window.
- Stroke room: 87% of a note's score is earned *outside* the hit instant, so charts must budget approach + follow-through room or the player is mathematically capped below 100% and feels cheated.
- Reaction time bounds 350–1200ms; large lane jumps get **more** approach time than in-place reversals.
- Six fixed cells, zero jitter, zero random z → **overlap is structurally impossible** (fixes the reported bug at the design level).
- Forbidden patterns ported from BSMG: handclaps, hidden/stacked notes, hitbox abuse, danger-dash, excessive towers.

**Density (one thumb = one saber).** Beat Saber's published NPS bands are totals across two sabers; halved for one thumb: Easy 0.41–1.15 · Normal 0.53–1.71 · Hard 0.87–2.61 · Expert 1.21–3.91 · Expert+ 1.61–5.33. **2.6 NPS is "one-handed Beat Saber Expert" — the correct ceiling for a 30–50yo phone audience, not a floor.**

**Structural fix found in the current music:** the arrangement **ends on the BREAK** (bars 32–39, lowest energy). A 70-second level that is also a trophy must **end on its peak** — reorder so the run climaxes at the seal, and place the block's real whales at that peak.

---

## 3. DIFFICULTY — two layers, and the first three blocks cannot be failed

**The number that determines the architecture: fewer than 7% of mobile users retry after two consecutive failures in their first five minutes.** CHOP must be structurally incapable of failing a first-timer twice. No-fail is not a setting; it is the shape of the first three blocks.

**Split difficulty into two layers — this is the fix for both prior rejections at once:**

- **VISIBLE layer** (note density, lanes in play, cut axes, bomb rate): earned via THE CHAIN, displayed, and **NEVER auto-adjusted**. The moment a game silently moves the yardstick a player measures themselves against, you get the Oblivion level-scaling failure — which is precisely "no goal, stale after seconds."
- **INVISIBLE layer** (contact windows, angle tolerance, approach margin): adapts silently, is capped, is never named, and **never touches score**. This is the coyote-time / Half-Life / RE4 model — the only kind of assist players never resent.

**Ladder: 10 rungs at ×1.18 density per block**, anchored to Beat Saber's published bands (its official downmapping constant is ~20%/tier; ×1.18 gives a finer climb over the same span).

**Ramp inside each 70s block too**, not just across blocks — Beatstar's defining structural choice is that a song's chart level rises as you go deeper.

**Skill expression in three legible layers:** audible (music stems gate on the combo multiplier — extend `setIntensity` from 3 to 5 tiers), visible (trail intensity, cut-quality flourishes), and expert-only (chart lines a beginner can't reach).

---

## 4. LEVELS, GRADES, COMPLETION

**One block = one level = one 40-bar phrase ≈ 70 seconds.** Ends on the coinbase cut → **THE SEAL**: the real hash stamps in, the height ticks up, the chain card mints.

**Score tiers, with researched thresholds:**
- Mid-tier gaps ≈ **8–15% of max**
- Top tier within **1–3% of theoretical perfect** — this is what manufactures productive near-misses
- Target a **~30% near-miss rate**: Kassinove & Schare found 30% maximises persistence on an inverted-U (15% and 45% both perform worse)

Grades: clear → ★/★★/★★★ → medal → perfect-seal. Combo multiplier ×1→×2→×4→×8, **halved** (not zeroed) on a miss.

**Unlimited free retries on the core loop.** Beatstar's success path was core-free with energy only on the competitive mode; energy gating before habit is a top-10 session-1 killer.

---

## 5. PROGRESSION — THE CHAIN

**The live block is the scarcity engine and it is honest:** every ~10 minutes the entire planet gets a chart no human has ever played. Free, infinite, self-authoring. No content pipeline competes with that.

**THE CHAIN is the meta-object.** Every sealed block mints a card printing **block height + timestamp + fee/tx fingerprint + your grade + directional cut stats**. They render as a growing linked chain. It is a *personal timechain of skill against history*, not a stamp book.

Collections work when items have **identity, scarcity, narrative and display** (Pokémon, GitHub contribution graphs, Strava) and fail when they are identical stamps on a progress bar. Because the chart is `f(height, hash, tier)`, storing 32 bytes of hash + the height makes **every block you have ever sealed permanently replayable, bit-identical** — the chain is a playable library, not a trophy shelf.

**THE ARCHIVE** unlocks at chain milestones — real historical blocks through the same generator: **57,043** (the pizza block) at 5 sealed, **210,000** (first halving) at 12, **774,628** (the 2023 ordinals fee storm — its absurd fee tail generates as a whale-storm level) at 21.

**THE DAILY SEAL** is the ritual peak: one canonical block per UTC day, one shared board, everyone on the identical chart, spoiler-free share grid (Wordle DNA).

**Never punish absence.** The chain never burns. No "you lost 47 days." Scarcity comes only from unrepeatable reality ("block 912,xxx is gone forever" is honest); guilt-driven streak mechanics are refused.

---

## 6. WHAT WE REFUSE (ethics line, explicit)

No loot boxes or paid random rewards. No pay-to-restore streaks. No confirmshaming. No streak-freefall guilt. No grind that skill cannot skip (the FTC has called grind-to-pay a dark pattern). No token, no gacha, no "GameFi." Variable *grade quality* from skill is fine; variable payoff from money is not.

---

## 7. X-LINKING

**Never a gate.** Ask at the moment of victory.

- **Moment 1 — boot card, passive:** `⛏ 31 CHOPPERS ON THIS BLOCK` · *link 𝕏 to seat your name* (text link, not a button)
- **Moment 2 — mid-run crown line:** `👑 @satoshistacker ✓ · 94.1%` (one board-global HMGET, CDN-cache safe)
- **Moment 3 — THE PROMPT**, only on an earned moment (top-20, grade S+, or a personal best): the grade lands → the board animates in → their row scrolls into place → **their nameplate is blank, engraved, reading `— unnamed —`** → then:

> **YOU'RE 4TH ON BLOCK 959,891.**
> This board dies when the block does.
> Link 𝕏 and your handle rides every block you seal — and your chain follows you to any device.
> `LINK 𝕏 →`  ·  `stay unnamed`

Microcopy elsewhere: **`Link X · show @you on the board`** / *"Read-only. Your handle on leaderboards + cloud saves. We never post."*

---

## 8. SHARE LOOP

X's 2026 algorithm: **native video > images/GIF > text**, and **external links in the post body are heavily suppressed**. Therefore:

- **Main post = native media + dare copy, NO URL**
- **Reply 1 = the play URL + dare/seed id**
- CTA is competitive and one-tap: challenge *their exact seed*, not a homepage

**Share card contents:** `CHOP · LIVE CHAIN` / big grade+score / `Block #XXX,XXX` / `Seeded from Bitcoin · not random` / `@handle` if linked / `Beat this line →`. Plus a spoiler-free lane heat-grid (Wordle DNA) for every finisher — **not gated on winning** (the measured Kart funnel defect).

---

## 9. PRIOR ART — the honest position

**Mempool Space Invaders** (April 2026) already shipped live unconfirmed BTC transactions as enemies with a sat bounty. Bitfeed, TxStreet, BitListen are live visualisers. So "first game to touch mempool data" is **false** and must never be claimed.

**What remains genuinely unclaimed is the composition:** a mobile-browser *rhythm-slicer* whose notes and lanes are live block structure, with production-grade swipe feel, code-generated adaptive music, honest haptic degradation, X identity and a dare share loop.

**Own publicly:** "The chain is the chart." / "You play today's tip." Never "first to use mempool data."

---

## 10. HAPTICS — the honest platform truth

- **Android:** Vibration API works in all browsers. Patterns `[on, off, on]` ms, **no amplitude**. 10–20ms for keyclick-class feel.
- **iOS:** **no browser has it** — all iOS browsers are WebKit. Can I Use lists Safari iOS 3.2→26.5 as not supported. PWAs don't fix it (16.4 gained push, not haptics). The iOS 17.4 `<input type=checkbox switch>` haptic trick was **patched by Apple in iOS 26.5** — do not build a pillar on it.
- **iOS answer:** an **audio pseudo-haptic** — a sub-40Hz thump fired in coincidence with the slice SFX. Not the Taptic Engine, but it is what web games that care actually ship.
- **This matters less than feared:** game-feel research ranks **audio-visual coincidence #1**, hitstop #2, and **haptics #7**.

**Native (phase 2, not now):** Capacitor wraps the same web build — 3–7 days for shell + `@capacitor/haptics` (→ `UIImpactFeedbackGenerator`), ~3–6 weeks calendar with store review. Policy risk for a theme-only, no-wallet, no-payout game is **low** (Apple 3.1.5 governs custody/mining/exchange/pay-for-tasks, not aesthetics). **Sats-prize leaderboards inside an app binary are high risk** (3.1.5(v), possibly 5.3) and need licensed rails. The real cost is reach: store visit→install for games converts in the **single digits (~5%)**, versus a tweet link that plays in 3 seconds. **Web-first; native later as a retention upgrade**, triggered by real demand.

---

## 11. TECHNICAL CONTRACT (mobile web)

- **60Hz** ceiling (iOS Safari caps rAF at 60), **10–12ms** frame budget at thermal equilibrium (not 16.6), **<100 draw calls**, **<150MB** GPU memory, page footprint **under ~200–300MB** before Safari jetsams the tab.
- Drop `antialias: true` (does nothing once EffectComposer owns the target); set MSAA samples on the composer target instead. Clamp **DPR to 1.5** by default.
- Quality tier + live FPS probe over the first 3–5s (the pattern Bitcoin Kart already proved).
- **Three audio lifecycle bugs to fix first**, each a total-failure mode for a subset of users: set `navigator.audioSession.type = 'playback'` (or the silent-HTMLAudio-loop fallback) or every ring-switch-muted iPhone gets a silent rhythm game; handle context resume on backgrounding; decode buffers before first gesture.
- **Calibration:** no wizard. Infer from the first block, seeded from `outputLatency` → `baseLatency` → device-class default. Never gate play on calibration. (A wizard has <100% completion; inference has 100%.)

---

## 12. TARGETS

Free browser game: **good** = D1 25–35%, D7 8–12%, D30 2–5%. **Excellent** = 40/15/5. Median mobile game is 22.9/4.2/0.85, so "excellent" is a real bar.

Time-to-first-slash **< 4 seconds** from boot tap. Players decide in ~7 seconds; churn is settled inside 30–60s. 39% of early quits are simply "not fun."

---

## 13. BUILD ORDER (each milestone showable on your phone)

**M1 · THE CORRIDOR + THE COUNTER — the fun gate.** Rip out the ballistics (`GRAVITY`, apex solve, wave spawner). Constant-velocity approach on 6 fixed cells, kerf grooves, geometry scoring, ±120ms gate, `getCoalescedEvents()`, hitstop. **Plus the four cheap magic devices so M1 is not bitcoin-free:** the UNCONFIRMED counter counting down from the block's real tx_count with `+N` pops, the `×N` dust stamps, the coinbase as the final note, and the live "sealed N ago" clock. *If this is not fun, stop.*

**M2 · MUSIC_GRID + generator.** Extract the grid, build the motif library and the chart generator + fairness validator. Reorder the arrangement to end on the peak. Extend intensity to 5 tiers gated on combo.

**M3 · THE BLOCK IS THE LEVEL.** THE POUR (open inside the packed block at its true weight fill), real whale txids fetched and tappable through to mempool.space, block-character mapping (tempo band, motif family), the briefing card.

**M4 · COMPLETION.** Grades, medals, near-miss tuning to ~30%, the seal ceremony (full only on firsts/PBs; 1.2s and tap-skippable otherwise), instant retry.

**M5 · THE CHAIN + DAILY SEAL.** Chain ledger with real per-block fingerprints, permanent replay from 32-byte hash storage, archive unlocks, daily board.

**M6 · ARCADE BACKEND + THE X MOMENT.** Board keys, score packing, the earned-moment prompt, share card + dare seed.

**M7 · POLISH.** Quality tiers, audio lifecycle fixes, inferred calibration, haptics ladder with honest iOS degradation, reduced-motion contract, verify-suite invariants.

**Phase 2 (deferred):** Capacitor native for real Taptic haptics.

---

## 14. RISKS

- Touch direction misreads on iOS (mitigated by geometry scoring + coalesced events + direction-never-misses).
- Scope: M1 alone rewrites the gameplay half of a ~1,700-line file.
- Extracting MUSIC_GRID risks changing how the music sounds — diff-guard it.
- Whale txid fetch adds an upstream call; must stay in the CDN window and degrade honestly.
- A per-block board has a ~10-minute life and can look empty on a fresh block — the Daily Seal board is the mitigation.
