/**
 * Binding guard for the hand-written game bundles.
 *
 * WHY THIS EXISTS
 *   The arcade's vanilla-JS games (public/chop, public/bitcoin-kart,
 *   public/six-deep) are plain browser modules. They are outside `tsc
 *   --noEmit`, outside ESLint, and outside every deterministic suite in
 *   `npm run verify` — those suites import *pure data/engine* modules,
 *   never the DOM/WebGL files. So a whole class of runtime-fatal bug can
 *   ship with a green build.
 *
 *   It did. Commit 86501e5 inserted a block into chop's cutNote() that
 *   read `onBeat` thirty lines ABOVE its own `const` declaration. That is
 *   a temporal-dead-zone THROW, not an undefined read. Because `S.hits++`
 *   sat above the throw, the counters kept climbing while every reward
 *   below it — sats, cut SFX, haptics, hitstop, camera kick, score pops,
 *   sparks, debris halves, the combo pill, praise, music intensity — went
 *   silently dead on EVERY cut, in production, for a full release. Blind
 *   visual review could not see it: the frames still had cubes in them.
 *
 * WHAT IT DOES
 *   Runs the TypeScript compiler (already a devDependency) over the game
 *   files with allowJs + checkJs, then keeps ONLY the diagnostics that
 *   mean "this throws at runtime regardless of types". Type inference
 *   noise on untyped JS is discarded — this is a binding checker, not a
 *   type checker, and it must stay that way or nobody will keep it green.
 *
 * TO ADD A GAME: append to TARGETS. Cheap — the check is ~1-2s.
 */
import ts from "typescript";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Files to bind-check. Vendored libraries are deliberately excluded: they
// are minified third-party code and their diagnostics are not ours to fix.
const TARGETS = [
  "public/chop/js/main.js",
  "public/chop/js/music.js",
  "public/chop/js/board.js",
  "public/chop/js/latency.js",
  "public/chop/js/beatgrid.js",
  "public/chop/js/blockfacts.js",
  "public/chop/js/chart.js",
  "public/chop/qa/derive-grid.js",
  "public/bitcoin-kart/js/main.js",
  "public/bitcoin-kart/js/race.js",
  "public/bitcoin-kart/js/hub.js",
  "public/bitcoin-kart/js/ai.js",
  "public/bitcoin-kart/js/track.js",
  "public/bitcoin-kart/js/geometry.js",
  "public/bitcoin-kart/js/coach.js",
  "public/bitcoin-kart/js/save.js",
  "public/six-deep/js/main.js",
];

/**
 * The runtime-fatal set. Every code here means the program throws or
 * misbehaves no matter how the value is typed:
 *   2304 Cannot find name 'X'                    · dangling reference
 *   2552 Cannot find name 'X'. Did you mean 'Y'? · typo'd reference
 *   2448 Block-scoped variable 'X' used before its declaration · TDZ throw
 *   2454 Variable 'X' is used before being assigned
 *   2451 Cannot redeclare block-scoped variable 'X'
 *   2588 Cannot assign to 'X' because it is a constant
 *   2657 JSX expressions must have one parent (syntax-adjacent)
 *   1108 A 'return' statement can only be used within a function body
 * Anything else (type mismatches, implicit any, missing props) is NOISE
 * on untyped browser JS and is dropped.
 */
const FATAL = new Set([2304, 2552, 2448, 2454, 2451, 2588, 1108]);

/**
 * Names the browser gives us that TS's lib.dom may not know about, plus
 * our own debug handles. A miss here would be a FALSE POSITIVE (code
 * 2304), which is worse than a false negative — it trains people to
 * ignore the check. Keep this list tight and justified.
 */
const KNOWN_GLOBALS = new Set([
  "__CHOP", "__BK_RACE", "__BK_AUTO", "__SIX", "__SS",
  "webkitAudioContext", "WebKitCSSMatrix",
]);

const COMPILER_OPTS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  // The games are ES modules loaded straight by the browser, with
  // extension-bearing relative specifiers ("./music.js"). Bundler
  // resolution is the mode that accepts those without complaint.
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  // Do not walk into node_modules types; nothing here imports a package.
  types: [],
  skipLibCheck: true,
  strict: false,
  noImplicitAny: false,
};

/**
 * SELF-TEST — verify the instrument before trusting its reading.
 *
 * A guard that silently stops guarding is worse than no guard: it prints
 * a ✓ and everyone relaxes. One wrong compiler option (checkJs off, a
 * lib swap, a TS major bump that renumbers a diagnostic) would do exactly
 * that. So before checking real files, compile a synthetic module that
 * contains BOTH regression shapes we have actually shipped, and require
 * that both are caught. If the instrument is broken, this fails first and
 * says so in those words.
 */
