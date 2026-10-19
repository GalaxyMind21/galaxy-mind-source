#!/usr/bin/env tsx
/**
 * check-jsx-whitespace
 *
 * Greps the codebase for the JSX whitespace-collapse pattern that has
 * bitten /stack twice now (HOLDon, contrariananswer):
 *
 *   <span>WORD</span>NEWLINE+INDENT+followingword
 *   <strong>...</strong>NEWLINE+INDENT+followingword
 *
 * In theory JSX inserts a single space at line breaks between text
 * content. In practice (Next 16 + Turbopack + React 19.2 + certain
 * attribute combinations) the space sometimes collapses to nothing,
 * smashing the words together in the rendered output.
 *
 * The fix is always the same: replace the implicit space with explicit
 * `{" "}` interpolation. This script catches the pattern at lint time
 * so the bug doesn't ship a third time.
 *
 * Run via:
 *   npx tsx scripts/check-jsx-whitespace.ts
 *
 * Exit codes:
 *   0 = no risky patterns found
 *   1 = found at least one risky pattern (CI should fail)
 *
 * Allow-list:
 *   - Lines inside block comments are skipped (heuristic: walks back
 *     looking for an unclosed comment opener).
 *   - Files in node_modules / .next / dist are skipped.
 *   - Lines that already contain `{" "}` adjacent are skipped.
 *   - Closing tags preceded by an HTML entity (e.g. `&ldquo;`) are
 *     skipped · those are typography characters where flush-against
 *     text is intentional.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/app", "src/components"];
const EXTS = new Set([".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);

// Inline tags whose closing form is at risk of whitespace collapse.
// Keep this list tight · adding more tags increases false positives.
const RISKY_TAGS = ["span", "strong", "em", "a", "code", "b", "i"];

// Pattern: closing tag immediately followed by whitespace then a word
// (a real space + letter is what's at risk of collapsing), then more
// same-line content, then a line break, then indentation, then a
// lowercase continuation word.
//
// The critical bit is the `\s+\w` right after the closing tag · this
// is the ACTUAL at-risk whitespace that "HOLDon" and "contrariananswer"
// shipped with. If a closing tag is followed by punctuation directly
// (e.g. `</strong>.`) there's no space to collapse, so we don't flag it.
//
// We require lowercase on the continuation word to avoid matching JSX
// element siblings (which start with uppercase).
//
// Trailing alternation closes a real blind spot (audit 2026-05): the
// original `\n\s+[a-z]` only caught `</tag> word…\n  continuationword`.
// It MISSED `</tag> word…\n</parent>` — the at-risk text run ending
// right before the parent's closing tag. That is exactly what shipped
// "Sells forBitcoin" on /methodology: the JSXText after `<em>for</em>`
// is multiline (ends with the newline before `</h2>`), so JSX trims
// its LEADING space. The collapse mechanism is identical — a multiline
// JSXText leading-trims; whether a word or a closing tag follows the
// newline matters only to DETECTION, not to the bug. The `<\/` branch
// flags that case too.
const PATTERN = new RegExp(
  `\\b<\\/(?:${RISKY_TAGS.join("|")})>[ \\t]+[A-Za-z][^\\n<>{}]*\\n\\s*(?:[a-z]|<\\/)`,
  "g",
);

type Finding = {
  file: string;
  line: number;
  excerpt: string;
};

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p, out);
    } else if (st.isFile() && EXTS.has(p.slice(p.lastIndexOf(".")))) {
      out.push(p);
    }
  }
  return out;
}

function scanFile(file: string): Finding[] {
  const src = readFileSync(file, "utf8");
  const findings: Finding[] = [];
  PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATTERN.exec(src)) !== null) {
    const offset = match.index;
    const upToMatch = src.slice(0, offset);
    const line = upToMatch.split("\n").length;

    // Skip if inside a block comment · walk backwards through preceding
    // lines and bail if we hit an unclosed comment.
    const preceding = upToMatch.split("\n").slice(-15).join("\n");
    const lastBlockOpen = preceding.lastIndexOf("/*");
    const lastBlockClose = preceding.lastIndexOf("*/");
    if (lastBlockOpen > lastBlockClose) continue;

    // Skip if the matched span already includes the explicit fix.
    const matchedText = match[0];
    if (matchedText.includes('{" "}')) continue;

    // Skip if the closing tag is preceded by an HTML entity ·
    // typography characters (&ldquo; &rdquo; etc) where flush-against
    // text is intentional.
    const before = src.slice(Math.max(0, offset - 8), offset);
    if (/&\w+;\s*$/.test(before)) continue;

    findings.push({
      file: relative(process.cwd(), file),
      line,
      excerpt: matchedText.replace(/\n/g, "\\n").slice(0, 100),
    });
  }
  return findings;
}

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function main(): void {
  const files = ROOTS.flatMap((r) => walk(r));
  const allFindings = files.flatMap(scanFile);

  if (allFindings.length === 0) {
    console.log(
      `${C.ok} JSX whitespace check: ${files.length} files scanned, no risky patterns found.`,
    );
    return;
  }

  console.log(C.bold(`Found ${allFindings.length} risky JSX whitespace pattern(s):`));
  console.log(
    C.dim(
      '  Pattern: </tag> word…\\n(<indent>word | </parent>) · a multiline JSXText after an inline tag gets its LEADING space trimmed, smashing words together in render. Fix with explicit {" "} interpolation.',
    ),
  );
  console.log();
  for (const f of allFindings) {
    console.log(`  ${C.fail} ${f.file}:${f.line}`);
    console.log(`     ${C.dim(f.excerpt)}`);
  }
  console.log();
  console.log(C.bold("Suggested fix:"));
  console.log('  <strong>word</strong>{" "}\n  followingword');
  process.exitCode = 1;
}

main();
