#!/usr/bin/env tsx
/**
 * pull-gsc · Google Search Console → actionable SEO report.
 *
 * Run via:
 *   npx tsx scripts/pull-gsc.ts                  # last 28d, full report
 *   npx tsx scripts/pull-gsc.ts --days 90        # longer window
 *   npx tsx scripts/pull-gsc.ts --json           # machine-readable
 *   npx tsx scripts/pull-gsc.ts --sites          # list properties + exit
 *
 * SETUP: see docs/gsc-setup.md. Short version — create a Google Cloud
 * service account, enable the Search Console API, add the service
 * account's email as a FULL user in Search Console → Settings → Users
 * and permissions, then put the key JSON at .gsc-key.json (gitignored)
 * or in GSC_SERVICE_ACCOUNT_JSON.
 *
 * WHY A SERVICE ACCOUNT: Search Console is one of the few Google APIs
 * that accepts service-account auth with no OAuth consent screen — the
 * property owner grants access inside GSC's own UI instead. That's what
 * makes this scriptable and cron-able, unlike most Google surfaces.
 *
 * WHY NOT lib/upstream.ts: upstreamFetchJson is GET-only (its opts carry
 * no method/body) and caps at a 5s timeout tuned for market-snapshot
 * fail-to-null. GSC needs POST with a JSON body and is comfortably
 * slower, so this does its own fetch with an explicit AbortSignal.
 *
 * READ-ONLY. Scope is webmasters.readonly; this script never submits a
 * sitemap, requests indexing, or mutates the property in any way.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// Load .env.local before anything reads process.env (tsx doesn't
// auto-load dotenv the way Next.js does). Same fs-only loader as
// scripts/peek-submissions.ts · no extra dep.
(function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TIMEOUT_MS = 20_000;

/** GSC's own data pipeline lags ~2 days; asking for yesterday returns a partial row. */
const DATA_LAG_DAYS = 3;

// ─────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────

type ServiceAccount = { client_email: string; private_key: string };

const KEY_FILE_CANDIDATES = [".gsc-key.json", "gsc-key.json"];

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (raw) {
    // Accept both raw JSON and base64 (Vercel env vars dislike newlines).
    const text = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf-8");
    return parseServiceAccount(text, "GSC_SERVICE_ACCOUNT_JSON");
  }

  const explicit = process.env.GSC_SERVICE_ACCOUNT_FILE;
  const candidates = explicit ? [explicit] : KEY_FILE_CANDIDATES;
  for (const c of candidates) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) {
      return parseServiceAccount(fs.readFileSync(p, "utf-8"), c);
    }
  }

  die(
    `No Search Console credentials found.\n\n` +
      `  Expected one of:\n` +
      `    • ${KEY_FILE_CANDIDATES.join(" or ")} in the repo root\n` +
      `    • GSC_SERVICE_ACCOUNT_FILE=/path/to/key.json\n` +
      `    • GSC_SERVICE_ACCOUNT_JSON=<raw or base64 JSON>\n\n` +
      `  Setup instructions: docs/gsc-setup.md`,
  );
}

function parseServiceAccount(text: string, source: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    die(`${source} is not valid JSON.`);
  }
  const o = parsed as Partial<ServiceAccount>;
  if (!o.client_email || !o.private_key) {
    die(
      `${source} is missing client_email / private_key. ` +
        `Download the JSON key (not the P12) from the service account's Keys tab.`,
    );
  }
  // Env-var round-trips often turn real newlines into the two-char "\n".
  return {
    client_email: o.client_email,
    private_key: o.private_key.replace(/\\n/g, "\n"),
  };
}

// ─────────────────────────────────────────────────────────────
// Auth · self-signed JWT → access token
// ─────────────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;

  let signature: string;
  try {
    signature = b64url(
      crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key),
    );
  } catch (e) {
    die(
      `Failed to sign the auth JWT with the service-account private key.\n` +
        `  ${e instanceof Error ? e.message : String(e)}\n` +
        `  The key is usually malformed — it must include the ` +
        `-----BEGIN PRIVATE KEY----- header and real newlines.`,
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !body.access_token) {
    const detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    die(
      `Token exchange failed · ${detail}\n\n` +
        `  Most common cause: the Search Console API is not enabled on the\n` +
        `  service account's Google Cloud project. See docs/gsc-setup.md step 2.`,
    );
  }
  return body.access_token;
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

type Row = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

async function gscFetch<T>(
  token: string,
  urlPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep the status */
    }
    if (res.status === 403) {
      die(
        `Search Console denied the request · ${detail}\n\n` +
          `  The service account is authenticated but not authorised for this\n` +
          `  property. In Search Console → Settings → Users and permissions,\n` +
          `  add the service account email and give it Full access.\n` +
          `  Run with --sites to see which properties it CAN read.`,
      );
    }
    die(`Search Console request failed · ${urlPath} · ${detail}`);
  }
  return (await res.json()) as T;
}

