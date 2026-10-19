import { closeTheSale as cts, rentUrl as ru } from "../src/lib/rentals";
import { SQL_COMMIT_CAP } from "../src/lib/rentals/phase2/pricing";
// Direct-rental core (src/lib/rentals): availability, pricing, caps, expiry,
// status, blocked-term filter, rate-limit fallback. Placeholder ids only.
import assert from "node:assert/strict";
import { maxDaysNow, PILOT_MAX_DAYS as PMD } from "../src/lib/rentals/limits";
import { maxHoursFor } from "../src/lib/rental-limits";
import { pilotEnabled } from "../src/lib/rentals/phase2/flag";
import { maxDaysFor } from "../src/lib/rentals/phase2/service";
import { composeRentalQuote } from "../src/lib/rental-quote";
import { readFileSync } from "node:fs";
import {
  listAvailableRigs, sanitizeStatus, fetchRentalStatus,
  assertCustomerSafe, blockedHit, normalizeForFilter, MAX_RIGS_PER_QUOTE,
  closeTheSale, rentUrl, FINISH_HOW, FINISH_OPEN, FINISH_PAUSED, parseQuoteInput, thirdPartyMarket, MAX_RIGS, MAX_DAYS, DEFAULT_DAYS, MAX_PH, RENTAL_LIMITS,
} from "../src/lib/rentals";
import { directQuote } from "../src/lib/rentals/direct";
import { MemoryStore } from "../src/lib/rentals/phase2/store";
import { MockProvider } from "../src/lib/rentals/phase2/providers";
import { bayBoard, type Deps } from "../src/lib/rentals/phase2/service";
import type { DailyPricing } from "../src/lib/rentals/phase2/pricing";
import { buildDirectQuoteResponse } from "../src/lib/rentals/http-quote";
import { localLimit, rateLimitBucket } from "../src/lib/rate-limit";
import { QUOTE_TOOL_DESCRIPTION, MCP_RENT_WHEN } from "../src/lib/hashrate-copy";
import { useSyntheticNeverReveal, leaksNeverReveal, SYNTH } from "./lib/never-reveal-test";
useSyntheticNeverReveal();

const now = Date.parse("2026-10-16T09:00:00Z");
const PRICING: DailyPricing = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: now - 3600_000 };
const mkD = (over: Partial<Deps> = {}): Deps => ({
  store: new MemoryStore(), providers: { x402_usdc: new MockProvider("x402_usdc") }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
  signingKeyPem: "", signingKid: "t", codeHmacKey: "k".repeat(32), killSwitch: async () => false, pilot: true, bays: [1, 2, 3, 4], ...over,
});
const qq = (input: Record<string, unknown>, over: Partial<Deps> = {}) => directQuote(mkD(over), input);

