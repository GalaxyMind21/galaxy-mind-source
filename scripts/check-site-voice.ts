#!/usr/bin/env tsx
/**
 * check-site-voice
 *
 * The voice gate for PAGE COPY. `test-social-drafts.ts` has enforced the
 * same rules on generated posts since 2026-08-04; nothing enforced them
 * on the prose the site actually renders, and it showed: the sitewide
 * de-slop pass of 2026-08-05 rewrote `lib/hashrate-copy.ts` for
 * punctuation, and by 2026-08-27 that same file had drifted back to
 * SEVEN em-dash clause breaks, because /hashrate was rebuilt through
 * August and the rule lived only in a doc. A copy rule that is not in
 * `npm run verify` loses to the next feature sprint.
 *
 * WHAT IT CHECKS (shipped strings only):
 *   1. em/en dash used as a clause break. The house separator is `·`;
 *      ` — ` in prose is the single strongest drafted-by-a-model tell,
 *      and it is the one the operator clocks first.
 *   2. The structural slop patterns measured in test-social-drafts.ts
 *      on 2026-08-08, when a batch of drafts was rejected as "very AI"
 *      while passing every vocabulary-level check. Sentence
 *      ARCHITECTURE, not word choice.
 *   3. Runaway sentence length (RUNAWAY_WORDS), which is the readability
 *      half and the SEO half at once: these strings include FAQPage
 *      JSON-LD answers, and a 64-word semicolon chain gives Google
 *      nothing liftable for a featured snippet.
 *
 * TWO RULES THIS FILE EXISTS TO ENCODE, both learned the expensive way:
 *
 * A. STRIP COMMENTS FIRST. The first version of this scan reported 416
 *    hits; ~85% were authoring notes, not shipped copy. A gate that
 *    cries wolf gets disabled, and then the drift it existed to stop
 *    happens anyway.
 *
 * B. A REGEX THAT FIRES ON GOOD WRITING IS WORSE THAN NONE. Every
 *    pattern here was measured to fire ZERO times on the accepted
 *    corpus before it shipped. The gate re-proves that on every commit:
 *    if one starts firing on copy the operator likes, verify goes red
 *    and the rule gets re-argued, rather than the claim quietly
 *    going stale.
 *
 * THE ENUMERATION EXEMPTION is principled, not a fudge. A colon
 * introducing four or more comma-separated items is a LIST, and a
 * reader parses a list as items rather than as a clause chain, so it
 * stays legible at length (/faq's asset roster, /fit's presets, the
 * signal-source list). A long sentence WITHOUT that shape is a chain,
 * and a chain is where the reader loses the thread. Length alone was
 * measured to flag all seven surviving enumerations; length-minus-
 * enumerations flags none of them.
 *
 * DELIBERATE KEEPS live in ALLOW below, each with the reason. The
 * 2026-08-05 pass established that list; "Not financial advice." and
 * the 404 joke are not slop, they are house voice.
 *
 * Run:  npx tsx scripts/check-site-voice.ts
 * Exit: 0 clean · 1 at least one violation (CI fails)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/app", "src/lib", "src/components"];
const EXTS = new Set([".ts", ".tsx"]);

/** Sentences at or above this many words are runaway unless enumerated. */
const RUNAWAY_WORDS = 46;

/**
 * Files whose strings are not page prose.
 *  - /api/  route handlers: machine payloads and operator error text.
 *  - vendors.ts: merchant-supplied descriptions. We quote shops, we do
 *    not rewrite them, and precision about what someone sells matters
 *    more than cadence.
 *  - glossary*.ts: definitions written to be QUOTED with attribution by
 *    AI agents. Density there is the product; simplifying them makes
 *    them less citable, not more.
 *  - trail-deck.ts: HODL Trail event lines, authored as period voice.
 *  - social-drafts / badge-outreach: already gated, harder, by
 *    test-social-drafts.ts and test-badge-outreach.ts.
 *  - email.ts: HTML template soup; string extraction is unreliable there.
 *  - treasury-shares.ts: `source`/`note` carry filing provenance for the
 *    constant-freshness audit, not prose anybody reads on a page.
 *  - admin/: operator-only UI behind a bearer token.
 */
const SKIP_PATH =
  /(?:\/api\/|\/admin\/|\/lib\/vendors\.ts|\/lib\/glossary(?:-deep)?\.ts|\/lib\/trail-deck\.ts|\/lib\/social-drafts\.ts|\/lib\/badge-outreach\.ts|\/lib\/email\.ts|\/lib\/treasury-shares\.ts)/;

/** Deliberate keeps. Each entry must say WHY, so this never becomes a dumping ground. */
const ALLOW: [RegExp, string][] = [
  [/Not financial advice|Not investment advice|Not tax advice/i, "disclaimer, house voice since launch"],
  [/Not your URL, not your coins/i, "the 404 joke (2026-08-05 keep-list)"],
  [/Four plebs\.|One chair\.|No second best/i, "game poster taglines (2026-08-05 keep-list)"],
  [/not spend OR hold/i, "glossary load-bearing contrast (2026-08-05 keep-list)"],
  [/curated roster, not a census/i, "load-bearing contrast (2026-08-05 keep-list)"],
  [/workaround, not acceptance/i, "load-bearing contrast (2026-08-05 keep-list)"],
];

