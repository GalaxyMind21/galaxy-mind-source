// Gate: src/ never reaches the transport override (review S4-a, replaces
// the PR #188 S-4 call-site lint, which could be evaded by aliasing,
// .call/.apply, namespaces or re-exports).
//
// The override no longer exists on the src-facing API: safeFetch in
// src/lib/safe-fetch.ts takes (url, init, maxRedirects) and always uses the
// DNS-pinned transport. The override lives in src/lib/safe-fetch-transport.ts
// (scripts and tests only), on top of src/lib/safe-fetch-core.ts. So the
// only thing to enforce is the import graph. Under src/:
//   - NO file may reference safe-fetch-transport, by any import form:
//     import (incl. type-only and side-effect), export ... from,
//     export * from, import x = require(), dynamic import(), require(),
//     require.resolve(), or a typeof import("...") type;
//   - only safe-fetch.ts and safe-fetch-transport.ts may reference
//     safe-fetch-core (so nothing else can call runSafeFetch with its own
//     transport);
//   - safe-fetch.ts may not re-export runSafeFetch or the core wholesale,
//     and may use runSafeFetch only as a direct call;
//   - an import()/require() whose argument is not a plain string literal
//     is refused, since it can't be checked (src/ has none today).
// Specifiers are resolved, so "@/lib/...", "./", "../" forms, extensions
// and /index all count. scripts/ is deliberately not scanned.
//
// Run: npx tsx scripts/check-safe-fetch-imports.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const TRANSPORT = "src/lib/safe-fetch-transport";
const CORE = "src/lib/safe-fetch-core";
const PUBLIC_FILE = "src/lib/safe-fetch.ts";
const CORE_IMPORTERS = new Set([PUBLIC_FILE, "src/lib/safe-fetch-transport.ts"]);
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const posix = (p: string) => p.split(sep).join("/");

/** Resolve a module specifier from `fileName` (repo-relative, posix) to a repo-relative module id, or null for packages. */
export function resolveSpecifier(fileName: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = join("src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..")
    target = join(dirname(fileName), spec);
  else if (spec.startsWith("/")) target = relative(ROOT, spec);
  else return null;
  let id = posix(normalize(target)).replace(/\/+$/, "");
  for (const ext of EXTS) if (id.endsWith(ext)) { id = id.slice(0, -ext.length); break; }
  id = id.replace(/\/index$/, "");
  return id.toLowerCase();
}

