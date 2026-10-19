// 2026-10-16 (operator): every rental funnels through Galaxy Mind's own service.
// Fails if MiningRigRentals or an MRR rig URL can reach rendered or public
// output: anything in public/, and string/JSX content (comments stripped)
// in pages, components and copy. Backend MRR clients that only read market
// data server-side are allow-listed below.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MENTION_FILE, UNITS_FILE, NAMED_FILES, checkMention, checkUnitsModule, stripNamed } from "./lib/no-mrr-mention";

const ROOT = process.cwd();
const ALLOW = new Set([
  "src/lib/mrr.ts", // server-side market data client (api calls only)
  "src/lib/hashrate.ts", // server-side desk aggregation
  "src/app/api/cron/snapshot-hashrate/route.ts", // server cron
]);
// 2026-10-17 (operator): ONE secondary marketplace mention
// may name MiningRigRentals and carry our referral id: the /hashrate card,
// its FAQ entry and the footer link. All of that copy lives in MENTION_FILE,
// which is exempt from BAD but must pass checkMention (exact URL only, no
// other ref, digits outside that URL, prices, rig ids or locations, and a
// visible referral disclosure). Every other file keeps the full rule.
// 2026-10-17 (MRR-only): UNITS_FILE builds the per-unit rig links
// (checkUnitsModule), and NAMED_FILES (llms.txt, OpenAPI) may name the
// marketplace and carry the two exact referral URLs; everything else in them
// still meets BAD. Rig-id hrefs anywhere else stay banned.
const BAD = [
  /miningrigrentals/i, /\bmrr\.(?:com|io)\b/i, /rig\.rent\b/i, /\/rigs\/\d{4,}/,
  /\bMRR\b/, /[?&]ref=/i, /make\s+it\s+right/i,
  /\b3[78]\d{4}\b/, // bare rig ids
];
const TEXT = /\.(tsx?|mjs|js|json|txt|md|xml|html|css)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const errors: string[] = [];
for (const base of ["public", "src/app", "src/components", "src/lib"]) {
  for (const f of walk(join(ROOT, base))) {
    const rel = relative(ROOT, f);
    if (ALLOW.has(rel)) continue;
    if (rel === MENTION_FILE) {
      errors.push(...checkMention(stripComments(readFileSync(f, "utf8")), rel));
      continue;
    }
    if (rel === UNITS_FILE) {
      errors.push(...checkUnitsModule(stripComments(readFileSync(f, "utf8")), rel));
      continue;
    }
    const raw = readFileSync(f, "utf8");
    const body0 = rel.startsWith("public/") ? raw : stripComments(raw);
    const body = NAMED_FILES.includes(rel) ? stripNamed(body0) : body0;
    for (const re of BAD) {
      // Game assets carry six-digit geometry constants, not rig ids.
      if (re.source.startsWith("\\b3[78]") && rel.startsWith("public/bitcoin-kart/")) continue;
      const m = body.match(re);
      if (m) errors.push(`${rel}: ${re} matched "${m[0]}"`);
    }
  }
}

if (errors.length) {
  console.error("check-no-mrr-public: MiningRigRentals reached public output\n" + errors.join("\n"));
  process.exit(1);
}
console.log("check-no-mrr-public: ok");
