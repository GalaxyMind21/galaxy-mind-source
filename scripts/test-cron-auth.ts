// Admin and cron bearer auth (security audit 2026-10-18, M4 + L10). In-process, no network, no KV.
// Uses throwaway test secrets only; never reads the real ones.
for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const ADMIN = "test-admin-secret-0123456789abcdef";
const CRON = "test-cron-secret-fedcba9876543210";
let ipSeq = 0;
const req = (bearer: string | null, ip = `198.51.100.${(ipSeq++ % 250) + 1}`) =>
  new Request("https://galaxymind.space/api/cron/x", {
    headers: { ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }), "x-vercel-forwarded-for": ip },
  });

async function main() {
  const { verifyAdminAuth, verifyAdminAuthLimited, verifyCronAuth, verifyCronAuthLimited } = await import("../src/lib/cron-auth");

  console.log("admin auth");
  process.env.CRON_SECRET = CRON;
  delete process.env.ADMIN_SECRET;
  assert("ADMIN_SECRET unset: CRON_SECRET still opens admin (no break before it is set)", verifyAdminAuth(req(CRON)).ok);
  assert("ADMIN_SECRET unset: wrong bearer rejected", !verifyAdminAuth(req("nope")).ok);
  assert("ADMIN_SECRET unset: missing header rejected", !verifyAdminAuth(req(null)).ok);

  process.env.ADMIN_SECRET = "";
  assert("ADMIN_SECRET empty string counts as unset (cron fallback, documented)", verifyAdminAuth(req(CRON)).ok);
  assert("ADMIN_SECRET empty string: empty bearer rejected", !verifyAdminAuth(req("")).ok);

  process.env.ADMIN_SECRET = ADMIN;
  assert("ADMIN_SECRET set: admin bearer opens admin", verifyAdminAuth(req(ADMIN)).ok);
  assert("ADMIN_SECRET set: CRON_SECRET no longer opens admin", !verifyAdminAuth(req(CRON)).ok);
  assert("ADMIN_SECRET set: admin bearer with a suffix rejected", !verifyAdminAuth(req(ADMIN + "x")).ok);
  assert("ADMIN_SECRET set: admin prefix rejected", !verifyAdminAuth(req(ADMIN.slice(0, -1))).ok);
  const r401 = verifyAdminAuth(req(CRON));
  assert("rejection is a plain 401", !r401.ok && r401.response.status === 401);

  delete process.env.CRON_SECRET;
  assert("ADMIN_SECRET set, CRON_SECRET unset: admin still works", verifyAdminAuth(req(ADMIN)).ok);
  delete process.env.ADMIN_SECRET;
  assert("both unset: everything rejected", !verifyAdminAuth(req("")).ok && !verifyAdminAuth(req(null)).ok);

  console.log("cron auth");
  process.env.CRON_SECRET = CRON;
  process.env.ADMIN_SECRET = ADMIN;
  assert("cron bearer opens cron", verifyCronAuth(req(CRON)).ok);
  assert("admin bearer does not open cron", !verifyCronAuth(req(ADMIN)).ok);
  assert("limited: cron bearer opens cron", (await verifyCronAuthLimited(req(CRON))).ok);

  // Failure limiter (local fallback window, since KV is not configured here).
  const ip = "203.0.113.77";
  let lastHeaders: Headers | null = null;
  for (let i = 0; i < 20; i++) {
    const r = await verifyCronAuthLimited(req("guess-" + i, ip));
    if (r.ok) { assert("guess never passes", false); break; }
    lastHeaders = r.response.headers;
  }
  assert("first 20 failures: plain 401 without Retry-After", !!lastHeaders && !lastHeaders.get("retry-after"));
  const over = await verifyCronAuthLimited(req("guess-21", ip));
  assert("21st failure from one IP is throttled (401 + Retry-After)", !over.ok && over.response.status === 401 && !!over.response.headers.get("retry-after"));
  // Over the cap the IP is refused BEFORE the compare: even the correct bearer fails (review follow-up).
  const correctOver = await verifyCronAuthLimited(req(CRON, ip));
  assert("throttled IP: correct bearer is refused before compare (401 + Retry-After)", !correctOver.ok && correctOver.response.status === 401 && !!correctOver.response.headers.get("retry-after"));
  assert("the scheduler's correct bearer from its own IP still works", (await verifyCronAuthLimited(req(CRON, "203.0.113.79"))).ok);
  // Successes are never counted: 30 good calls from one IP stay open.
  const gip = "203.0.113.80";
  let allGood = true;
  for (let i = 0; i < 30; i++) allGood &&= (await verifyCronAuthLimited(req(CRON, gip))).ok;
  assert("30 successful calls from one IP are never throttled", allGood);
  const other = await verifyCronAuthLimited(req("guess", "203.0.113.78"));
  assert("another IP has its own bucket", !other.ok && !other.response.headers.get("retry-after"));

  // Admin limiter still throttles on its own bucket.
  const aip = "203.0.113.90";
  for (let i = 0; i < 20; i++) await verifyAdminAuthLimited(req("a" + i, aip));
  const aover = await verifyAdminAuthLimited(req("a21", aip));
  assert("admin limiter throttles after 20 failures", !aover.ok && !!aover.response.headers.get("retry-after"));
  process.env.ADMIN_SECRET = ADMIN;
  const aCorrect = await verifyAdminAuthLimited(req(ADMIN, aip));
  assert("admin: over-cap IP is refused even with the correct bearer", !aCorrect.ok && !!aCorrect.response.headers.get("retry-after"));
  assert("admin: correct bearer from a fresh IP works", (await verifyAdminAuthLimited(req(ADMIN, "203.0.113.91"))).ok);

  console.log("compare is skipped when over the cap");
  {
    const { rateLimitPeek } = await import("../src/lib/rate-limit");
    const pip = "203.0.113.92";
    const before = await rateLimitPeek(req(null, pip), { name: "cron-auth-fail", limit: 20, windowSec: 900 });
    assert("peek on a fresh IP is ok and does not count", before.ok);
    for (let i = 0; i < 20; i++) await verifyCronAuthLimited(req("p" + i, pip));
    const after = await rateLimitPeek(req(null, pip), { name: "cron-auth-fail", limit: 20, windowSec: 900 });
    assert("peek after 20 failures is blocked", !after.ok && !!after.headers["Retry-After"]);
    let evaluated = false;
    const probe = new Request("https://galaxymind.space/api/cron/x", { headers: { "x-vercel-forwarded-for": pip } });
    Object.defineProperty(probe, "headers", { value: new Proxy(probe.headers, { get(t, k) { const v = Reflect.get(t, k); if (k === "get") return (n: string) => { if (n.toLowerCase() === "authorization") evaluated = true; return t.get(n); }; return typeof v === "function" ? v.bind(t) : v; } }) });
    const r = await verifyCronAuthLimited(probe);
    assert("over-cap request never reads the Authorization header", !r.ok && !evaluated);
  }

  console.log("call sites");
  const root = join(__dirname, "..");
  const cronDir = join(root, "src/app/api/cron");
  const routes = readdirSync(cronDir).map((d) => join(cronDir, d, "route.ts")).filter(existsSync);
  routes.push(join(root, "src/app/api/indexnow-ping/route.ts"), join(root, "src/app/api/post-to-social/route.ts"));
  for (const f of routes) {
    const src = readFileSync(f, "utf8");
    if (!/cron-auth/.test(src)) continue; // routes with their own sha256 auth (sweep, test-order)
    const rel = f.slice(root.length + 1);
    assert(`${rel} uses verifyCronAuthLimited`, /await verifyCronAuthLimited\(/.test(src) && !/\bverifyCronAuth\(/.test(src));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