function literalText(n: ts.Node | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

export function findViolations(fileName: string, source: string): string[] {
  const file = posix(fileName);
  const out: string[] = [];
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const coreLocals = new Set<string>();

  const checkSpec = (spec: string, node: ts.Node, how: string) => {
    const id = resolveSpecifier(file, spec);
    if (!id) return;
    if (id === TRANSPORT) out.push(`${at(node)} ${how} "${spec}": src/ may not import safe-fetch-transport`);
    if (id === CORE && !CORE_IMPORTERS.has(file))
      out.push(`${at(node)} ${how} "${spec}": only safe-fetch.ts may import safe-fetch-core`);
    if (id === CORE && file === PUBLIC_FILE) {
      if (ts.isExportDeclaration(node)) {
        const ec = node.exportClause;
        if (!ec || ts.isNamespaceExport(ec)) out.push(`${at(node)} safe-fetch.ts may not re-export safe-fetch-core wholesale`);
        else for (const el of ec.elements) {
          const name = (el.propertyName ?? el.name).text;
          if (name === "runSafeFetch" || name === "createPinnedTransport")
            out.push(`${at(node)} safe-fetch.ts may not re-export ${name}`);
        }
      }
      if (ts.isImportDeclaration(node)) {
        const nb = node.importClause?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) out.push(`${at(node)} safe-fetch.ts must import safe-fetch-core by name, not as a namespace`);
        if (node.importClause?.name) out.push(`${at(node)} safe-fetch.ts must import safe-fetch-core by name`);
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements)
            if ((el.propertyName ?? el.name).text === "runSafeFetch") coreLocals.add(el.name.text);
      }
    }
  };

  const isRequireLike = (e: ts.Expression) =>
    (ts.isIdentifier(e) && e.text === "require") ||
    (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "require" && e.name.text === "resolve");

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const s = literalText(node.moduleSpecifier);
      if (s != null) checkSpec(s, node, "import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const s = literalText(node.moduleSpecifier);
      if (s != null) checkSpec(s, node, "export from");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const s = literalText(node.moduleReference.expression);
      if (s != null) checkSpec(s, node, "import = require");
      else out.push(`${at(node)} import = require() with a non-literal specifier`);
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      const s = ts.isLiteralTypeNode(arg) ? literalText(arg.literal) : null;
      if (s != null) checkSpec(s, node, "import type");
    } else if (ts.isCallExpression(node)) {
      const isDyn = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isDyn || isRequireLike(node.expression)) {
        const how = isDyn ? "import()" : "require()";
        const s = literalText(node.arguments[0]);
        if (s != null) checkSpec(s, node, how);
        else out.push(`${at(node)} ${how} with a non-literal specifier can't be checked`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // In safe-fetch.ts, runSafeFetch may appear only as the callee of a direct call.
  if (file === PUBLIC_FILE && coreLocals.size) {
    const use = (node: ts.Node) => {
      if (ts.isIdentifier(node) && coreLocals.has(node.text)) {
        const p = node.parent;
        const inImport = ts.isImportSpecifier(p);
        const isCallee = ts.isCallExpression(p) && p.expression === node;
        if (!inImport && !isCallee) out.push(`${at(node)} runSafeFetch may only be called directly in safe-fetch.ts`);
      }
      ts.forEachChild(node, use);
    };
    use(sf);
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXTS.some((e) => name.endsWith(e)) && !name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

// ---- self-tests: each must or must not be flagged -----------------------
const T = "src/lib/x.ts";
const cases: Array<[string, string, string, boolean]> = [
  ["named import via alias", T, `import { safeFetchWithTransport } from "@/lib/safe-fetch-transport";`, true],
  ["relative import", T, `import { safeFetchWithTransport } from "./safe-fetch-transport";`, true],
  ["import with .ts extension", T, `import * as S from "./safe-fetch-transport.ts";`, true],
  ["import with .js extension from a sibling dir", "src/app/api/a/route.ts", `import { x } from "../../../lib/safe-fetch-transport.js";`, true],
  ["type-only import", T, `import type { Transport } from "@/lib/safe-fetch-transport";`, true],
  ["side-effect import", T, `import "./safe-fetch-transport";`, true],
  ["default import", T, `import t from "./safe-fetch-transport";`, true],
  ["export * from", T, `export * from "./safe-fetch-transport";`, true],
  ["export * as ns from", T, `export * as T from "@/lib/safe-fetch-transport";`, true],
  ["named re-export", T, `export { safeFetchWithTransport as f } from "./safe-fetch-transport";`, true],
  ["import = require", T, `import t = require("./safe-fetch-transport");`, true],
  ["dynamic import", T, `const m = await import("@/lib/safe-fetch-transport");`, true],
  ["dynamic import, template literal", T, "const m = await import(`./safe-fetch-transport`);", true],
  ["require()", T, `const m = require("./safe-fetch-transport");`, true],
  ["require.resolve()", T, `const p = require.resolve("./safe-fetch-transport");`, true],
  ["typeof import() type", T, `type M = typeof import("./safe-fetch-transport");`, true],
  ["index form", T, `import { x } from "./safe-fetch-transport/index";`, true],
  ["case trick", T, `import { x } from "./Safe-Fetch-Transport";`, true],
  ["dot-dot round trip", T, `import { x } from "../lib/safe-fetch-transport";`, true],
  ["non-literal dynamic import", T, `const n = "./safe-fetch-" + "transport"; await import(n);`, true],
  ["non-literal require", T, `const n = "x"; require(n);`, true],
  ["template with substitution", T, "const k = 't'; await import(`./safe-fetch-${k}`);", true],
  ["core from another src file", T, `import { runSafeFetch } from "./safe-fetch-core";`, true],
  ["core via alias from a route", "src/app/api/a/route.ts", `export { runSafeFetch } from "@/lib/safe-fetch-core";`, true],
  ["core dynamic import", T, `await import("@/lib/safe-fetch-core");`, true],
  ["safe-fetch.ts re-exports runSafeFetch", PUBLIC_FILE, `export { runSafeFetch } from "./safe-fetch-core";`, true],
  ["safe-fetch.ts export * from core", PUBLIC_FILE, `export * from "./safe-fetch-core";`, true],
  ["safe-fetch.ts namespace import of core", PUBLIC_FILE, `import * as C from "./safe-fetch-core"; C.runSafeFetch("u", {}, 3, fetch, 1);`, true],
  ["safe-fetch.ts aliases runSafeFetch", PUBLIC_FILE, `import { runSafeFetch } from "./safe-fetch-core"; export const go = runSafeFetch;`, true],
  ["safe-fetch.ts local re-export of runSafeFetch", PUBLIC_FILE, `import { runSafeFetch as r } from "./safe-fetch-core"; export { r };`, true],
  // allowed
  ["public safe-fetch import", T, `import { safeFetch } from "@/lib/safe-fetch";`, false],
  ["outbound-url import", T, `import { validateOutboundUrl } from "./outbound-url";`, false],
  ["lookalike module name", T, `import { x } from "./safe-fetch-transporter";`, false],
  ["package import", T, `import { Agent } from "node:https"; import ts from "typescript";`, false],
  ["comment and string mention", T, `// see ./safe-fetch-transport\nconst s = "./safe-fetch-transport";`, false],
  ["literal dynamic import elsewhere", T, `const m = await import("./other");`, false],
  ["safe-fetch.ts calls runSafeFetch", PUBLIC_FILE, `import { createPinnedTransport, runSafeFetch } from "./safe-fetch-core"; export { BlockedAddressError } from "./safe-fetch-core"; const t = createPinnedTransport(); export function safeFetch(u: string) { return runSafeFetch(u, {}, 3, t, 1); }`, false],
  ["transport module imports core", "src/lib/safe-fetch-transport.ts", `import { runSafeFetch } from "./safe-fetch-core"; export { createPinnedTransport } from "./safe-fetch-core";`, false],
];

let bad = 0;
for (const [name, file, src, expect] of cases) {
  const got = findViolations(file, src).length > 0;
  if (got !== expect) {
    bad++;
    console.error(`check-safe-fetch-imports self-test FAILED: ${name} (expected ${expect ? "flagged" : "clean"})`);
  }
}
if (bad) process.exit(1);

const violations: string[] = [];
for (const abs of walk(join(ROOT, "src"))) {
  const rel = posix(relative(ROOT, abs));
  violations.push(...findViolations(rel, readFileSync(abs, "utf8")));
}
if (violations.length) {
  console.error("check-safe-fetch-imports: src/ reaches the transport override:");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`check-safe-fetch-imports: ok (${cases.length} self-tests, src/ clean)`);
