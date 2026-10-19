// Proxy + routing hardening (security audit 2026-10-18: L1 malformed paths, L3 vercel.app host, L9 CSP upgrade).
// In-process, no network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { malformedPath } from "../src/lib/proxy-guards";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const root = join(__dirname, "..");

async function main() {
  console.log("malformed percent-encoding → 400");
  for (const p of ["/v/%ff", "/spend-bitcoin-in/%ff", "/treasuries/%ff", "/chop/card/%ff", "/bitcoin-kart/card/%ff", "/api/badge/vendor/%ff%fe", "/v/%", "/v/%e0%a4%a"]) {
    assert(`${p} is malformed`, malformedPath(p));
  }
  for (const p of ["/", "/v/club-orange", "/v/caf%C3%A9", "/es/spend-bitcoin-in-latin-america", "/api/vendors.json", "/v/a%20b"]) {
    assert(`${p} is fine`, !malformedPath(p));
  }

  // Run the real proxy on a malformed request and a normal one.
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../src/proxy");
  const bad = proxy(new NextRequest("https://galaxymind.space/v/%ff"));
  assert("proxy answers 400 for /v/%ff", bad.status === 400 && (await bad.text()) === "Bad Request");
  const ok = proxy(new NextRequest("https://galaxymind.space/v/club-orange"));
  assert("proxy passes a normal path with a nonce CSP", ok.status === 200 && /'nonce-/.test(ok.headers.get("content-security-policy") ?? ""));

  console.log("CSP upgrade-insecure-requests (production only)");
  const proxySrc = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const spreads = (proxySrc.match(/\.\.\.UPGRADE_INSECURE,/g) ?? []).length;
  assert("all five policies (site + kart + six deep + chop + super saylor) carry it", spreads === 5, String(spreads));
  const guardSrc = readFileSync(join(root, "src/lib/proxy-guards.ts"), "utf8");
  assert("gated on NODE_ENV === production", /process\.env\.NODE_ENV === "production" \? \["upgrade-insecure-requests"\] : \[\]/.test(guardSrc));
  assert("proxy.ts exports only proxy + config", !/export (function|const) (?!proxy\b|config\b)/.test(proxySrc));

  console.log("galaxy-mind.vercel.app → apex");
  const nextSrc = readFileSync(join(root, "next.config.ts"), "utf8");
  const block = nextSrc.slice(nextSrc.indexOf('value: "galaxy-mind.vercel.app"') - 200, nextSrc.indexOf('value: "galaxy-mind.vercel.app"') + 200);
  assert("exact-host redirect exists", /has: \[\{ type: "host", value: "galaxy-mind\.vercel\.app" \}\]/.test(nextSrc));
  assert("308 to https://galaxymind.space, /api/* excluded (cron does not follow redirects)",
    /source: "\/:path\(\(\?!api\/\)\.\*\)"/.test(block) && /destination: "https:\/\/galaxymind\.space\/:path"/.test(block) && /permanent: true/.test(block));
  const re = /^\/(?!api\/).*$/;
  assert("pattern sends pages, keeps /api/cron", re.test("/hashrate") && re.test("/") && !re.test("/api/cron/monitor-vendors"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
