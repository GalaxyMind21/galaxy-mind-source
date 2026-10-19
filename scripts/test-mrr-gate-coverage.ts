// Every payment, quote or order route must open with the mrr_only gate
// (security review 2026-10-18, rounds 4 and 5).
//
// Why this file exists: test-mrr-only.tsx calls the handlers we know
// about today. A new payment route anywhere under src/app/api/** would
// not be in that list, so it could ship without the gate and quietly
// reopen direct checkout. This test walks the whole API tree instead,
// picks out the payment-like route files, and checks each one, so a new
// file is covered the moment it is added.
//
// The rule, checked with the TypeScript parser (not regexes):
//   - every exported HTTP handler (GET, POST, PUT, PATCH, DELETE, HEAD,
//     OPTIONS) in a payment-like route file starts with exactly
//         if (mrrOnly()) return directRentalsClosedResponse();
//     as its FIRST statement. Calling both somewhere in the body is not
//     enough (round 5, nit 1): `mrrOnly(); directRentalsClosedResponse();
//     return quote` would gate nothing;
//   - both names are imported from "@/lib/rentals/mode", so a local
//     look-alike cannot satisfy the check;
//   - handler shapes the test cannot read (export const GET = wrap(x),
//     export { GET }, an expression-bodied arrow) fail, so a wrapper
//     cannot hide a missing gate.
// A route file is payment-like when its directory path has a
// rental/payment segment (rentals, hashrate, pay, checkout, order, quote,
// invoice, refund, ...), when it imports from "@/lib/rentals" or a
// sub-module, or when it names a known order or payment entry point.
// The only exemptions are listed below with the reason, and each one is
// re-checked with the parser so the reason stays true.
//
// Run: npx tsx scripts/test-mrr-gate-coverage.ts

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const MODE_MODULE = "@/lib/rentals/mode";
const API_ROOT = "src/app/api";

/** A whole path segment that names a rental or payment surface. */
const PAYMENT_SEGMENT =
  /^(rentals?|hashrate|pay|payments?|checkout|orders?|quotes?|invoices?|buy|purchases?|refunds?|bind|settle|x402|btc|eth|sol|solana|lightning|ln)$/i;
/** A word inside a segment (split on - _ .) that names one, e.g. "test-order", "rentals-sweep", "new-checkout". */
const PAYMENT_WORD = /^(rentals?|pay|payments?|checkout|orders?|quotes?|invoices?|purchases?|refunds?|x402)$/i;
const PAYMENT_NAMES = /\b(createRental|handleOrder|handleAccess|confirmPayment|directQuote|extendRental|cancelRental|payTo)\b/;
const RENTALS_IMPORT = /^@\/lib\/rentals(\/|$)/;

// ---------------------------------------------------------------------------
// Parser helpers

function parse(file: string, src: string): ts.SourceFile {
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function isExported(node: ts.Node): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** `name()` with no arguments. */
function isBareCall(e: ts.Expression | undefined, name: string): boolean {
  if (!e) return false;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name && e.arguments.length === 0;
}

/** A statement that is only `return <call>;`, alone or as the single statement of a block. */
function returnsOnly(st: ts.Statement, test: (e: ts.Expression | undefined) => boolean): boolean {
  if (ts.isBlock(st)) return st.statements.length === 1 && returnsOnly(st.statements[0], test);
  return ts.isReturnStatement(st) && test(st.expression);
}

/** `if (mrrOnly()) return directRentalsClosedResponse();` with no else. */
function isEarlyGate(st: ts.Statement | undefined): boolean {
  return (
    !!st &&
    ts.isIfStatement(st) &&
    !st.elseStatement &&
    isBareCall(st.expression, "mrrOnly") &&
    returnsOnly(st.thenStatement, (e) => isBareCall(e, "directRentalsClosedResponse"))
  );
}

type Handler = { name: string; fn: ts.FunctionLikeDeclaration };

/** Exported HTTP handlers, plus problems for export shapes the test cannot read. */
function readHandlers(sf: ts.SourceFile): { handlers: Handler[]; problems: string[] } {
  const handlers: Handler[] = [];
  const problems: string[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st) && st.name && METHODS.has(st.name.text)) {
      handlers.push({ name: st.name.text, fn: st });
    }
    if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !METHODS.has(d.name.text)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) handlers.push({ name: d.name.text, fn: init });
        else problems.push(`${d.name.text}: exported in a shape this test cannot read (put the gate inside the handler body)`);
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (METHODS.has(el.name.text)) problems.push(`${el.name.text}: re-exported with export { }, so the gate cannot be checked`);
      }
    }
  }
  return { handlers, problems };
}

