// RENTALS_MODE=mrr_only (operator 2026-10-17). In-process, no network.
// Mode default, every closed direct-rental route = 410 with the exact marketplace link, access status reads stay,
// MCP tools in each mode, the narrow assertCustomerSafe exemption, the unit availability rule and staleness,
// and that rendered visible text (incl. alt/aria/title) never carries a rig id or a price.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { rentalsMode, mrrOnly, directRentalsClosedBody, marketplaceRedirect } from "../src/lib/rentals/mode";
import { assertCustomerSafe, closeTheSale } from "../src/lib/rentals";
import { MARKETPLACE_REGISTER_URL, MARKETPLACE_REFERRAL_NOTE } from "../src/lib/marketplace-listing";
import { RENT_PAGE_URL, RENT_UNITS_NOTE } from "../src/lib/rent-page";
import { XP_UNIT_IDS, isUnitFree, snapshotFrom, unitsView, unitHref, UNIT_HREF_RE, STALE_MS } from "../src/lib/mrr-units";
import type { MrrUnitState } from "../src/lib/mrr";
import { projectUnitState } from "../src/lib/mrr";
import { HashrateFunnel, roughOneIn } from "../src/app/hashrate/components/HashrateFunnel";
import { FUNNEL_COPY, funnelView as pickerView, MRR_FAQ_ALL } from "../src/app/hashrate/components/MrrHashrateContent";
import * as COPY from "../src/lib/mrr-page-copy";
import { RentalTermsBody } from "../src/components/RentalTermsBody";
import { checkUnitsModule, stripNamed, UNITS_FILE, BANNED_PROFILE_URL } from "./lib/no-mrr-mention";
import { useSyntheticNeverReveal, leaksNeverReveal, SYNTH } from "./lib/never-reveal-test";
useSyntheticNeverReveal();

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const safe = (x: unknown) => { try { assertCustomerSafe(x); return true; } catch { return false; } };

/** Visible text + every attribute value except href. */
function visible(html: string): string {
  const attrs = [...html.matchAll(/\s([a-zA-Z-:]+)="([^"]*)"/g)].filter((m) => m[1] !== "href").map((m) => m[2]);
  return html.replace(/<[^>]+>/g, " ") + "\n" + attrs.join("\n");
}
const RIG_ID = /\b3[78]\d{4}\b/;
const PRICE = /\$|\bUSD\b|\bBTC\b|\bsats?\b|\bprice\b|per\s+(day|hour)|\/\s*day/i;
const MODEL = /\bS21\b|\bXP\b|antminer|bitmain/i;

