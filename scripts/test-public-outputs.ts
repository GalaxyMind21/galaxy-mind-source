// Runtime guard for public machine-readable outputs (review PR #73).
// mrr.ts and hashrate.ts are skipped by check-no-mrr-public because they
// are server-side, but they FEED /api/hashrate and the MCP tools. This
// renders those outputs from a hostile fixture (real-looking rig ids,
// upstream names, referral links, locations) and asserts none survives.
import { TEST_PAYTO_SOLANA, TEST_PAYTO_PINS } from "./lib/test-payto";
import type { HashrateDesk, DeskRig } from "../src/lib/hashrate";
import { GALAXY_MIND_RIG_IDS } from "../src/lib/hashrate";
import { publicDesk } from "../src/lib/public-desk";
import { composeRentalQuote } from "../src/lib/rental-quote";
import { buildDirectQuoteResponse } from "../src/lib/rentals/http-quote";
import { listAvailableRigs, closeTheSale, blockedHit } from "../src/lib/rentals";
import { directQuote, unifiedRentalStatus } from "../src/lib/rentals/direct";
import { MemoryStore } from "../src/lib/rentals/phase2/store";
import { MockProvider } from "../src/lib/rentals/phase2/providers";
import { bayBoard, type Deps } from "../src/lib/rentals/phase2/service";
import { readFileSync } from "node:fs";
import * as COPY from "../src/lib/hashrate-copy";
import { SUPPORT_EMAIL } from "../src/lib/support";
import { MIN_DAYS, MAX_DAYS } from "../src/lib/rentals/limits";
import { containsNeverReveal } from "../src/lib/never-reveal";

let pass = 0, fail = 0;
const assert = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

const ids = GALAXY_MIND_RIG_IDS.slice(0, 3);
const NOW = Date.parse("2026-10-16T11:00:00Z");
const mkD = (over: Partial<Deps> = {}): Deps => ({
  store: new MemoryStore(), providers: { x402_usdc: new MockProvider("x402_usdc") },
  pricing: async () => ({ marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: NOW - 3600_000 }),
  btcUsd: async () => 82000, now: () => NOW, signingKeyPem: "", signingKid: "t", codeHmacKey: "k".repeat(32), killSwitch: async () => false, pilot: true, bays: [11, 12, 13, 14], ...over,
});
const rig = (id: string, i: number): DeskRig => ({
  id, name: `GalaxyMind S21 XP US-South #${i} MRR`, owner: "GalaxyMind", region: "us-south",
  status: i === 0 ? "rented" : "available", hoursLeft: i === 0 ? 5 : null, online: true,
  advertisedPh: 0.27, measuredPh: 0.28, askBtcPerPhDay: 0.00052, minHours: 3, maxHours: 168, rpi: "new",
  rentUrl: `https://www.miningrigrentals.com/rigs/${id}?ref=123`, recovery: null, isOurs: true,
});
const desk: HashrateDesk = {
  asOf: "2026-10-16T11:00:00.000Z", hashprice: 0.00047, networkPhs: 1_000_000, btcUsd: 82_000, blockRewardBtc: 3.16,
  book: { floor: 0.0004, medianAsk: 0.0005, clearedLast30: null, clearedLast10: null, suggested: 0.00049 },
  bookSample: { collected: 10, availableRigs: 20, complete: false },
  ourRigs: ids.map(rig), regionBook: ids.map(rig), region: "us-south",
  stats: null, degraded: [],
} as unknown as HashrateDesk;

const BAD = [/miningrigrentals/i, /\bMRR\b/, /[?&]ref=/i, /make\s+it\s+right/i, /us-south/i, /GalaxyMind S21/];
function clean(name: string, out: unknown) {
  const s = JSON.stringify(out);
  for (const re of BAD) assert(`${name}: no ${re}`, !re.test(s), s.slice(0, 200));
  for (const id of ids) assert(`${name}: no rig id ${id}`, !s.includes(id));
  const hit = blockedHit(s);
  assert(`${name}: passes the customer-safe filter`, !hit, String(hit));
}

