// THE HODL TRAIL engine + deck invariants. Run with
// `npx tsx scripts/test-hodl-trail.ts` · wired into `npm run verify`.
//
// The deck is CONTENT with a legal contract: the banned-string checks
// are the IP ship gate from the 2026-07-25 adversarial review (never
// franchise prose, never the franchise name), and the balance-band
// checks keep Workflow-authored events inside the tuning envelope.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TRAIL_BIG_GAIN,
  TRAIL_DEATH_STAKE,
  TRAIL_LEGS,
  TRAIL_PARTY_SIZE,
  TRAIL_SATS_MAX,
  TRAIL_START_SATS,
  TRAIL_SURVIVOR_BONUS,
  buildTrailShareText,
  isValidTrailScore,
  runTrail,
  survivorLineFor,
  tombstoneFor,
  trailEventsFor,
  trailPartyFor,
  trailRoll,
  type TrailAction,
} from "../src/lib/hodl-trail";
import {
  TRAIL_ERAS,
  TRAIL_EVENTS,
  TRAIL_PARTY_NAMES,
  TRAIL_SURVIVOR_LINES,
  TRAIL_TOMBSTONES,
} from "../src/lib/trail-deck";
import {
  parseTrailProof,
  verifyTrailProof,
} from "../src/lib/arcade-replay";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n🛶  THE HODL TRAIL engine + deck\n");

// ── deck size · the content moat gate ───────────────────────────────
{
  check(
    `deck holds ≥150 events (${TRAIL_EVENTS.length})`,
    TRAIL_EVENTS.length >= 150,
  );
  let minPool = Infinity;
  let thinEra = "";
  for (const e of TRAIL_ERAS) {
    const n = TRAIL_EVENTS.filter((ev) => ev.era === e.era).length;
    if (n < minPool) {
      minPool = n;
      thinEra = e.era;
    }
  }
  check(
    `every era pool ≥12 events (thinnest: ${thinEra}=${minPool})`,
    minPool >= 12,
  );
  const ids = new Set(TRAIL_EVENTS.map((e) => e.id));
  check("event ids unique", ids.size === TRAIL_EVENTS.length);
  // The slider-floor repair walk in trailEventsFor can only converge
  // when every era pool carries slider events to walk to.
  let minSliderPool = Infinity;
  for (const e of TRAIL_ERAS) {
    const withSlider = TRAIL_EVENTS.filter(
      (ev) => ev.era === e.era && ev.choices.some((c) => c.slider),
    ).length;
    if (withSlider < minSliderPool) minSliderPool = withSlider;
  }
  check(
    `every era pool ≥4 slider events (thinnest: ${minSliderPool})`,
    minSliderPool >= 4,
  );
}

// ── deck schema + balance bands ─────────────────────────────────────
{
  let ok = true;
  let why = "";
  const flag = (id: string, msg: string) => {
    if (ok) why = `${id}: ${msg}`;
    ok = false;
  };
  for (const ev of TRAIL_EVENTS) {
    if (!TRAIL_ERAS.some((e) => e.era === ev.era)) flag(ev.id, "unknown era");
    if (ev.year < 2010 || ev.year > 2026) flag(ev.id, "year out of range");
    if (ev.prose.length > 330) flag(ev.id, "prose too long");
    if (ev.title.length > 44) flag(ev.id, "title too long");
    if (ev.choices.length < 2 || ev.choices.length > 4) {
      flag(ev.id, "needs 2-4 choices");
    }
    let sliders = 0;
    let deadly = 0;
    let safeOut = false;
    let bestEv = -Infinity;
    for (const c of ev.choices) {
      if (c.label.length > 48) flag(ev.id, "label too long");
      if ((c.detail ?? "").length > 90) flag(ev.id, "detail too long");
      if (c.risk < 0.05 || c.risk > 0.8) flag(ev.id, "risk band");
      if (c.boomX < 0.02 || c.boomX > 0.8) flag(ev.id, "boomX band");
      if (c.bustX < 0.2 || c.bustX > 1) flag(ev.id, "bustX band");
      if (c.stake < 0 || c.stake > 1) flag(ev.id, "stake band");
      if (c.slider) {
        sliders++;
        if (c.stake !== 0) flag(ev.id, "slider rows carry stake 0");
      }
      if (c.deathRisk) {
        deadly++;
        if (c.risk < 0.35 || c.bustX < 0.5) {
          flag(ev.id, "deathRisk needs risk≥0.35 & bustX≥0.5");
        }
      }
      if (c.risk <= 0.2) safeOut = true;
      const evx = (1 - c.risk) * c.boomX - c.risk * c.bustX;
      if (evx > 0.56 || evx < -0.75) flag(ev.id, `EV out of band (${evx.toFixed(2)})`);
      if (evx > bestEv) bestEv = evx;
    }
    if (sliders > 1) flag(ev.id, "max one slider per event");
    if (deadly > 1) flag(ev.id, "max one deathRisk per event");
    if (!safeOut) flag(ev.id, "needs a risk≤0.2 safe out");
    if (bestEv < 0.02) flag(ev.id, "needs a winning line (max EV ≥ 0.02)");
  }
  check("all events inside schema + balance bands", ok, why);
}