// ── availability (B3): the bay board, never the marketplace feed; data-driven bay count
void (async () => {
  const list = listAvailableRigs(await bayBoard(mkD()));
  assert.deepEqual(list.rigTypes.map((r) => [r.rigType, r.total, r.available, r.thPerRig]), [["S21 XP", 4, 4, 270]]);
  assert.deepEqual(list.bays.map((b) => b.bay), [1, 2, 3, 4]);
  assert.equal(listAvailableRigs(null).dataComplete, false);
  assert.equal(listAvailableRigs(null).totalAvailable, 0);
  const big = await bayBoard(mkD({ bays: Array.from({ length: 12 }, (_, i) => i + 1), dbCommitCap: 12 }));
  // Review #106 N1: the board never shows more than the SQL cap; growing past it = the migration PR that raises
  // SQL_COMMIT_CAP together with rental_settle. Within the cap the allowlist alone sizes the board.
  assert.equal(big.total, SQL_COMMIT_CAP, "the board is capped at the SQL commit cap, whatever the env says");
  assert.equal((await bayBoard(mkD({ bays: [5, 6, 7] }))).total, 3, "within the cap, the allowlist sizes the board: config, not code");
  const capped = await bayBoard(mkD({ bays: Array.from({ length: 12 }, (_, i) => i + 1) }));
  assert.equal(capped.total, 4, "default DB commit cap 4 bounds the board until the migration raises it");
  assert.doesNotThrow(() => assertCustomerSafe(list));

  // ── pricing: one function (getQuote -> priceOrder); the clamp and freshness live in priceOrder
  const q1 = await qq({ rigs: 1, days: 1 });
  assert.ok(q1.ok, JSON.stringify(q1));
  if (q1.ok) {
    assert.ok((q1.result.pricePerPhDayBtc as number) >= 0.00051644, "never below the listing minimum");
    assert.ok(typeof q1.result.quoteId === "string" && typeof q1.result.validUntil === "string", "alias adds quoteId + validUntil");
    assert.ok(!JSON.stringify(q1.result).includes("0.00052\""), "internal ask not echoed");
    assert.ok(!/indicative/i.test(JSON.stringify(q1.result)), "no 'indicative' wording");
  }
  const none = await directQuote(null, { rigs: 1 });
  assert.ok(!none.ok && none.error === "pricing_unavailable" && /Price unavailable/.test(none.message), "no deps -> price unavailable");
  const stale = await qq({ rigs: 1 }, { pricing: async () => ({ ...PRICING, writtenAt: now - 37 * 3600_000 }) });
  assert.ok(!stale.ok && stale.error === "pricing_unavailable", "stale pricing -> price unavailable, no fallback formula");
  const nul = await qq({ rigs: 1 }, { pricing: async () => null });
  assert.ok(!nul.ok && nul.error === "pricing_unavailable");

  // ── 270 TH minimum, whole-rig steps with a note, caps
  const tiny = await qq({ ph: 1e-6, days: 1 });
  assert.ok(!tiny.ok && tiny.error === "below_minimum" && tiny.message.includes("270 TH minimum"));
  const r1 = await qq({ ph: 0.4, days: 1 });
  assert.ok(r1.ok && r1.result.rigs === 1 && /Rounded your 0.4 PH request to 1 whole rig/.test(String(r1.result.rounded ?? "")), "rounding must be stated");
  const r2 = await qq({ ph: 0.42, days: 1 });
  assert.ok(r2.ok && r2.result.rigs === 2 && r2.result.th === 540);
  const exact = await qq({ ph: 0.54 });
  assert.ok(exact.ok && exact.result.rounded === undefined, "no note when exact");
  const ten = await qq({ ph: 10, days: 1 });
  assert.ok(!ten.ok && ten.error === "above_maximum" && ten.message.includes(`${MAX_RIGS_PER_QUOTE} S21 XP`), "ph 10 must be capped at 4 rigs");
  const err = async (input: Record<string, unknown>, code: string) => { const q = await qq(input); assert.ok(!q.ok && q.error === code && !!q.supported, `${JSON.stringify(input)} -> ${JSON.stringify(q)}`); };
  await err({ rigs: 0 }, "below_minimum"); await err({ rigs: -1 }, "below_minimum"); await err({ rigs: 5 }, "above_maximum"); await err({ rigs: 31 }, "above_maximum");
  await err({ days: 0 }, "below_minimum"); await err({ days: 31 }, "above_maximum"); await err({ days: 1.5 }, "below_minimum"); await err({ ph: 0 }, "below_minimum"); await err({ ph: 1.3 }, "above_maximum");
  await err({ ph: 1e9 }, "above_maximum"); await err({ ph: "1e9" }, "above_maximum"); await err({ days: "1e3" }, "above_maximum");
  for (const days of [8, 30]) {
    const over = await qq({ rigs: 1, days });
    assert.ok(!over.ok && over.error === "above_maximum" && /1 to 7 days during the pilot/.test(over.message), `${days} days is above the pilot max`);
    assert.equal((over as unknown as { supported: { maxDays: number } }).supported.maxDays, 7);
  }
  const month = await qq({ rigs: 1, days: 30 }, { pilot: false });
  assert.ok(month.ok && month.result.days === 30, "pilot off: 30 days quotes");
  const week = await qq({ rigs: 1, days: 7 });
  assert.ok(week.ok && week.result.days === 7);
  const four = await qq({ rigs: 4 });
  assert.ok(four.ok && four.result.th === 1080 && four.result.days === 1, "default 1 day, 4 rigs ok");
  console.log("test-direct-rental: quote alias ok");
})().catch((e) => { console.error(e); process.exit(1); });

// ── blocked-term filter
// MRR-only (2026-10-17): the standalone marketplace name and its two exact referral URLs are exempt (test-mrr-only
// covers that); every other spelling, path, domain form and rig id still blocks.
assert.equal(blockedHit("Rent on MiningRigRentals"), undefined, "standalone marketplace name is exempt");
const bad = ["MRR", "mrr", "MiningRigRentals.com", "miningrigrentals", "MiningRigRentals/rigs", "xMiningRigRentals", "Mining Rig Rentals", SYNTH.host, SYNTH.hostSplit, `${SYNTH.place} #25`, SYNTH.place.toUpperCase(), "US-South", "US facility",
  "192.0.2.38", "fe80::1:2:3", "2001:db8:85a3:0:0:8a2e:370:7334", "rig_12345", "rig 370001", "389999", SYNTH.customer, "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "Еxampleland", "MR\u200BR", "Ａｃｍｅｈｏｓｔ Ｃｏ", "A\u200Dcmehost\u00ADCo",
  "Mining_Rig.Rentals", "mining-rig-rentals", "M.R.R", "Umbrel", "UMBREL node", "fe80::1", "::", "a::b", "ip ::1", "Εxαmplεland", "Ac\u0301mehost Co", "Exämpleland", "zzrеntеr"];