(async () => {
  console.log("── mode ─────────────────────────────────────────");
  assert("default (unset) = mrr_only", rentalsMode({}) === "mrr_only" && mrrOnly({}));
  assert("RENTALS_MODE=direct = direct", rentalsMode({ RENTALS_MODE: "direct" }) === "direct" && !mrrOnly({ RENTALS_MODE: " Direct " }));
  assert("unknown value = mrr_only (fail safe)", rentalsMode({ RENTALS_MODE: "open" }) === "mrr_only");
  const body = directRentalsClosedBody();
  assert("410 body: rentUrl is our /hashrate page + units note, no referral fields", body.rentUrl === "https://galaxymind.space/hashrate" && body.rentUrl === RENT_PAGE_URL && body.units === RENT_UNITS_NOTE && !("referral" in body) && !("note" in body) && body.error === "direct_rentals_closed");
  assert("410 body: no marketplace URL at all", !/miningrigrentals\.com|\/u\/GalaxyMind/i.test(JSON.stringify(body)));
  assert("closeTheSale in mrr_only = our /hashrate page, passes assertCustomerSafe", closeTheSale({}).url === RENT_PAGE_URL && safe(closeTheSale({})));
  assert("closeTheSale in direct keeps the old shape", "tool" in closeTheSale({ RENTALS_MODE: "direct" }));
  assert("marketplaceRedirect has no price field", !PRICE.test(JSON.stringify(marketplaceRedirect()).replace(MARKETPLACE_REFERRAL_NOTE, "")));

  console.log("── closed routes (410) ──────────────────────────");
  delete process.env.RENTALS_MODE;
  const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
  const post = (url: string, b: unknown) => req(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const p = { params: Promise.resolve({ ref: "x402_" + "0".repeat(32) }) };
  const routes: [string, () => Promise<Response>][] = [
    ["GET /api/rentals/quote", async () => (await import("../src/app/api/rentals/quote/route")).GET(req("/api/rentals/quote?rigs=1&days=1"))],
    ["POST /api/rentals/order", async () => (await import("../src/app/api/rentals/order/route")).POST(post("/api/rentals/order", {}))],
    ["GET /api/rentals/pay/[ref]", async () => (await import("../src/app/api/rentals/pay/[ref]/route")).GET(req("/x"), p)],
    ["POST /api/rentals/pay/[ref]", async () => (await import("../src/app/api/rentals/pay/[ref]/route")).POST(post("/x", {}), p)],
    ["POST /api/rentals/btc/bind", async () => (await import("../src/app/api/rentals/btc/bind/route")).POST(post("/x", {}))],
    ["POST /api/rentals/btc/status", async () => (await import("../src/app/api/rentals/btc/status/route")).POST(post("/x", {}))],
    ["POST /api/rentals/eth", async () => (await import("../src/app/api/rentals/eth/route")).POST(post("/x", {}))],
    ["POST /api/rentals/test-order", async () => (await import("../src/app/api/rentals/test-order/route")).POST(post("/x", {}))],
    ["GET /api/hashrate/quote", async () => (await import("../src/app/api/hashrate/quote/route")).GET(req("/api/hashrate/quote") as never)],
    ["POST /api/rentals/access {action:pay}", async () => (await import("../src/app/api/rentals/access/route")).POST(post("/x", { action: "pay", rental_id: "a", creator_secret: "b" }))],
    ["POST /api/rentals/access {action:cancel}", async () => (await import("../src/app/api/rentals/access/route")).POST(post("/x", { action: "cancel", rental_id: "a", creator_secret: "b" }))],
  ];
  for (const [name, call] of routes) {
    const r = await call();
    const j = await r.json().catch(() => ({}));
    assert(`${name} → 410 + exact rentUrl`, r.status === 410 && j.rentUrl === RENT_PAGE_URL && j.error === "direct_rentals_closed", `${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  }
  {
    // Hidden test-order route: 404 in direct mode too unless RENTALS_TEST_ORDER_ROUTE_ENABLED=1 (off by default).
    const prev = { m: process.env.RENTALS_MODE, p: process.env.RENTALS_PHASE2_ENABLED, t: process.env.RENTALS_TEST_ORDER_TOKEN };
    process.env.RENTALS_MODE = "direct"; process.env.RENTALS_PHASE2_ENABLED = "1"; process.env.RENTALS_TEST_ORDER_TOKEN = "t".repeat(40);
    try {
      const r = await (await import("../src/app/api/rentals/test-order/route")).POST(post("/x", {}));
      assert("test-order route is 404 while RENTALS_TEST_ORDER_ROUTE_ENABLED is unset", r.status === 404, String(r.status));
    } finally {
      for (const [k, v] of [["RENTALS_MODE", prev.m], ["RENTALS_PHASE2_ENABLED", prev.p], ["RENTALS_TEST_ORDER_TOKEN", prev.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }
  {
    const access = await import("../src/app/api/rentals/access/route");
    const r = await access.POST(post("/x", { access_code: "short" }));
    assert("access status read is NOT closed in mrr_only", r.status !== 410, String(r.status));
  }
  process.env.RENTALS_MODE = "direct";
  {
    const q = await (await import("../src/app/api/rentals/quote/route")).GET(req("/api/rentals/quote?rigs=1&days=1"));
    const o = await (await import("../src/app/api/rentals/order/route")).POST(post("/x", {}));
    assert("direct mode: quote/order keep their old behaviour (not 410)", q.status !== 410 && o.status !== 410, `${q.status} ${o.status}`);
  }
  delete process.env.RENTALS_MODE;

  console.log("── MCP ──────────────────────────────────────────");
  const route = await import("../src/app/api/mcp/[transport]/route");
  const rpc = async (method: string, params: unknown) => {
    const res = await route.POST(new Request("http://localhost/api/mcp/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
    return JSON.parse(line.replace(/^data: /, ""));
  };
  process.env.RENTALS_PHASE2_ENABLED = "1";
  process.env.RENTALS_PHASE2_MODE = "staging";
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert("serverInfo version 3.0.0", init.result?.serverInfo?.version === "3.0.0", JSON.stringify(init.result?.serverInfo));
    const names = ((await rpc("tools/list", {})).result?.tools ?? []).map((t: { name: string }) => t.name);
    assert("mrr_only: no create_rental / cancel_rental", !names.includes("create_rental") && !names.includes("cancel_rental"), names.join(","));
    assert("mrr_only: get_quote, get_rental_status, rental_status, get_rental_quote, list_available_rigs listed",
      ["get_quote", "get_rental_status", "rental_status", "get_rental_quote", "list_available_rigs"].every((n) => names.includes(n)));
    for (const tool of ["get_quote", "get_rental_quote", "list_available_rigs"]) {
      const out = await rpc("tools/call", { name: tool, arguments: tool === "list_available_rigs" ? {} : { rigs: 1, days: 1 } });
      const j = JSON.parse(out.result?.content?.[0]?.text ?? "{}");
      assert(`${tool} → marketplace redirect, no price`, j.rentUrl === RENT_PAGE_URL && j.closeTheSale?.url === RENT_PAGE_URL && !JSON.stringify(j).includes("/u/GalaxyMind") && !("totalBtc" in j) && !("bays" in j), JSON.stringify(j).slice(0, 160));
    }
    process.env.RENTALS_MODE = "direct";
    const dnames = ((await rpc("tools/list", {})).result?.tools ?? []).map((t: { name: string }) => t.name);
    assert("direct mode: create_rental and cancel_rental come back", dnames.includes("create_rental") && dnames.includes("cancel_rental"));
  } finally {
    delete process.env.RENTALS_MODE; delete process.env.RENTALS_PHASE2_ENABLED; delete process.env.RENTALS_PHASE2_MODE;
  }
  const sj = JSON.parse(readFileSync("server.json", "utf8"));
  assert("server.json 3.0.0, names the marketplace, ≤100 chars", sj.version === "3.0.0" && /MiningRigRentals/.test(sj.description) && sj.description.length <= 100);

  console.log("── assertCustomerSafe exemption ─────────────────");
  assert("passes: our /hashrate URL, register URL and name", safe({ url: RENT_PAGE_URL, s: MARKETPLACE_REGISTER_URL, how: "Rent on MiningRigRentals." }));
  const blocked: [string, unknown][] = [
    ["our login-walled profile URL (no longer exempt)", { u: BANNED_PROFILE_URL }],
    ["a rig link /rigs/<id>", { u: "https://www.miningrigrentals.com/rigs/940018?ref=2770797" }],
    ["a rig link with a non-fleet id", { u: "https://www.miningrigrentals.com/rigs/123456" }],
    ["another user's profile", { u: "https://www.miningrigrentals.com/u/Other?ref=2770797" }],
    ["our profile with another ref", { u: "https://www.miningrigrentals.com/u/GalaxyMind?ref=1234567" }],
    ["our profile without ref", { u: "https://www.miningrigrentals.com/u/GalaxyMind" }],
    ["the name inside a hostname", { u: "https://www.MiningRigRentals.com/u/Other" }],
    ["the bare marketplace domain", { u: "MiningRigRentals.com" }],
    ["the abbreviation", { s: "rent on MRR" }],
    ["a bare rig id", { s: "unit 940018" }],
    ["an IPv4", { s: "192.0.2.36" }],
    ["a customer name", { s: SYNTH.customer }],
    ["a location", { s: SYNTH.place }],
    ["the hosting company", { s: SYNTH.host }],
  ];
  for (const [n, x] of blocked) assert(`still blocked: ${n}`, !safe(x));
  assert("register URL + a rig link in one payload still blocked", !safe({ a: MARKETPLACE_REGISTER_URL, b: "/rigs/980438" }));

  console.log("── unit availability ────────────────────────────");
  const u = (id: string, o: Partial<MrrUnitState> = {}): MrrUnitState => ({ id, owner: "GalaxyMind", status: "available", rented: false, availableStatus: "available", online: true, measured15Th: 270, ...o });
  assert("30 unit ids, all 6 digits, unique", XP_UNIT_IDS.length === 30 && new Set(XP_UNIT_IDS).size === 30 && XP_UNIT_IDS.every((x) => /^\d{6}$/.test(x)));
  assert("other hardware is never a unit (Avalons, home miner, Z15s)", !["925852", "986205", "913977", "983432", "985808"].some((x) => XP_UNIT_IDS.includes(x)));
  assert("#27 (940018) is a normal free unit when available", isUnitFree(u("940018")));
  assert("free: available, online, hashing, ours", isUnitFree(u("980438")));
  assert("not free: set unavailable on the marketplace (available_status=disabled)", !isUnitFree(u("980438", { availableStatus: "disabled" })));
  assert("not free: status unavailable", !isUnitFree(u("980438", { status: "unavailable" })));
  assert("not free: rented", !isUnitFree(u("980438", { rented: true, status: "rented" })));
  assert("not free: offline", !isUnitFree(u("980438", { online: false })));
  assert("not free: not hashing", !isUnitFree(u("980438", { measured15Th: 0 })) && !isUnitFree(u("980438", { measured15Th: null })));
  assert("not free: another owner", !isUnitFree(u("980438", { owner: "Someone" })));
  assert("not free: not one of our units", !isUnitFree(u("925852")));
  const raw = { id: "940018", owner: "GalaxyMind", status: { status: "rented", rented: true }, available_status: "disabled", online: true, hashrate: { last_15min: { hash: "285090384.7", type: "mh" } }, price: { BTC: { price: "0.0001" } }, region: "us-x" };
  const proj = projectUnitState(raw);
  assert("projection keeps flags + measured TH, drops price/region", proj?.availableStatus === "disabled" && proj.rented && Math.round(proj.measured15Th ?? 0) === 285 && !("price" in (proj as object)) && !("region" in (proj as object)));
  const now = Date.UTC(2026, 9, 17, 15, 30);
  const snap = snapshotFrom([u("980438", { measured15Th: 250 }), u("914098", { measured15Th: 290 }), u("940018"), u("907634", { availableStatus: "disabled" }), u("911746", { rented: true, status: "rented" }), u("925852")], now);
  assert("snapshot: free units best-measured first, disabled/rented excluded", snap.free.length === 3 && snap.free[0] === unitHref("914098") && snap.free[1] === unitHref("940018") && snap.free[2] === unitHref("980438"), snap.free.join(","));
  assert("snapshot: every href is the exact referral rig link", snap.free.every((h) => UNIT_HREF_RE.test(h)));
  assert("snapshot: rented count", snap.rented === 1);
  let threw = false; try { unitHref("123456"); } catch { threw = true; }
  assert("unitHref refuses a non-unit id", threw);
  assert("view: fresh = live", unitsView(snap, now + 60_000).state === "live");
  assert("view: older than 15 min = stale (no counts, no buttons)", unitsView(snap, now + STALE_MS + 1).state === "stale");
  assert("view: from the future = stale", unitsView({ ...snap, at: now + 10 * 60_000 }, now).state === "stale");
  assert("view: no data = unavailable", unitsView(null, now).state === "unavailable");

  console.log("── rendered unit picker ─────────────────────────");
  const big = snapshotFrom(XP_UNIT_IDS.slice(0, 13).map((id, i) => u(id, { measured15Th: 300 - i })), now);
  const live = pickerView(unitsView(big, now));
  const render = (initialUnits: number, view = live, networkPhs: number | null = 900_000) => renderToStaticMarkup(
    <HashrateFunnel view={view} copy={FUNNEL_COPY} networkPhs={networkPhs} registerUrl={MARKETPLACE_REGISTER_URL} rel="noopener noreferrer" agentsHref="/hashrate/agents" initialUnits={initialUnits} />,
  );
  for (const n of [1, 3]) {
    const html = render(n);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const unitHrefs = [...html.matchAll(/<li[^>]*data-unit-row[\s\S]*?href="([^"]+)"/g)].map((m) => m[1]);
    assert(`N=${n}: exactly ${n} unit buttons, each an exact referral rig link`, unitHrefs.length === n && unitHrefs.every((h) => UNIT_HREF_RE.test(h)), unitHrefs.join(","));
    assert(`N=${n}: every /rigs/ href is an exact referral rig link`, hrefs.filter((h) => h.includes("/rigs/")).every((h) => UNIT_HREF_RE.test(h)));
    const primaries = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*data-primary-cta="(\w+)"/g)];
    assert(`N=${n}: hero, final and sticky CTAs all open Unit 1 and read "Rent hashrate on MiningRigRentals"`, primaries.length === 3 && primaries.every((m) => m[1] === unitHrefs[0]) && (html.match(/Rent hashrate on MiningRigRentals/g) ?? []).length >= 3);
    assert(`N=${n}: odds panel shows an estimate in 24 hours and 7 days`, html.includes("data-odds") && (html.match(/data-odds-value/g) ?? []).length === 2 && /Estimate for/.test(html) && /about 1 in/.test(html));
    assert(`N=${n}: one H1, the outcome headline`, (html.match(/<h1/g) ?? []).length === 1 && html.includes("Rent Bitcoin hashrate that mines to your own wallet"));
    assert(`N=${n}: agents get only a small link`, html.includes('href="/hashrate/agents"') && !/create_rental|x402|USDC|MCP/.test(visible(html)));
    assert(`N=${n}: labelled Unit 1..${n}`, Array.from({ length: n }, (_, i) => `Unit ${i + 1}`).every((l) => html.includes(l)));
    const vis = visible(html);
    assert(`N=${n}: no rig id in visible text, alt, aria or title`, !RIG_ID.test(vis), vis.match(RIG_ID)?.[0]);
    assert(`N=${n}: no price in visible text`, !PRICE.test(vis), vis.match(PRICE)?.[0]);
    assert(`N=${n}: no hardware model, no word "real"`, !MODEL.test(vis) && !/\breal\b/i.test(vis));
    assert(`N=${n}: live count shown (13 × 270 TH/s) and referral disclosed`, html.includes("13 × 270 TH/s available now") && html.includes(MARKETPLACE_REFERRAL_NOTE));
    assert(`N=${n}: chunk chips in 270 TH/s steps up to the free count`, html.includes(">270 TH/s<") && html.includes(">3.51 PH/s<") && !html.includes(">3.78 PH/s<"));
    assert(`N=${n}: register link with our ref`, hrefs.includes(MARKETPLACE_REGISTER_URL));
  }
  {
    // Desktop centering (operator 2026-10-17): hero card centers its contents from md up; mobile (<md) keeps
    // the left-aligned base classes, so no unprefixed text-center / mx-auto lands on the hero.
    const html = render(3);
    const cls = (re: RegExp) => re.exec(html)?.[1] ?? "";
    const card = cls(/<div class="([^"]*)" data-hero-card/), h1 = cls(/<h1 id="rent-hero-h" class="([^"]*)"/);
    const stepper = cls(/<div class="([^"]*)"><button type="button" aria-label="[^"]*"[^>]*>−/);
    const chips = cls(/<div class="([^"]*)" role="radiogroup"/);
    const row = cls(/<li class="([^"]*)" data-unit-row/);
    const has = (c: string, t: string) => c.split(/\s+/).includes(t);
    assert("hero: card centers text from md up, not on mobile", has(card, "md:text-center") && !has(card, "text-center"), card);
    assert("hero: H1, stepper centered (md:mx-auto), chips justify-center, unit rows stay left", has(h1, "md:mx-auto") && !has(h1, "mx-auto") && has(stepper, "md:mx-auto") && has(chips, "md:justify-center") && has(row, "md:text-left"), JSON.stringify({ h1, stepper, chips, row }));
  }
  {
    const o1 = /data-odds-value[^>]*>about 1 in ([\d,.]+)/.exec(render(1))?.[1], o3 = /data-odds-value[^>]*>about 1 in ([\d,.]+)/.exec(render(3))?.[1];
    assert("odds scale with N (3 units beat 1 unit) and round to two significant figures", !!o1 && !!o3 && Number(o3.replace(/,/g, "")) < Number(o1.replace(/,/g, "")) && roughOneIn(23_456) === "23,000", `${o1} vs ${o3}`);
    const noNet = render(1, live, null);
    assert("no network figure: no odds numbers, honest line instead", !noNet.includes("data-odds-value") && noNet.includes("not showing odds"));
  }
  {
    const html = render(1, { state: "stale" });
    const checkBack = (h: string) => h.includes("All rented right now. Check back soon.") && (h.match(/<button[^>]*disabled[^>]*data-primary-cta/g) ?? []).length === 3 && !/<a[^>]*data-primary-cta/.test(h) && h.includes("Check back soon<");
    assert("stale: no unit buttons, no count, check-back line + disabled CTAs, no profile link",
      !html.includes("/rigs/") && !/available now/.test(html) && checkBack(html) && !html.includes("/u/"), html.match(/data-fallback-line[^<]*<?[^<]*/)?.[0]);
    const z = render(1, { state: "live", at: now, free: [], freeCount: 0 });
    assert("zero free: check-back line + disabled CTAs, no unit buttons, no profile link", !z.includes("/rigs/") && checkBack(z) && !z.includes("/u/"));
    assert("zero free / stale: every marketplace link left carries our ref", [html, z].every((h) => [...h.matchAll(/href="(https:\/\/www\.miningrigrentals\.com[^"]*)"/g)].every((m) => m[1].includes("ref=2770797"))));
    const stale2 = render(1, pickerView(unitsView(big, now + STALE_MS + 5)));
    assert("a 15-min-old snapshot renders the fallback", !stale2.includes("/rigs/"));
  }

  console.log("── copy rules ───────────────────────────────────");
  const strings = Object.values(COPY).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" ? [x] : Object.values(x as object) as string[])) : [])).concat(MRR_FAQ_ALL.flatMap((f) => [f.q, f.a]));
  const joined = strings.join("\n");
  assert("MRR copy: no hardware model", !MODEL.test(joined), joined.match(MODEL)?.[0]);
  assert("MRR copy: never the word 'real'", !/\breal\b/i.test(joined));
  assert("MRR copy: no price figure or currency", !/\$|\bUSD\b|\bBTC\b|\bsats?\b|per\s+(day|hour)/i.test(joined), joined.match(/\$|\bUSD\b|\bBTC\b|\bsats?\b|per\s+(day|hour)/i)?.[0]);
  assert("MRR copy: no rig id, no location beyond US-based", !RIG_ID.test(joined) && !/us-?south|facility/i.test(joined) && !leaksNeverReveal(joined));
  assert("MRR copy: hashrate leads the H1", /^Rent Bitcoin hashrate/.test(COPY.MRR_PAGE_H1));

  console.log("── terms banner ─────────────────────────────────");
  const t = renderToStaticMarkup(<RentalTermsBody closed />);
  assert("terms: 'Direct rentals closed October 17, 2026' banner", t.includes("Direct rentals closed October 17, 2026") && t.includes("data-terms-closed-banner"));
  assert("terms: no banner in direct mode", !renderToStaticMarkup(<RentalTermsBody closed={false} />).includes("data-terms-closed-banner"));

  console.log("── gate negatives ───────────────────────────────");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  const unitsSrc = strip(readFileSync(UNITS_FILE, "utf8"));
  assert("real mrr-units.ts passes checkUnitsModule", checkUnitsModule(unitsSrc).length === 0, checkUnitsModule(unitsSrc).join("; "));
  assert("units module: a second URL fails", checkUnitsModule(unitsSrc + '\nconst X = "https://www.miningrigrentals.com/u/GalaxyMind";').length > 0);
  assert("units module: another ref fails", checkUnitsModule(unitsSrc.replace('"?ref=2770797"', '"?ref=1234567"')).length > 0);
  assert("units module: marketplace copy in a string fails", checkUnitsModule(unitsSrc + '\nconst Y = "Rent on MiningRigRentals";').length > 0);
  assert("units module: a price string fails", checkUnitsModule(unitsSrc + '\nconst Z = "price per day";').length > 0);
  assert("named files: a rig link survives stripNamed (BAD still sees it)", /\/rigs\/\d{4,}/.test(stripNamed(`MiningRigRentals ${MARKETPLACE_REGISTER_URL} https://www.miningrigrentals.com/rigs/980438`)));
  assert("named files: another profile survives stripNamed", /miningrigrentals/i.test(stripNamed("https://www.miningrigrentals.com/u/Other")));
  assert("named files: our login-walled profile survives stripNamed", /miningrigrentals/i.test(stripNamed(BANNED_PROFILE_URL)));
  assert("named files: the allowed strings are removed", !/miningrigrentals|ref=/i.test(stripNamed(`Rent on MiningRigRentals: ${MARKETPLACE_REGISTER_URL}.`)));

  console.log("── no named pool in public copy (operator 2026-10-17: not affiliated with any pool) ──");
  {
    // Everything under src/ and public/ ships to customers except the phase2 backend pool catalogs
    // (gm-pools.mjs, pools-catalog.json), which only validate a renter's own choice in direct mode.
    const BACKEND = /^src\/lib\/rentals\/phase2\/(gm-pools\.mjs|pools-catalog\.json|validate\.ts)$/;
    const TEXT = /\.(tsx?|mjs|js|json|txt|md|html|xml)$/;
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
    const files = [...walk("src"), ...walk("public"), "scripts/update-mrr-listings.ts"].filter((f) => TEXT.test(f) && !BACKEND.test(f));
    const hits = files.filter((f) => /ckpool/i.test(readFileSync(f, "utf8")));
    assert(`no "ckpool" in ${files.length} public source files`, hits.length === 0, hits.join(", "));
    assert("guard scans the hashrate copy and llms.txt", files.includes("src/lib/hashrate-copy.ts") && files.includes("public/llms.txt"));
    const H = readFileSync("src/lib/hashrate-copy.ts", "utf8") + readFileSync("public/llms.txt", "utf8") + readFileSync("src/lib/agent-connect-copy.ts", "utf8");
    assert("no specific pool recommended in hashrate copy, agent prompts or llms.txt", !/\b(ocean|braiins|f2pool|antpool|viabtc|luxor|foundry)\b/i.test(H));
    assert("no 'Solo catches' section on /hashrate", !/SOLO_CATCHES|Solo catches/.test(readFileSync("src/app/hashrate/HashrateContent.tsx", "utf8") + H));
    assert("status strip has no solo-blocks feed", !/solo-blocks/.test(readFileSync("src/app/hashrate/components/DeskStatusStrip.tsx", "utf8")));
    const visibleHtml = renderToStaticMarkup(<RentalTermsBody />);
    assert("terms render names no pool", !/ckpool/i.test(visibleHtml));
  }

  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
