/**
 * OG FONT GUARD · the social cards are set in Plus Jakarta Sans, and there are two
 * ways that quietly stops being true.
 *
 * WHY THIS EXISTS
 * ---------------
 * 1. THE FILES ARE READ OFF DISK, NOT IMPORTED. `lib/og-bench.tsx` does a
 *    `readFileSync` on `src/app/fonts/*.ttf`, so nothing in the module
 *    graph references them and Next's tracer has no reason to ship them.
 *    `next.config.ts` pins them with `outputFileTracingIncludes`. If that
 *    pin is removed the fonts vanish from the deployed function while dev
 *    stays perfect — and because `benchFonts()` FAILS SOFT (deliberately:
 *    37 routes, an exception would 500 every social card) the only symptom
 *    would be the cards quietly going back to system sans.
 *
 * 2. A GLYPH THE FACE DOES NOT HAVE SENDS SATORI TO THE NETWORK. Probed
 *    2026-09-10 with a real card: `Failed to load dynamic font for ▼ .
 *    Error: Failed to download dynamic font. Status: 400`, and the card
 *    rendered a tofu box. This is the same failure the vendor and stack
 *    cards already carry ASCII-only comments about — 449 production errors
 *    from ★ / ₿ — except supplying our own font makes the covered set
 *    SMALLER than next/og's default, so the trap got easier to fall into.
 *    The face first used here covered ▲ (U+25B2) but not ▼ (U+25BC), which
 *    is why the float card draws its down state as a rotated ▲ (that works
 *    with any face that has ▲).
 *
 * Emoji are exempt: next/og resolves those through its own emoji pipeline,
 * not the supplied font, which is how the vendor cards' country flags work.
 * NBSP is exempt too, and that is measured rather than assumed — the probe
 * above showed Satori treats U+00A0 as whitespace and never asks for a
 * glyph. It is load-bearing in the /fit card, where Satori strips ordinary
 * trailing whitespace from flex text nodes.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const FONT_DIR = join(ROOT, "src/app/fonts");
const EXPECTED = [
  { file: "PlusJakartaSans-Regular.ttf", weight: 400 },
  { file: "PlusJakartaSans-Medium.ttf", weight: 500 },
  { file: "PlusJakartaSans-Bold.ttf", weight: 700 },
];

let failures = 0;
const fail = (m: string) => {
  console.error(`  ✗ ${m}`);
  failures++;
};
const ok = (m: string) => console.log(`  ✓ ${m}`);

console.log("\nog fonts\n");

// ── a minimal sfnt cmap reader ────────────────────────────────────────
// Only what is needed to answer "is this codepoint covered": the Windows
// Unicode subtables, format 4 (BMP) and format 12 (full range).
function coveredCodepoints(buf: Buffer): Set<number> {
  const out = new Set<number>();
  const numTables = buf.readUInt16BE(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap") {
      cmapOff = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (!cmapOff) return out;

  const nSub = buf.readUInt16BE(cmapOff + 2);
  const subtables: number[] = [];
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    // Windows BMP (3,1), Windows full (3,10), and Unicode (0,*)
    if (platform === 3 || platform === 0) {
      subtables.push(cmapOff + buf.readUInt32BE(rec + 4));
      void encoding;
    }
  }

  for (const off of subtables) {
    const format = buf.readUInt16BE(off);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(off + 6);
      const seg = segX2 / 2;
      const endBase = off + 14;
      const startBase = endBase + segX2 + 2;
      for (let s = 0; s < seg; s++) {
        const end = buf.readUInt16BE(endBase + s * 2);
        const start = buf.readUInt16BE(startBase + s * 2);
        if (start > end || end === 0xffff) continue;
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 12) {
      const nGroups = buf.readUInt32BE(off + 12);
      for (let g = 0; g < nGroups; g++) {
        const rec = off + 16 + g * 12;
        const start = buf.readUInt32BE(rec);
        const end = buf.readUInt32BE(rec + 4);
        if (end - start > 0x20000) continue; // guard a corrupt group
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

// ── 1. the files are there and are real TTFs ──────────────────────────
let cover: Set<number> | null = null;
for (const { file, weight } of EXPECTED) {
  const p = join(FONT_DIR, file);
  if (!existsSync(p)) {
    fail(`${file} is missing — regenerate it from the .woff2 beside it (fontTools, flavor = None)`);
    continue;
  }
  const buf = readFileSync(p);
  const tag = buf.readUInt32BE(0);
  // 0x00010000 (TrueType) or "true"; a woff2 here would read "wOF2"
  if (tag !== 0x00010000 && buf.toString("ascii", 0, 4) !== "true") {
    fail(
      `${file} is not a plain TTF (magic ${buf.toString("ascii", 0, 4)}) — ` +
        `Satori cannot read woff/woff2`,
    );
    continue;
  }
  if (file.includes("Regular")) cover = coveredCodepoints(buf);
  ok(`${file} · ${(buf.length / 1024).toFixed(0)}KB, weight ${weight}`);
}

// ── 2. the cmap reader itself works ───────────────────────────────────
// Self-test before trusting it: a reader that returns an empty set would
// make section 4 pass by finding nothing, which is the failure mode this
// repo has shipped before.
if (cover) {
  const present = ["A", "1", "·", "—", "→", "×"].filter((c) => cover!.has(c.codePointAt(0)!));
  const absent = ["⌘", "⏎", "ⓘ"].filter((c) => !cover!.has(c.codePointAt(0)!));
  if (present.length === 6 && absent.length === 3) {
    ok(`cmap reader self-test · ${cover.size} codepoints, knows ▲ is in and ⌘ is not`);
  } else {
    fail(
      `cmap reader is wrong — expected all of A 1 · — → × present (got ${present.length}/6) ` +
        `and ⌘ ⏎ ⓘ absent (got ${absent.length}/3)`,
    );
    cover = null;
  }
}

// ── 3. the trace pin is still in next.config.ts ───────────────────────
{
  const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  if (/outputFileTracingIncludes[\s\S]{0,200}src\/app\/fonts\/\*\.ttf/.test(cfg)) {
    ok("next.config.ts still traces src/app/fonts/*.ttf into the functions");
  } else {
    fail(
      "next.config.ts no longer pins src/app/fonts/*.ttf in outputFileTracingIncludes — " +
        "nothing imports those files, so the deployed cards would silently fall back to system sans",
    );
  }
}

// ── 4. every card supplies the fonts, and asks for no glyph we lack ───
{
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "src/app/**/opengraph-image.tsx",
      "src/app/api/og/**/route.tsx",
      "src/lib/og-catalyst.tsx",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  const isEmoji = (cp: number) =>
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
    cp === 0xfe0f ||
    cp === 0x200d ||
    cp === 0x20e3;

  // U+00A0 is whitespace to Satori, never a glyph request — measured, and
  // load-bearing in the /fit card. See this file's header.
  const EXEMPT = new Set([0x00a0]);

  let noFonts = 0;
  let badGlyphs = 0;

  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const calls = (src.match(/new ImageResponse\(/g) || []).length;
    const fonts = (src.match(/fonts:\s*benchFonts\(\)/g) || []).length;
    if (calls > fonts) {
      noFonts++;
      fail(`${rel}: ${calls} ImageResponse call(s) but ${fonts} pass fonts: benchFonts()`);
    }

    if (!cover) continue;
    const seen = new Set<string>();
    for (const ch of src) {
      const cp = ch.codePointAt(0)!;
      if (cp < 128 || isEmoji(cp) || EXEMPT.has(cp) || cover.has(cp)) continue;
      if (seen.has(ch)) continue;
      seen.add(ch);
      badGlyphs++;
      fail(
        `${rel} prints ${JSON.stringify(ch)} (U+${cp.toString(16).toUpperCase().padStart(4, "0")}), ` +
          `which the face does not have — Satori will try to DOWNLOAD a font for it and render tofu. ` +
          `Use a covered character, or draw it from one (the float card rotates ▲ for its down state).`,
      );
    }
  }

  if (!noFonts) ok(`all ImageResponse calls across ${files.length} cards pass benchFonts()`);
  if (cover && !badGlyphs) ok("no card asks for a glyph the face lacks");
}

console.log("");
if (failures) {
  console.error(`✗ ${failures} og-font problem(s)\n`);
  process.exit(1);
}
console.log("All og-font checks passed.\n");