for (const b of bad) assert.throws(() => assertCustomerSafe({ note: b }), /blocked_output/, `filter missed ${JSON.stringify(b)}`);
assert.equal(normalizeForFilter("Тoledo\u200B"), "Toledo");
for (const ok of ["validUntil 10:58:13", "Rental::status", "Umbrella", "an umbrella policy", "Mr R. Jones", "Mr R", "std::vector", "Note:: see below", "2026-10-16T09:15:00.000Z", "S21 XP", "Rentals are closed in the Galaxy Mind Discord", "txid pending", "Mine to any pool you like, solo included."]) assert.equal(blockedHit(ok), undefined, `false positive ${ok}`);
for (const s of [QUOTE_TOOL_DESCRIPTION, MCP_RENT_WHEN, readFileSync("src/lib/hashrate-copy.ts", "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")]) {
  assert.ok(!/MiningRigRentals|Mining Rig Rentals|\bMRR\b|US-South|US facility/.test(s), "copy names the marketplace or a site");
}
assert.ok(QUOTE_TOOL_DESCRIPTION.includes("Identical to get_quote") && !/indicative/i.test(QUOTE_TOOL_DESCRIPTION));

// ── status projection drops PII
const st = sanitizeStatus({ miners: [{ label: "renterx Machine Alpha", online: true, ths: 50, workers: [{ online: true, best_difficulty: 5, last_seen: "2026-10-16T08:00:00Z", name: "renterx.w1" } as never] }], wallet: "bc1qsecretsecret", pool: "p" } as never);
assert.ok(!/renterx|bc1q|Alpha|pool/i.test(JSON.stringify(st)), "status leaks");

// ── rate-limit buckets: rotating IPv6 collapses to /48
assert.equal(rateLimitBucket("2a09:bac5:baea:28dc::412:4b"), rateLimitBucket("2a09:bac5:baea:741::b9:95"));
assert.equal(rateLimitBucket("2a09:bac5:baea:28dc::412:4b"), "2a09:bac5:baea::/48");
assert.equal(rateLimitBucket("::1"), "0:0:0::/48");
assert.equal(rateLimitBucket("203.0.113.9"), "203.0.113.9");
// ── rate-limit fallback caps at 100/min and resets
{
  let last = localLimit("t", 600, 0);
  for (let i = 1; i < 101; i++) last = localLimit("t", 600, 1);
  assert.equal(last.ok, false, "fallback must cap at 100/min");
  assert.equal(localLimit("t", 600, 61_000).ok, true, "window must reset");
}

(async () => {
  for (const b of ["short", "", "x".repeat(65), "bad code with spaces!!!!!!", "../../etc/passwd/aaaaaaaaaaaaa"]) {
    const r = await fetchRentalStatus(b, {});
    assert.ok(!r.ok && r.error === "invalid_code", `accepted ${b}`);
  }
  const code = "A".repeat(32);
  let hitUrl = "";
  const spy = (async (u: string) => { hitUrl = u; return new Response("{}", { status: 404 }); }) as unknown as typeof fetch;
  await fetchRentalStatus(code, {}, spy);
  assert.ok(hitUrl.startsWith("https://dec2mdw3kligqvsk.public.blob.vercel-storage.com/c/"), "default feed origin");
  const mk = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const nf = await fetchRentalStatus(code, {}, mk(404));
  assert.ok(!nf.ok && nf.error === "not_found");
  const up = await fetchRentalStatus(code, {}, mk(500));
  assert.ok(!up.ok && up.error === "upstream_unavailable");
  const ok = await fetchRentalStatus(code, {}, mk(200, { miners: [{ label: "S21 XP", online: true, ths: 270, wallet: "bc1qsecretsecret", pool: "x" }] }));
  assert.ok(ok.ok && ok.result.miners[0].rigType === "S21 XP");
  assert.doesNotThrow(() => assertCustomerSafe(ok.ok ? ok.result : {}));

  console.log("test-direct-rental: ok");
})().catch((e) => { console.error(e); process.exit(1); });