function selfTest(): void {
  const probePath = resolve(process.cwd(), "__binding-guard-selftest__.js");
  const probeSrc = [
    "export function shipped86501e5(score) {",
    "  const S = { beatRun: 0 };",
    "  if (score >= 110 && onBeat) S.beatRun++;   // TDZ read (TS2448)",
    "  const onBeat = score > 0;",
    "  return S.beatRun + (onBeat ? 1 : 0);",
    "}",
    "export function danglingReference() {",
    "  return edges.count;                        // removed symbol (TS2304)",
    "}",
  ].join("\n");

  const host = ts.createCompilerHost(COMPILER_OPTS);
  const realGetSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, onErr, shouldCreate) =>
    name === probePath
      ? ts.createSourceFile(name, probeSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
      : realGetSource(name, lang, onErr, shouldCreate);
  host.fileExists = (name) => name === probePath || ts.sys.fileExists(name);
  host.readFile = (name) => (name === probePath ? probeSrc : ts.sys.readFile(name));

  const probe = ts.createProgram([probePath], COMPILER_OPTS, host);
  const caught = new Set(
    probe
      .getSemanticDiagnostics()
      .filter((d) => d.file?.fileName === probePath && FATAL.has(d.code))
      .map((d) => d.code),
  );
  // and prove the syntax path is live, since it has its own code path
  const synProbePath = resolve(process.cwd(), "__binding-guard-syntax__.js");
  const synHost = ts.createCompilerHost(COMPILER_OPTS);
  const synReal = synHost.getSourceFile.bind(synHost);
  const synSrc = "export function broken() { return 1; }\n}\n";
  synHost.getSourceFile = (name, lang, onErr, shouldCreate) =>
    name === synProbePath
      ? ts.createSourceFile(name, synSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
      : synReal(name, lang, onErr, shouldCreate);
  synHost.fileExists = (name) => name === synProbePath || ts.sys.fileExists(name);
  synHost.readFile = (name) => (name === synProbePath ? synSrc : ts.sys.readFile(name));
  const synProgram = ts.createProgram([synProbePath], COMPILER_OPTS, synHost);
  const sawSyntax = synProgram
    .getSyntacticDiagnostics()
    .some((d) => d.file?.fileName === synProbePath);
  if (!sawSyntax) {
    console.error(
      "✗ SELF-TEST FAILED — the syntax path is not reporting.\n" +
      "  A file with an unmatched brace parsed clean. That exact case has\n" +
      "  already slipped through this guard once.",
    );
    process.exit(1);
  }

  const missing = [2448, 2304].filter((c) => !caught.has(c));
  if (missing.length) {
    console.error(
      `✗ SELF-TEST FAILED — this guard is not guarding.\n` +
      `  Expected TS${missing.join(" and TS")} on a synthetic file that\n` +
      `  definitely contains ${missing.includes(2448) ? "a temporal-dead-zone read" : ""}` +
      `${missing.length === 2 ? " and " : ""}${missing.includes(2304) ? "a dangling reference" : ""}, and got nothing.\n` +
      `  Something changed the compiler options or the diagnostic codes.\n` +
      `  Fix the instrument before trusting any ✓ below it.`,
    );
    process.exit(1);
  }
  console.log("  ✓ self-test: syntax errors, TDZ (TS2448) and dangling references (TS2304) all detectable");
}

const roots = TARGETS.map((t) => resolve(process.cwd(), t)).filter((p) => {
  const ok = existsSync(p);
  if (!ok) console.log(`  · skipped (absent): ${p.replace(process.cwd() + "/", "")}`);
  return ok;
});

if (!roots.length) {
  console.error("✗ no game bundles found — TARGETS is stale");
  process.exit(1);
}

console.log(`Game binding guard · ${roots.length} file(s)`);
selfTest();

const program = ts.createProgram(roots, COMPILER_OPTS);

const rootSet = new Set(roots);
let failures = 0;

// SYNTAX ERRORS ARE ALWAYS FATAL — no allow-list.
// These were previously funnelled through FATAL, which lists semantic
// codes, so a genuine parse failure (a stray brace left by a bad splice)
// passed this guard clean and only `node --check` caught it. A file that
// does not parse cannot run; there is no code number worth consulting.
for (const d of program.getSyntacticDiagnostics()) {
  if (!d.file || !rootSet.has(d.file.fileName)) continue;
  const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
  const rel = d.file.fileName.replace(process.cwd() + "/", "");
  console.error(`  ✗ ${rel}:${line + 1}:${character + 1}  SYNTAX TS${d.code}  ${text}`);
  failures++;
}

for (const d of program.getSemanticDiagnostics()) {
  if (!d.file || !rootSet.has(d.file.fileName)) continue; // ignore vendored three
  if (!FATAL.has(d.code)) continue;
  const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
  // allow-listed browser/debug globals
  const named = /Cannot find name '([^']+)'/.exec(text)?.[1];
  if (named && KNOWN_GLOBALS.has(named)) continue;
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
  const rel = d.file.fileName.replace(process.cwd() + "/", "");
  console.error(`  ✗ ${rel}:${line + 1}:${character + 1}  TS${d.code}  ${text}`);
  failures++;
}

if (failures) {
  console.error(
    `\n✗ ${failures} runtime-fatal binding error(s) in the game bundles.\n` +
    `  These THROW in the browser. A green tsc on src/ does not cover these files.`,
  );
  process.exit(1);
}
console.log("✓ no dangling references or temporal-dead-zone reads");