type Pattern = [RegExp, string];

/** Typographic + vocabulary tells. */
const TYPOGRAPHIC: Pattern[] = [
  [/\s[—–]\s/u, "em/en dash clause break · the house separator is `·`"],
  [/≈/u, "approx symbol · write 'about'"],
  [
    /\b(?:game.?changer|revolutioni[sz]e|unleash|elevate your|in today's world|cutting.edge|state.of.the.art|treasure trove|testament to)\b/i,
    "stock AI vocabulary",
  ],
];

/**
 * Sentence-architecture tells. Ported from test-social-drafts.ts, where
 * each was measured against 237 accepted post texts and fired on none.
 * Re-measured against page copy before landing here.
 */
const STRUCTURAL: Pattern[] = [
  [
    /(?:^|\n)[^\n]{0,20}\bhere(?:'s|s| is)\s+(?:what|why|how|where|when|the thing|everything)\b/i,
    "deictic-promise opener (\"Here's what X costs\")",
  ],
  [
    /\b(?:ever\s+(?:wonder(?:ed|ing)?|thought about)|did you know|you(?:'re| are) probably wondering)\b/i,
    "rhetorical-wondering hook (\"Ever wondered...\")",
  ],
  [
    /\b(?:we|i)\s+(?:built|made|created|shipped|launched)\s+(?:a|an|the)\s[^.!?\n]{0,40}\bthat\s+(?:lets|helps|shows|gives|tells|answers|makes|tracks|calculates)\b/i,
    "builder announcement with benefit clause",
  ],
  [
    /(?:^|\n|[.!?]\s+)(?:for context|put simply|simply put|in short|here'?s the thing|make no mistake|the kicker|let'?s be honest|in other words)\b/i,
    "discourse-marker preamble (\"For context,\")",
  ],
  [
    /\byou(?:'d|'ll| would| will)\s+(?:statistically|effectively|essentially|realistically|technically|basically)\b/i,
    "hedged-adverb conditional (\"you'd statistically land a block\")",
  ],
  [
    /\bit(?:'s| is)\s+not\s+[^.!?\n]{0,30}\.\s+It(?:'s| is)\s/i,
    "\"It's not X. It's Y.\" flourish",
  ],
  [
    /\bthink\s+\w[^,.!?\n]{2,30},\s+but\s+(?:for|with|on)\b/i,
    "\"Think X, but Y\" analogy",
  ],
];

// ── extraction ───────────────────────────────────────────────────────
/** Blank out comments so authoring notes never reach the patterns (rule A). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (quote) {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c2 === "//") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c2 === "/*") {
      while (i < src.length && src.slice(i, i + 2) !== "*/") { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/** Tailwind / code shapes that are not prose. */
const CLASSY =
  /(?:^|\s)(?:flex|grid|text-\[?|bg-|border-|px-|py-|mt-|mb-|rounded|hover:|md:|lg:|sm:|w-|h-|gap-|p-\d|font-|leading-|tracking-|opacity-|z-\d|min-|max-|inline-|justify-|items-|space-|overflow-|shadow-|transition|duration-|translate-|scale-|var\(--)/;
const CODEISH = /^(?:https?:|\/[a-z]|[\w.-]+@|#[0-9a-f]{3,8}$|use (?:client|server))/i;

function looksLikeProse(raw: string): boolean {
  const t = raw.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 40) return false;
  if (!/[a-z]{4}/.test(t)) return false;
  if (CLASSY.test(t) || CODEISH.test(t)) return false;
  if (/[<>{}]|=>|style=|px;|#[0-9a-f]{6}|function |const |return /.test(t)) return false;
  // Ops/developer strings (thrown Errors, config guidance) name env vars in
  // SCREAMING_SNAKE. Page copy never does, so this separates the two cleanly
  // without allow-listing individual sentences that will drift out of date.
  if (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(t)) return false;
  if (t.split(/\s+/).length < 7) return false;
  return true;
}

function normalise(raw: string): string {
  return raw
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\$\{[^}]*\}/g, "X") // template holes -> a token, so counts stay honest
    .replace(/&[a-z]+;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sentence split that survives this site's lowercase-identifier openers.
 * `mNAV`, `costBtc`, `isolabellart` and `1.0x` all legitimately START
 * sentences here, so a naive `[.!?]\s+(?=[A-Z])` rule silently welds
 * sentences together and reports invented 40-word monsters. That
 * artifact inflated the first measurement of this very pass.
 */
export function splitSentences(t: string): string[] {
  const ABBR = /(?:\b(?:etc|e\.g|i\.e|vs|approx|Inc|Ltd|Co|St|Mr|Mrs|Dr|No|Fig|al|U\.S|U\.K)\.)$/i;
  const parts: string[] = [];
  let cur = "";
  for (const tok of t.split(/(\s+)/)) {
    cur += tok;
    if (!/[.!?]["')\]]?$/.test(tok)) continue;
    const trimmed = cur.trimEnd();
    if (ABBR.test(trimmed)) continue;
    if (/(?:^|\s)[A-Z]\.$/.test(trimmed)) continue; // middle initial
    parts.push(cur.trim());
    cur = "";
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter((s) => s.length > 3);
}

/** A colon introducing 4+ comma-separated items reads as a list, not a chain. */
export function isEnumeration(sentence: string): boolean {
  const afterColon = sentence.split(/:\s/).slice(1).join(": ");
  if (!afterColon) return false;
  return afterColon.split(",").length >= 4;
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
}

// ── walk ─────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, out); continue; }
    if (EXTS.has(p.slice(p.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

export type Violation = { file: string; line: number; why: string; text: string };

function scanText(file: string, line: number, text: string, out: Violation[]): void {
  if (ALLOW.some(([re]) => re.test(text))) return;
  for (const [re, why] of [...TYPOGRAPHIC, ...STRUCTURAL]) {
    if (re.test(text)) out.push({ file, line, why, text });
  }
  for (const s of splitSentences(text)) {
    const w = wordCount(s);
    if (w >= RUNAWAY_WORDS && !isEnumeration(s)) {
      out.push({ file, line, why: `runaway sentence (${w} words, not an enumeration)`, text: s });
    }
  }
}

export function scanSource(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  const src = stripComments(source);
  const seen = new Set<string>();
  const push = (line: number, raw: string) => {
    if (!looksLikeProse(raw)) return;
    const text = normalise(raw);
    const key = `${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    scanText(file, line, text, out);
  };
  // `\\[\s\S]` rather than `\\.` + the /s flag: this tsconfig targets below
  // es2018, where the dotAll flag is a compile error.
  const strRe = /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(src))) push(src.slice(0, m.index).split("\n").length, m[2]);
  const jsxRe = />([^<>{}]{40,})</g;
  while ((m = jsxRe.exec(src))) push(src.slice(0, m.index).split("\n").length, m[1]);
  return out;
}

// ── self-test (rule B: prove the gate still detects before it certifies) ──
function selfTest(): string[] {
  const fails: string[] = [];
  const POISON = [
    ["const a = \"Here's what a real shot costs, and why it matters.\";", "deictic-promise"],
    ["const b = \"Renting costs more than mining — the gap is what you pay.\";", "em dash"],
    ["const c = \"Running nonstop, you would statistically find a block eventually.\";", "hedged adverb"],
    ["const d = \"For context, the fleet runs around the clock in a US facility.\";", "discourse marker"],
  ];
  for (const [src, label] of POISON) {
    if (scanSource("poison.ts", src).length === 0) fails.push(`self-test: poison "${label}" NOT caught`);
  }
  // A comment carrying poison must NOT be reported (rule A).
  const commented = `// Here's what a real shot costs — for context, it is a lot.\nconst ok = "The fleet runs in a US facility.";`;
  if (scanSource("comment.ts", commented).length !== 0) {
    fails.push("self-test: a COMMENT was reported · comment stripping is broken");
  }
  // An enumeration at length must NOT be reported.
  const enumSrc = `const e = "Every signal pulls from a public source: CoinGecko for price, Yahoo Finance for moving averages and volatility, Coinmetrics for MVRV and Puell, OKX for the perpetual funding rate, alternative.me for Fear and Greed, and mempool.space for the current block height.";`;
  if (scanSource("enum.ts", enumSrc).some((v) => v.why.startsWith("runaway"))) {
    fails.push("self-test: an ENUMERATION was flagged as runaway");
  }
  // Lowercase-identifier sentence starts must not weld into a false runaway.
  const lower = `const f = "The renter points the machines at their own pool. costBtc is the list price in BTC. mNAV is a different metric entirely and belongs on the treasury pages instead of here.";`;
  if (scanSource("lower.ts", lower).some((v) => v.why.startsWith("runaway"))) {
    fails.push("self-test: lowercase sentence starts welded into a false runaway");
  }
  return fails;
}

function main(): void {
  const selfFails = selfTest();
  if (selfFails.length) {
    console.error("check-site-voice: SELF-TEST FAILED\n");
    for (const f of selfFails) console.error("  " + f);
    process.exit(1);
  }

  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !SKIP_PATH.test("/" + f));
  const violations: Violation[] = [];
  for (const f of files) {
    let src: string;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    violations.push(...scanSource(relative(process.cwd(), f), src));
  }

  if (violations.length) {
    console.error(`check-site-voice: ${violations.length} voice violation(s) in shipped copy\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.why}`);
      console.error(`    ${v.text.slice(0, 190)}\n`);
    }
    console.error("Rewrite the sentence. Do not loosen the gate to admit it.");
    console.error("A genuine keep goes in ALLOW at the top of this file, WITH its reason.");
    process.exit(1);
  }

  console.log(
    `check-site-voice: ✓ ${files.length} files · self-test green · no em-dash breaks, structural tells, or runaway sentences in shipped copy`,
  );
}

main();