/** Top-level statements of a handler body; null for an expression-bodied arrow. */
function bodyStatements(fn: ts.FunctionLikeDeclaration): readonly ts.Statement[] | null {
  return fn.body && ts.isBlock(fn.body) ? fn.body.statements : null;
}

function importsFrom(sf: ts.SourceFile, module: string): Map<string, string> {
  // local name -> imported name
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== module) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) out.set(el.name.text, (el.propertyName ?? el.name).text);
    }
  }
  return out;
}

function topLevelFunction(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  return sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
}

// ---------------------------------------------------------------------------
// The rule

/** Problems for one route source; an empty list means every handler opens with the gate. */
function gateProblems(file: string, src: string): string[] {
  const sf = parse(file, src);
  const { handlers, problems } = readHandlers(sf);
  const mode = importsFrom(sf, MODE_MODULE);
  for (const gate of ["mrrOnly", "directRentalsClosedResponse"]) {
    if (handlers.length && mode.get(gate) !== gate) problems.push(`${gate} is not imported from ${MODE_MODULE}`);
  }
  for (const { name, fn } of handlers) {
    const body = bodyStatements(fn);
    if (!body) problems.push(`${name}: expression-bodied handler, so it cannot open with the gate`);
    else if (!isEarlyGate(body[0])) {
      problems.push(`${name}: first statement is not \`if (mrrOnly()) return directRentalsClosedResponse();\``);
    }
  }
  if (handlers.length === 0 && problems.length === 0) problems.push("no exported HTTP handler found");
  return [...new Set(problems)];
}

/** Is this route file payment-like (so it must be gated or exempt)? */
function paymentLike(file: string, src: string): boolean {
  const dir = path.posix.dirname(file).slice(API_ROOT.length).split("/").filter(Boolean);
  for (const raw of dir) {
    const seg = raw.replace(/^\[+\.{0,3}|\]+$/g, "");
    if (PAYMENT_SEGMENT.test(seg) || seg.split(/[-_.]/).some((w) => PAYMENT_WORD.test(w))) return true;
  }
  const sf = parse(file, src);
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      if (RENTALS_IMPORT.test(st.moduleSpecifier.text)) return true;
    }
  }
  return PAYMENT_NAMES.test(src);
}

// ---------------------------------------------------------------------------
// Exemptions, each re-checked with the parser

/** The sweep: GET must open by calling sweepGate(...) and return early on 401 and 429, sweepGate must
 *  return 200 only behind cronAuthorized(...), and cronAuthorized must do a timing-safe compare. */
