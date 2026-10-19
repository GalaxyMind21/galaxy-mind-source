// Canonical-URL drift guard (2026-07-11).
//
// The root layout sets alternates.canonical to SITE_URL as the homepage
// default. Because Next merges metadata SHALLOWLY per top-level key,
// any route that never declares its own alternates silently inherits
// that default and renders <link rel="canonical" href="https://
// galaxymind.space"/> — telling Google the page is a duplicate of the
// homepage and should be deindexed. /float and /horizon shipped that
// way for weeks before anyone noticed. This asserts, from source, that
// every indexable page's nearest canonical declaration resolves to its
// OWN path, so the root default can never swallow a future page.
//
// Static analysis, zero network, zero build. Three declaration shapes
// are recognized:
//   1. literal      · alternates: { canonical: "https://…/x" } or a
//                     same-file const ("const URL_ = …; canonical: URL_")
//                     → hard-checked: origin + pathname must equal the
//                     route's own path.
//   2. computed     · generateMetadata / template exprs (dynamic
//                     [slug] routes) → presence-checked only.
//   3. delegated    · export const metadata = buildX(…) where the
//                     imported builder's module declares the canonical
//                     (the is-*-overvalued pages) → presence-checked.
// Pages marked robots noindex are exempt · a canonical is meaningless
// on a page that asks not to be indexed (admin, prefs, share cards,
// skeleton previews).
//
// SECOND CHECK · og:url (2026-08-08, after Ahrefs flagged both halves)
//
// Same bug class, opposite failure mode, so it lives here rather than in
// its own script. `openGraph` is REPLACED wholesale, not merged per key
// (this is what lib/og.ts exists to explain for `images`), which gives
// two ways to get og:url wrong and both shipped:
//
//   · page declares openGraph WITHOUT url  → og:url is absent entirely
//     (/about, /faq, /methodology)
//   · page declares NO openGraph at all    → inherits the root block
//     including `url: SITE_URL`, so the page unfurls as the homepage
//     while its own canonical says otherwise (/privacy, /embed)
//
// The second is the nastier one: nothing is missing, the value is just
// silently wrong, and it contradicts the canonical this same script
// already verifies. So every indexable page must declare an og:url that
// resolves to its OWN path, exactly as canonical must. Dynamic and
// computed declarations are presence-checked, same as canonical.

// Run in the validator suite (npm run verify). Exits non-zero on drift.

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";

const SITE = "https://galaxymind.space";
const APP_DIR = join(process.cwd(), "src/app");

const errors: string[] = [];
let literalChecked = 0;
let ogChecked = 0;
let ogPresenceOnly = 0;
let presenceOnly = 0;
let exempt = 0;

// ---------------------------------------------------------------- walk

function findPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPages(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

// Route path from the page's directory · route groups "(group)" vanish
// from the URL, dynamic segments keep their [brackets] as markers.
function routeFor(pageFile: string): string {
  const rel = dirname(pageFile).slice(APP_DIR.length);
  const segs = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

// -------------------------------------------------------- declarations

// Resolve the canonical expression in a source file to a URL string if
// it's a literal or a same-file const. Returns:
//   { kind: "none" }                 · no canonical declared here
//   { kind: "literal", value }       · resolved to a concrete URL
//   { kind: "opaque" }               · declared but not statically
//                                      resolvable (computed / template)
type Decl =
  | { kind: "none" }
  | { kind: "literal"; value: string }
  | { kind: "opaque" };

function findCanonical(src: string): Decl {
  return findDecl(src, "canonical");
}

/** Resolve `<key>: <value>` to a URL string, by the rules above. */
function findDecl(src: string, key: string): Decl {
  const m = src.match(
    new RegExp(`${key}:\\s*(?:"([^"]+)"|'([^']+)'|\`([^\`]+)\`|([A-Za-z_$][\\w$]*))`),
  );
  if (!m) return { kind: "none" };
  const direct = m[1] ?? m[2];
  if (direct) return { kind: "literal", value: direct };
  if (m[3]) {
    // Template literal · resolvable only if it has no interpolation.
    return m[3].includes("${")
      ? { kind: "opaque" }
      : { kind: "literal", value: m[3] };
  }
  // Identifier · look for a same-file string const of that name.
  const ident = m[4];
  const c = src.match(
    new RegExp(`const\\s+${ident}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`),
  );
  const value = c?.[1] ?? c?.[2];
  return value ? { kind: "literal", value } : { kind: "opaque" };
}

// The openGraph object literal's own body, braces balanced so a nested
// images array can't end it early. Returns null when the file declares
// no openGraph block (which is itself a finding — see the header).
function ogBlock(src: string): string | null {
  const at = src.search(/openGraph:\s*\{/);
  if (at < 0) return null;
  const start = src.indexOf("{", at);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start + 1, j);
  }
  return null;
}

// Drop every nested {...} / [...] group so a search for `url:` cannot
// match the one inside `images: [{ url: "/opengraph-image" }]` — that is
// the card's path, not the page's, and matching it would make this check
// pass on exactly the pages it exists to catch.
// String and template literals are copied through WHOLE. A naive depth
// counter eats the braces of a `${SITE_URL}/stack` interpolation and
// hands back "$/stack", which then fails the absolute-URL test — the
// check would have reported four healthy pages as broken.
function topLevelOnly(block: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < block.length) {
    const c = block[i];
    if (c === '"' || c === "'" || c === "`") {
      let lit = c;
      let j = i + 1;
      while (j < block.length) {
        if (block[j] === "\\") {
          lit += block[j] + (block[j + 1] ?? "");
          j += 2;
          continue;
        }
        lit += block[j];
        const closed = block[j] === c;
        j++;
        if (closed) break;
      }
      if (depth === 0) out += lit;
      i = j;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (depth === 0) out += c;
    i++;
  }
  return out;
}

function findOgUrl(src: string): Decl {
  const block = ogBlock(src);
  if (block === null) return { kind: "none" };
  const top = topLevelOnly(block);
  const decl = findDecl(top, "url");
  if (decl.kind !== "none") return decl;
  // ES6 shorthand · `openGraph: { url, title, description }` on the
  // dynamic routes, where url is a computed local. It IS declared, just
  // not as `url:`, and reading it as absent reported all four [slug]
  // routes as broken when their live og:url is correct. Value can't be
  // resolved statically, so it presence-checks like any computed decl.
  // The leading delimiter keeps `imageUrl,` from matching.
  return /(^|[,{\s])url\s*(,|\}|$)/.test(top)
    ? { kind: "opaque" }
    : { kind: "none" };
}

// Delegated metadata · `export const metadata = buildX(…)` where the
// builder lives in another module. Follows one level of import to
// confirm the builder declares a canonical.
function delegatedDeclares(
  src: string,
  fromFile: string,
  needle = "canonical",
): boolean {
  const m = src.match(
    /export\s+const\s+metadata\s*(?::[^=]*)?=\s*([A-Za-z_$][\w$]*)\s*\(/,
  );
  if (!m) return false;
  const im = src.match(
    new RegExp(
      `import\\s*\\{[^}]*\\b${m[1]}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
    ),
  );
  if (!im) return false;
  const spec = im[1];
  const base = spec.startsWith("@/")
    ? join(process.cwd(), "src", spec.slice(2))
    : resolve(dirname(fromFile), spec);
  for (const ext of ["", ".ts", ".tsx"]) {
    const p = base + ext;
    if (existsSync(p) && readFileSync(p, "utf8").includes(needle)) {
      return true;
    }
  }
  return false;
}

// robots noindex on the page itself → canonical is moot.
function isNoindex(src: string): boolean {
  return /robots:\s*\{[^}]*index:\s*false/.test(src);
}

// ---------------------------------------------------------------- main

for (const pageFile of findPages(APP_DIR).sort()) {
  const route = routeFor(pageFile);
  const relPage = pageFile.slice(process.cwd().length + 1);
  const pageSrc = readFileSync(pageFile, "utf8");

  if (isNoindex(pageSrc)) {
    exempt++;
    continue;
  }

  // Nearest-first declaration chain: the page itself, then each
  // segment layout walking up. The ROOT layout only counts for the
  // homepage · for every other route its canonical is the exact
  // homepage-default this script exists to catch.
  const chain: { file: string; src: string }[] = [
    { file: relPage, src: pageSrc },
  ];
  let d = dirname(pageFile);
  while (true) {
    const atRoot = d === APP_DIR;
    if (atRoot && route !== "/") break;
    const layout = join(d, "layout.tsx");
    if (existsSync(layout)) {
      chain.push({
        file: layout.slice(process.cwd().length + 1),
        src: readFileSync(layout, "utf8"),
      });
    }
    if (atRoot) break;
    d = dirname(d);
  }

  // --- og:url · nearest declaration wins, root counts only for "/" ---
  // The chain deliberately excludes the root layout for non-homepage
  // routes (see its construction above), which is what lets an absent
  // og:url read as "inherits the homepage URL" rather than "fine".
  let og: Decl = { kind: "none" };
  let ogFile = "";
  for (const link of chain) {
    const found = findOgUrl(link.src);
    if (found.kind !== "none") {
      og = found;
      ogFile = link.file;
      break;
    }
  }
  if (og.kind === "none" && delegatedDeclares(pageSrc, pageFile, "openGraph")) {
    og = { kind: "opaque" };
    ogFile = relPage + " (delegated metadata builder)";
  }

  if (og.kind === "none") {
    errors.push(
      `${route} (${relPage}) declares no openGraph.url · it inherits the ` +
        `ROOT layout's homepage og:url and unfurls as / on every social ` +
        `platform, contradicting its own canonical · add url to the page's ` +
        `openGraph block (declaring the block replaces the root's whole, so ` +
        `restate title/description/images with it)`,
    );
  } else if (og.kind === "literal" && !/\[.+\]/.test(route)) {
    let ogUrl: URL | null = null;
    try {
      ogUrl = new URL(og.value);
    } catch {
      errors.push(`${route}: openGraph.url "${og.value}" in ${ogFile} is not an absolute URL`);
    }
    const normOg = (p: string) => (p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p);
    if (
      ogUrl &&
      (ogUrl.origin !== SITE || normOg(ogUrl.pathname) !== normOg(route))
    ) {
      errors.push(
        `${route}: openGraph.url (${ogFile}) points at ${og.value} · ` +
          `expected ${SITE}${route === "/" ? "" : route}`,
      );
    } else if (ogUrl) {
      ogChecked++;
    }
  } else {
    ogPresenceOnly++;
  }

  // Declaring `openGraph` without `images` drops a sibling
  // opengraph-image.tsx (Next replaces the object wholesale). Dedicated
  // cards on habit/share pages shipped blank for this reason.
  const nearestOg = chain.find((link) => ogBlock(link.src) !== null);
  if (nearestOg) {
    const block = ogBlock(nearestOg.src)!;
    const hasImages =
      /images\s*:/.test(block) ||
      /\bOG_DIRECTORY\b/.test(block) ||
      /\bOG_TREASURY\b/.test(block) ||
      /\bpageOgImage\s*\(/.test(block);
    if (!hasImages) {
      const dir = dirname(pageFile);
      let d = dir;
      let dedicatedCard = false;
      while (true) {
        const card = join(d, "opengraph-image.tsx");
        if (
          existsSync(card) &&
          resolve(card) !== resolve(join(APP_DIR, "opengraph-image.tsx"))
        ) {
          dedicatedCard = true;
          break;
        }
        if (d === APP_DIR) break;
        d = dirname(d);
      }
      if (dedicatedCard) {
        errors.push(
          `${route} (${nearestOg.file}) declares openGraph without images · ` +
            `that drops the sibling opengraph-image.tsx. Spread OG_DIRECTORY / ` +
            `OG_TREASURY or call pageOgImage().`,
        );
      }
    }
  }

  // og:type · same wholesale-replace trap as og:url. The root layout
  // declares type "website", but any page/segment openGraph block that
  // omits it ships NO og:type at all (Ahrefs "Open Graph tags
  // incomplete", 12 URLs, crawl 2026-09-24). Spreads (`...base`) are
  // trusted to carry it.
  if (nearestOg) {
    const top = topLevelOnly(ogBlock(nearestOg.src)!);
    const hasType = /(^|[,{\s])type\s*(:|,|\}|$)/.test(top) || /\.\.\./.test(top);
    if (!hasType) {
      errors.push(
        `${route} (${nearestOg.file}) declares openGraph without type · ` +
          `that ships no og:type (the root's "website" does not merge in) · ` +
          `add type: "website" (or "article") to the block`,
      );
    }
  }

  let decl: Decl = { kind: "none" };
  let declFile = "";
  for (const link of chain) {
    const found = findCanonical(link.src);
    if (found.kind !== "none") {
      decl = found;
      declFile = link.file;
      break;
    }
  }
  if (decl.kind === "none" && delegatedDeclares(pageSrc, pageFile)) {
    decl = { kind: "opaque" };
    declFile = relPage + " (delegated metadata builder)";
  }

  if (decl.kind === "none") {
    errors.push(
      `${route} (${relPage}) declares no canonical anywhere in its segment ` +
        `chain · it inherits the ROOT layout's homepage canonical and tells ` +
        `Google it's a duplicate of / · add alternates.canonical (or robots ` +
        `noindex if this page shouldn't be indexed)`,
    );
    continue;
  }

  if (decl.kind === "opaque" || /\[.+\]/.test(route)) {
    presenceOnly++;
    continue;
  }

  // Literal on a static route · must be this route's own URL, exactly.
  let url: URL;
  try {
    url = new URL(decl.value);
  } catch {
    errors.push(`${route}: canonical "${decl.value}" in ${declFile} is not an absolute URL`);
    continue;
  }
  const norm = (p: string) => (p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p);
  if (url.origin !== SITE || norm(url.pathname) !== norm(route)) {
    errors.push(
      `${route}: nearest canonical (${declFile}) points at ${decl.value} · ` +
        `expected ${SITE}${route === "/" ? "" : route}`,
    );
    continue;
  }
  literalChecked++;
}

if (errors.length > 0) {
  console.error(
    "✗ canonical drift:\n" + errors.map((e) => "  - " + e).join("\n"),
  );
  process.exit(1);
}

console.log(
  `✓ canonicals self-referential · ${literalChecked} literal-verified, ` +
    `${presenceOnly} computed/delegated (presence-checked), ${exempt} noindex-exempt`,
);
console.log(
  `✓ og:url self-referential · ${ogChecked} literal-verified, ` +
    `${ogPresenceOnly} computed/delegated (presence-checked)`,
);
