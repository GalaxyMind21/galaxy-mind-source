# CHOP · THE BLOCK IS THE LEVEL

Design doc generated 2026-07-27 from a 6-agent research + design + roast workflow.
Operator rejected the Fruit-Ninja build; this is the Beat-Saber-structured redesign.

**Operator-voice critic verdict on design v1: REJECTED** — its five fixes are listed at the end and MUST be folded into the build.

## CORE LOOP

**THE VERB: you are the blade that confirms the block.**

Transactions from the block that was just mined pour down a lit 3-lane corridor toward you at constant velocity and arrive at a STRIKE PLANE (a machined bar ~30% up the screen, inside the thumb arc). Each cube carries a KERF — a bright groove scored across its face showing the one axis the blade must travel. You cut it along its grain, on the beat, and it splits along that plane. The block's UNCONFIRMED counter drops. When the last one is cut you seal the block and its real hash stamps in.

**Why it is skillful — four independent axes, none of which the current build has:**

1. **Direction.** Every non-free cube must be cut on its authored axis. Beat Saber's 100°-preswing/60°-followthrough scoring has no thumb analog, so the touch substitute is: the stroke must *begin outside* the cube's radius and *end outside* it. A tap-in-place scores the floor. This is what converts "swiping" into "cutting."
2. **Timing.** Notes are only live within ±140ms of arrival. Before that the blade passes through with a dull ping and no effect — which teaches timing in one swipe with no tutorial.
3. **Parity / flow.** Consecutive authored directions differ by ≥90° (a chart-validator rule, not a suggestion), so the thumb oscillates like a pendulum and the return stroke *is* the next note. This is the mechanical difference between swiping and dancing, and it is fully portable to one finger.
4. **Routing.** Direction errors and misses are punished *differently* (see `levels_and_completion`), so on a dense bar you are choosing between protecting accuracy and protecting streak. Two axes in tension = a strategy.

**Fixed musical contract** (learnable in 15 seconds, and it is the answer to "you're not really slashing to a beat"):

| music event | 16th slots | note |
|---|---|---|
| kick | 0, 8 | **DOWN** |
| snare | 4, 12 | **LEFT / RIGHT**, alternating |
| stab | 2, 6, 10, 14 | **UP** |
| ghost 16ths | 3, 7, 11, 15 | chain links (free direction) |
| open hat | 14 | whale accent slot |

Down on the kick, every time, in every level. That single rule makes the game *feel* like a chart within four bars.

**Deletions from the current build (each is the direct cause of a symptom the operator named):**
- `GRAVITY`, `APEX_Y_MIN/MAX`, `SPAWN_Y`, `KILL_Y`, and the `vy` solve in `spawnTarget()` — a parabola's apparent velocity changes continuously, so it is physically un-timeable. → constant-velocity corridor.
- `buildWave()`'s five random wave shapes with per-note `sampleFeeR(rng)` — random arcs at random lanes maximizes pattern-space coverage, which the TaikoNation measurements show is the *opposite* of the human-authored signature (humans cover only 14–16%).
- `jit()` continuous lane offsets, random z-offset `0.15 + (rng()-0.5)*0.9`, random `spin`, random `apexY` — four independent overlap vectors.
- `densityTier()`'s monotone staircase — flat/monotone density is the single strongest generated-content tell.
- `rng() < 0.08` inline bomb rolls — bombs get calendared slots with a stated job or they don't ship.

**Kept wholesale** (the feel layer is good; the chart layer was the entire defect): the hitstop ladder, 3-layer slice SFX, haptics ladder, `heardTime()` latency compensation, bar-quantized intensity crossfade, ember/spark/trail work, the ceremony bell, all materials and post.

## THE MAGIC

**Requirement: understood in 30 seconds, felt, zero paragraphs.** Six devices, in the order the player meets them.

**1. The boot plate has a clock that is counting up.**
```
      BLOCK 959,891
 SEALED 0:47 AGO · F2POOL · 2,847 TX
```
That `0:47` ticks in real time from the block's real timestamp. Nothing says "this is live" like a running clock you didn't expect. It is one line of DOM.

**2. THE POUR — the level opens *inside* the block.**
Before the first note, the camera is nose-against a solid packed slab of ~2,800 instanced micro-cubes, rendered at the block's true weight fill (99.8% full looks packed; a 40%-full block visibly has gaps). One bar of hold. Then on the downbeat it CRACKS and the first transactions come down the corridor at you. You are physically emptying the block. No sentence can do this.