(async () => {
console.log("── public outputs · /api/hashrate ────────────────");
const pd = publicDesk(desk);
clean("/api/hashrate", pd);
assert("ourRigs are bay aliases", pd.ourRigs.every((r) => /^bay-\d+$/.test(r.id)));
assert("no regionBook or region", !("regionBook" in pd) && !("region" in pd));
assert("no hourly window", !/minHours|maxHours/.test(JSON.stringify(pd)));
assert("term is 1 to 7 days during the pilot, up to 30 later", pd.rentalTerm.minDays === MIN_DAYS && pd.rentalTerm.maxDays === 7 && pd.rentalTerm.laterMaxDays === MAX_DAYS && MAX_DAYS === 30 && pd.rentalTerm.copy === "1 to 7 days during the pilot, up to 30 later");

console.log("── public outputs · /api/hashrate/quote ──────────");
{
  // These are the direct-mode outputs (RENTALS_MODE=direct); MRR-only outputs carry the referral link by design (test-mrr-only).
  const deps = { deps: () => mkD(), env: { RENTALS_MODE: "direct" }, now: Date.parse("2026-10-16T11:00:00Z") };
  const ok = await buildDirectQuoteResponse(new URLSearchParams("rigs=1&days=3"), deps);
  assert("quote 200", ok.status === 200, JSON.stringify(ok.body).slice(0, 200));
  clean("/api/hashrate/quote", ok.body);
  const big = await buildDirectQuoteResponse(new URLSearchParams("ph=1000000000"), deps);
  assert("ph 1e9 -> above_maximum", (big.body as { error?: string }).error === "above_maximum");
  clean("/api/hashrate/quote error", big.body);
  // the bay-alias quote still feeds /hashrate/agents and the Offer JSON-LD
  const q = composeRentalQuote(desk, undefined, 24);
  assert("agents quote ok", q.ok);
  if (q.ok) {
    clean("/hashrate/agents quote", q.result);
    assert("handoff never loops to /hashrate", q.result.handoff.finishUrl === null || !/galaxymind\.space\/hashrate/.test(q.result.handoff.finishUrl));
  }
}

console.log("── public outputs · MCP tools ────────────────────");
const board = await bayBoard(mkD());
const lar = { ...listAvailableRigs(board), closeTheSale: closeTheSale({ RENTALS_MODE: "direct" }) };
assert("MRR-only closeTheSale passes the customer-safe filter (exact referral link exempt)", !blockedHit(JSON.stringify(closeTheSale({}))));
clean("list_available_rigs", lar);
assert("list_available_rigs bays are positions 1..n, never allowlist values", JSON.stringify(lar.bays) === JSON.stringify([1, 2, 3, 4].map((bay) => ({ bay, state: "open" }))));
const dq = await directQuote(mkD(), { rigs: 1, days: 1 });
assert("direct quote ok", dq.ok, JSON.stringify(dq).slice(0, 200));
clean("get_rental_quote", dq);
const nf = await unifiedRentalStatus(mkD(), "A".repeat(32), {}, (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
clean("rental_status not_found", nf);
assert("not_found carries the support email", !nf.ok && nf.message.includes(SUPPORT_EMAIL));

console.log("── new customer copy (B1-B6): no keyed private word, facility word or IP ──");
{
  // QUOTE_API_* are the legacy marketplace-API steps for agents (rental-quote.ts), not direct-rental copy.
  const strings = Object.entries(COPY).filter(([k]) => !k.startsWith("QUOTE_API")).map(([, v]) => v).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : []));
  const files = ["src/app/hashrate/page.tsx", "src/app/hashrate/HashrateContent.tsx", "src/app/hashrate/how-to-rent/page.tsx", "src/app/hashrate/rent/RentCheckout.tsx", "src/app/hashrate/rent/page.tsx", "src/app/hashrate/agents/page.tsx", "public/llms.txt", "src/lib/support.ts"]
    .map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1"));
  const all = strings.join("\n") + "\n" + files.join("\n");
  for (const re of [/\b(us-?south)\b/i, /\bfacility\b/i, /\b\d{1,3}(\.\d{1,3}){3}\b/]) {
    const m = all.match(re);
    assert(`copy: no ${re}`, !m, m ? m[0] : "");
  }
  assert("copy: no private word (keyed never-reveal list, when configured)", !containsNeverReveal(all, "copy"));
  // Lightning stays legitimate in merchant copy (llms.txt directory); only the rental "Lightning soon" promise is stale.
  for (const re of [/1 to 30 days/i, /Lightning[^.\n]{0,40}soon/i, /13 read-only/i, /humans on support/i, /one-time setup/i]) {
    const m = all.match(re);
    assert(`copy: no stale "${re.source}"`, !m, m ? m[0] : "");
  }
}

console.log("── Review #106 N1/N2/N5/N6 ──");
{
  const { dbCommitCap, PRICING_CACHE_MS } = await import("../src/lib/rentals/phase2/staging");
  const { SQL_COMMIT_CAP, minBtcPhDay, DEFAULT_MIN_BTC_PH_DAY, MAX_MIN_BTC_PH_DAY } = await import("../src/lib/rentals/phase2/pricing");
  const { fleetCapacity, getQuote, createRental } = await import("../src/lib/rentals/phase2/service");
  assert("N1: RENTALS_DB_COMMIT_CAP is clamped to the SQL cap", dbCommitCap({ RENTALS_DB_COMMIT_CAP: "40" }) === SQL_COMMIT_CAP && dbCommitCap({ RENTALS_DB_COMMIT_CAP: "2" }) === 2 && dbCommitCap({}) === SQL_COMMIT_CAP && dbCommitCap({ RENTALS_DB_COMMIT_CAP: "x" }) === SQL_COMMIT_CAP);
  assert("N1: fleetCapacity never exceeds the SQL cap", fleetCapacity({ bays: [1, 2, 3, 4, 5, 6, 7, 8], dbCommitCap: 40 }) === SQL_COMMIT_CAP);
  const mig = readFileSync("supabase/migrations/20261016190000_phase2_reoffer.sql", "utf8");
  assert("N1: SQL_COMMIT_CAP matches the rental_settle literal", new RegExp(`others \\+ cur_rigs > ${SQL_COMMIT_CAP}\\b`).test(mig));
  const hq = readFileSync("src/app/api/hashrate/quote/route.ts", "utf8");
  assert("N2: /api/hashrate/quote is rate limited", /rateLimit\(req, \{ name: "hashrate-quote"/.test(hq) && /status: 429/.test(hq));
  assert("N2: pricing_daily cached ~60 s", PRICING_CACHE_MS === 60_000);
  assert("N5: MRR_MIN_BTC_PH_DAY upper bound is tight", MAX_MIN_BTC_PH_DAY <= 0.002 && minBtcPhDay({ MRR_MIN_BTC_PH_DAY: "0.005" }) === DEFAULT_MIN_BTC_PH_DAY && minBtcPhDay({ MRR_MIN_BTC_PH_DAY: "0.0006" }) === 0.0006);
  const q = await getQuote(mkD(), { rigs: 1, days: 1 });
  assert("N5: priceBasis names the min clamp", q.ok && (q.result as { priceBasis: string }).priceBasis === "max_ask0.985_floor_x_1.03_min");
  const { RENTAL_TERMS_VERSION } = await import("../src/lib/rentals/phase2/terms");
  const ln = await createRental(mkD(), { rigs: 1, days: 1, pool_id: "ocean", username: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: "k".repeat(20), rail: "lightning" } as never);
  assert("N6: rail lightning answers rail_unavailable", !ln.ok && (ln as { error: string }).error === "rail_unavailable", JSON.stringify(ln).slice(0, 120));
  const mcpSrc = readFileSync("src/lib/rentals/phase2/mcp.ts", "utf8");
  assert("N6: create_rental rail is not a zod enum (no -32602 for lightning)", /rail: z\.string\(\)/.test(mcpSrc) && !/rail: z\.enum/.test(mcpSrc));
  assert("N6: get_rental_status is not marked read-only", /title\("Get Rental Status"\), readOnlyHint: false/.test(mcpSrc));
  const route = readFileSync("src/app/api/mcp/[transport]/route.ts", "utf8");
  assert("N6: scope text says 14 read-only and names get_rental_status as changing state", /14 are read-only/.test(route) && /get_rental_status \(rental_id and creator_secret\) reads your rental but/.test(route));
  const terms = readFileSync("src/lib/rental-terms-draft-html.ts", "utf8");
  assert("N3: Terms payment wording names Base or Solana", (terms.match(/USDC on Base or Solana, or other networks shown at checkout/g) ?? []).length === 2 && !/USDC on Base \(x402\)/.test(terms));
}

console.log("── funnel (privacy allow-list) + support line ──");
{
  const { funnelProps, railOf, trackFunnel, setFunnelTracker, FUNNEL_EVENTS } = await import("../src/lib/rentals/funnel");
  const { supportInfo, supportDiscordUrl } = await import("../src/lib/support");
  const leaky = { channel: "web", rail: "base", rigs: 2, days: 3, outcome: "settled", wallet: "0xabc", payer: "0xdef", email: "a@b.c", pool: "stratum+tcp://x", rentalId: "r1", ip: "1.2.3.4" } as unknown as Parameters<typeof funnelProps>[0];
  const out = funnelProps(leaky);
  assert("funnel keeps only allow-listed props", JSON.stringify(Object.keys(out).sort()) === JSON.stringify(["channel", "days", "outcome", "rail", "rigs"]), JSON.stringify(out));
  assert("funnel drops unknown outcomes and junk numbers", Object.keys(funnelProps({ outcome: "0xwallet", rigs: -1, days: 1.5 } as never)).length === 0);
  assert("rail is coarse", railOf("eip155:8453") === "base" && railOf("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") === "solana" && railOf("x") === undefined);
  assert("five funnel events", FUNNEL_EVENTS.length === 5);
  const seen: [string, Record<string, string | number> | undefined][] = [];
  setFunnelTracker(async (n, p) => { seen.push([n, p]); });
  await trackFunnel("rental_paid", leaky);
  setFunnelTracker(async () => { throw new Error("boom"); });
  await trackFunnel("rental_paid", {}); // must not throw
  setFunnelTracker(null);
  assert("trackFunnel sends the projected props only", seen.length === 1 && !JSON.stringify(seen).includes("0x") && !JSON.stringify(seen).includes("@"));
  // Review #106 F1: no funnel event from a request whose URL names a payment ref or rental (the SDK would attach it).
  {
    const sym = Symbol.for("@vercel/request-context");
    const g = globalThis as unknown as Record<symbol, unknown>;
    const prev = g[sym];
    const got: string[] = [];
    setFunnelTracker(async (n) => { got.push(n); });
    g[sym] = { get: () => ({ url: "https://galaxymind.space/api/rentals/pay/x402_0123456789abcdef0123456789abcdef", headers: {} }) };
    await trackFunnel("rental_paid", { rail: "base", outcome: "settled" });
    g[sym] = { get: () => ({ url: "https://galaxymind.space/api/rentals/status/gm_abc123", headers: {} }) };
    await trackFunnel("rental_paid", { rail: "base", outcome: "settled" });
    assert("F1: no funnel event from a request URL containing x402_ or gm_", got.length === 0, JSON.stringify(got));
    g[sym] = { get: () => ({ url: "https://galaxymind.space/api/rentals/order", headers: {} }) };
    await trackFunnel("rental_order_created", { channel: "web" });
    assert("F1: id-free request URLs still count", got.length === 1);
    g[sym] = prev;
    setFunnelTracker(null);
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(f) ? [p] : []; });
    const srcFiles = walk("src");
    const serverTrack = srcFiles.filter((f) => /@vercel\/analytics\/server/.test(readFileSync(f, "utf8")));
    assert("F1: no server-side @vercel/analytics track anywhere in src", serverTrack.length === 0, serverTrack.join(","));
    const serverSideAnalytics = srcFiles.filter((f) => (f.startsWith("src/app/api/") || f.startsWith("src/lib/")) && /from\s+["']@vercel\/analytics/.test(readFileSync(f, "utf8")));
    assert("F1: no @vercel/analytics import in API routes or src/lib", serverSideAnalytics.length === 0, serverSideAnalytics.join(","));
    const payRoute = readFileSync("src/app/api/rentals/pay/[ref]/route.ts", "utf8");
    assert("F1: the pay route emits no funnel event", !/trackFunnel|rentals\/funnel|@vercel\/analytics/.test(payRoute));
    const rc = readFileSync("src/app/hashrate/rent/RentCheckout.tsx", "utf8");
    assert("F1: rental_paid fires client-side on /hashrate/rent", /track\("rental_paid", funnelProps\(\{ channel: "web", rail: payNet, outcome: out\.outcome \}\)\)/.test(rc));
    const sweep = readFileSync("src/app/api/rentals/sweep/route.ts", "utf8");
    assert("F1: the sweep counts all payments (rental_paid_total)", /paidInLastWindow\(d\)/.test(sweep) && /"rental_paid_total"/.test(sweep));
  }
  assert("support is email-only while SUPPORT_DISCORD_URL is unset", supportInfo({}).discord === null && supportInfo({}).email === SUPPORT_EMAIL);
  assert("Discord shows only for an https URL", supportDiscordUrl({ SUPPORT_DISCORD_URL: "https://discord.gg/abc" }) === "https://discord.gg/abc" && supportDiscordUrl({ SUPPORT_DISCORD_URL: "javascript:alert(1)" }) === null && supportDiscordUrl({ SUPPORT_DISCORD_URL: "http://discord.gg/x" }) === null);
  const { payRailsLabel, solanaRailOn } = await import("../src/lib/rentals/rails");
  assert("rails copy: Base only while Solana is off", payRailsLabel({}) === "USDC on Base" && !solanaRailOn({ RENTALS_SOLANA_ENABLED: "0" }));
  const SOL = { RENTALS_PAYTO_PIN_SOLANA: TEST_PAYTO_SOLANA };
  assert("rails copy: names Solana when RENTALS_SOLANA_ENABLED=1", payRailsLabel({ ...SOL, RENTALS_SOLANA_ENABLED: "1" }, TEST_PAYTO_PINS) === "USDC on Base or Solana");
  assert("rails copy: no Solana when its payTo does not hash to the pin", payRailsLabel({ ...SOL, RENTALS_SOLANA_ENABLED: "1" }) === "USDC on Base");
  {
    // N4: the copy and the checkout picker read the same check (human.ts solanaOffered).
    const { chainInfo } = await import("../src/lib/rentals/phase2/human");
    const SOLP = { RENTALS_PAYTO_PIN_SOLANA: TEST_PAYTO_SOLANA };
    const envs: Record<string, string | undefined>[] = [{}, { ...SOLP, RENTALS_SOLANA_ENABLED: "1" }, { ...SOLP, RENTALS_SOLANA_ENABLED: "1", RENTALS_SOLANA_RPC: "http://insecure.example" }, { ...SOLP, RENTALS_SOLANA_ENABLED: "0" }];
    assert("N4: rails copy names Solana exactly when the checkout offers it", envs.every((e) => solanaRailOn(e, TEST_PAYTO_PINS) === !!chainInfo(e, TEST_PAYTO_PINS).solana) && solanaRailOn(envs[1], TEST_PAYTO_PINS), envs.map((e) => `${solanaRailOn(e, TEST_PAYTO_PINS)}/${!!chainInfo(e, TEST_PAYTO_PINS).solana}`).join(","));
    assert("N4: a rail that can't be built (non-https RPC) is not advertised", payRailsLabel({ ...SOLP, RENTALS_SOLANA_ENABLED: "1", RENTALS_SOLANA_RPC: "http://insecure.example" }, TEST_PAYTO_PINS) === "USDC on Base");
  }
  {
    const hc = readFileSync("src/app/hashrate/HashrateContent.tsx", "utf8");
    assert("/hashrate hero and fine print fill {RAILS}", /withRails\(RENT_PRICE_FOOT\)/.test(hc) && /withRails\(RENT_HERO_SUB\)/.test(hc) && /withRails\(s\.body\)/.test(hc));
    assert("price fine print no longer hardcodes Base", /\{RAILS\}/.test(COPY.RENT_PRICE_FOOT) && !/on Base/.test(COPY.RENT_PRICE_FOOT));
    const rc = readFileSync("src/app/hashrate/rent/RentCheckout.tsx", "utf8");
    assert("progress ring names the chain actually paid on", /chain=\{paidChainName\(order, collecting\.tx\)\}/.test(rc) && /PAY_STEPS\(sol\.name(, gate)?\)/.test(rc) && /signed: true, net: payNet/.test(rc));
  }
  for (const f of ["src/app/hashrate/rent/RentCheckout.tsx", "src/app/hashrate/rent/page.tsx", "src/app/hashrate/HashrateContent.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert(`${f}: support line mounted`, /<SupportLine\b/.test(src));
    assert(`${f}: no X handle as the support channel`, !/x\.com\/GalaxyMind/.test(src));
  }
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);

console.log("── filter + link guards ──────────────────────────");
assert("'ab::' is not an IPv6 hit", !blockedHit("Use ab:: as a separator"));
assert("real compressed IPv6 still blocked", !!blockedHit("host fe80::1 here") && !!blockedHit("at 2001:db8:: now"));
import("../src/app/hashrate/components/RentWithAiBot").then(({ safeHttpsUrl }) => {
  assert("marketplace url must be https", safeHttpsUrl("https://example.com/x") === "https://example.com/x");
  assert("javascript: rejected", safeHttpsUrl("javascript:alert(1)") === "");
  assert("http: rejected", safeHttpsUrl("http://example.com") === "");
  console.log(`\n${pass} passed · ${fail} failed (with link guards)`);
  if (fail > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });

})().catch((e) => { console.error(e); process.exit(1); });