// ── IP ship gate + prose rules ──────────────────────────────────────
{
  const engineSrc = readFileSync(
    join(__dirname, "../src/lib/hodl-trail.ts"),
    "utf8",
  );
  const deckSrc = readFileSync(
    join(__dirname, "../src/lib/trail-deck.ts"),
    "utf8",
  );
  const all = engineSrc + deckSrc;
  check(
    "no borrowed franchise prose (dysentery)",
    !/dysentery/i.test(all.replace(/never the word .dysentery./, "")),
  );
  check(
    "franchise name absent from game content",
    !/Oregon\s+Trail/.test(all.replace(/never the string .Oregon Trail./, "")),
  );
  check(
    "engine is pure (no Math.random / Date.now / new Date)",
    !/Math\.random\(|Date\.now\(|new Date\(/.test(engineSrc + deckSrc),
  );
  let noEmDash = true;
  let noDashWhere = "";
  for (const ev of TRAIL_EVENTS) {
    const texts = [
      ev.title,
      ev.prose,
      ev.hint ?? "",
      ...ev.choices.flatMap((c) => [c.label, c.detail ?? ""]),
    ];
    if (texts.some((t) => t.includes("—"))) {
      noEmDash = false;
      noDashWhere = ev.id;
    }
  }
  for (const t of [...TRAIL_TOMBSTONES, ...TRAIL_SURVIVOR_LINES]) {
    if (t.includes("—")) {
      noEmDash = false;
      noDashWhere = t;
    }
  }
  check("no em dashes in player-facing copy", noEmDash, noDashWhere);
  check(
    "tombstones fit the card (≤60 chars)",
    [...TRAIL_TOMBSTONES, ...TRAIL_SURVIVOR_LINES].every((t) => t.length <= 60),
  );
}

// ── daily derivation · deterministic, era-ordered, slider-rich ──────
{
  let deterministic = true;
  let ordered = true;
  let slidersOk = true;
  let thinDay = 0;
  for (let n = 1; n <= 400; n++) {
    const a = trailEventsFor(n);
    const b = trailEventsFor(n);
    if (a.length !== TRAIL_LEGS || b.length !== TRAIL_LEGS) ordered = false;
    for (let i = 0; i < TRAIL_LEGS; i++) {
      if (a[i].id !== b[i].id) deterministic = false;
      if (a[i].era !== TRAIL_ERAS[i].era) ordered = false;
    }
    const sliders = a.reduce(
      (s, ev) => s + ev.choices.filter((c) => c.slider).length,
      0,
    );
    if (sliders < 3) {
      slidersOk = false;
      thinDay = n;
    }
  }
  check("day's events deterministic from day number alone", deterministic);
  check("ten legs, one per era, chronological", ordered);
  check(
    "every day carries ≥3 slider choices (anti-copy dial)",
    slidersOk,
    slidersOk ? undefined : `day ${thinDay}`,
  );
}

// ── party + tombstone derivation ────────────────────────────────────
{
  let ok = true;
  for (let n = 1; n <= 600; n++) {
    const p = trailPartyFor(n);
    const q = trailPartyFor(n);
    if (p.length !== TRAIL_PARTY_SIZE) ok = false;
    if (new Set(p).size !== TRAIL_PARTY_SIZE) ok = false;
    if (p.join("|") !== q.join("|")) ok = false;
    if (!p.every((name) => TRAIL_PARTY_NAMES.includes(name))) ok = false;
  }
  check("party of 4 · unique, deterministic, from the roster", ok);
  check(
    "tombstone + survivor picks deterministic and in-pool",
    tombstoneFor(42, 0) === tombstoneFor(42, 0) &&
      TRAIL_TOMBSTONES.includes(tombstoneFor(42, 0)) &&
      TRAIL_TOMBSTONES.includes(tombstoneFor(42, 3)) &&
      TRAIL_SURVIVOR_LINES.includes(survivorLineFor(42)),
  );
}

// ── strategy sims · bounds, determinism, grid shape ─────────────────
function safeLine(n: number): TrailAction[] {
  const evs = trailEventsFor(n);
  return evs.map((ev, leg) => {
    let best = 0;
    ev.choices.forEach((c, i) => {
      if (c.risk < ev.choices[best].risk) best = i;
    });
    return [leg, best, 0] as const;
  });
}
function degenLine(n: number): TrailAction[] {
  // Greedy max-boom with alloc 100 · walks legs until the sim says the
  // caravan wiped (runTrail legality requires stopping exactly there).
  const evs = trailEventsFor(n);
  const actions: TrailAction[] = [];
  for (let leg = 0; leg < TRAIL_LEGS; leg++) {
    const ev = evs[leg];
    let best = 0;
    ev.choices.forEach((c, i) => {
      if (c.boomX > ev.choices[best].boomX) best = i;
    });
    actions.push([leg, best, 100]);
    const probe = runTrail(n, actions.slice(0, leg + 1));
    if (probe && probe.wiped) break;
  }
  return actions;
}
{
  let ok = true;
  let why = "";
  const cells = new Set(["💀", "📉", "🚀", "🟧", "⬜", "🏰", "🪦"]);
  for (let n = 1; n <= 120; n++) {
    for (const line of [safeLine(n), degenLine(n)]) {
      const r1 = runTrail(n, line);
      const r2 = runTrail(n, line);
      if (!r1 || !r2) {
        ok = false;
        why = `day ${n}: legal line rejected`;
        break;
      }
      if (JSON.stringify(r1) !== JSON.stringify(r2)) {
        ok = false;
        why = `day ${n}: nondeterministic`;
        break;
      }
      if (!Number.isInteger(r1.score) || !isValidTrailScore(r1.score)) {
        ok = false;
        why = `day ${n}: score ${r1.score}`;
        break;
      }
      const glyphs = Array.from(r1.grid);
      if (glyphs.length !== r1.outcomes.length + 1) {
        ok = false;
        why = `day ${n}: grid length`;
        break;
      }
      if (!glyphs.every((g) => cells.has(g))) {
        ok = false;
        why = `day ${n}: alien glyph`;
        break;
      }
      if (r1.wiped !== (r1.survivors === 0)) {
        ok = false;
        why = `day ${n}: wipe flag`;
        break;
      }
    }
    if (!ok) break;
  }
  check("safe + degen lines · bounds, determinism, grid", ok, why);
}

// ── safe line never loses a pleb (safe-out ⇒ no deathRisk) ─────────
{
  let ok = true;
  for (let n = 1; n <= 200; n++) {
    const r = runTrail(n, safeLine(n));
    if (!r || r.survivors !== TRAIL_PARTY_SIZE) ok = false;
  }
  check("lowest-risk line keeps the caravan alive", ok);
}

// ── replay legality · every malformed shape bounces ─────────────────
{
  const n = 7;
  const good = safeLine(n);
  check("legal full line runs", runTrail(n, good) !== null);
  check(
    "wrong leg order rejected",
    runTrail(n, [good[1], good[0], ...good.slice(2)]) === null,
  );
  check(
    "bad choice index rejected",
    runTrail(n, [[0, 9, 0], ...good.slice(1)]) === null,
  );
  check(
    "non-integer alloc rejected",
    runTrail(n, [[0, 0, 50.5], ...good.slice(1)]) === null,
  );
  check(
    "alloc out of range rejected",
    runTrail(n, [[0, 0, 101], ...good.slice(1)]) === null,
  );
  check("short log without a wipe rejected", runTrail(n, good.slice(0, 4)) === null);
  check(
    "overlong log rejected",
    runTrail(n, [...good, [10, 0, 0]] as TrailAction[]) === null,
  );
}

// ── proof parse + verify round-trip ─────────────────────────────────
{
  let ok = true;
  let why = "";
  for (let n = 1; n <= 60; n++) {
    for (const line of [safeLine(n), degenLine(n)]) {
      const r = runTrail(n, line);
      if (!r) {
        ok = false;
        why = `day ${n} line rejected`;
        break;
      }
      const parsed = parseTrailProof(JSON.parse(JSON.stringify(line)));
      if (!parsed) {
        ok = false;
        why = `day ${n} parse failed`;
        break;
      }
      if (!verifyTrailProof(n, parsed, r.score)) {
        ok = false;
        why = `day ${n} verify failed`;
        break;
      }
      if (verifyTrailProof(n, parsed, r.score + 1)) {
        ok = false;
        why = `day ${n} accepted wrong score`;
        break;
      }
    }
    if (!ok) break;
  }
  check("proof parse + replay verify round-trip", ok, why);
  check("proof parse rejects junk", parseTrailProof(null) === null);
  check("proof parse rejects empty", parseTrailProof([]) === null);
  check(
    "proof parse rejects non-sequential legs",
    parseTrailProof([[1, 0, 0]]) === null,
  );
  check(
    "proof parse rejects fractional alloc",
    parseTrailProof([[0, 0, 3.5]]) === null,
  );
}

// ── the anti-copy dial · nearby allocs land on distinct scores ──────
{
  let found = false;
  outer: for (let n = 1; n <= 60; n++) {
    const evs = trailEventsFor(n);
    for (let leg = 0; leg < TRAIL_LEGS; leg++) {
      const si = evs[leg].choices.findIndex((c) => c.slider);
      if (si < 0) continue;
      // Only compare when the slider leg MISSES (a boom applies the
      // staked delta · a 1pt alloc change must move the final score).
      if (trailRoll(n, leg) < evs[leg].choices[si].risk) continue;
      const base = safeLine(n);
      const a = base.map((x, i) => (i === leg ? ([leg, si, 57] as const) : x));
      const b = base.map((x, i) => (i === leg ? ([leg, si, 58] as const) : x));
      const ra = runTrail(n, a);
      const rb = runTrail(n, b);
      if (ra && rb && ra.score !== rb.score) {
        found = true;
        break outer;
      }
    }
  }
  check("57% vs 58% alloc produce distinct scores", found);
}

// ── score envelope + share text ─────────────────────────────────────
{
  check(
    "isValidTrailScore envelope",
    !isValidTrailScore(-1) &&
      isValidTrailScore(0) &&
      isValidTrailScore(TRAIL_SATS_MAX) &&
      !isValidTrailScore(TRAIL_SATS_MAX + 1) &&
      !isValidTrailScore(12.5) &&
      !isValidTrailScore(Number.NaN),
  );
  const r = runTrail(9, safeLine(9))!;
  const text = buildTrailShareText(9, r.score, r.grid, r.survivors);
  check(
    "share text carries day, sats, grid, link",
    text.includes("#9") &&
      text.includes(r.grid) &&
      text.includes("galaxymind.space/trail") &&
      !text.includes("—"),
  );
  check(
    "constants sane",
    TRAIL_START_SATS === 210_000 &&
      TRAIL_SATS_MAX === 2_100_000 &&
      TRAIL_SURVIVOR_BONUS > 0 &&
      TRAIL_DEATH_STAKE === 0.5 &&
      TRAIL_BIG_GAIN === 0.25,
  );
}

console.log(
  failures === 0
    ? "\n✅ trail: all invariants hold\n"
    : `\n❌ trail: ${failures} failure(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