function sweepStillCronOnly(file: string, src: string): string[] {
  const sf = parse(file, src);
  const p: string[] = [];
  const { handlers, problems } = readHandlers(sf);
  p.push(...problems);
  const names = handlers.map((h) => h.name).sort().join(",");
  if (names !== "GET") p.push(`exports ${names || "no handler"}; only GET is expected`);
  const get = handlers.find((h) => h.name === "GET");
  const body = get ? bodyStatements(get.fn) : null;
  let gVar: string | undefined;
  const first = body?.[0];
  if (first && ts.isVariableStatement(first) && first.declarationList.declarations.length === 1) {
    const d = first.declarationList.declarations[0];
    const init = d.initializer;
    if (ts.isIdentifier(d.name) && init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "sweepGate") {
      gVar = d.name.text;
    }
  }
  if (!gVar) p.push("GET does not open with `const g = sweepGate(...)`");
  else {
    // The next statements must early-return on every non-200 result sweepGate can give (401 and 429).
    const covered = new Set<number>();
    for (const st of (body ?? []).slice(1)) {
      if (!ts.isIfStatement(st) || st.elseStatement || !returnsOnly(st.thenStatement, (e) => !!e)) break;
      const c = st.expression;
      if (
        ts.isBinaryExpression(c) &&
        c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(c.left) &&
        c.left.text === gVar &&
        ts.isNumericLiteral(c.right)
      ) {
        covered.add(Number(c.right.text));
      } else break;
    }
    if (!covered.has(401) || !covered.has(429)) p.push("GET does not return early on both 401 and 429 from sweepGate");
  }
  const gate = topLevelFunction(sf, "sweepGate");
  const gs = gate?.body?.statements;
  const g0 = gs?.[0];
  const opensWithCron =
    !!g0 &&
    ts.isIfStatement(g0) &&
    ts.isCallExpression(g0.expression) &&
    ts.isIdentifier(g0.expression.expression) &&
    g0.expression.expression.text === "cronAuthorized" &&
    returnsOnly(g0.thenStatement, (e) => !!e && ts.isNumericLiteral(e) && e.text === "200");
  if (!opensWithCron) p.push("sweepGate does not open with `if (cronAuthorized(...)) return 200;`");
  // No other path in sweepGate may return 200.
  let other200 = false;
  const visit = (n: ts.Node) => {
    if (n === g0) return;
    if (ts.isReturnStatement(n) && n.expression && /\b200\b/.test(n.expression.getText(sf))) other200 = true;
    ts.forEachChild(n, visit);
  };
  if (gate?.body) gate.body.statements.slice(1).forEach(visit);
  if (other200) p.push("sweepGate can return 200 without cronAuthorized");
  const auth = topLevelFunction(sf, "cronAuthorized");
  if (!auth || !/timingSafeEqual\(/.test(auth.getText(sf))) p.push("cronAuthorized is not a local timing-safe compare");
  if (/\b(createRental|handleOrder)\b/.test(src)) p.push("the sweep now references an order entry point");
  return p;
}

/** The Vercel Cron alias: GET must open by delegating to the sweep's GET (checked above) and add nothing payment-like. */
function cronAliasStillDelegates(file: string, src: string): string[] {
  const sf = parse(file, src);
  const p: string[] = [];
  const { handlers, problems } = readHandlers(sf);
  p.push(...problems);
  const names = handlers.map((h) => h.name).sort().join(",");
  if (names !== "GET") p.push(`exports ${names || "no handler"}; only GET is expected`);
  const local = [...importsFrom(sf, "@/app/api/rentals/sweep/route")].find(([, imported]) => imported === "GET")?.[0];
  if (!local) p.push("does not import GET from the sweep route");
  const get = handlers.find((h) => h.name === "GET");
  const first = get ? bodyStatements(get.fn)?.[0] : undefined;
  let delegates = false;
  if (first && ts.isVariableStatement(first) && first.declarationList.declarations.length === 1) {
    let init = first.declarationList.declarations[0].initializer;
    if (init && ts.isAwaitExpression(init)) init = init.expression;
    delegates = !!init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === local;
  }
  if (!delegates) p.push("GET does not open by calling the sweep handler");
  if (PAYMENT_NAMES.test(src)) p.push("references an order or payment entry point");
  return p;
}

/** Public desk JSON: GET takes no request at all and sells nothing. */
function deskStillReadOnly(file: string, src: string): string[] {
  const sf = parse(file, src);
  const p: string[] = [];
  const { handlers, problems } = readHandlers(sf);
  p.push(...problems);
  const names = handlers.map((h) => h.name).sort().join(",");
  if (names !== "GET") p.push(`exports ${names || "no handler"}; only GET is expected`);
  const get = handlers.find((h) => h.name === "GET");
  if (get && get.fn.parameters.length !== 0) p.push("GET now takes request input");
  if (/createRental|quote|payTo/i.test(src) || PAYMENT_NAMES.test(src)) p.push("references quote, payTo or an order entry point");
  return p;
}

/** Status reads stay open for past renters; only pay and cancel are closed. The partial gate must come before
 *  any handleAccess call and must cover exactly those two actions. */
function accessStillGatesPayAndCancel(file: string, src: string): string[] {
  const sf = parse(file, src);
  const p: string[] = [];
  const { handlers, problems } = readHandlers(sf);
  p.push(...problems);
  const names = handlers.map((h) => h.name).sort().join(",");
  if (names !== "POST") p.push(`exports ${names || "no handler"}; only POST is expected`);
  const mode = importsFrom(sf, MODE_MODULE);
  if (mode.get("mrrOnly") !== "mrrOnly" || mode.get("directRentalsClosedResponse") !== "directRentalsClosedResponse") {
    p.push(`gate names are not imported from ${MODE_MODULE}`);
  }
  const post = handlers.find((h) => h.name === "POST");
  const body = post ? bodyStatements(post.fn) ?? [] : [];
  const gateAt = body.findIndex((st) => {
    if (!ts.isIfStatement(st) || st.elseStatement) return false;
    if (!returnsOnly(st.thenStatement, (e) => isBareCall(e, "directRentalsClosedResponse"))) return false;
    const c = st.expression;
    if (!ts.isBinaryExpression(c) || c.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || !isBareCall(c.left, "mrrOnly")) return false;
    const acts = c.right.getText(sf).replace(/\s+/g, "");
    return /^\(action==="pay"\|\|action==="cancel"\)$/.test(acts) || /^\(action==="cancel"\|\|action==="pay"\)$/.test(acts);
  });
  if (gateAt < 0) p.push('POST has no `if (mrrOnly() && (action === "pay" || action === "cancel")) return directRentalsClosedResponse();`');
  const accessAt = body.findIndex((st) => /\bhandleAccess\(/.test(st.getText(sf)));
  if (accessAt >= 0 && gateAt >= 0 && accessAt < gateAt) p.push("handleAccess runs before the pay/cancel gate");
  return p;
}

/** MCP: tools are gated per tool, not per HTTP method; test-mrr-only.tsx calls tools/list and every quote tool in
 *  mrr_only. Keep this honest by requiring the mode import and that the MCP test still asserts it. */
function mcpStillCoveredElsewhere(file: string, src: string): string[] {
  const sf = parse(file, src);
  const p: string[] = [];
  if (importsFrom(sf, MODE_MODULE).get("mrrOnly") !== "mrrOnly") p.push(`does not import mrrOnly from ${MODE_MODULE}`);
  const t = "scripts/test-mrr-only.tsx";
  const ts_ = fs.existsSync(t) ? fs.readFileSync(t, "utf8") : "";
  if (!/no create_rental \/ cancel_rental/.test(ts_)) p.push(`${t} no longer asserts that MCP hides create_rental and cancel_rental in mrr_only`);
  if (!ts_.includes("api/mcp")) p.push(`${t} no longer imports the MCP route`);
  return p;
}

const EXEMPT: Record<string, { why: string; still: (file: string, src: string) => string[] }> = {
  "src/app/api/rentals/sweep/route.ts": {
    why: "Vercel Cron only: settles or refunds existing orders, never opens one",
    still: sweepStillCronOnly,
  },
  "src/app/api/cron/rentals-sweep/route.ts": {
    why: "Vercel Cron alias that only delegates to the sweep above",
    still: cronAliasStillDelegates,
  },
  "src/app/api/hashrate/route.ts": {
    why: "public read-only desk JSON, takes no input and sells nothing",
    still: deskStillReadOnly,
  },
  "src/app/api/rentals/access/route.ts": {
    why: "status reads stay open for past renters; pay and cancel are gated",
    still: accessStillGatesPayAndCancel,
  },
  "src/app/api/mcp/[transport]/route.ts": {
    why: "tools are gated per tool and covered by test-mrr-only.tsx",
    still: mcpStillCoveredElsewhere,
  },
};

// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /^route\.(ts|tsx|js|jsx|mjs)$/.test(e.name) ? [p.split(path.sep).join("/")] : [];
  });
}