**3. The counter counts DOWN, and it is the block's real tx count.**
`2,847 UNCONFIRMED` → `2,833` → `2,791`. Cutting a dust cube pops `+14 tx` (it is the dust cohort's share, and the cube wears a small `×14` corner stamp). Cutting a whale pops `+1 tx`. That single HUD number, moving, *is* the explanation. It is also the completion condition, so the magic and the goal are the same object.

**4. Whales are REAL, named, and checkable.**
The API gains one upstream call (`/api/block/{hash}/txs/0`, 25 txs — blocks are ordered by fee so page 0 is the whales plus coinbase). Whale slabs wear a real txid prefix and a real amount:
```
a3f9…c02 · 0.84 BTC · 712 sat/vB
```
The results screen makes each one tappable → `mempool.space/tx/a3f9…`. Cutting a specific stranger's 0.84 BTC transaction and then *looking it up* is the moment the abstraction collapses. The rest of the swarm stays honestly synthesized from the real fee percentiles, exactly as `/api/chop-block` already documents.

**5. The finale is the coinbase.**
The last note of every level, on bar 39 beat 1, is one enormous gold-black slab: the miner's own transaction, the block reward, paying themselves. `F2POOL · 3.125 BTC + 0.41 BTC FEES`. You cut the block reward and the level ends. Nothing has to explain what a coinbase is — it arrives last, it is the biggest thing you have ever cut, and it has the miner's name on it.

**6. THE SEAL — proof-of-work, watched.**
On the coinbase cut, everything stops and the block's REAL hash stamps in character by character, left to right, at ~40ms/char:
```
00000000000000000000a3f9c02e…
^^^^^^^^^^^^^^^^^^^^
```
The leading zeros land last and light gold, one at a time, with a machine-press thud each. Twenty zeros, twenty thuds. Every player in the world learns what difficulty means in three seconds without being told.

**7. Live-chain interrupt (already half-built — promote it).**
The existing 30s tip poll stays. When the real chain advances mid-run, the world jolts, the bell rings, the sign reads `959,892 JUST MINED · QUEUED`, and — new — the rest of the level runs at **×1.5 FRESH BLOCK BONUS**. A rewarded event, not a notification. The chain moved while you were playing and you got paid for being there.

**Honesty guardrails (non-negotiable, and they are what make the magic hold up to a bitcoiner):** the cube count never claims to be the tx count; dust cubes wear their `×N` stamp; when `/api/chop-block` returns `ok:false` the game says `OFFLINE WORLD · REPLAYING BLOCK 959,847` and plays an archived block rather than faking a live one — the same posture the route already takes.

## INPUT MODEL

**COMMITTED: 4 cardinal directions (↑↓←→), never 8, on a 3-lane × 2-row portrait corridor. Timing and direction judged SEPARATELY. Direction can never cause a MISS.**

**Why 4 and not 8.** No mainstream mobile rhythm game ships 8. Project Sekai has exactly two flick kinds and had to add a FLICK indicator just to tell players when their direction was misread. Chunithm's flicks are *non-directional* and appear only in MASTER/ULTIMA. Beatstar — the highest-grossing Western mobile rhythm game, and the closest structural sibling — uses exactly four, on a 3-lane portrait highway. Beat Saber's 8 are a two-arm VR affordance; even there, dot notes (any direction) read measurably faster than arrow notes because arrows add a decode step. 4 is the empirical ceiling for a thumb.

**Why direction never misses.** Browsers make this non-optional. Since Chrome 60, `pointermove` is throttled and delivered aligned to `requestAnimationFrame` — on a 60Hz phone your swipe is quantized to ~16.7ms buckets, arriving up to a frame late. Safari/iOS does not implement `getCoalescedEvents()` at all, so on iPhone the sub-frame path of a fast flick is simply unrecoverable. The current `onPointer()` derives direction from a *single* `prev → p` segment, which is the worst case on the platform that matters most. A 40px thumb flick misread as LEFT instead of DOWN must never cost a 200-combo.

**Geometry (world space, Three.js, portrait).**
- Camera `(0, 1.60, 6.5)` looking at `(0, 1.10, 0)`, vFOV 58°. Strike plane at `z = 0`, drawn as a machined bar.
- Lanes: `x = −1.15, 0, +1.15`. Rows: `y = 1.02` (LOW), `y = 1.86` (HIGH). **Six cells, zero jitter, zero random z.**
- Cube edge by tier: dust 0.62, mid 0.80, whale 1.05. Max half-width 0.525 vs lane pitch 1.15 → ≥0.10 world gap between adjacent cells at all times.
- Screen check at 390pt width / 844pt height: a mid cube subtends ~11% of screen height ≈ **93pt** (floor is 44pt iOS / 48dp Android); lane pitch ≈ 135pt separation. Comfortable.
- HIGH row is locked at tier 1 (EASY is one row) and unlocks at tier 2 — progressive disclosure, and it keeps the entry chart trivially readable.

**Approach.** Constant velocity toward the camera. Speed and read time both scale with tier so corridor length stays ~constant for scene composition:

| tier | read time R | speed v | corridor Zc |
|---|---|---|---|
| 1 DUST | 1.00s | 8.0 u/s | 8.00 |
| 2 MID | 0.88s | 9.5 u/s | 8.36 |
| 3 WHALE | 0.76s | 11.0 u/s | 8.36 |
| 4 MAXI | 0.66s | 12.5 u/s | 8.25 |

Never below 600ms. Beat Saber's floor (~425–500ms) is a two-arm VR number; a thumb on a 6-inch screen that it partially occludes needs more. At 136 BPM one beat is 441ms, so tier 1's 1.00s is ~2.3 beats — very close to the current spawner's 2-beat lead, making this a cheap retune rather than a re-derivation.

**Timing windows** (half-widths, judged at first hitbox contact):

| grade | window | timing points |
|---|---|---|
| **BLADE** | ±25ms | 25 |
| **PERFECT** | ±50ms | 22 |
| **CLEAN** | ±90ms | 15 |
| **RAGGED** | ±140ms | 6 |
| MISS | beyond | 0 |

Calibrated against the shipped mobile set — Arcaea PURE ±50 with an inner max-PURE ±25, Deemo ~±50, Phigros ±80, World Dai Star ±40/±70/±100 — deliberately looser than arcade tap windows (maimai/Chunithm ±16.7) because a slash is a *gesture* note, and every cabinet that ships both grades gestures an order of magnitude wider than taps (Chunithm ±16.66 tap vs ±266.67 air). BLADE exists to give the leaderboard a ceiling worth grinding without punishing casuals.

**Direction judgment (separate gate, no window of its own).** Timing comes from contact; the direction only has to resolve before the note expires. Acceptance cone **±40° per direction with 10° dead bands** between adjacent directions — an exactly-diagonal flick is rejected as *sloppy* rather than silently assigned to a direction the player didn't intend.
- Correct axis + polarity → full 60 direction points.
- **Wrong direction inside the timing window = RAGGED CUT**, not a miss: the cube shatters along the wrong plane with a torn-edge VFX and an ugly detuned SFX, scores timing + quality only (max 55/115), and **drops the combo multiplier one tier** (×8→×4) without zeroing it. Beat Saber's "a bad cut beats a miss" rule.
- Only an **uncut** note zeroes combo.

**Stroke qualification and quality (30 points).**
- Minimum travel **28 CSS px** (~4.5mm — under the 10–14mm adult finger pad, so it reads as a flick not a drag). Retain the existing `SWIPE_MIN_SPEED` gate.
- **Direction vector integrated over the last ~60ms / 3 samples**, not the current single segment. Use `getCoalescedEvents()` where available as a bonus, never as a dependency.
- Quality = `0.4·(startedOutsideRadius) + 0.4·(endedOutsideRadius, ≥0.55 edge past center) + 0.2·straightness`, scaled by a speed term. Registered at contact (immediate hitstop/VFX), **settled on stroke end** — so the score pop lands a beat later, which reads as follow-through.

**Two-thumb:** never required, always allowed. Two simultaneous *directional* strokes are never charted (Beat Swiper's top review complaint is importing Beat Saber's per-hand color rule onto one device — "you can't use the red swipe on the right side, so some cubes can't be swiped"). **No cube is ever bound to a specific thumb.** The one place a second thumb earns its keep is the CHAIN note, where a long sweep is easier with the off thumb.

**Calibration (currently absent on the input side).** `music.js` already compensates the *visual* clock via `outputLatency`/`baseLatency`; there is no input offset anywhere. Ship two independent offsets (the arcade Offset-A/Offset-B split): audio offset seeded from `outputLatency`, and an **input offset defaulting to −60ms** (flagship touch-to-photon measures ~86ms; even native guidance says treat "0ms" as really 5–10ms). Calibration UI is **4 taps** — the human eye is very keen at comparing two flashing objects, you don't need 20 — and **the tap target makes no sound**, or latency-scheduled audio contaminates the measurement. Stored per-device in `localStorage` and **never cloud-synced**, per the arcade cloud contract's durable-only rule (same class as the kart's dynamic-assist window).

**Telegraphing — four redundant channels, and no arrow glyph anywhere.**
1. **THE KERF LINE** — a bright machined groove scored across the *entire* front face along the cut axis. A line to trace, not a symbol to decode. Survives to ~30px where a glyph does not. This is the load-bearing choice: players of directional rhythm games report arrow icons "tricked their brain into pressing the direction on them rather than the part of the grid they fell on."
2. **EXIT CHEVRON NOTCHES** on the two edges the blade should leave through — the cube reads as physically pre-scored, like a chocolate bar. Legible in peripheral vision, resolves polarity late.
3. **COLOR CODES THE AXIS, NOT THE DIRECTION** — vertical-axis kerf = Bitcoin orange, horizontal-axis kerf = the scene's existing violet-teal complement. Beat Saber binds color to *hand*; CHOP has no hands, so it binds to axis. The first read at distance becomes a **1-bit decision**, and ↑-vs-↓ resolves from the chevrons up close. *This is the mechanism that lets CHOP ship 4-way where every other mobile game hedged to 2.*
4. **FREE CUBES CARRY NO MARKING AT ALL** — a smooth unscored face. Absence is the signal, costs zero pixels, and is Beat Saber's dot-note convention exactly.

**Cuttability gate.** A note is inert until `|z| ≤ v × 0.14`. The blade visibly passes through an early cube with a dull ping and no split. One swipe teaches the timing window with no words.

## CHART GENERATION

**Principle: do not generate notes — generate an ARRANGEMENT of hand-authored motifs.** The research is unambiguous on why generated charts feel dead. TaikoNation (FDG'21): "just placing notes at appropriate times is not sufficient… patterning is a fundamental component of highly-rated charts," and their measured Pattern Space says human charts cover only **14.45% (Taiko) / 16.06% (DDR)** of possible note windows versus **21.3%** for the generator that beat the baseline. Humans use a *small* vocabulary with *high* reuse over a *swinging* density arc. Per-note randomness gets you the exact opposite on both axes.

**Layer 0 — extract `MUSIC_GRID` (do this first, it unlocks everything).**
`music.js` already knows every onset: 136 BPM, `PHRASE_BARS = 40` (INTRO 8 / BUILD 8 / DROP 16 / BREAK 8) = **70.6s, which is exactly one level.** Beat 441.2ms, bar 1765ms, 16th 110.3ms. Refactor `scheduleStep()`'s event decisions into a pure table:

```js
MUSIC_GRID.eventsAt(bar, six) → {
  section, kick, snare, ghostSnare, hat, openHat,
  ghost16, stab, bassOnset, fillStep, riser, chordDegree
}
```
consumed by BOTH `scheduleStep()` and the chart generator. One source of truth, two consumers — the same discipline the README already enforces for market numbers. Regression-guard the refactor by dumping 40 bars of scheduled events before and after and diffing.

Onset slots per bar, read straight out of the current source: **intro** ~10 (kick 0/8, hats evens, pad 0) · **build** ~14 (kick all four, hats evens, stabs 6/14, bass per beat, riser last bar) · **drop** **16 — every 16th is live** (kick 0/4/8/12, snare 4/12 + ghost 10, full hats + double-time, stabs 2/6/10/14) · **break** ~9. Fills on 16ths 8–15 of every section's last bar.

This makes the **overmapping invariant a one-liner** — `assert every note.t ∈ MUSIC_GRID.onsets` — which no MIR-based generator can ever guarantee. BSMG calls overmapping "almost universally problematic." We get it free because we own the music. **This is CHOP's genuine structural advantage over every rhythm game it is imitating; do not waste it.**

---

**Layer 1 — Block → LevelSpec (deterministic, and every field is SHOWN on the briefing card).**

Live `/api/v1/blocks` carries far more than the route currently projects. Add: `nonce`, `difficulty`, `extras.utxoSetChange`, `totalInputs`, `totalOutputs`, `segwitTotalTxs`, `avgFeeRate`, `coinbaseSignatureAscii`, plus one new upstream call to `/api/block/{hash}/txs/0` for 25 real notable txs + the coinbase.

```
LevelSpec = {
  lengthBars: 40 (or 80 for a >20min block),
  densityScale: f(tx_count, weight/4e6)      → 0.75 … 1.25
  whaleSlots:  spread<100 ? 1 : spread<500 ? 2 : 3   // feeRange[6]/feeRange[3]
  motifFamily: sign(utxoSetChange) > 0 ? DIVERGENT : CONVERGENT
  chainRatio:  segwitTotalTxs / tx_count      → chain-note frequency
  readTimeAdj: f(medianFee)
  houseRule:   POOL_RULES[pool.slug]          // recurring, learnable
  palette:     pick 5–7 motifs from hash bytes
  variations:  nonce bits → mirror/retro/shift ops
}
```

**Verified live: the range is real.** I pulled the last 15 blocks. `tx_count` 2,908→6,226 (**2.1×**), median fee 0.50→3.99 sat/vB (**8×**), fee spread 30→1,447 (**48×**), segwit 82.9→99.1%, `utxoSetChange` −1,657→+6,272 (**sign flip**), interval 0s→2,551s (**42 min**), 8 distinct pools. A 6,226-tx Binance block with a 1,447× fee spread and +5,412 UTXOs is a dense, divergent, one-gold-note-decides-it level. A 2,950-tx ViaBTC block at −1,657 UTXOs is a sparse convergent grind. These are not cosmetic differences.

**The load-bearing binding — cut axis comes from the transaction's own shape:**
- **fan-out** (outputs > inputs — a payout/batch) → **VERTICAL kerf**. You split it down the middle, into many.
- **consolidation** (inputs > outputs — UTXOs collapsing) → **HORIZONTAL kerf**. You sweep across and merge them.
- **simple spend** → **no kerf**, free cut.

And the halves separate *along the direction the money went*. A consolidation block therefore plays as a level where everything sweeps sideways; a fan-out block splits vertically. **The operator's "no explanation of how the boxes correlate with the block" is solved by the input design, not by a tooltip.**

---

**Layer 2 — Section plan (top-down; never left-to-right).** Assign the *arc* before any note exists. Target density scalar per 8-bar group, deliberately **non-monotone** because flat density is the strongest generated tell (DDC's measured failure, and precisely the operator's "stale after a few seconds"):

```
bars  0–7  INTRO   0.35
bars  8–15 BUILD   0.50 → 0.65 → 0.80 (ramp)
bars 16–31 DROP    1.00, with a SCRIPTED 2-BAR BREATHER at bars 24–25 (0.0),
                   then reprise at 1.05
bars 32–39 BREAK   0.40 → FINALE
```
× `LevelSpec.densityScale`. **The breather is the thing DDC cannot do and the thing the operator felt the absence of.**

**Calendar the rare events; never roll them.** The whale lands ONLY on the drop downbeat (bar 16, six 0) and the drop's final bar. Bombs get named slots. BSMG's law governs: *"If everything is emphasized, nothing is emphasized."* The current `rng() < 0.08` inline bomb roll is deleted.

---

**Layer 3 — The motif bank (this is the "feels authored" engine).**

Hand-author **~24 two-bar motifs**, tagged `(section, densityTier, family)`, each a list of `{six, lane, row, dir, type}` relative to bar start. Example:

```js
M_PENDULUM_A = [           // build/drop, CONVERGENT
  {six:0,  lane:0, row:0, dir:'D', type:'kerf'},
  {six:4,  lane:-1,row:0, dir:'L', type:'kerf'},
  {six:8,  lane:0, row:0, dir:'D', type:'kerf'},
  {six:12, lane:1, row:0, dir:'R', type:'kerf'},
]
```

The hash picks **5–7 motifs into the block's palette, and the level may use nothing else.** Variation operators are selected by `nonce` bits: `mirrorX` (lane flip + L/R polarity flip), `rotate90`, `halveDensity`, `doubleDensity`, `laneShift ±1`, `retrograde`.

**Authoring rules, straight from BSMG's map-context section ("if you want to use risky patterns, it is usually best to introduce them early on in the map in clear ways"):**
- Every palette motif is **STATED in the intro or build before it may appear in the drop.**
- Structure per motif: **A → A′ (one variation) → A-inverted in the drop's second half.**
- **REUSE FLOOR INVARIANT: any motif instance count < 3 is illegal.** A motif appearing once is deleted and replaced by a repeat of a sibling. This is the direct operationalization of the 14–16% pattern-space finding.
- ≥70% of all notes must belong to a motif instance occurring ≥3 times.
- Similar sections get similar motifs; contrasting sections get contrasting ones.

---

**Layer 4 — Note vocabulary (the block's semantics, mapped to Beat Saber v3's objects, which were designed for exactly these musical shapes).**

| note | tx meaning | musical trigger | behavior |
|---|---|---|---|
| **FREE** | simple spend | any onset | any direction |
| **KERF** | fan-out / consolidation | kick / snare / stab | authored axis |
| **CHAIN** (3–5 links) | batch payment, 1-in-many-out | ghost 16th runs, fills | one continuous stroke; ratio set by `segwitTotalTxs/tx_count` |
| **ARC** (unscored rail) | RBF / pinned tx | into a new motif | **zero score, zero punishment** — Beat Saber: *"Arcs don't have any score, as their power comes from their guidance and connection without punishing players."* This is the coaching mechanism: it physically draws the path into a new pattern, mid-level, with no tutorial text. |
| **WHALE SLAB** | a REAL notable tx, txid + amount on the face | drop downbeat, open hat | long committed stroke or it only cracks |
| **BOMB** | dust-spam / RBF-replaced | calendared only | do not cut; ≥1.4s telegraph; own lane |
| **THE SEAL** | the coinbase | bar 39 beat 1 | the finale |

---

**Layer 5 — THE VALIDATOR (generate → validate → re-roll with salt+1, max 8 tries, else canonical safety chart).** Spelunky's guaranteed-solution-path architecture, transposed to time. Every one of these is an invariant in `scripts/test-chop-chart.ts`, wired into `npm run verify`:

1. **Cell quantization** — 6 cells, zero jitter, zero random z.
2. **Cell occupancy** — a note owns its cell for `[tArrive − readTime, tArrive + 0.15]`; two notes may never hold overlapping intervals in the same cell. *(This is the overlap bug, dead.)*
3. **Column clarity** — within a note's final 300ms, no new note may spawn in the same LANE. BSMG: *"if you place down a face block, avoid placing other blocks in that half of the grid until the half jump duration has passed. Do not sacrifice vision for the sake of pattern setup — this alienates players."*
4. **Thumb travel** — `cellDistance / Δt ≤ 2.2 cells per beat` at 136 BPM. Violation relocates the later note to the nearest legal cell, or drops it.
5. **Parity** — consecutive directions differ by ≥90°, OR are ≥1 beat apart. No two identical directions within 250ms (a thumb lock). Enforced at *generation* time, not as a post-hoc lint — note that real `bs-parity` admits it "only looks at cut direction, not note position," a gap we don't inherit because we own both.
6. **No ambiguous simultaneity** — two notes at one timestamp are legal ONLY if they share a row AND a direction (one stroke takes both). Otherwise offset ≥1/8 beat. Kills "which one do I swipe?", the mobile analog of Beat Saber's forbidden handclaps.
7. **Reaction floor** — every note visible ≥ `readTime(tier)`, *including* the first note after the breather (post-breather re-entry is where generated charts ambush people).
8. **Density ceiling — thumb-calibrated, NOT Beat Saber's.** BS publishes Easy 0.82–2.29 → Expert+ 3.21–10.66 NPS, but those are *two arms in VR*. **One thumb: 1.2 / 2.0 / 3.0 / 4.0 NPS** (= 2.1 / 3.5 / 5.3 / 7.1 notes per bar). ≥20% reduction per tier down.
9. **No overmapping** — `note.t ∈ MUSIC_GRID.onsets`. Free.
10. **Motif reuse floor** — ≥3 instances each, ≥70% coverage.
11. **Solvability sim** — a headless perfect-player using the (4) thumb-travel model must clear 100%. If it can't, regenerate. BSMG's warning applies to us doubly: *"mappers struggle identifying readability issues since they know intended motions."* An automated solver is our only substitute for the testplays we will never get. (Same discipline the kart already uses — its gap widths are sized by a real headless clearance sim, not a guessed constant.)

`test-chop-chart.ts` runs **500 synthetic LevelSpecs across the full verified live range × 4 tiers** and asserts zero validator failures and zero fallbacks.

---

**Layer 6 — KEYSOUNDING (the "you're actually playing the music" feeling).**
Because the note grid *is* the synth grid, CHOP can be keysounded like beatmania IIDX, where "the player isn't just hitting notes to a beat, they're also creating the song as they go along." `chopSfx()` already pitches hits to an A-minor pentatonic degree by combo — half the machinery exists. A confirmed cut **adds** its layer: kick note → sub thump, snare note → the crack, stab note → the pentatonic degree. Full-combo a bar and the bar sounds *complete*; miss and it sounds thin.

Two rules from the same literature, both load-bearing: keysound volume sits slightly **above** the bed so the player hears their own playing, and **a miss must never create silence** — the bed always carries, or a miss punishes twice (score AND music), which is the fastest way to make a hard chart feel unfair.

---

**Layer 7 — Publish a ★ difficulty, computed from the GENERATED CHART, not the block stats.** osu!-style: accumulate strain over a decaying window (osu! uses `strainDecayBase` 0.15 aim / 0.3 speed), log-reduce the top spikes so one burst can't dominate. CHOP's three skills: **density** (speed), **thumb travel** (aim), **direction-change cost** (technique). Print it: `BLOCK 959,891 · ★4.7`. Now blocks are comparable, hard blocks become events people tweet, and the "is today's block hard?" conversation writes itself.

## LEVELS AND COMPLETION

**A LEVEL = ONE BLOCK = ONE 40-BAR PHRASE = 70.6 SECONDS.** It has a fixed end, and the end is the coinbase.

**Four difficulty tiers, each a genuinely different authored chart over the same block** — not a speed slider. Bitcoin-native names, so the ladder is also vocabulary:

| tier | NPS cap | read time | rows | direction set | note types |
|---|---|---|---|---|---|
| **DUST** | 1.2 | 1.00s | 1 | free + DOWN | free, kerf |
| **MID** | 2.0 | 0.88s | 2 | 4-way | + chain, arc |
| **WHALE** | 3.0 | 0.76s | 2 | 4-way | + whale, bomb |
| **MAXI** | 4.0 | 0.66s | 2 | 4-way, tight parity | all |

**You ladder by re-chopping the same block one tier up.** This is a *tighter* progression than Beat Saber has, because it converts "I finished" into "I haven't beaten it on WHALE yet" without needing a content library.

**Completion state.** The UNCONFIRMED counter reaches 0 on the coinbase cut → **THE SEAL**: the real hash stamps in, zeros lighting one at a time, the height ticks up on the sign, the chain-ledger card mints. This is unambiguous, thematically exact, and it is the same object as the goal.

**Scoring — 115 points per note** (Beat Saber's number, touch-adapted):
- **60** direction (binary within the ±40° cone; 0 on a wrong-direction cut)
- **30** stroke quality (started outside radius · ended ≥0.55 edge past center · straightness · speed)
- **25** timing (BLADE 25 / PERFECT 22 / CLEAN 15 / RAGGED 6)

**Two axes in tension — this is the whole strategy layer.**

*Accuracy* = earned / max, → letter grade:
`SSS 100 · SS ≥95 · S ≥90 · A ≥80 · B ≥65 · C ≥50 · D below`

*Combo multiplier* is separate and vicious: **×1 → ×2 (8 clean) → ×4 (16) → ×8 (32)**.
- **Wrong direction → multiplier drops ONE TIER (×8→×4), combo survives.**
- **Uncut note (miss) → combo to 0.**
- **Bomb cut → combo to 0** + `REORG!` (keep the existing bomb copy, it's perfect).

So on a dense bar you are actively choosing: throw a sloppy-but-present stroke to protect the streak, or commit to the direction and risk the miss. Beat Saber's official advice — keep combo "even if that means sacrificing some Hit Score accuracy" — proves this is a real decision, not a reflex.

**Medals** (independent of grade — the 3-star replay-value mechanic: *"if a 3-star system was not in place, players would never have revisited any level"*):
- 🥉 **BRONZE** — sealed
- 🥈 **SILVER** — grade A+
- 🥇 **GOLD** — grade S+
- 💎 **DIAMOND** — grade S+ **and fewer than 8 non-PERFECT notes** (Beatstar's precision gate, which is what makes Diamond mean something)

**Badges** (distinct from grade, and this is the pair people chase):
- **FULL CONFIRM** — zero missed transactions
- **CLEAN SEAL** — zero wrong-direction cuts
- **BLADE RUN** — ≥50% BLADE-window notes

**Objectives that force technique** (per-block, rotating, drawn from Beat Saber's campaign vocabulary — score target, max combo, *limited* combo, technique constraints):
`FULL-CONFIRM THE DROP SECTION` · `SEAL WITH NO WRONG-DIRECTION CUTS` · `GOLD ON WHALE TIER` · `CUT EVERY WHALE IN THE BLADE WINDOW`

**Fail and retry — cheap, instant, legible.** The retry literature is blunt: rhythm games survive on "quick-paced death loops with instant respawns and tight loop timing," and competence motivation dies when "failure feels random or poorly communicated."

An energy bar labeled **CONFIRMATIONS** (6 segments). Miss drains 1, bomb drains 2, clean cut refills 0.25. At zero:

> **BLOCK ORPHANED**
> The screen goes cold blue, the corridor lights cut, the hash stamp cracks down the middle.
> One button, thumb-sized, dead center: **`RE-MINE →`**

Restart is **under one second** — identical chart, no menu, no interstitial, no refetch, no ad. **Because the chart is `f(hash, tier)` the retry is bit-identical.** You are re-attempting the same puzzle, not rolling new dice. That is the entire difference between "one more try" and a shrug — and it is the single most important consequence of making the block the level.

**NO-FAIL toggle** exists (Beat Saber's model): you can always finish, but a no-fail seal is stamped `SOFT SEAL`, is worth 0.7× on the board, and is visibly worth less. You can always finish; finishing soft is legibly cheaper.

**Post-run breakdown** — a per-section strip showing which notes you fluffed and how (early / late / wrong-direction / missed), so the player knows exactly what to fix. Fruit Ninja misses are illegible, which is why the current build's failures feel like noise.

## PROGRESSION

**Three shelves, one ledger, one ritual.**

**1. THE LIVE BLOCK — the scarcity engine, and it is TRUE.**
The tip block's chart exists for ~10 minutes and then never again. Home screen: `⛏ MINED 2:14 AGO · ★4.7 · 31 SEALED IT` with the clock running. This is Beat Saber's "brand new custom map nobody has played" freshness engine, except it is free, infinite, self-authoring, and honest. **Every ~10 minutes the entire planet gets a chart no human has ever played.** No content pipeline can compete with that, and it costs us nothing.

**2. THE DAILY SEAL — the habit ritual.**
One canonical block per UTC day (the first block after 00:00 UTC, deterministic), one shared board, everyone on the identical chart. Slots straight into the arcade's existing daily pattern (`gm:lb:chop:day:v1:{n}`, UTC day number, TTL self-expiry). A push topic `chop` mirrors the existing `wen-drop` cron: `TODAY'S SEAL IS OPEN · BLOCK 959,912 · ★5.1`.

**3. THE CHAIN — the collection, and it is the meta-object.**
Every block you seal mints a card: height, pool, ★, grade, medal, date. They render as an actual **chain of blocks** on the home screen, linked, scrolling horizontally, and it GROWS. Your chain length is your identity. Concrete, glanceable, screenshot-able, and thematically inevitable.

Chain milestones unlock **THE ARCHIVE** — hand-curated historical blocks, real blocks through the same generator, needing zero special-casing:

| unlock | block | why |
|---|---|---|
| 5 sealed | **57,043** | the pizza block |
| 12 sealed | **210,000** | the first halving |
| 21 sealed | **774,628** | the 2023 ordinals fee spike — an absurd `feeRange` tail, so it generates as a whale-storm level |
| 50 sealed + a GOLD | **BLOCK 0 — GENESIS** | the boss. One transaction. The coinbase. `The Times 03/Jan/2009 Chancellor on brink of second bailout for banks` renders in the sign as the real `coinbaseSignatureAscii`. |

*"Chop the pizza block"* is a tweet. *"Play my rhythm game"* is not. **The Archive is the marketing.**

**4. STREAK.** Consecutive UTC days with a Daily Seal. Joins the arcade's existing shared `streak` cloud key (day-continuity merge, never naive max). Surfaced on the MobileBottomNav Play tab's open-dailies badge, exactly like WEN and the Gauntlet.

**5. BLADES — cosmetic, cheap to build, high perceived value, and they are what people screenshot.**
Trail color + slice SFX skins unlocked by medals: `HOT KNIFE` (10 Gold), `LIGHTNING` (a Diamond), `GENESIS` (seal block 0), `ORANGE PILL` (30-day streak). Zero gameplay effect, zero monetization, pure identity.

**6. DIFFICULTY ASSIST — AUTO / RELAXED / STANDARD**, reusing the kart's shipped pattern wholesale: device-local last-4-run window with hysteresis, and **assists ANNOUNCE themselves** via the toast channel (`THE CHAIN EASES`), never silently. The block sets the level's *character*; the player's tier sets the density ceiling and reaction floor. Same block, same motifs, same identity, playable at ★2 or ★6 — which is also what stops a 6,226-tx block from being unplayable for a newcomer.

**7. CLOUD SAVE.** Register `chop` in `CLOUD_MERGES` with the durable-only contract: chain ledger (union by height, best-of grade per block), medals, blades, per-tier PBs, stats (MAX not SUM), streak pair with day-continuity. **Never synced:** today's day-state, unsent board posts, or the input calibration offset (device setting, same class as the kart's assist window).

**Why someone comes back tomorrow, ranked:** (a) today's Daily Seal is a block that will never be playable again, (b) their streak is at risk, (c) they have a Silver on block 959,891 and they know a Gold is there, (d) the chain is 19 blocks and Genesis unlocks at 50, (e) someone took their board slot and they got the push.

## X LINKING

**Principle: ask at the moment of victory, never as a pre-game gate, and never gate sharing on winning** (the kart funnel's measured defect — every finisher shares, not just winners).

**MOMENT 1 — Boot card. Passive, non-blocking, plants the frame.**
Bottom of the briefing card, small, alongside the block stats:
> `⛏ 31 CHOPPERS ON THIS BLOCK`
> `link 𝕏 to seat your name` *(text link, not a button)*

**MOMENT 2 — Mid-run crown line.** Top-right, tiny mono, non-interactive:
> `👑 @satoshistacker ✓ · 94.1%`

Resolved via one board-global `HMGET` on `gm:arcade:xprofiles` (the kart's pattern), so the 30s CDN cache stays valid. Seeing a real `@handle ✓` on a board you are currently climbing is the ask, made without asking.

**MOMENT 3 — THE PROMPT. Post-seal, and only on an earned moment** (top-20 on the block board, OR grade S+, OR a personal best). This is the whole play.

Sequence: the grade lands → the board animates in → their row scrolls into place → **their nameplate is blank, engraved, reading `— unnamed —`** → *then* the card:

> **YOU'RE 4TH ON BLOCK 959,891.**
>
> This board dies when the block does.
> Link 𝕏 and your handle rides every block you seal — and your chain follows you to any device.
>
> `LINK 𝕏 →`
> `stay unnamed`

Post-link toast: **`SEALED AS @handle ✓`**, and the nameplate re-engraves in place with their handle. That re-engrave animation is the payoff and it should be good.

**Decline handling.** Ask once per session. Never nag mid-run. Re-ask only on a *new* earned moment, with different copy:

- On a personal best: > **NEW PERSONAL BEST ON BLOCK 959,891.** > `Want your name on it?` → `LINK 𝕏 →` / `not now`
- On a Diamond medal: > **DIAMOND. 6 PEOPLE HAVE EVER DONE THAT ON THIS BLOCK.** > `LINK 𝕏 →` / `not now`
- On streak day 3: > **3-DAY STREAK.** > `Link 𝕏 so it survives a lost phone.` → `LINK 𝕏 →` / `not now`

**MOMENT 4 — SHARE, available to every finisher including orphans.** Button: **`SHARE THE SEAL`**. Native PNG media share (the kart's shipped lesson — link cards convert far worse than media). Tweet text:

```
SEALED BLOCK 959,891 ⛏ F2POOL
★4.7 · SS · FULL CONFIRM
4th of 31 · 2,847 tx confirmed
▓▓▓▓▓▓▓▓▓░ 96.2%

galaxymind.space/chop
```

Orphan variant (failure is shareable too — it is funnier, and it converts):
```
BLOCK 959,891 ORPHANED ME AT 61% ⛏
that 712 sat/vB whale was not real

galaxymind.space/chop
```

**MOMENT 5 — THE DARE (the growth loop, modeled on the kart's dare-ghost).** The share link carries the block: `/chop?block=959891`. A recipient lands on **that exact chart** with a board already populated — `@handle sealed this at 96.2%. Beat it.` Mint-on-share so KV volume tracks sharing intent, 7-day TTL. The block board is a finite, shared, *expiring* arena, which is the strongest possible frame for a dare.

**Backend wiring.**
- Boards: `gm:lb:chop:block:v1:{height}` (TTL 7d) · `gm:lb:chop:day:v1:{n}` · `gm:lb:chop:v1` (all-time chain length + best grade).
- Score packing in `lib/arcade-score.ts` alongside the runner/timechain schemes: `accuracyBP × 1e6 + min(sats, 999_999)` — accuracy basis points primary, sats as the true secondary sort key (the runner's 2026-07-10 lesson: never pack a real-valued secondary into four decimals).
- **Verification posture — be honest in the README.** The chart is `f(height, hash, tier)` and the scoring math has no rAF/wall-clock dependency, so the server re-derives the chart and re-scores the submitted `[noteIdx, dtMs, dirDeg, quality]` log with **no upstream price/series dependency and no possibility of a 503**. That is stronger than the salt-token posture Kart and Super Saylor carry, but it verifies **ACHIEVABILITY** (the score falls out of a real chart, note count matches, every note ≤115) rather than live play — it cannot prove a stroke was human. Document it as its own tier. Do not claim WEN/Gauntlet parity.
- All of it degrades to the anonymous culture-handle path when X is unlinked or unconfigured, per the existing contract.

## FIRST 60 SECONDS

**Block 959,891 · F2POOL · 2,847 tx · MID tier · first-ever run. 136 BPM, 1 bar = 1.765s.**

**0:00** — Boot plate. `BLOCK 959,891` in machined type. Under it, monospace, typing in: `SEALED 0:47 AGO · F2POOL · 2,847 TX`. **The 0:47 is counting up in real time.** One button: `CHOP →`. First proof this is live, delivered before a single frame of gameplay.

**0:01** — Tap. AudioContext unlocks. Pad swells. Darkness.

**0:02–0:03** — **THE POUR.** Camera pulls back off a solid packed slab of ~2,800 instanced micro-cubes — the block at its true 99.8% weight fill. It is *heavy*. HUD seats: `2,847 UNCONFIRMED`.

**0:04 (bar 0, downbeat)** — Kick. The slab **CRACKS**. The corridor lights: three lanes, the strike plane bar ignites across the bottom third.

**0:05–0:08 (bars 1–2, INTRO)** — **ONE note.** Free cut, no kerf, center lane, low row, arriving on the kick with a full 1.0s of read. A ghosted finger arc animates across it exactly once. Player swipes. Cube splits, halves peel apart, `+14 tx` pops, counter drops to **2,833**, and the sub-thump layer joins the music because *they* played it. Nothing can be failed here.

**0:09–0:13 (bars 3–4)** — Three more free notes on kicks 1 and 3. The lesson lands with no words: **cut on the kick.**

**0:14 (bar 5)** — **First KERF note.** Orange vertical groove, center lane. The kerf pulses once at 1.5s out. One coach card, one line, 1.2s: **`CUT ALONG THE GRAIN`**. Down-stroke → `PERFECT` → first ×2.

**0:15–0:21 (bars 6–7)** — Alternating free / DOWN-kerf on kicks. Then the first **cyan horizontal kerf** on the snare, beat 2 → LEFT. Parity engages: down, left, down, right. The thumb starts oscillating. This is where it stops being Fruit Ninja.

**0:22 (bar 8 · INTRO→BUILD)** — Fill roll. Bass enters. Lanes widen to all three. Density steps to ~1.6 NPS. Counter ~**2,590**.

**0:23–0:30 (bars 9–12)** — Motif A stated, then A′ (mirrored). Combo passes 8 → **×2**, second combo segment lights, filter opens on the bass. The player has now heard the same shape twice and their thumb recognizes it before their eyes do. *That is the authored feeling, manufactured.*

**0:31 (bar 13)** — **First CHAIN.** A batch payout: four links physically joined by a lit bar, sweeping L→R across the lanes, taken in one continuous stroke. `+61 tx`. New verb, introduced clearly, exactly as BSMG prescribes.

**0:32–0:38 (bars 14–15)** — Build ramps. Stabs bring UP-kerf notes on 6 and 14 — all four directions now in play. 2.2 NPS. The riser starts. The progress ring visibly fills toward the drop.

**0:39–0:41** — **Riser peaks and every note stops for two beats.** Screen darkens. The strike plane charges white. Counter reads ~**1,900**. Pure anticipation, zero input.

**0:42 (bar 16 · THE DROP)** — Drop lands. Every corridor light snaps on, bloom punch, and **THE WHALE** arrives dead center in the HIGH row: a gold slab at twice size, wearing a **real** txid and a **real** amount —

> `a3f9…c02 · 0.84 BTC · 712 sat/vB`

It needs a long, fast, committed down-stroke or it only cracks. 90ms hitstop on contact. `+1 tx · 41,200 sats`. **This is the 30-second mark's payoff and the exact instant the player understands these are real transactions.**

**0:43–0:55 (bars 17–23)** — The drop proper. 3.0 NPS, full palette, both rows, direction changing every note, chains on the ghost 16ths. Combo hits 16 → **×4**. Peak.

**0:56–0:58 (bars 24–25)** — **THE SCRIPTED BREATHER.** All notes stop. The beat keeps going. One line, center: **`1,102 LEFT`**. The pocket where they notice they are winning — and the thing a flat-density generator can never do.

**0:59–1:00 (bar 26)** — Drop reprise, 3.2 NPS. The **first BOMB** appears: red, telegraphed 1.4s out, in a lane entirely to itself. `DO NOT CUT` is implied by every visual cue and nothing is written.

*(Beyond the minute: bars 27–31 the reprise peaks, bars 32–39 BREAK ramps down and the counter falls under 200 — and on **bar 39 beat 1, THE COINBASE**: one enormous gold-black slab, `F2POOL · 3.125 BTC + 0.41 BTC FEES`, the miner paying themselves. Cut it. Everything stops. The real hash stamps in character by character, the twenty leading zeros landing last and lighting gold with a press-thud each. Grade. Medal. Board. Blank nameplate.)*

## BUILD ORDER

**M1.** **M1 · THE CORRIDOR — the fun gate. Showable on a phone, day one.** Rip the ballistics out of `main.js` (`GRAVITY`, `APEX_Y_MIN/MAX`, `SPAWN_Y`, `KILL_Y`, the `vy` solve, `buildWave()`, `jit()`, random z/spin, `densityTier()`). Add: constant-velocity corridor, 3 lanes × 1 row at `x = −1.15/0/+1.15`, `y = 1.02`, strike plane at `z = 0`, camera `(0,1.6,6.5)`. Kerf-line + chevron cube materials (extend the existing `onBeforeCompile` shader — the bevel/metal/fresnel work is already right). 4-direction judgment with the ±40° cone and 10° dead bands, 3-sample direction integration (fixes iOS's missing `getCoalescedEvents`). Timing windows ±25/50/90/140. Cuttability gate at `|z| ≤ v×0.14`. Keep every existing feel system: hitstop, SFX, haptics, sparks, trail, hitflash. ONE hand-authored 40-bar chart, hardcoded — no generator yet. Live block still drives fee colors and the HUD. **Operator test: does slashing to this beat feel good on a phone? Ship nothing else until the answer is yes.** ~600 lines new, ~450 deleted.

**M2.** **M2 · MUSIC_GRID + the generator.** Extract `MUSIC_GRID.eventsAt(bar, six)` out of `scheduleStep()` as a pure table consumed by both the scheduler and the chart builder; regression-guard by diffing a 40-bar scheduled-event dump before/after (the music must sound bit-identical). Author the ~24-motif bank with the parity/statement rules. Build `chart.js`: LevelSpec → section arc (with the bars 24–25 breather) → motif arrangement → variation ops → validator (all 11 invariants) → re-roll on failure → canonical fallback. Ship `scripts/test-chop-chart.ts` (500 synthetic LevelSpecs across the verified live range × 4 tiers, zero failures, zero fallbacks) and wire it into `npm run verify`. Add the headless perfect-player solvability sim.

**M3.** **M3 · THE BLOCK IS THE LEVEL.** Extend `/api/chop-block`: project `nonce`, `difficulty`, `utxoSetChange`, `totalInputs/Outputs`, `segwitTotalTxs`, `avgFeeRate`, `coinbaseSignatureAscii`; add ONE upstream call to `/api/block/{hash}/txs/0` → `notables[25]` + `coinbase`, keeping the CDN cache posture and the honest `ok:false` degrade. Client: THE POUR intro (instanced micro-cube slab at true weight fill), the counting-DOWN UNCONFIRMED HUD, `×N` dust stamps, whale slabs with real txid + amount, the fan-out/consolidation → kerf-axis binding, THE SEAL hash stamp with the zero-by-zero reveal, the coinbase finale note, the boot plate's live age clock. Promote the existing tip-poll interrupt to a rewarded ×1.5 FRESH BLOCK event.

**M4.** **M4 · Completion loop.** CONFIRMATIONS energy bar → BLOCK ORPHANED → sub-second `RE-MINE →` on the bit-identical chart. Per-note 115-point scoring, run accuracy %, letter grades, the ×1/2/4/8 combo tiers with the wrong-direction-drops-one-tier rule. Results screen with medals, FULL CONFIRM / CLEAN SEAL / BLADE RUN badges, the per-section miss breakdown, and tappable whale txids → mempool.space. Four difficulty tiers (DUST/MID/WHALE/MAXI) with per-tier charts. NO-FAIL toggle → SOFT SEAL at 0.7×. ★ difficulty rating computed osu!-style from the generated chart.

**M5.** **M5 · Meta-progression.** THE CHAIN ledger (localStorage, renders as a growing linked chain of block cards). DAILY SEAL on the UTC day-number pattern. Streak joining the arcade's shared `streak` key with day-continuity merge. THE ARCHIVE unlocks (57,043 / 210,000 / 774,628 / block 0). BLADES cosmetics. AUTO/RELAXED/STANDARD difficulty assist reusing the kart's announced-assist pattern. Register `chop` in `CLOUD_MERGES` with the durable-only contract + a `CLOUD_TRIVIAL` guard; extend `scripts/test-arcade-cloud.ts`.

**M6.** **M6 · Arcade backend + the X moment.** Board keys `gm:lb:chop:block:v1:{height}` / `:day:v1:{n}` / `:v1`. Score packing in `lib/arcade-score.ts` (accuracy bp primary, sats secondary, integer packing). Achievability replay in `lib/arcade-replay.ts` — re-derive chart from `(height, hash, tier)`, re-score the action log, bound each note at 115 — documented as its own verification tier, NOT claimed as WEN/Gauntlet parity. The post-seal X prompt with the blank-nameplate reveal and the exact microcopy. Share PNG (native media share, never a link card, available to every finisher including orphans). `/chop?block=N` dare landing. `/api/cron/chop-drop` push mirroring `wen-drop`.

**M7.** **M7 · Polish + integration.** Keysounding (confirmed cuts add their layer; bed never goes silent on a miss). 4-tap input calibration with a silent tap target, device-local, never cloud-synced. Coach lessons via the unscored ARC note (guidance with zero punishment). Reduced-motion paths for the pour, seal, and hitstop. `/arcade` card + preview GIF (countdown-grid-theater recipe, not a chase lap). Nav + sitemap + llms.txt. `npm run verify` green. the README row + the CHOP verification-posture paragraph + the deck/chart edit-after-UTC-rollover rule.

## RISKS

- **Touch direction misreads on iOS are the single biggest fun risk.** Safari has no `getCoalescedEvents()` and Chrome rAF-aligns `pointermove`, so a fast flick may be one 16.7ms sample. Mitigations are all in the design and none are optional: 3-sample integration, ±40° cones with 10° dead bands, 28px minimum travel, and **direction never causing a MISS**. If M1 playtesting still shows misreads above ~3%, the fallback is to ship DUST/MID as axis-only (horizontal vs vertical, 2 states) and gate polarity to WHALE/MAXI.
- **Scope: this is a rewrite of the gameplay half of a 1,737-line file.** ~600 lines new, ~450 deleted in M1 alone, plus a new `chart.js` and a validator. The renderer, materials, post stack, music engine, and all feel systems survive intact — but anyone estimating this as a tuning pass will be wrong by 3×. M1 is deliberately scoped so the fun gate is reachable before any of the meta exists.
- **Extracting `MUSIC_GRID` out of `scheduleStep()` risks changing how the music sounds.** The scheduler has section floors/ceilings, bar-quantized intensity crossfades, and ghost-note conditionals tangled into the same function. Mitigation: extract as a pure table first, diff a 40-bar scheduled-event dump before/after, and do not touch synthesis in the same commit.
- **The whale-txid fetch adds a second upstream call** (`/api/block/{hash}/txs/0`, ~25 txs). Must stay inside the existing CDN cache window and degrade honestly — if notables are unavailable the whale slabs fall back to fee-percentile synthesis with no txid label rather than showing a fabricated one. Never invent a txid.
- **A per-block board has a ~10-minute life.** That is the design's scarcity engine, but it means the block board can look empty for an unlucky player on a fresh block. Mitigation: the DAILY SEAL board is the stable social object, the block board always shows the tail of ancestor blocks' boards for context, and the boot card's chopper count is honest about small numbers rather than hidden.
- **Replay verification is weaker than WEN/Gauntlet and must not be overclaimed.** It verifies achievability (the score falls out of a real chart derived from the hash, note count matches, per-note ≤115) but cannot prove a stroke was human. It belongs in its own documented tier between replay-verified and salt-token. Writing 'replay-verified' in the README without that qualifier would be a false claim about the board's integrity.
- **Two rows in perspective may still read ambiguously on a small phone**, especially with the thumb occluding the lower third. Mitigation is already in the design: DUST is one row, HIGH unlocks at MID — but if MID playtests poorly, the honest move is to make the high row a whale-and-accent-only lane rather than a general placement target, and cap simultaneous live notes at 6.
- **Difficulty cliff between MID and WHALE.** The NPS jump 2.0→3.0 plus bombs plus 0.76s read is three changes at once. Watch the AUTO-assist window's ease rate; if a majority of runs on WHALE orphan before bar 24, split the tier or move bombs to MAXI.
- **Deleting the 'random' feeling could over-correct into repetitive.** The motif reuse floor (≥3 instances, ≥70% coverage) is deliberately aggressive against the generated-content tell, but it can tip into monotony on a low-`densityScale` block. The counterweights are the variation operators and the non-monotone section arc — if a block still plays flat, the fix is more motifs in the bank, never more randomness in the placement.
- **Chart edits reshuffle every un-played block.** Same class as the HODL Trail deck rule: deploy motif-bank or validator changes right after a UTC rollover so the Daily Seal board is not split across two chart versions mid-day. A chart-version integer must ride in the board key or the score payload.

## CRITIC REJECTION — WEAK POINTS

- SINGLE WEAKEST ELEMENT — M1, the fun gate the operator has to approve, contains ZERO bitcoin. Build order explicitly defers the pour, the counting-down UNCONFIRMED counter, the xN dust stamps, the real whale txids, the coinbase finale and the hash seal to M3. So the third build I get handed is a grey corridor with orange grooves and a hardcoded chart, and every reason I rejected the last one ('no explanation how the boxes correlate with the block', 'no goal') is still true on the day I'm asked to greenlight it. This is the highest-probability path to a third rejection and it is the cheapest thing in the document to fix.
- THE TX-SHAPE -> KERF-AXIS BINDING IS OVERCLAIMED, and it is the doc's own stated answer to 'the boxes don't correlate with the block'. /api/chop-block projects block AGGREGATES; only the proposed /txs/0 call returns 25 real transactions. For a 2,847-tx block that means ~2,822 cubes get their 'fan-out vs consolidation' axis from a block-level ratio, i.e. synthesized. Worse, the axis is simultaneously nailed down by the fixed musical contract (kick = DOWN, every time, every level) and the parity rule (consecutive directions differ by >=90 degrees). Music grid + motif bank + parity fully determine the axis; there is no degrees of freedom left for the transaction to speak through. It IS a label on a HUD, just a prettier one.
- THE MASTERY LADDER AND THE SCARCITY ENGINE CONTRADICT EACH OTHER. The doc sells progression as 'you ladder by re-chopping the same block one tier up' and 'I haven't beaten it on WHALE yet' — but the live block's board has a 7-day TTL and the block itself is gone in ~10 minutes, and the only persistent charts named are the Daily Seal and four Archive blocks. So the one object the ladder is built on evaporates. Right now a 45-year-old who gets a Silver on 959,891 at 8:04am has no way to go get the Gold.
- ONE SONG. FOREVER. 136 BPM, PHRASE_BARS = 40, one fixed intro/build/drop/break arc = 70.6 seconds, identical on every block, every tier, every day. All the anti-staleness work in the doc operates at the 10-second scale (breather, non-monotone density, motif variation). Nobody plays one block. Five blocks in a sitting is the same 70 seconds five times with the same drop in the same place and the same coinbase in the same bar. That is my original complaint reappearing one zoom level out, and music.js being code-generated is exactly why there is no excuse for it.
- THE SEAL CEREMONY IS A RUN-5 PROBLEM. Twenty zeros stamping at 40ms each with a press-thud each, plus the coinbase stop, plus the grade, plus the board animation, plus the nameplate reveal — that is 5+ seconds of unskippable ceremony after every 70-second level. Beautiful the first time, hated by the third. The doc obsesses over a sub-second RE-MINE loop on failure and then puts a cutscene on success.
- TIER 1 (DUST) IS STILL FRUIT NINJA BY CONSTRUCTION — one row, free + DOWN only, 1.2 NPS, 1.0s read. Direction is trivially satisfied, so none of the four skill axes are actually live. If DUST is the first-run default, the operator's first playthrough of the redesign demonstrates precisely the thing he rejected.
- THE SCORING MATH LETS A NON-PLAYER COAST. Direction never causes a miss, a wrong-direction cut only drops one multiplier tier, and quality (30) + timing (25) = 55 of 115 are payable with any stroke in any direction. A player who ignores every kerf keeps their combo and clears at ~48% accuracy. That is the right accessibility floor but it means the kerf is optional, and optional mechanics are cosmetic mechanics unless something makes ignoring them feel bad immediately.
- THE X ASK CAN STACK INTO NAGGING. Post-seal, earned-moment-only and the blank-nameplate re-engrave are genuinely good — that part is the strongest section in the document. But three separate re-ask templates (personal best / Diamond / streak day 3) with no lifetime cap means a player who said no on day one gets asked again on day one, again on day two, again on day three. Separately, 'MINED 2:14 AGO · 31 CHOPPERS ON THIS BLOCK' will read '0 CHOPPERS' or '2 CHOPPERS' for the first several months on a block that is 90 seconds old. That is a shame number printed on the boot screen.
- SCOPE HAS NO CUT LINE. Seven milestones covering a gameplay rewrite, a chart generator, an 11-invariant validator, a headless solver, a 24-motif hand-authored bank, keysounding, a calibration UI, cloud save, a new replay tier, a cron push topic and a share PNG pipeline. The risks section admits M1 alone is 3x what it looks like and says nothing about the other six. There is no statement of what constitutes shippable.
- THE BREATHER, THE POUR AND THE VALIDATOR ARE ALL LOAD-BEARING AND ALL UNPROVEN ON A PHONE. An instanced ~2,800-micro-cube slab at true weight fill, plus the existing bloom/post stack, on a mid-range Android in portrait, is a frame-budget claim the document makes without a number. If the pour stutters, the very first three seconds of the redesign look worse than the build I already rejected.

## CRITIC REQUIRED FIXES

- Move the four cheap magic devices INTO M1: (a) the UNCONFIRMED counter counting DOWN from the block's real tx_count with +N pops, (b) the xN dust stamp on cube faces, (c) the coinbase as the final note of the hardcoded chart with the real pool name and reward from the payload we already fetch, (d) the SEAL — the real hash stamping in. All four are DOM text plus one oversized cube; none needs the second upstream call, the instanced slab, or the generator. M1's operator test then becomes 'cut this block down to zero and seal it', which is the actual pitch, in 70 seconds, on a phone.
- Stop claiming per-note tx binding and bind at the honest scale. (1) Level-scale: keep motifFamily from utxoSetChange and SAY it on the briefing card — 'ViaBTC · -1,657 UTXOs · CONSOLIDATION BLOCK · this one sweeps sideways'. The whole level plays horizontal-heavy and the player learns to read a block by its feel. (2) Note-scale: bind axis to real in/out counts ONLY on the ~25 notables and the coinbase, which is where we have real data, and let those notes override the parity rule (they are accents, not runs). (3) Delete the fan-out/consolidation language from everywhere else in the spec so nobody ships a claim we can't back.
- THE CHAIN becomes a permanent playable library, not a trophy shelf. The chart is f(height, hash, tier) — store 32 bytes of hash plus the height per sealed block and every block you have ever sealed is replayable forever, bit-identical, at zero server cost. Each chain card shows the medals you have and the ones you don't, and taps straight into a re-chop at the next tier. That is the mastery ladder the doc promises, and it makes the chain the reason to come back rather than a screenshot.
- The block must change the MUSIC, not just the chart. music.js is code-generated, so this is cheap: (a) tempo band 126-146 BPM derived from the block interval — a 42-minute block is a slow grinder, a 12-second block is frantic; (b) key/mode from hash bytes, reusing the pentatonic root that already exists; (c) section-arc variants selected by LevelSpec — the 80-bar long-block arc the doc already half-specs, plus a no-breather 'high-fee storm' arc and a sparse 'empty block' arc. Three arcs x a tempo band x a key set means block 2 does not sound like block 1.
- Ceremony is earned, not automatic. FULL seal (all twenty zeros, thuds, the works) fires on: first-ever seal, first seal of a given block, a new personal best, or a new medal tier. Every other seal gets a 1.2s version, and ANY tap skips to the results card. Same rule for the pour: full on first entry to a block, one-bar version on a re-mine.
- Default the first run to MID, not DUST. DUST exists for the person who bounces off MID, reachable from the results screen and from the AUTO assist — it is not the front door. And the operator's approval build boots MID with both rows and all four directions live.
- Make ignoring the kerf feel bad within two notes without making it fail. Rebalance to direction 60 / quality 25 / timing 30, and add an immediate sensory penalty on a wrong-direction cut that is impossible to miss: the torn-edge shatter, the detuned SFX, AND the keysound layer for that note DROPS OUT of the bar. You hear the music go thin the instant you stop cutting along the grain. Keep the combo rule as written — the punishment should be audible, not numeric.
- Cap the X ask hard: one ask per session, maximum two lifetime re-asks after the first decline, then it retires to a permanent quiet 'link 𝕏' line on the results card and never interrupts again. Replace the boot-screen block chopper count with the daily-board population ('184 SEALED TODAY'), and only surface the per-block count once it clears 20.
- Declare the cut line now: M1-M4 is CHOP v1 and it ships as arcade cabinet #9. M5-M7 (chain/archive/blades, backend boards, keysounding, calibration) are named post-launch batches with their own dates, exactly the way the kart shipped in batches. Nothing in M5-M7 is allowed to block v1.
- Put a number on the pour before it is designed: the slab is instanced, capped at 2,048 instances regardless of tx_count (the count is honest in the HUD, the visual is representative and says so), reduced-motion and low-tier devices get a 3-plane cracked slab instead of instances, and M1 records a real frame-time capture on a mid-range Android in portrait before the pour is approved. Same discipline as the kart's headless clearance sim — measure it, do not guess it.