#!/usr/bin/env tsx
/**
 * check-type-floor
 *
 * A RATCHET on sub-12px Tailwind type literals (UX audit 2026-07-13).
 *
 * The operator's mobile type floor is 12px for anything a user reads or
 * acts on — but `text-[10px]` / `text-[11px]` are hardcoded px literals,
 * so (unlike rem-based utilities) they DON'T scale with the 106.25% root
 * bump in globals.css and render genuinely sub-floor on iPhone Safari.
 *
 * A blind global sweep is the wrong fix: a chunk of the existing
 * sub-12px labels are INTENTIONAL, load-bearing instrument typography
 * (e.g. DirectoryConsole documents AA-tuned 10-11px dial text). So
 * instead of forcing a risky one-shot rewrite, this lint RATCHETS: it
 * fails if the count goes UP (a new sub-12px literal shipped), and nudges
 * you to lower BASELINE whenever the count goes down. New surfaces should
 * use the `.micro-label` utility (globals.css) — it pins the 12px floor
 * in rem — instead of picking a fresh `text-[Npx]`.
 *
 * Run via:  npx tsx scripts/check-type-floor.ts
 * Exit: 0 = at or below baseline · 1 = above baseline (a regression)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The count at the time the ratchet was introduced (post the /today
// Super Saylor pill bump). LOWER this — never raise it — as sub-12px
// literals are migrated to `.micro-label` or bumped to `text-[12px]`.
// 237 → 219: the 2026-07-13 actionable sweep (B6a) bumped 18 sub-12px
// literals that were the SOLE label on a tap target (share/dismiss/
// subscribe/nav/footer/breadcrumb links) to the 12px floor. The
// remaining 219 are intentional instrument/decorative typography
// (SupplyClock rails, gauge ticks, pSEO captions) — left as-is.
// 216 -> 214 on 2026-09-06. NOT earned by that day's type-scale work:
// the scale moved rem sizes and a 19px/15px pair, none of which are the
// sub-12px literals this gate counts. The two had already been removed
// by earlier work and the ratchet was simply never tightened behind it,
// which is the one way a ratchet quietly stops ratcheting.
// 214 -> 10 on 2026-09-07, and this one IS earned: the px-literal sweep
// moved 655 of 679 text-[10px]/[11px]/[12px]/[13px] call sites onto the
// .t-xs rung. Every one of the 10 survivors has a responsive sibling
// (sm:text-*), meaning the author deliberately wanted two sizes, which a
// single-size class cannot express — so this floor is where the
// mechanical sweep correctly stops, not where it ran out of steam.
const BASELINE = 10;

const ROOTS = ["src/app", "src/components"];
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);

// text-[10px] and text-[11px] · the two literals below the 12px floor.
// (text-[9px] and smaller would also match \[1?[0-9]px\]; we scope to
// the two that actually occur to keep the count meaningful. Widen if a
// smaller literal ever appears.)
const SUB12 = /text-\[1[01]px\]/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else {
      const dot = entry.lastIndexOf(".");
      if (dot >= 0 && EXTS.has(entry.slice(dot))) out.push(full);
    }
  }
}

const files: string[] = [];
for (const root of ROOTS) {
  try {
    walk(root, files);
  } catch {
    /* root may not exist in some checkouts · skip */
  }
}

let total = 0;
const perFile: { file: string; n: number }[] = [];
for (const file of files) {
  const matches = readFileSync(file, "utf8").match(SUB12);
  if (matches && matches.length > 0) {
    total += matches.length;
    perFile.push({ file: relative(process.cwd(), file), n: matches.length });
  }
}

console.log(
  `\n🔠 Type floor · ${total} sub-12px literals (text-[10px]/text-[11px]) · baseline ${BASELINE}`,
);

if (total > BASELINE) {
  const worst = perFile.sort((a, b) => b.n - a.n).slice(0, 8);
  console.error(
    `\n✗ ${total - BASELINE} NEW sub-12px literal(s) since the ratchet was set.`,
  );
  console.error(
    "  Anything a user reads or acts on must be ≥12px on mobile. Use the",
  );
  console.error(
    "  `.micro-label` utility (globals.css · rem-based, scales with root)",
  );
  console.error("  or text-[12px] instead. Heaviest files:");
  for (const f of worst) console.error(`    ${f.n.toString().padStart(3)}  ${f.file}`);
  process.exit(1);
}

if (total < BASELINE) {
  console.log(
    `✓ ${BASELINE - total} fewer than baseline — nice. Lower BASELINE in this script to ${total} to lock the win in.`,
  );
} else {
  console.log("✓ at baseline · no new sub-12px literals.");
}
