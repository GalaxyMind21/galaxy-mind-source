/**
 * BRAND RAMP DRIFT GUARD · the site's off-site face must be the same
 * colour as the site.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Night Bench rollout (2026-08-23) moved the page ground from the
 * OLD OLED void `#0A0A0B` to the warm night `#12110F`, and the ink from
 * a cold `#F5F5F7`/`#9999A1` pair to the warm `#F2EFE9`/`#A5A096` pair.
 * It moved the PAGES. It did not move anything that represents the site
 * somewhere else, and nobody noticed for months because none of those
 * surfaces is ever on screen next to a page:
 *
 *   ~24 opengraph-image cards   every X / Slack / iMessage unfurl
 *   14 email templates          every alert, digest and roundup
 *   manifest.ts                 the PWA splash — cold black, then a warm page
 *   the merchant badge SVGs     the most-distributed artifact we have,
 *                               sitting on other people's websites
 *   public/embed.js             the gauge widget, likewise on other people's sites
 *
 * 256 literals across 50 files. That is not a taste question: a social
 * card and a splash screen ARE the brand for someone who has not
 * arrived yet.
 *
 * WHAT THIS CHECKS
 * ----------------
 * 1. The warm ramp below still matches `:root` in globals.css. If someone
 *    retunes the palette there, this fails and names the new value, so
 *    the off-site copies get retuned in the same commit.
 * 2. No retired cold-ramp literal has reappeared anywhere in `src/` or
 *    `public/embed.js`.
 * 3. No emissive orange halo has reappeared on a product surface. That is
 *    the OTHER thing the rollout retired (spec 4.7) and it had crept back
 *    onto ~55 controls in two different spellings — see §3 below.
 *
 * All three sections were self-tested by reintroducing a real offender and
 * confirming a non-zero exit, because this repo has already shipped a
 * check that compared the wrong field and therefore never fired once.
 *
 * DELIBERATELY OUT OF SCOPE: the self-contained arcade cabinets
 * (`public/super-saylor.html`, `public/bitcoin-kart/`, `public/six-deep/`)
 * and `public/arcade-open-browser.js`. Those are separately art-directed,
 * ship under their own CSP, and the kart is under a hard payload cap with
 * its own parser test — they are not "the site's chrome in another
 * medium", which is what this guard is about.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");

/** The warm ramp. Each entry is [token in globals.css, the literal that
 *  off-site surfaces must use, the retired literal it replaced]. */
const RAMP: Array<{ token: string; warm: string; retired: string; role: string }> = [
  { token: "--bg-base", warm: "#12110f", retired: "#0A0A0B", role: "ground" },
  { token: "--text-primary", warm: "#f2efe9", retired: "#F5F5F7", role: "primary ink" },
  { token: "--text-secondary", warm: "#a5a096", retired: "#9999A1", role: "muted ink" },
  { token: "--bg-elevated", warm: "#1c1a16", retired: "#131316", role: "raised chip" },
];

let failures = 0;
const fail = (m: string) => {
  console.error(`  ✗ ${m}`);
  failures++;
};
const ok = (m: string) => console.log(`  ✓ ${m}`);

console.log("\nbrand ramp\n");

// ── 1. the constants still match globals.css :root ───────────────────
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
// Only the FIRST :root block — the dark default. The light theme lives in
// :root[data-theme="light"] and is not what off-site surfaces render.
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf('/* LIGHT theme'));

for (const { token, warm, role } of RAMP) {
  const m = rootBlock.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) {
    fail(`${token} not found in the :root block — did the palette move?`);
    continue;
  }
  if (m[1].toLowerCase() !== warm.toLowerCase()) {
    fail(
      `${token} is now ${m[1]} in globals.css but this guard still expects ${warm}. ` +
        `The palette moved: retune the off-site ${role} to ${m[1]} (og cards, ` +
        `lib/email.ts, manifest.ts, the badge routes, public/embed.js) and update RAMP here.`,
    );
    continue;
  }
  ok(`${token} ${warm} · ${role}`);
}

// ── 2. no retired literal has come back ──────────────────────────────
// git grep so we honour .gitignore and never walk node_modules/.next.
// execFileSync with an argv array, never a shell string: the needles are
// constants here, but a `#`-leading pattern through a shell is exactly the
// kind of thing that quietly stops matching one day.
const HAYSTACK = ["src", "public/embed.js"];
for (const { retired, warm, role } of RAMP) {
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-ni", "--", retired, ...HAYSTACK], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    hits = ""; // git grep exits 1 when there are no matches
  }
  // A COMMENT may name a retired colour — the history of why a value
  // moved is worth keeping, and banning the word would push people into
  // writing vaguer notes. Only real uses count, so drop lines whose first
  // non-space characters open a comment (`//` or a `*` continuation,
  // which covers every form these files actually use).
  const lines = hits
    .split("\n")
    .filter(Boolean)
    .filter((l) => {
      const body = l.replace(/^[^:]*:\d+:/, "").trimStart();
      return !body.startsWith("//") && !body.startsWith("*") && !body.startsWith("/*");
    });
  if (lines.length) {
    fail(
      `retired ${role} ${retired} is back in ${lines.length} place(s) — use ${warm}:\n` +
        lines.slice(0, 8).map((l) => `      ${l.slice(0, 110)}`).join("\n") +
        (lines.length > 8 ? `\n      …and ${lines.length - 8} more` : ""),
    );
  } else {
    ok(`retired ${retired} (${role}) is gone`);
  }
}

