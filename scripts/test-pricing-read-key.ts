// pricing_daily read path + the L4 revoke migration (security audit 2026-10-18). In-process, no network.
// Throwaway test keys only.
import "./lib/server-only-stub"; // first: pricing-read-key is marked server-only
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pricingReadCreds } from "../src/lib/rentals/phase2/pricing-read-key";
import { loadPricingDaily } from "../src/lib/rentals/phase2/pricing";
import { loadBtcPricingRows } from "../src/lib/rentals/phase2/btc/quote";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const root = join(__dirname, "..");

async function main() {
  console.log("pricing read creds");
  const U = "https://pricing.example.supabase.co", O = "https://other.example.supabase.co";
  assert("no URL → null", pricingReadCreds({ RENTALS_SUPABASE_KEY: "anon" }) === null);
  assert("http URL → null", pricingReadCreds({ RENTALS_SUPABASE_URL: "http://x", RENTALS_SUPABASE_KEY: "anon" }) === null);
  assert("URL, no key → null", pricingReadCreds({ RENTALS_SUPABASE_URL: U }) === null);
  assert("anon only → anon (until the revoke lands)", pricingReadCreds({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon" })?.source === "anon");
  const own = pricingReadCreds({ RENTALS_SUPABASE_URL: U + "/", RENTALS_SUPABASE_KEY: "anon", RENTALS_SUPABASE_SERVICE_KEY: "svc", RENTALS_PHASE2_SUPABASE_URL: U, RENTALS_PHASE2_SUPABASE_SERVICE_KEY: "p2" });
  assert("dedicated service key wins", own?.source === "service" && own.key === "svc" && own.url === U);
  const p2 = pricingReadCreds({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon", RENTALS_PHASE2_SUPABASE_URL: U.toUpperCase() + "/", RENTALS_PHASE2_SUPABASE_SERVICE_KEY: "p2" });
  assert("phase2 service key used when it is the same project", p2?.source === "phase2_service" && p2.key === "p2");
  const mism = pricingReadCreds({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon", RENTALS_PHASE2_SUPABASE_URL: O, RENTALS_PHASE2_SUPABASE_SERVICE_KEY: "p2" });
  assert("phase2 key is never sent to a different project", mism?.source === "anon" && mism.key === "anon");
  const rd = pricingReadCreds({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon", RENTALS_SUPABASE_SERVICE_KEY: "svc", RENTALS_PRICING_READ_KEY: " reader " });
  assert("narrow pricing_reader key wins over the service key", rd?.source === "reader" && rd.key === "reader");
  assert("phase2 key without a matching URL and no anon → null", pricingReadCreds({ RENTALS_SUPABASE_URL: U, RENTALS_PHASE2_SUPABASE_SERVICE_KEY: "p2" }) === null);

  console.log("loaders use the server key");
  const seen: string[] = [];
  const fk = (rows: unknown) => (async (u: string | URL | Request, init?: RequestInit) => {
    seen.push(String((init?.headers as Record<string, string>)?.apikey ?? ""));
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  const env = { RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon", RENTALS_SUPABASE_SERVICE_KEY: "svc" };
  await loadPricingDaily(env, fk([{ mrr_ask_btc_ph_day: "0.00052", floor_btc_ph_day: "0.000501", hashprice_sats_th_day: "47", written_at: "2026-10-16T09:00:00Z" }]));
  await loadBtcPricingRows(env, fk([]));
  assert("loadPricingDaily + loadBtcPricingRows send the service key, not anon", seen.length === 2 && seen.every((k) => k === "svc"), JSON.stringify(seen));
  const denied = (async () => new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 401 })) as unknown as typeof fetch;
  assert("anon after the revoke → loadPricingDaily fails closed", (await loadPricingDaily({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon" }, denied)) === null);
  assert("anon after the revoke → loadBtcPricingRows fails closed", (await loadBtcPricingRows({ RENTALS_SUPABASE_URL: U, RENTALS_SUPABASE_KEY: "anon" }, denied)) === null);

  console.log("migration is permissions and policies only");
  const strip = (s: string) => s.replace(/--.*$/gm, "").trim();
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const migRaw = strip(readFileSync(join(root, "supabase/migrations/20261019030000_pricing_daily_revoke_anon_select.sql"), "utf8"));
  const mig = norm(migRaw);
  for (const want of [
    "set local lock_timeout = '5s';",
    "drop policy if exists pricing_daily_read on public.pricing_daily;",
    "revoke select on table public.pricing_daily from anon, authenticated;",
    "grant select on table public.pricing_daily to service_role;",
    "create role pricing_reader nologin noinherit;",
    "grant pricing_reader to authenticator;",
    "grant select on table public.pricing_daily to pricing_reader;",
    "create policy pricing_daily_read_server on public.pricing_daily for select to pricing_reader using (true);",
  ]) assert(`migration has: ${want}`, mig.includes(want));
  assert("migration drops the open policy before anything re-grants", mig.indexOf("drop policy if exists pricing_daily_read on") < mig.indexOf("grant select on table public.pricing_daily to pricing_reader"));
  assert("no data change, no column/table change, no grant to anon/authenticated/public",
    !/\b(insert|update|delete|truncate|alter table|drop table|upsert_pricing_daily)\b/.test(mig) && !/grant [^;]* to (anon|authenticated|public)\b/.test(mig));
  assert("the only grants are SELECT on pricing_daily, schema usage and role membership",
    [...mig.matchAll(/\bgrant ([^;]*);/g)].every((m) => /^select on table public\.pricing_daily to (service_role|pricing_reader)$|^usage on schema public to pricing_reader$|^pricing_reader to authenticator$/.test(m[1])), mig);
  const rb = norm(strip(readFileSync(join(root, "supabase/rollback/20261019030000_pricing_daily_revoke_anon_select_rollback.sql"), "utf8")));
  assert("rollback re-grants anon/authenticated SELECT and restores the open policy",
    rb.includes("grant select on table public.pricing_daily to anon, authenticated;") && rb.includes("create policy pricing_daily_read on public.pricing_daily for select to public using (true);"));
  assert("rollback removes pricing_reader and touches no data", rb.includes("drop role pricing_reader;") && !/\b(insert|update|delete|truncate|alter table|drop table)\b/.test(rb));

  console.log("server-only marker");
  const keySrc = readFileSync(join(root, "src/lib/rentals/phase2/pricing-read-key.ts"), "utf8");
  assert("pricing-read-key.ts imports server-only", /^import "server-only";$/m.test(keySrc));
  for (const f of ["src/lib/rentals/phase2/pricing.ts", "src/lib/rentals/phase2/btc/quote.ts"]) {
    const src = readFileSync(join(root, f), "utf8");
    assert(`${f} loads pricing-read-key lazily (no static import)`, !/^import [^;]*pricing-read-key/m.test(src) && /await import\("\.{1,2}\/(\.\.\/)?pricing-read-key"\)/.test(src));
  }

  console.log("no public client path reads pricing_daily");
  const files = execFileSync("git", ["ls-files", "src"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /\.(t|j)sx?$/.test(f));
  const clientHits: string[] = [];
  for (const f of files) {
    const s = readFileSync(join(root, f), "utf8");
    const isClient = /^\s*["']use client["']/m.test(s.slice(0, 400));
    if (isClient && (/pricing_daily|pricing-read-key|RENTALS_SUPABASE/.test(s))) clientHits.push(f);
    if (/NEXT_PUBLIC_[A-Z_]*SUPABASE/.test(s)) clientHits.push(`${f} (NEXT_PUBLIC supabase env)`);
  }
  assert("no 'use client' file touches pricing_daily or its keys, and no NEXT_PUBLIC Supabase env", clientHits.length === 0, clientHits.join(", "));
  const readers = files.filter((f) => /rest\/v1\/pricing_daily/.test(readFileSync(join(root, f), "utf8")));
  assert("only the two server loaders read pricing_daily over REST", JSON.stringify(readers.sort()) === JSON.stringify(["src/lib/rentals/phase2/btc/quote.ts", "src/lib/rentals/phase2/pricing.ts"]), readers.join(", "));
  for (const f of readers) assert(`${f} reads with pricingReadCreds`, /pricingReadCreds\(env\)/.test(readFileSync(join(root, f), "utf8")) && !/env\.RENTALS_SUPABASE_KEY/.test(readFileSync(join(root, f), "utf8")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