async function listSites(token: string): Promise<string[]> {
  const data = await gscFetch<{
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  }>(token, "/sites");
  return (data.siteEntry ?? []).map(
    (s) => `${s.siteUrl}  (${s.permissionLevel})`,
  );
}

/** Paged searchAnalytics query. GSC caps rowLimit at 25k per call. */
async function query(
  token: string,
  site: string,
  opts: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    rowLimit?: number;
  },
): Promise<Row[]> {
  const limit = opts.rowLimit ?? 5000;
  const out: Row[] = [];
  let startRow = 0;

  // Page until GSC returns a short batch. Bounded so a wide dimension
  // combo can never spin forever on a large property.
  for (let page = 0; page < 10; page++) {
    const data = await gscFetch<{ rows?: Row[] }>(
      token,
      `/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions,
        type: "web",
        rowLimit: Math.min(limit, 25_000),
        startRow,
      },
    );
    const rows = data.rows ?? [];
    out.push(...rows);
    if (rows.length < Math.min(limit, 25_000)) break;
    startRow += rows.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Position buckets for the CTR-gap model. The expected CTR per bucket is
 * the site's OWN median, never an invented industry constant — same
 * discipline as the "published numbers come from the lib that owns them"
 * rule in the README. A page is only flagged when it underperforms its
 * actual peers at the same rank on this exact site.
 */
const POSITION_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1-3", min: 0, max: 3 },
  { label: "3-5", min: 3, max: 5 },
  { label: "5-10", min: 5, max: 10 },
  { label: "10-20", min: 10, max: 20 },
  { label: "20+", min: 20, max: Infinity },
];

function bucketFor(position: number): string {
  return (
    POSITION_BUCKETS.find((b) => position >= b.min && position < b.max)
      ?.label ?? "20+"
  );
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median CTR per position bucket, computed from the rows themselves. */
function ctrCurve(rows: Row[], minImpressions: number): Map<string, number> {
  const byBucket = new Map<string, number[]>();
  for (const r of rows) {
    if (r.impressions < minImpressions) continue;
    const b = bucketFor(r.position);
    const list = byBucket.get(b) ?? [];
    list.push(r.ctr);
    byBucket.set(b, list);
  }
  const curve = new Map<string, number>();
  for (const [b, list] of byBucket) curve.set(b, median(list));
  return curve;
}

type Totals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function totals(rows: Row[]): Totals {
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  // Position must be impression-weighted — a naive mean lets a
  // 1-impression #1 ranking outweigh a 5000-impression #12.
  const posWeighted = rows.reduce((a, r) => a + r.position * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posWeighted / impressions : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => n.toFixed(1);
const num = (n: number) => n.toLocaleString("en-US");

function delta(now: number, before: number): string {
  if (before === 0) return now > 0 ? "  new" : "    –";
  const d = ((now - before) / before) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(0)}%`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Strip the origin so page tables read as routes. */
function routeOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function table(
  headers: string[],
  rows: string[][],
  align: ("l" | "r")[],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (align[i] === "r" ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  return [
    line(headers),
    widths.map((w) => "─".repeat(w)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

function section(title: string, why: string): string {
  return `\n\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}\n${why}\n`;
}

// ─────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const days = Math.max(1, parseInt(value("days", "28"), 10) || 28);
  const asJson = flag("json");

  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);

  if (flag("sites")) {
    const sites = await listSites(token);
    console.log(
      sites.length
        ? `\nProperties readable by ${sa.client_email}:\n\n  ${sites.join("\n  ")}\n`
        : `\n${sa.client_email} can't read ANY property yet.\n\n` +
            `  Add it in Search Console → Settings → Users and permissions.\n`,
    );
    return;
  }

  // Resolve the property. A domain property (sc-domain:) and a URL-prefix
  // property are different strings for the same site, so try configured →
  // domain → url-prefix, and fall back to whatever the account can read.
  const configured = process.env.GSC_SITE_URL;
  const readable = (
    await gscFetch<{ siteEntry?: { siteUrl: string }[] }>(token, "/sites")
  ).siteEntry?.map((s) => s.siteUrl) ?? [];

  const site =
    configured ??
    readable.find((s) => s === "sc-domain:galaxymind.space") ??
    readable.find((s) => s.includes("galaxymind.space")) ??
    readable[0];

  if (!site) {
    die(
      `${sa.client_email} can't read any Search Console property.\n\n` +
        `  In Search Console → Settings → Users and permissions, add that\n` +
        `  email with Full access, then re-run. (--sites lists what it sees.)`,
    );
  }

  const endDate = isoDaysAgo(DATA_LAG_DAYS);
  const startDate = isoDaysAgo(DATA_LAG_DAYS + days);
  const prevEnd = isoDaysAgo(DATA_LAG_DAYS + days + 1);
  const prevStart = isoDaysAgo(DATA_LAG_DAYS + days * 2 + 1);

  const [queries, pages, prevQueries, pairs] = await Promise.all([
    query(token, site, { startDate, endDate, dimensions: ["query"] }),
    query(token, site, { startDate, endDate, dimensions: ["page"] }),
    query(token, site, {
      startDate: prevStart,
      endDate: prevEnd,
      dimensions: ["query"],
    }),
    query(token, site, {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      rowLimit: 25_000,
    }),
  ]);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          site,
          window: { startDate, endDate, days },
          previousWindow: { startDate: prevStart, endDate: prevEnd },
          totals: totals(queries),
          previousTotals: totals(prevQueries),
          queries,
          pages,
          queryPagePairs: pairs,
        },
        null,
        2,
      ),
    );
    return;
  }

  const now = totals(queries);
  const before = totals(prevQueries);

  const out: string[] = [];
  out.push(
    `\nGOOGLE SEARCH CONSOLE · ${site}`,
    `${startDate} → ${endDate}  (${days}d, vs prior ${days}d)`,
  );

  if (now.impressions === 0) {
    out.push(
      `\n⚠ Zero impressions in this window.`,
      `  Either the property was verified very recently, or the window`,
      `  predates indexing. Try --days 90.`,
    );
    console.log(out.join("\n"));
    return;
  }

  // ── Summary ──────────────────────────────────────────────
  out.push(
    section("SUMMARY", "Headline movement. Position is impression-weighted."),
  );
  out.push(
    table(
      ["metric", "now", "prior", "change"],
      [
        ["clicks", num(now.clicks), num(before.clicks), delta(now.clicks, before.clicks)],
        [
          "impressions",
          num(now.impressions),
          num(before.impressions),
          delta(now.impressions, before.impressions),
        ],
        ["ctr", pct(now.ctr), pct(before.ctr), delta(now.ctr, before.ctr)],
        [
          "avg position",
          pos(now.position),
          pos(before.position),
          // Lower position is better, so invert the sign for readability.
          delta(before.position, now.position),
        ],
        ["ranking queries", num(queries.length), num(prevQueries.length), delta(queries.length, prevQueries.length)],
      ],
      ["l", "r", "r", "r"],
    ),
  );

  // ── Striking distance ────────────────────────────────────
  const striking = queries
    .filter((r) => r.position >= 5 && r.position <= 20 && r.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  out.push(
    section(
      "STRIKING DISTANCE · queries at position 5–20",
      "The highest-leverage list. These already rank — moving them onto\n" +
        "page one is a title/content/internal-link job, not new pages.",
    ),
  );
  out.push(
    striking.length
      ? table(
          ["query", "impr", "clicks", "ctr", "pos"],
          striking.map((r) => [
            truncate(r.keys[0], 44),
            num(r.impressions),
            num(r.clicks),
            pct(r.ctr),
            pos(r.position),
          ]),
          ["l", "r", "r", "r", "r"],
        )
      : "  (nothing in this band yet)",
  );

  // ── CTR gap ──────────────────────────────────────────────
  const curve = ctrCurve(pages, 10);
  const ctrGap = pages
    .filter((r) => r.impressions >= 25)
    .map((r) => {
      const expected = curve.get(bucketFor(r.position)) ?? 0;
      return { row: r, expected, missed: (expected - r.ctr) * r.impressions };
    })
    // Floor of ~5 missed clicks. Below that the "gap" is sampling noise
    // against the median and not worth an operator's rewrite time.
    .filter((x) => x.missed >= 5)
    .sort((a, b) => b.missed - a.missed)
    .slice(0, 15);

  out.push(
    section(
      "CTR GAP · pages underperforming their own rank peers",
      "Expected CTR is this site's MEDIAN CTR at the same position band —\n" +
        "not an industry constant. High 'missed' = the ranking is fine but\n" +
        "the title/description is losing the click. Pure rewrite work.",
    ),
  );
  out.push(
    ctrGap.length
      ? table(
          ["page", "impr", "ctr", "peer", "pos", "missed"],
          ctrGap.map((x) => [
            truncate(routeOf(x.row.keys[0]), 40),
            num(x.row.impressions),
            pct(x.row.ctr),
            pct(x.expected),
            pos(x.row.position),
            `~${Math.round(x.missed)}`,
          ]),
          ["l", "r", "r", "r", "r", "r"],
        )
      : "  (no page is materially under its peers)",
  );

  // ── Cannibalization ──────────────────────────────────────
  // the README keeps the exact-match spend phrase OFF the homepage title
  // deliberately so / and /online-stores-that-accept-bitcoin don't split
  // relevance. This surfaces whether that discipline is actually holding.
  const byQuery = new Map<string, Row[]>();
  for (const r of pairs) {
    if (r.impressions < 10) continue;
    const q = r.keys[0];
    byQuery.set(q, [...(byQuery.get(q) ?? []), r]);
  }
  const cannibal = [...byQuery.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([q, rs]) => ({
      query: q,
      rows: [...rs].sort((a, b) => b.impressions - a.impressions),
      impressions: rs.reduce((a, r) => a + r.impressions, 0),
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  out.push(
    section(
      "CANNIBALIZATION · one query, multiple pages ranking",
      "Two URLs competing for the same query split link equity and confuse\n" +
        "Google's pick. Fix by differentiating titles or consolidating.",
    ),
  );
  out.push(
    cannibal.length
      ? cannibal
          .map(
            (c) =>
              `  "${truncate(c.query, 60)}"  ·  ${num(c.impressions)} impr\n` +
              c.rows
                .slice(0, 4)
                .map(
                  // dimensions are ["query","page"] → keys[1] is the URL.
                  // keys[0] here is the query, and routeOf() would silently
                  // pass it through as a non-URL string.
                  (r) =>
                    `      ${truncate(routeOf(r.keys[1]), 42).padEnd(42)} ` +
                    `${num(r.impressions).padStart(6)} impr  pos ${pos(r.position)}`,
                )
                .join("\n"),
          )
          .join("\n\n")
      : "  (no query is split across pages — the hub discipline is holding)",
  );

  // ── Top pages ────────────────────────────────────────────
  const topPages = [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  out.push(
    section("TOP PAGES BY CLICKS", "What is actually earning traffic today."),
  );
  out.push(
    table(
      ["page", "clicks", "impr", "ctr", "pos"],
      topPages.map((r) => [
        truncate(routeOf(r.keys[0]), 44),
        num(r.clicks),
        num(r.impressions),
        pct(r.ctr),
        pos(r.position),
      ]),
      ["l", "r", "r", "r", "r"],
    ),
  );

  // ── Top queries ──────────────────────────────────────────
  const topQueries = [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  out.push(
    section(
      "TOP QUERIES BY CLICKS",
      "The demand you already capture. Defend these before chasing new ones.",
    ),
  );
  out.push(
    table(
      ["query", "clicks", "impr", "ctr", "pos"],
      topQueries.map((r) => [
        truncate(r.keys[0], 44),
        num(r.clicks),
        num(r.impressions),
        pct(r.ctr),
        pos(r.position),
      ]),
      ["l", "r", "r", "r", "r"],
    ),
  );

  out.push("");
  console.log(out.join("\n"));
}

main().catch((e) => {
  die(e instanceof Error ? e.message : String(e));
});