// ── shared limits (QA 2026-10-16): 4 rigs per order, 1 to 30 days (7 in the pilot), default 1
assert.equal(MAX_RIGS, 4); assert.equal(MAX_RIGS_PER_QUOTE, 4); assert.equal(MAX_DAYS, 30); assert.equal(DEFAULT_DAYS, 1);
assert.equal(MAX_PH, 1.08); assert.equal(RENTAL_LIMITS.maxPh, (RENTAL_LIMITS.maxRigs * RENTAL_LIMITS.rigTh) / 1000);
// ── pilot flag: one rule for quotes, createRental and the MCP schema
{
  for (const env of [{}, { RENTALS_PILOT: "1" }, { RENTALS_PILOT: "0" }, { RENTALS_PILOT: "" }] as Record<string, string>[]) {
    const days = maxDaysNow(env);
    assert.equal(days, pilotEnabled(env) ? PMD : MAX_DAYS, `maxDaysNow follows pilotEnabled for ${JSON.stringify(env)}`);
    assert.equal(maxHoursFor(env), days * 24, "hours cap = days cap");
    assert.equal(maxDaysFor({ pilot: pilotEnabled(env) } as Parameters<typeof maxDaysFor>[0]), days, "createRental's cap agrees with the quote's");
  }
  const rq = readFileSync("src/lib/rental-quote.ts", "utf8");
  assert.ok(/maxHoursFor\(env\)/.test(rq) && !/\bMAX_HOURS\b/.test(rq), "composeRentalQuote clamps to the pilot-tied cap");
  const bad = composeRentalQuote({} as Parameters<typeof composeRentalQuote>[0], undefined, Number.NaN, { RENTALS_PILOT: "0" });
  assert.ok(!bad.ok && /24 to 720 hours \(1 to 30 whole days\)/.test((bad as { supported: string[] }).supported[0]), "pilot off: supported says 1 to 30");
  const badOn = composeRentalQuote({} as Parameters<typeof composeRentalQuote>[0], undefined, Number.NaN, {});
  assert.ok(!badOn.ok && /24 to 168 hours \(1 to 7 whole days during the pilot\)/.test((badOn as { supported: string[] }).supported[0]), "pilot on: supported says 1 to 7");
  const mcpSrc = readFileSync("src/lib/rentals/phase2/mcp.ts", "utf8");
  assert.ok(/const capDays = maxDaysNow\(\)/.test(mcpSrc) && !/\.max\(PILOT_MAX_DAYS\)/.test(mcpSrc), "MCP day schema follows the pilot flag");
}
// ── closeTheSale never loops to /hashrate
{
  // Direct mode (RENTALS_MODE=direct). The MRR-only default is asserted just below and in test-mrr-only.
  const DIRECT = { RENTALS_MODE: "direct" };
  const mrrSale = closeTheSale({});
  assert.ok("url" in mrrSale && String(mrrSale.url) === "https://galaxymind.space/hashrate", "MRR-only default points at our own /hashrate (the marketplace profile is login-walled)");
  assert.doesNotThrow(() => assertCustomerSafe(mrrSale));
  const none = closeTheSale(DIRECT);
  assert.equal(none.how, FINISH_HOW); assert.ok(!("url" in none));
  // Live vs paused copy (kill switch): never "opens soon", always points at create_rental + terms.
  const open = closeTheSale(DIRECT, false), paused = closeTheSale(DIRECT, true);
  assert.equal(open.rentals, "open"); assert.equal(paused.rentals, "paused"); assert.ok(!("rentals" in none));
  for (const c of [none, open, paused]) {
    assert.ok(!/opens soon|never takes payment/i.test(JSON.stringify(c)), "no pre-launch copy");
    assert.equal(c.tool, "create_rental"); assert.equal(c.terms, "https://galaxymind.space/terms/rental");
    assert.doesNotThrow(() => assertCustomerSafe(c));
  }
  assert.match(open.how, /create_rental/); assert.match(open.how, /accept_terms=true/); assert.match(open.how, /terms_version/); assert.match(open.how, /x402/); assert.match(open.how, /USDC on Base/);
  assert.match(paused.how, /paused/i); assert.ok(!/Rentals are open/.test(paused.how));
  assert.ok(FINISH_PAUSED.includes("paused") && FINISH_OPEN.includes("x402-capable agent wallet"));
  for (const u of ["https://galaxymind.space/hashrate", "https://www.galaxymind.space/hashrate/", "http://discord.gg/x", "nope"]) assert.equal(rentUrl({ RENT_URL: u, DISCORD_RENT_URL: u }), null, u);
  assert.equal(rentUrl({ DISCORD_RENT_URL: "https://discord.gg/abc" }), "https://discord.gg/abc");
  assert.equal(rentUrl({ RENT_URL: "https://galaxymind.space/rent", DISCORD_RENT_URL: "https://discord.gg/abc" }), "https://galaxymind.space/rent");
  const route = readFileSync("src/app/api/mcp/[transport]/route.ts", "utf8");
  assert.ok(!/closeTheSale\(\)\.url\s*\?\?\s*`\$\{SITE\}\/hashrate`/.test(route), "tool errors must not fall back to bare /hashrate");
  assert.ok(!/\.max\(30\)|\.max\(365\)|Defaults to 30/.test(route.slice(route.indexOf('"get_rental_quote"'), route.indexOf('"rental_status"'))), "quote schema uses shared limits");
}
// ── third-party market: no floor/suggested, labelled
{
  const m = thirdPartyMarket({ floor: 0.00048, suggested: 0.0005018, medianAsk: 0.00052, clearedLast30: 0.0005 });
  assert.ok(m && !("floor" in m) && !("suggested" in m) && (m as Record<string, unknown>).medianAsk === 0.00052 && /not Galaxy Mind's price/.test(m.label));
  assert.equal(thirdPartyMarket(null), null);
  assert.doesNotThrow(() => assertCustomerSafe(m));
}
// ── raw input parsing: strings and fractions reach friendly errors
{
  assert.deepEqual(parseQuoteInput({ rigs: "2" }), { ok: true, input: { rigs: 2 } });
  const s = parseQuoteInput({ rigs: "two" }); assert.ok(!s.ok && s.error === "invalid_input");
  assert.ok(!parseQuoteInput({ days: "0x3" }).ok && !parseQuoteInput({ days: {} as never }).ok && !parseQuoteInput({ ph: "1e999" }).ok && !parseQuoteInput({ ph: " " }).ok && !parseQuoteInput({ ph: "-1" }).ok);
  const p = parseQuoteInput({ days: 1.5 }); assert.ok(p.ok);
}
// ── no copy points at Discord #rent
{
  const src = readFileSync("src/lib/rentals/index.ts", "utf8");
  assert.ok(!/Discord #rent bot issues|ask in the Discord #rent/.test(src), "stale Discord copy");
  const route = readFileSync("src/app/api/mcp/[transport]/route.ts", "utf8");
  assert.ok(!route.includes("rent-with-ai"), "no liveUrl fallback");
}
// ── /api/hashrate/quote runtime: the same directQuote, aggregate only
void (async () => {
  const deps = { deps: () => mkD(), env: { RENTALS_MODE: "direct" }, now };
  const scan = (body: unknown) => {
    const j = JSON.stringify(body);
    for (const re of [/\b3[78]\d{4}\b/, /miningrigrentals/i, /ref=/, /"ask[A-Za-z]*":/i, /askBtc/i, /rentUrl/]) assert.ok(!re.test(j), `quote API leaks ${re}: ${j}`);
    assert.ok(!leaksNeverReveal(j), `quote API leaks a never-reveal term: ${j}`);
  };
  for (const qs of ["", "rigs=2&days=3", "ph=1.08", "rigs=0", "rigs=5", "days=0", "days=8", "days=31", "days=1.5", "rigs=two", "machine=bogus", "hours=3"]) {
    const r = await buildDirectQuoteResponse(new URLSearchParams(qs), deps);
    scan(r.body);
    if (qs === "" || qs === "rigs=2&days=3" || qs === "ph=1.08" || qs === "machine=bogus" || qs === "hours=3") assert.equal(r.status, 200, `${qs} -> ${JSON.stringify(r.body)}`);
    else assert.equal(r.status, 400, `${qs} -> ${JSON.stringify(r.body)}`);
  }
  const ok = await buildDirectQuoteResponse(new URLSearchParams("rigs=2&days=3"), deps);
  const b = ok.body as { rigs: number; days: number; pricePerPhDayBtc: number };
  assert.ok(b.rigs === 2 && b.days === 3 && b.pricePerPhDayBtc >= 0.00051644, "floor holds on HTTP");
  const stale = await buildDirectQuoteResponse(new URLSearchParams(""), { ...deps, deps: () => mkD({ pricing: async () => null }) });
  assert.equal(stale.status, 503);
  const off = await buildDirectQuoteResponse(new URLSearchParams(""), { ...deps, deps: () => null });
  assert.equal(off.status, 503);
  const route = readFileSync("src/app/api/hashrate/quote/route.ts", "utf8");
  assert.ok(route.includes("buildDirectQuoteResponse") && !route.includes("composeRentalQuote"));
})().catch((e) => { console.error(e); process.exit(1); });
console.log("limits/freshness/closeTheSale/market/http ok");
