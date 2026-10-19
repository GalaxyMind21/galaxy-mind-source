// Build-time minifier for the static Bitcoin Kart game (2026-07-18).
//
// The game ships as a no-build directory served verbatim from
// public/bitcoin-kart/. Its committed SOURCE stays readable on purpose:
// scripts/test-bitcoin-kart.ts imports the game's modules AND greps
// decision sentinels ("wall feeler", "MUSIC SLOTS", ...) out of the
// comments AND regex-extracts functions (cardSeg) from the source text, so
// stripping comments in place would break the suite itself. The real
// "minification sweep" is therefore this BUILD-TIME pass: it runs ONLY in
// the Vercel build sandbox (VERCEL=1), minifying the shipped js/css in
// place so users load ~360KB instead of ~600KB, while the repo source is
// never touched. Local `npm run build` skips it (source served as-is).
//
// Conservative settings: whitespace + syntax only, NO identifier mangling,
// so nothing name-dependent can break at runtime. scripts/test-bitcoin-
// kart.ts measures the payload with the SAME settings, so the cap reflects
// the real deployed load. Pass a target dir as argv[2] to minify a copy
// (used by the test rig to smoke-test the minified build).

import esbuild from "esbuild";
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// exported so scripts/test-bitcoin-kart.ts measures the payload with the
// EXACT settings the deploy uses (the cap then reflects real load)
export const MINIFY_OPTS = { minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".js") || name.endsWith(".css")) out.push(p);
  }
  return out;
}

// only minify when run directly (node scripts/build-kart.mjs) · importing
// this module for MINIFY_OPTS must stay side-effect-free
if ((process.argv[1] || "").endsWith("build-kart.mjs")) {
  const target = process.argv[2];
  const onVercel = process.env.VERCEL === "1" || process.env.KART_MINIFY === "1";
  if (!target && !onVercel) {
    console.log("build-kart: skipped (local build · source served as-is)");
  } else {
    const ROOT = target || "public/bitcoin-kart";
    let before = 0, after = 0;
    for (const f of walk(ROOT)) {
      const body = readFileSync(f, "utf8");
      before += Buffer.byteLength(body);
      const res = esbuild.transformSync(body, { loader: f.endsWith(".css") ? "css" : "js", ...MINIFY_OPTS });
      writeFileSync(f, res.code);
      after += Buffer.byteLength(res.code);
    }
    console.log(`build-kart: minified ${ROOT} · ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB`);
  }
}