console.log("checker self-test");
{
  const IMP = `import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";\n`;
  const ok = (src: string) => gateProblems("x/route.ts", src);
  const gated = IMP + `export async function POST(req: Request) { if (mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); }`;
  check("a gated handler passes", ok(gated).length === 0, ok(gated).join("; "));
  const block = IMP + `export async function POST() { if (mrrOnly()) { return directRentalsClosedResponse(); } return new Response("x"); }`;
  check("a braced early gate passes", ok(block).length === 0, ok(block).join("; "));
  const missing = IMP + `export async function POST() { return new Response("pay me"); }`;
  check("a handler without the gate fails", ok(missing).some((p) => /^POST: first statement/.test(p)));
  const bare = IMP + `export async function GET() { mrrOnly(); directRentalsClosedResponse(); return new Response("quote"); }`;
  check("both calls present but not as an early return fails (round 5 nit 1)", ok(bare).some((p) => /^GET: first statement/.test(p)));
  const late = IMP + `export async function GET(req: Request) { const q = await quote(req); if (mrrOnly()) return directRentalsClosedResponse(); return q; }`;
  check("a gate that is not the first statement fails", ok(late).some((p) => /^GET: first statement/.test(p)));
  const negated = IMP + `export async function GET() { if (!mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); }`;
  check("a negated gate fails", ok(negated).length > 0);
  const elsed = IMP + `export async function GET() { if (mrrOnly()) return directRentalsClosedResponse(); else return new Response("x"); }`;
  check("a gate with an else branch fails", ok(elsed).length > 0);
  const extra = IMP + `export async function GET() { if (mrrOnly()) { log(); return directRentalsClosedResponse(); } return new Response("x"); }`;
  check("a gate block with extra work before the return fails", ok(extra).length > 0);
  const other = IMP + `export async function GET() { if (mrrOnly()) return new Response("open"); return new Response("x"); }`;
  check("a gate that returns something else fails", ok(other).length > 0);
  const nested = IMP + `export async function GET() { const later = () => { if (mrrOnly()) return directRentalsClosedResponse(); }; return new Response("x"); }`;
  check("a gate hidden in a nested function fails", ok(nested).length > 0);
  const local = `const mrrOnly = () => false; const directRentalsClosedResponse = () => new Response("");
export async function GET() { if (mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); }`;
  check("a local look-alike gate fails", ok(local).some((p) => /not imported/.test(p)));
  const wrapped = IMP + `const h = async () => new Response("x"); export const POST = withLimit(h);`;
  check("a wrapped export fails", ok(wrapped).some((p) => /cannot read/.test(p)));
  const reexp = `export { POST } from "./impl";`;
  check("an export { } re-export fails", ok(reexp).some((p) => /re-exported/.test(p)));
  const exprArrow = IMP + `export const GET = async () => new Response("x");`;
  check("an expression-bodied arrow fails", ok(exprArrow).some((p) => /expression-bodied/.test(p)));
  const arrow = IMP + `export const GET = async () => { if (mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); };`;
  check("a gated arrow handler passes", ok(arrow).length === 0, ok(arrow).join("; "));
  const half = IMP + `export async function GET() { if (mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); }
export async function POST() { return new Response("pay"); }`;
  check("one ungated method in a gated file fails", ok(half).some((p) => /^POST:/.test(p)));
  const opts = IMP + `export async function POST() { if (mrrOnly()) return directRentalsClosedResponse(); return new Response("x"); }
export function OPTIONS() { return new Response(null, { status: 204, headers: { allow: "POST" } }); }`;
  check("an ungated OPTIONS handler fails (round 5 nit 2)", ok(opts).some((p) => /^OPTIONS:/.test(p)));

  // Payment-like classification for the src/app/api/** walk.
  check("api/checkout is payment-like", paymentLike("src/app/api/checkout/route.ts", "export async function POST() {}"));
  check("api/new-checkout is payment-like", paymentLike("src/app/api/new-checkout/route.ts", "export async function POST() {}"));
  check("api/[...order] is payment-like", paymentLike("src/app/api/[...order]/route.ts", "export async function POST() {}"));
  check("api/foo/[ref]/pay is payment-like", paymentLike("src/app/api/foo/[ref]/pay/route.ts", "export async function POST() {}"));
  check(
    "a route importing @/lib/rentals/* is payment-like",
    paymentLike("src/app/api/agent/route.ts", `import { x } from "@/lib/rentals/phase2/service";\nexport async function POST() {}`),
  );
  check("a route naming createRental is payment-like", paymentLike("src/app/api/misc/route.ts", "export async function POST() { createRental(); }"));
  check(
    "a vendor-directory route is not payment-like",
    !paymentLike("src/app/api/vendors.json/route.ts", `import { vendors } from "@/lib/vendors";\nexport async function GET() { return Response.json({ lightning: true }); }`),
  );
  check("a cron path that only contains 'hashrate' in a longer name is not payment-like by path", !paymentLike("src/app/api/cron/snapshot-hashrate/route.ts", "export async function GET() {}"));

  // Sweep exemption: the cronAuthorized( string alone is not enough (round 5 nit 2).
  const sweepOk = `import crypto from "node:crypto";
export function sweepGate(h: string | null, s: string | undefined, now: number): 200 | 401 | 429 { if (cronAuthorized(h, s)) return 200; return now ? 401 : 429; }
export function cronAuthorized(h: string | null, s: string | undefined): boolean { return !!h && !!s && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(s)); }
export async function GET(req: Request) { const g = sweepGate(req.headers.get("authorization"), process.env.CRON_SECRET, Date.now()); if (g === 429) return new Response("", { status: 429 }); if (g === 401) return new Response("", { status: 401 }); return Response.json({ ok: true }); }`;
  check("the real sweep shape passes its exemption", sweepStillCronOnly("s/route.ts", sweepOk).length === 0, sweepStillCronOnly("s/route.ts", sweepOk).join("; "));
  const sweepSkips = sweepOk.replace(/const g = sweepGate\([^;]*\);/, "const g = 200;");
  check("a sweep GET that never calls sweepGate fails, even with cronAuthorized( defined", sweepStillCronOnly("s/route.ts", sweepSkips).length > 0);
  const sweepIgnores401 = sweepOk.replace(/if \(g === 401\) return new Response\("", \{ status: 401 \}\);/, "");
  check("a sweep GET that ignores 401 fails", sweepStillCronOnly("s/route.ts", sweepIgnores401).length > 0);
  const sweepOpen = sweepOk.replace("return now ? 401 : 429;", "return 200;");
  check("a sweepGate that returns 200 without cronAuthorized fails", sweepStillCronOnly("s/route.ts", sweepOpen).length > 0);
  const sweepPost = sweepOk + `\nexport async function POST() { return new Response("x"); }`;
  check("a sweep that grows a POST fails", sweepStillCronOnly("s/route.ts", sweepPost).length > 0);

  // Access exemption: the pay/cancel gate must stay, ahead of handleAccess.
  const accessOk = IMP + `import { handleAccess } from "@/lib/rentals/phase2/human";
export async function POST(req: Request) { const body = await req.json(); const action = body.action; if (mrrOnly() && (action === "pay" || action === "cancel")) return directRentalsClosedResponse(); return handleAccess(body); }`;
  check("the access shape passes its exemption", accessStillGatesPayAndCancel("a/route.ts", accessOk).length === 0, accessStillGatesPayAndCancel("a/route.ts", accessOk).join("; "));
  const accessPayOnly = accessOk.replace(` || action === "cancel"`, "");
  check("an access gate that drops cancel fails", accessStillGatesPayAndCancel("a/route.ts", accessPayOnly).length > 0);
  const accessLate = IMP + `import { handleAccess } from "@/lib/rentals/phase2/human";
export async function POST(req: Request) { const body = await req.json(); const r = await handleAccess(body); const action = body.action; if (mrrOnly() && (action === "pay" || action === "cancel")) return directRentalsClosedResponse(); return r; }`;
  check("handleAccess before the access gate fails", accessStillGatesPayAndCancel("a/route.ts", accessLate).length > 0);
}