// ── 3. no emissive orange halo on a product surface ──────────────────
// Spec 4.7 retired emissive depth; .lit-primary / .lit-active replaced it.
// The halo has TWO spellings and the first sweep only caught one:
// `var(--accent-glow)` (41 sites) and a raw `rgba(247,147,26,…)` (14 more
// the token search was structurally blind to). Both are banned here.
// The ARCADE keeps its halos on purpose — spec 4.5 gives the cabinets the
// site's effect budget, and a glowing cabinet is in-idiom.
const ARCADE = /\/(gauntlet|wen|trail|horizon|runner)\//;
const HALO_PATTERNS: Array<[RegExp, string]> = [
  [/shadow-\[0_0_[0-9]+px_var\(--accent-glow\)\]/, "var(--accent-glow) halo"],
  [/shadow-\[0_0_[0-9]+px_rgba\(247,147,26,[0-9.]+\)\]/, "raw rgba orange halo"],
];
let haloHits = 0;
for (const [re, label] of HALO_PATTERNS) {
  let files = "";
  try {
    files = execFileSync("git", ["grep", "-l", "-E", "--", re.source, "src"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    files = "";
  }
  const offenders = files
    .split("\n")
    .filter((f) => f && f.endsWith(".tsx") && !ARCADE.test("/" + f));
  if (offenders.length) {
    haloHits += offenders.length;
    fail(
      `${label} is back on ${offenders.length} product surface(s) — ` +
        `use .lit-primary (solid accent fill) or .lit-active (accent border/tint):\n` +
        offenders.slice(0, 6).map((f) => `      ${f}`).join("\n"),
    );
  }
}
if (!haloHits) ok("no emissive orange halos outside the arcade");

// ── 4. the two retired glow classes stay disarmed ────────────────────
// §3 bans the Tailwind arbitrary-value spellings of an orange halo. It
// was structurally blind to the THIRD spelling: a plain CSS class. The
// site shipped .glow-text (a 9px orange text-shadow on an emphasised
// heading word) and .glow-cta (a 16px halo behind a filled accent
// button) across 47 call sites in 32 files, and those were exactly the
// pages that still read as the pre-Night-Bench UI.
//
// Both are retired as NO-OPS rather than deleted, so existing markup
// keeps working. That makes the failure mode "somebody puts the
// declaration back", not "somebody adds the class" — so this pins the
// DEFINITIONS, which is also how .headline-gradient stays retired.
const GLOW_CLASSES: Array<[string, string]> = [
  ["glow-text", "text-shadow"],
  ["glow-cta", "box-shadow"],
];
for (const [cls, prop] of GLOW_CLASSES) {
  // ANCHORED TO LINE START, and that anchor is load-bearing. An
  // unanchored /\.glow-text\s*\{/ matches `.display-title .glow-text {`
  // — the SUPPRESSION rule twenty lines above the real declaration —
  // reads its `text-shadow: none`, and reports the class disarmed while
  // the actual rule below it is re-armed. The first version of this
  // check did exactly that and passed against a deliberately re-armed
  // .glow-text. Self-test any guard whose whole job is to fail.
  const m = css.match(new RegExp(`^\\.${cls}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) {
    fail(`.${cls} is gone from globals.css — if it was deleted on purpose, drop it from GLOW_CLASSES here too`);
    continue;
  }
  const body = m[1];
  if (/accent-glow|rgba\(\s*247\s*,\s*147\s*,\s*26/.test(body)) {
    fail(
      `.${cls} has been re-armed with an emissive orange halo:\n      ${body.trim().slice(0, 90)}\n` +
        `      Spec 4.7 retired emissive depth. Use .lit-primary / .lit-active, or --nb-rim for a lit edge.`,
    );
  } else if (!new RegExp(`${prop}\\s*:\\s*none`).test(body)) {
    fail(`.${cls} no longer declares ${prop}: none — it must stay a no-op`);
  } else {
    ok(`.${cls} still disarmed (${prop}: none)`);
  }
}

// ── 5. the opengraph cards still speak the page's design language ─────
//
// WHY THIS SECTION EXISTS. Sections 1-2 moved the four ramp LITERALS onto
// every off-site surface, the opengraph cards included, and everyone
// (including this guard) then assumed the cards were migrated. They were
// not. A card repainted in warm colours while keeping the pre-rollout
// cockpit grammar still reads as the old site, which is exactly what the
// operator saw unfurling on X on 2026-09-10. Measured that day, across
// the 37 cards:
//
//   65 label sites at 22 different tracking values, 0.04em to 0.39em,
//      against the site's canonical `.micro-label` 0.20em. Four matched.
//   36 of 36 display-type sites heavier than `.display-title`'s weight
//      500. Nineteen were at 800.
//   13 files on a cold `#26262C` border and 5 on cold `#5C5C66`/`#8C8C96`
//      ink — all OFF the guarded ramp, so §2 was structurally blind to
//      them while they sat blue-grey against a warm ground.
//
// Colour alone was never the contract. This section pins the grammar.
{
  const cardFiles = execFileSync(
    "git",
    ["ls-files", "src/app/**/opengraph-image.tsx", "src/app/api/og/**/route.tsx", "src/lib/og-catalyst.tsx"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  // Cold literals that are off the ramp and therefore invisible to §2.
  const COLD_OFF_RAMP: Array<[string, string]> = [
    ["#26262C", "--border-subtle rgba(247, 238, 224, 0.085)"],
    ["#5C5C66", "--text-tertiary #948F84"],
    ["#8C8C96", "--text-tertiary #948F84"],
  ];

  let coldHits = 0;
  let heavy = 0;
  let overTracked = 0;
  let bloom = 0;

  for (const rel of cardFiles) {
    let src: string;
    try {
      src = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    // Strip comments FIRST. The first run of this section failed on
    // og-catalyst.tsx because its header comment NAMES the cold literals it
    // was migrated away from — the guard was reading its own documentation
    // as evidence of the bug it documents. check-site-voice.ts learned the
    // same lesson (416 hits, ~85% authoring notes): a gate that cries wolf
    // gets switched off.
    src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    for (const [lit, replacement] of COLD_OFF_RAMP) {
      if (new RegExp(lit, "i").test(src)) {
        coldHits++;
        fail(`${rel} still paints the cold ${lit} — use ${replacement}`);
      }
    }

    // The orange corner bloom every card used for a ground. Spec 4.7
    // retired emissive depth; the bench lamp is CREAM light falling on
    // things (lib/og-bench.tsx exports it as LAMP).
    if (/radial-gradient\([^)]*rgba\(\s*247\s*,\s*147\s*,\s*26/.test(src)) {
      bloom++;
      fail(`${rel} has an orange bloom for a ground — use LAMP from lib/og-bench`);
    }

    // Pair every value with the block it lives in, so a 17px label is not
    // judged against a 132px numeral's tracking.
    const stack: Array<{ start: number }> = [];
    const spans: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "{") stack.push({ start: i });
      else if (src[i] === "}") {
        const b = stack.pop();
        if (b) spans.push({ start: b.start, end: i });
      }
    }
    for (const sp of spans) {
      const text = src.slice(sp.start, sp.end + 1);
      let depth = 0;
      let own = "";
      for (const c of text) {
        if (c === "{") depth++;
        if (depth === 1) own += c;
        if (c === "}") depth--;
      }
      const size = own.match(/fontSize:\s*(\d+)/);
      if (!size) continue;
      const px = parseInt(size[1], 10);
      // Rotated stamps and thick-bordered badges are arcade ART under spec
      // 4.5's effect budget, not type. They are allowed their own weight.
      if (/transform:\s*"rotate|[3-9]px solid/.test(own)) continue;

      const w = own.match(/fontWeight:\s*(\d+)/);
      if (px >= 40 && w && parseInt(w[1], 10) > 510) {
        heavy++;
        fail(
          `${rel}: display type at ${px}px is weight ${w[1]} — .display-title is 500`,
        );
      }
      const ls = own.match(/letterSpacing:\s*([\d.]+)\s*[,}]/);
      if (ls && parseFloat(ls[1]) / px > 0.26) {
        overTracked++;
        fail(
          `${rel}: a ${px}px label is tracked ${(parseFloat(ls[1]) / px).toFixed(2)}em` +
            ` — .micro-label is 0.20em`,
        );
      }
    }
  }

  if (!coldHits) ok(`no cold off-ramp literals in ${cardFiles.length} og surfaces`);
  if (!bloom) ok("no orange bloom grounds · the lamp is cream");
  if (!heavy) ok("og display type is weight 500, like .display-title");
  if (!overTracked) ok("og labels track at or near .micro-label's 0.20em");
}

console.log("");
if (failures) {
  console.error(`✗ ${failures} brand-ramp problem(s)\n`);
  process.exit(1);
}
console.log("All brand-ramp checks passed.\n");
