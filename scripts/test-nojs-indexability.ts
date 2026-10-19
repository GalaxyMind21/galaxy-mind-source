// No-JS indexability regression test (competitor teardown lesson A6,
// 2026-10-18). A competitor's storefronts are client-only SPAs, so a crawler
// sees a generic shell and none of the catalog. Ours are server-rendered, and
// this locks that in: it fetches RAW server HTML (no JavaScript runs) and
// asserts what a search engine needs is already there.
//
// For /, /submit, /hashrate, the /how-to-accept-bitcoin and
// /how-to-buy-bitcoin guides, one category hub and one country hub:
//   · HTTP 200
//   · a page-specific <title> (non-empty, and unique across the set)
//   · at least one <h1>
//   · <link rel="canonical"> pointing at the page's OWN galaxymind.space URL
//   · at least one application/ld+json block, and every block parses
// Site-wide: /sitemap.xml has ≥ 250 <loc>, /robots.txt names the sitemap,
// /llms.txt returns 200.
//
// It needs the network, so it is NOT part of `npm run verify` (CI has no
// deployment to hit, and previews sit behind Vercel protection). Run it
// against production after every merge, or against a preview:
//
//   npx tsx scripts/test-nojs-indexability.ts                       # prod
//   npx tsx scripts/test-nojs-indexability.ts --base https://<preview>.vercel.app --vercel
//   npx tsx scripts/test-nojs-indexability.ts /nostr-marketplaces   # extra paths
//
// --vercel fetches through `vercel curl` (automatic protection bypass), so
// the box's Vercel login is used and no secret is ever printed.
// Exit: 0 all green · 1 at least one failure.
import { execFileSync } from "node:child_process";

const SITE = "https://galaxymind.space";
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = (opt("--base") ?? process.env.NOJS_BASE ?? SITE).replace(/\/$/, "");
const VIA_VERCEL = flag("--vercel");
const EXTRA = argv.filter((a, i) => a.startsWith("/") && argv[i - 1] !== "--base");

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}${d ? ` · ${d}` : ""}`); } };

type Res = { status: number; body: string };
async function get(path: string): Promise<Res> {
  const url = `${BASE}${path}`;
  if (VIA_VERCEL) {
    try {
      const out = execFileSync("vercel", ["curl", url, "--", "-s", "-w", "\n__STATUS__%{http_code}"], {
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/\n__STATUS__(\d{3})\s*$/);
      return { status: m ? Number(m[1]) : 0, body: m ? out.slice(0, m.index) : out };
    } catch (e) {
      return { status: 0, body: String((e as Error).message).slice(0, 200) };
    }
  }
  const r = await fetch(url, { headers: { "user-agent": "GalaxyMind-nojs-indexability/1.0 (no JavaScript)" }, redirect: "follow" });
  return { status: r.status, body: await r.text() };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const norm = (u: string) => u.replace(/\/$/, "");

function pageChecks(path: string, html: string, titles: Map<string, string>) {
  const head = html.split("</head>")[0] ?? html;
  const title = decode((head.match(/<title[^>]*>([^<]*)<\/title>/) ?? [])[1] ?? "").trim();
  check(`${path}: <title> present`, title.length > 0, title || "(none)");
  if (title) titles.set(path, title);
  check(`${path}: <h1> in server HTML`, /<h1[\s>]/.test(html));
  const canon = (head.match(/<link[^>]+rel="canonical"[^>]*>/) ?? [])[0] ?? "";
  const href = decode((canon.match(/href="([^"]+)"/) ?? [])[1] ?? "");
  check(`${path}: canonical is its own URL`, norm(href) === norm(`${SITE}${path}`), href || "(none)");
  const blocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  check(`${path}: ≥ 1 JSON-LD block`, blocks.length > 0, String(blocks.length));
  const bad = blocks.filter((b) => { try { JSON.parse(b); return false; } catch { return true; } });
  check(`${path}: every JSON-LD block parses`, blocks.length > 0 && bad.length === 0, bad.length ? `${bad.length} broken` : "");
}

(async () => {
  console.log(`── no-JS indexability · ${BASE}${VIA_VERCEL ? " (vercel curl)" : ""} ──`);

  const sm = await get("/sitemap.xml");
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  check("/sitemap.xml returns 200", sm.status === 200, String(sm.status));
  check("/sitemap.xml has ≥ 250 <loc> entries", locs.length >= 250, String(locs.length));
  const pick = (re: RegExp) => locs.map((l) => l.replace(SITE, "")).find((p) => re.test(p));
  const category = pick(/^\/spend-bitcoin-on\/[^/]+$/);
  const country = pick(/^\/spend-bitcoin-in\/[^/]+$/);
  check("sitemap lists a category hub and a country hub", !!category && !!country, `${category} ${country}`);

  const robots = await get("/robots.txt");
  check("/robots.txt returns 200", robots.status === 200, String(robots.status));
  check("/robots.txt references the sitemap", /^Sitemap:\s*https:\/\/galaxymind\.space\/sitemap\.xml\s*$/im.test(robots.body));

  const llms = await get("/llms.txt");
  check("/llms.txt returns 200", llms.status === 200 && llms.body.length > 1000, String(llms.status));

  const paths = ["/", "/submit", "/hashrate", "/how-to-accept-bitcoin", "/how-to-buy-bitcoin", category, country, ...EXTRA].filter((p): p is string => !!p);
  const titles = new Map<string, string>();
  for (const p of paths) {
    const r = await get(p);
    check(`${p}: HTTP 200`, r.status === 200, String(r.status));
    if (r.status === 200) pageChecks(p, r.body, titles);
  }
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const [p, t] of titles) { if (seen.has(t)) dupes.push(`${seen.get(t)} = ${p}`); else seen.set(t, p); }
  check("every <title> is page-specific (no two pages share one)", dupes.length === 0, dupes.join(", "));

  console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
  if (fail) process.exit(1);
})();
