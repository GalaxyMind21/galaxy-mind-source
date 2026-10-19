// Repo guard: fails when any tracked file (contents or path) contains a word on the private never-reveal list.
// The list is NOT in this repo: it is NEVER_REVEAL_KEY (HMAC key) + NEVER_REVEAL_DIGESTS (keyed digests and per-file
// exceptions), held as GitHub Actions secrets. See src/lib/never-reveal.ts.
// Output names the file and line only, never the matched text or digest.
//   npx tsx scripts/check-never-reveal.ts             skip with a notice when the values are absent (forks, local)
//   npx tsx scripts/check-never-reveal.ts --require   fail when they are absent or malformed (push to main)
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { digestTerm, neverRevealFromEnv, neverRevealStatus, normalizeTerm, tokenize, tokenSpans, windowsAt } from "../src/lib/never-reveal";
import { decodeUtf16, metadataText } from "./lib/file-metadata";

const requireCfg = process.argv.includes("--require");
const status = neverRevealStatus();
const cfg = neverRevealFromEnv();
if (!cfg) {
  const why = status === "invalid" ? "NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS are set but malformed" : "NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS are not available (fork PR or local run)";
  if (requireCfg || status === "invalid") {
    console.error(`check-never-reveal: ${why}. Refusing to pass.`);
    process.exit(1);
  }
  const msg = `check-never-reveal: skipped, ${why}. It is enforced wherever the secrets are available (push to main, same-repo PRs).`;
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=never-reveal guard skipped::${msg}` : msg);
  process.exit(0);
}

const SKIP = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|webp|avif|ico|icns|m4a|mp3|ogg|wav|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp4|webm|glb|bin)$/i;
/** Images and PDFs whose metadata (EXIF / XMP / PNG text / PDF Info) is read even though the body is skipped. */
const META = /\.(png|jpe?g|webp|pdf)$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_META_BYTES = 32 * 1024 * 1024;

// Same function as digestTerm, on node:crypto with a BOUNDED cache (the repo has millions of tokens and few distinct
// ones). Strings up to 256 chars are cached, including windows cut from long tokens; the cache is dropped when it
// reaches CACHE_MAX entries, so a long blob or slug can never grow it without bound. Nothing is skipped: longer
// strings are simply hashed without caching.
const key = Buffer.from(cfg.key);
const cache = new Map<string, string>();
const CACHE_MAX_LEN = 256;
const CACHE_MAX = 500_000;
const raw = (norm: string) => createHmac("sha256", key).update(norm, "utf8").digest("hex").slice(0, 24);
function h(norm: string): string {
  if (norm.length > CACHE_MAX_LEN) return raw(norm);
  let v = cache.get(norm);
  if (v === undefined) {
    v = raw(norm);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(norm, v);
  }
  return v;
}
if (h(normalizeTerm("Self Check 1")) !== digestTerm(cfg.key, "Self Check 1")) throw new Error("check-never-reveal: digest drifted from src/lib/never-reveal.ts");

/** Hits as { token index, digest }: every token, runs of up to cfg.words tokens (plain and dotted), sub windows. */
function hitsIn(toks: readonly string[]): { i: number; d: string }[] {
  const out: { i: number; d: string }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    for (const w of windowsAt(toks, i, cfg!.words)) {
      const a = h(w);
      if (cfg!.guard.has(a)) out.push({ i, d: a });
    }
    for (const [len, ds] of cfg!.sub) {
      if (t.length <= len) continue;
      for (let j = 0; j + len <= t.length; j++) {
        const c = h(t.slice(j, j + len));
        if (ds.has(c) && cfg!.guard.has(c)) out.push({ i, d: c });
      }
    }
  }
  return out;
}

/**
 * Line numbers (1-based) with a non-allowed hit. The whole file is ONE token stream, so a two- or three-word term
 * split across a line break still matches (security audit 2026-10-18, M1c); the hit is reported on the line where
 * its first token starts.
 */
function badLines(text: string, allowed: (d: string) => boolean): number[] {
  const { norm, spans } = tokenSpans(text);
  const hits = hitsIn(spans.map((s) => s.t)).filter((x) => !allowed(x.d));
  if (!hits.length) return [];
  const nl: number[] = [];
  for (let p = norm.indexOf("\n"); p >= 0; p = norm.indexOf("\n", p + 1)) nl.push(p);
  const lineOf = (off: number) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < off) lo = m + 1; else hi = m; } return lo + 1; };
  return [...new Set(hits.map((x) => lineOf(spans[x.i].start)))].sort((a, b) => a - b);
}

function trackedFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch {
    console.error("check-never-reveal: git ls-files failed (not a git checkout?)");
    process.exit(2);
  }
}

// Belt and braces: every allow rule must be anchored (parseNeverReveal refuses unanchored ones and wraps them in ^(?:…)$).
if (cfg.allow.some((a) => !a.files.source.startsWith("^(?:") || !a.files.source.endsWith(")$"))) {
  console.error("check-never-reveal: an allow rule's path pattern is not anchored. Refusing to pass.");
  process.exit(1);
}

const problems: string[] = [];
let scanned = 0;
for (const f of trackedFiles()) {
  const rules = cfg.allow.filter((a) => a.files.test(f)); // parseNeverReveal only accepts anchored patterns (checked below)
  const allowed = (d: string) => rules.some((a) => a.d.has(d));
  if (hitsIn(tokenize(f)).some((x) => !allowed(x.d))) problems.push(`${f} (path)`);
  let st;
  try { st = statSync(f); } catch { continue; } // deleted in the working tree
  if (!st.isFile()) continue;
  if (SKIP.test(f)) {
    // Body skipped, but image and PDF metadata is text that ships with the file (M1d).
    if (META.test(f) && st.size <= MAX_META_BYTES) {
      const meta = metadataText(readFileSync(f), f);
      if (meta && badLines(meta, allowed).length) problems.push(`${f} (metadata)`);
      scanned++;
    }
    continue;
  }
  if (st.size > MAX_BYTES) continue;
  const buf = readFileSync(f);
  let body = buf.toString("utf8");
  if (body.includes("\u0000")) {
    const u16 = decodeUtf16(buf); // UTF-16 text has NUL bytes but is still text (M1d)
    if (u16 === null) continue; // binary
    body = u16;
  }
  scanned++;
  for (const n of badLines(body, allowed)) problems.push(`${f}:${n}`);
}

if (problems.length) {
  console.error(`check-never-reveal: ${problems.length} line(s) in ${scanned} files contain a never-reveal word. Remove it (a public exception goes in the private allow list):`);
  for (const p of problems.slice(0, 200)) console.error("  " + p);
  process.exit(1);
}
console.log(`check-never-reveal: ok (${scanned} files checked against the private list)`);
