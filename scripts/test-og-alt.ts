// Share-card alt text guard (competitor teardown lesson A7, 2026-10-18).
// Static, no network. Every share image the site declares must carry
// descriptive alt text for og:image:alt AND twitter:image:alt:
//   · every file-based opengraph-image.tsx exports a non-trivial `alt`;
//   · every metadata `images:` entry is an object with `alt` (or a shared
//     helper that sets one), never a bare URL string, which Next emits with
//     no alt at all (/float, /stack and /fit shared cards shipped that way);
//   · every static HTML page in public/ that sets og:image or twitter:image
//     also sets the matching :alt tag (/chop and /bitcoin-kart lacked them);
//   · / and /submit have their own branded cards with descriptive alt.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const walk = (dir: string, keep: (p: string) => boolean, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, keep, out); }
    else if (keep(p)) out.push(p);
  }
  return out;
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("── file-based opengraph-image alt ───────────────");
const ogFiles = walk("src/app", (p) => /opengraph-image\.tsx$/.test(p));
const noAlt = ogFiles.filter((f) => !/export const alt\s*=/.test(readFileSync(f, "utf8")));
check(`all ${ogFiles.length} opengraph-image.tsx export alt`, noAlt.length === 0, noAlt.join(", "));

console.log("── metadata images entries carry alt ────────────");
const pages = walk("src/app", (p) => /\.(tsx|ts)$/.test(p) && !/opengraph-image|\/api\//.test(p));
const bare: string[] = [];
for (const f of pages) {
  const src = strip(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/images:\s*\[\s*([^\]{]*?)\s*\]/g)) {
    // `[` followed by something that is not an object literal: a bare URL/identifier.
    if (m[1].trim() !== "") bare.push(`${relative(".", f)}: images: [${m[1].trim()}]`);
  }
  for (const m of src.matchAll(/images:\s*\[\s*\{([^}]*)\}/g)) {
    if (!/\balt\b/.test(m[1])) bare.push(`${relative(".", f)}: image object without alt`);
  }
}
check("no bare-URL or alt-less images entries in metadata", bare.length === 0, bare.join(" | "));
const og = readFileSync("src/lib/og.ts", "utf8");
check("OG_DIRECTORY alt is descriptive (not just the brand)", /alt:\s*"Galaxy Mind share card: [^"]{60,}"/.test(og));

console.log("── static HTML share tags ───────────────────────");
for (const f of walk("public", (p) => p.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  const rel = relative(".", f);
  if (/property="og:image"/.test(html)) check(`${rel}: og:image has og:image:alt`, /property="og:image:alt" content="[^"]{20,}"/.test(html));
  if (/name="twitter:card" content="summary_large_image"/.test(html)) {
    check(`${rel}: twitter:image present`, /name="twitter:image" content="https:\/\//.test(html));
    check(`${rel}: twitter:image:alt present`, /name="twitter:image:alt" content="[^"]{20,}"/.test(html));
  }
}

console.log("── branded cards for / and /submit ──────────────");
const root = readFileSync("src/app/opengraph-image.tsx", "utf8");
check("/ card carries the hook line", root.includes("Buy from people, not platforms"));
check("/ card alt is descriptive", /export const alt =\s*"Galaxy Mind share card: [^"]{60,}"/.test(root));
const sub = readFileSync("src/app/submit/opengraph-image.tsx", "utf8");
check("/submit has its own card with a seller headline", /title: "List your shop free"/.test(sub) && /export const alt = SUBMIT_OG_ALT/.test(sub));
check("/submit metadata points at its own card", /pageOgImage\("\/submit\/opengraph-image", SUBMIT_OG_ALT\)/.test(readFileSync("src/app/submit/page.tsx", "utf8")));
const visible = strip([root, sub, og].join("\n"));
check("card copy: no word 'real', no affiliate params", !/\breal\b/i.test(visible) && !/[?&](ref|aff|utm_[a-z]+)=/.test(visible));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