console.log("route files");
const all = walk(API_ROOT).sort();
check("walked the whole src/app/api tree", all.length >= 40, `${all.length} files`);
const files = all.filter((f) => EXEMPT[f] || paymentLike(f, fs.readFileSync(f, "utf8")));
for (const must of [
  "src/app/api/rentals/quote/route.ts",
  "src/app/api/rentals/order/route.ts",
  "src/app/api/rentals/pay/[ref]/route.ts",
  "src/app/api/rentals/eth/route.ts",
  "src/app/api/rentals/btc/bind/route.ts",
  "src/app/api/rentals/test-order/route.ts",
  "src/app/api/hashrate/quote/route.ts",
  "src/app/api/mcp/[transport]/route.ts",
]) {
  check(`payment-like set includes ${must}`, files.includes(must));
}
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const ex = EXEMPT[file];
  if (ex) {
    const p = ex.still(file, src);
    check(`${file} exempt (${ex.why}) and the reason still holds`, p.length === 0, p.join("; "));
    continue;
  }
  const problems = gateProblems(file, src);
  check(`${file} opens with the mrr_only gate`, problems.length === 0, problems.join("; "));
}
for (const file of Object.keys(EXEMPT)) {
  check(`exemption ${file} still points at a real file`, all.includes(file));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log(`✓ mrr_only gate: every payment-like route under ${API_ROOT} opens with it (${files.length} files checked)`);
