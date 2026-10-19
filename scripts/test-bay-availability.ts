// B7 bay availability gate. STAGING ONLY, in-memory store.
// G1 quote/board, G2 create, G3 pay re-check before any facilitator call, G4 settle assigns fresh-free bays only,
// bay_taken_mrr swap-or-refund (refund rows stay pending_owner, never auto-sent), gate off = old behaviour,
// and source asserts for the migration (grants, SECURITY DEFINER, search_path, RLS) and the wiring.
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { MemoryStore, type BayReason } from "../src/lib/rentals/phase2/store";
import { MockProvider } from "../src/lib/rentals/phase2/providers";
import { MockAlerter } from "../src/lib/rentals/phase2/safety";
import * as svc from "../src/lib/rentals/phase2/service";
import { RENTAL_TERMS_VERSION } from "../src/lib/rentals/phase2/terms";
import { X402Provider, BASE_SEPOLIA } from "../src/lib/rentals/phase2/x402";
import { requestOutcome, payOutcome, PAY_ERROR_COPY, ORDER_ERROR_COPY } from "../src/lib/rentals/phase2/human-wallet";
import { checkoutView } from "../src/lib/rentals/phase2/human";
import { backInLabel } from "../src/app/hashrate/components/BayBoard";

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const T0 = Date.parse("2026-10-17T15:00:00Z");
const PRICING = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 };
const base = { th: 270, days: 1, pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "renter.w1", accept_terms: true, terms_version: RENTAL_TERMS_VERSION };
const idem = () => crypto.randomBytes(12).toString("hex");
const ON = { RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging", RENTALS_HUMAN_CHECKOUT: "1" };

function mk(over: Partial<svc.Deps> = {}) {
  let now = T0;
  const x = new MockProvider("x402_usdc");
  const store = new MemoryStore();
  store.dbNow = () => now;
  const alerter = new MockAlerter();
  const d: svc.Deps = { store, providers: { x402_usdc: x }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
    signingKeyPem: PRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), killSwitch: async () => false, alerter, lightningEnabled: false, pilot: true,
    bays: [1, 2, 3, 4], availGate: true, ...over };
  const report = (rows: [number, BayReason, number?][]) => {
    for (const [bay, reason, until] of rows) {
      store.bayReports = store.bayReports.filter((r) => r.bay !== bay);
      store.bayReports.push({ bay, free: reason === "ok", reason, mrrRentedUntil: until ?? null, reportedAt: now });
    }
  };
  return { d, x, store, alerter, report, tick: (ms: number) => { now += ms; } };
}
type M = ReturnType<typeof mk>;
async function paid(m: M, rigs = 1) {
  const c = await svc.createRental(m.d, { ...base, th: 270 * rigs, idempotency_key: idem() });
  assert.ok(c.ok, JSON.stringify(c));
  const r = (c as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
  const ref = r.payment.paymentRef;
  m.x.simulatePay(ref, m.store.bindings.get(ref)!.expectedAtomic, m.d.now());
  const out = await svc.confirmPayment(m.d, ref);
  return { r, ref, outcome: out.outcome, order: async () => (await m.store.getOrderByPublicId(r.rentalId))! };
}
const errOf = (x: unknown) => (x as { error?: string }).error;

(async () => {
  // ── G1: 2 fresh-free, 1 committed -> 1 available ─────────────────────────
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"], [3, "mrr_rented", T0 + 5 * 3600_000], [4, "mrr_offline"]]);
    assert.deepEqual(await svc.freeBaysFresh(m.d), [1, 2]);
    const p = await paid(m);
    assert.equal(p.outcome, "settled");
    assert.equal((await p.order()).bays, "1", "G4: settle assigns a fresh-free bay");
    const b = await svc.bayBoard(m.d);
    assert.equal(b.available, 1, "G1: 2 fresh-free - 1 committed = 1");
    assert.deepEqual(b.bays.map((x) => x.state), ["rented", "open", "rented", "unavailable"]);
    assert.equal(b.bays[2].backAt, new Date(T0 + 5 * 3600_000).toISOString(), "marketplace-rented bay carries its back-at time");
    assert.equal(backInLabel(b.bays[2].backAt, T0), "Back in ~5 h");
    assert.equal(backInLabel(undefined, T0), null);
    assert.ok((await svc.getQuote(m.d, { rigs: 1, days: 1 })).ok, "G1: 1 rig quotes");
    const q2 = await svc.getQuote(m.d, { rigs: 2, days: 1 });
    assert.equal(errOf(q2), "no_capacity", "G1: 2 rigs -> no_capacity");
    assert.equal((q2 as { available?: number }).available, 1);
    const c2 = await svc.createRental(m.d, { ...base, th: 540, idempotency_key: idem() });
    assert.equal(errOf(c2), "no_capacity", "G2: create refused");
    console.log("G1/G2/G4 ok");
  }

  // #107 SF8 x B7: with the gate on, rigs held by a BTC binding waiting for confirmations are not sold again (G1/G2).
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"]]);
    const c = await svc.createRental(m.d, { ...base, idempotency_key: idem() });
    assert.ok(c.ok, JSON.stringify(c));
    const o = (await m.store.getOrderByPublicId((c as unknown as { result: { rentalId: string } }).result.rentalId))!;
    m.tick(svc.PAY_TTL_MS + 60_000);
    m.report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"]]);
    assert.ok((await svc.getQuote(m.d, { rigs: 4, days: 1 })).ok, "no BTC hold: 4 rigs quote (USDC soft hold expired)");
    const held = { ...m.d, btc: { store: { listBindings: async () => [{ orderId: o.id, status: "seen", displayOkAt: 1 }] } } } as unknown as svc.Deps;
    const q = await svc.getQuote(held, { rigs: 4, days: 1 }) as { error?: string; available?: number };
    assert.equal(q.error, "no_capacity", "BTC-held rig is not offered again");
    assert.equal(q.available, 3);
    console.log("btc hold x gate ok");
  }
  // ── stale rows -> 0 + no_capacity; read error -> 0 ────────────────────────
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"]]);
    assert.equal((await svc.bayBoard(m.d)).available, 4);
    m.tick(181_000);
    assert.deepEqual(await svc.freeBaysFresh(m.d), [], "rows older than 180 s are not free");
    assert.equal((await svc.bayBoard(m.d)).available, 0);
    assert.equal(errOf(await svc.getQuote(m.d, { rigs: 1, days: 1 })), "no_capacity", "stale -> no_capacity");
    assert.equal(errOf(await svc.createRental(m.d, { ...base, idempotency_key: idem() })), "no_capacity");
    m.report([[1, "ok"]]);
    assert.deepEqual(await svc.freeBaysFresh(m.d), [1]);
    m.store.bayReadFails = true;
    assert.deepEqual(await svc.freeBaysFresh(m.d), [], "read error fails closed");
    assert.equal((await svc.bayBoard(m.d)).available, 0);
    assert.equal(errOf(await svc.getQuote(m.d, { rigs: 1, days: 1 })), "no_capacity", "read error -> no_capacity");
    // checkoutView reports the gate and the gated free count.
    m.store.bayReadFails = false;
    const v = await checkoutView(ON, m.d);
    assert.ok(v.open && v.availGate === true && v.freeRigs === 1, JSON.stringify(v).slice(0, 200));
    console.log("stale/read-error ok");
  }
  // ── grid shows only configured bays; gate off keeps the old behaviour ─────
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"], [5, "ok"], [6, "ok"], [7, "ok"], [8, "ok"]]);
    const b = await svc.bayBoard(m.d);
    assert.equal(b.total, 4, "reports for unconfigured bays never show");
    assert.deepEqual(b.bays.map((x) => x.bay), [1, 2, 3, 4]);
    const off = mk({ availGate: false });
    off.store.bayReadFails = true; // never read while the gate is off
    assert.deepEqual(await svc.freeBaysFresh(off.d), [1, 2, 3, 4], "gate off: the allowlist");
    assert.equal((await svc.bayBoard(off.d)).available, 4);
    assert.ok((await svc.getQuote(off.d, { rigs: 4, days: 1 })).ok, "gate off: quotes as before");
    const p = await paid(off);
    assert.equal(p.outcome, "settled");
    assert.equal(await svc.payCapacity(off.d, p.ref), "ok", "gate off: payCapacity always ok");
    const v = await checkoutView(ON, off.d);
    assert.ok(v.open && v.availGate === false);
    console.log("grid/gate-off ok");
  }
  // ── G3: refused before ANY facilitator call; re-checked right before /settle ──
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"]]);
    const calls: string[] = [];
    let flipOnVerify = false;
    const from = "0x" + "11".repeat(20);
    const f = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/verify")) { if (flipOnVerify) m.report([[1, "mrr_rented"], [2, "mrr_rented"]]); return new Response(JSON.stringify({ isValid: true, payer: from })); }
      if (String(url).endsWith("/settle")) return new Response(JSON.stringify({ success: true, transaction: "0x" + "ab".repeat(32), network: BASE_SEPOLIA.network, payer: from }));
      return new Response(JSON.stringify({ result: "0x14a34" }));
    }) as unknown as typeof fetch;
    const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store: m.store, fetchImpl: f, now: () => m.d.now(), rpcDeadlineMs: 0, sleep: async () => {} });
    m.d.providers = { x402_usdc: xp };
    xp.setCapacityGuard(async (ref) => (await svc.payCapacity(m.d, ref)) === "ok");
    const c = await svc.createRental(m.d, { ...base, idempotency_key: idem() });
    assert.ok(c.ok, JSON.stringify(c));
    const cr = (c as unknown as { result: { payment: { paymentRef: string; http402: { amount: string } } } }).result;
    const ref = cr.payment.paymentRef;
    assert.equal((await xp.requestStatus(ref)).status, 402, "free bays: payable");
    const pr = await xp.paymentRequired(ref);
    const nowS = Math.floor(m.d.now() / 1000);
    const payload = { x402Version: 2 as const, accepted: pr!.accepts[0] as Record<string, unknown>,
      payload: { signature: "0x" + "cd".repeat(65), authorization: { from, to: PINNED_PAYTO, value: cr.payment.http402.amount, validAfter: String(nowS - 10), validBefore: String(nowS + 600), nonce: "0x" + "ef".repeat(32) } } };
    // Both bays taken on the marketplace after the quote.
    m.report([[1, "mrr_rented"], [2, "mrr_rented"]]);
    const st = await xp.requestStatus(ref);
    assert.deepEqual([st.status, (st.body as { error?: string }).error], [409, "no_capacity"], "GET: 409 no_capacity");
    assert.equal(errOf(await xp.pay(ref, payload)), "no_capacity", "POST: no_capacity");
    assert.equal(calls.length, 0, "G3: no facilitator verify/settle and no RPC before the capacity check");
    assert.equal((await m.store.getOrder((await m.store.getBinding(ref))!.orderId))!.state, "awaiting_payment", "order stays payable for a retry");
    // Read error = no capacity (fail closed), still no call.
    m.report([[1, "ok"], [2, "ok"]]); m.store.bayReadFails = true;
    assert.equal(errOf(await xp.pay(ref, payload)), "no_capacity");
    assert.equal(calls.length, 0);
    m.store.bayReadFails = false;
    // Taken between verify and settle: the pre-settle guard stops it, /settle is never called.
    flipOnVerify = true;
    assert.equal(errOf(await xp.pay(ref, payload)), "no_capacity", "pre-settle re-check");
    assert.ok(calls.some((u) => u.endsWith("/verify")), "verify ran");
    assert.ok(!calls.some((u) => u.endsWith("/settle")), "G3: /settle never called once the bays are gone");
    assert.equal(await m.store.getSettlement(ref), null, "no money recorded");
    console.log("G3 ok");
  }
  // ── bay_taken_mrr: one substitution (same pool + payment, no refund), then refund ──
  {
    const m = mk();
    m.report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"]]);
    const p = await paid(m);
    const o1 = await p.order();
    assert.equal(o1.bays, "1");
    const j1 = m.store.jobs.filter((j) => j.payload.order_ref === p.r.rentalId && j.payload.action === "route")[0];
    // Node: bay 1 was rented on the marketplace before it could switch it.
    m.report([[1, "mrr_rented", T0 + 3 * 3600_000]]);
    await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: p.r.rentalId, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.d.now() });
    m.tick(60_000);
    assert.equal(await svc.reofferOrExpire(m.d, o1), "reoffered", "substituted once");
    const o2 = await p.order();
    assert.equal(o2.state, "delivering");
    assert.equal(o2.bays, "2", "a fresh-free bay that no committed order holds");
    const routes = m.store.jobs.filter((j) => j.payload.order_ref === p.r.rentalId && j.payload.action === "route");
    assert.equal(routes.length, 2);
    const j2 = routes[1];
    assert.equal(j2.payload.bays, "2");
    assert.deepEqual(j2.payload.payment, j1.payload.payment, "same payment (ref, amount, tx_hash, network)");
    assert.ok(j1.payload.upstream && j1.payload.upstream.host === "stratum.braiins.com", "route carries the pool");
    assert.deepEqual(j2.payload.upstream, j1.payload.upstream, "same pool");
    assert.equal(j2.payload.pay_to, j1.payload.pay_to);
    assert.equal(j2.payload.end - j2.payload.start, j1.payload.end - j1.payload.start, "same paid duration, window shifted");
    assert.equal(m.store.refunds.length, 0, "no refund on a successful swap");
    assert.ok(m.store.alerts.some((a) => a.kind === "bay_substituted"));
    // Second take: refund, never a second swap.
    m.report([[2, "mrr_rented"]]);
    await m.store.recordResult({ jobId: j2.payload.job_id, orderRef: p.r.rentalId, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.d.now() });
    assert.equal(await svc.reofferOrExpire(m.d, o2), "bay_unavailable");
    const o3 = await p.order();
    assert.equal(o3.state, "failed");
    assert.equal(m.store.refunds.length, 1, "exactly one refund");
    const rf = m.store.refunds[0];
    assert.deepEqual([rf.reason, rf.status, rf.atomic, rf.network], ["bay_unavailable", "pending_owner", Number(j1.payload.payment!.amount_atomic), j1.payload.payment!.network], "full refund, pending_owner (sent manually)");
    assert.ok(m.store.alerts.some((a) => a.kind === "bay_unavailable"));
    assert.ok(m.store.jobs.some((j) => j.payload.order_ref === p.r.rentalId && j.payload.action === "revert"), "safety revert job");
    assert.equal(await svc.reofferOrExpire(m.d, o3), "none", "nothing more once failed");
    assert.equal(m.store.refunds.length, 1, "still one refund");
    const g = await svc.getRentalStatus(m.d, { rental_id: p.r.rentalId, creator_secret: p.r.creatorSecret });
    assert.match(JSON.stringify(g), /full refund is queued and will be sent manually/i, "status note");
    console.log("bay_taken_mrr swap + refund ok");
  }
  {
    // No free bay to swap to: refund on the first take.
    const m = mk();
    m.report([[1, "ok"], [2, "mrr_rented"], [3, "mrr_disabled"], [4, "node_hold"]]);
    const p = await paid(m);
    const j1 = m.store.jobs.find((j) => j.payload.order_ref === p.r.rentalId && j.payload.action === "route")!;
    m.report([[1, "mrr_rented"]]);
    await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: p.r.rentalId, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.d.now() });
    assert.equal(await svc.reofferOrExpire(m.d, await p.order()), "bay_unavailable");
    assert.equal(m.store.refunds.length, 1);
    assert.equal(m.store.refunds[0].status, "pending_owner");
    // Past the 10-minute substitution window: refund even with a free bay.
    const m2 = mk();
    m2.report([[1, "ok"], [2, "ok"]]);
    const p2 = await paid(m2);
    const k1 = m2.store.jobs.find((j) => j.payload.order_ref === p2.r.rentalId && j.payload.action === "route")!;
    await m2.store.recordResult({ jobId: k1.payload.job_id, orderRef: p2.r.rentalId, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m2.d.now() });
    m2.tick(11 * 60_000); m2.report([[1, "mrr_rented"], [2, "ok"]]);
    assert.equal(await svc.reofferOrExpire(m2.d, await p2.order()), "bay_unavailable", "outside the window: refund");
    assert.equal(m2.store.refunds.length, 1);
    // A bay substitution never overlaps a committed order (memory store mirrors the SQL trigger).
    const m3 = mk();
    m3.report([[1, "ok"], [2, "ok"]]);
    const a = await paid(m3), b = await paid(m3);
    assert.deepEqual([(await a.order()).bays, (await b.order()).bays], ["1", "2"]);
    const { CapExceeded } = await import("../src/lib/rentals/phase2/store");
    const ob = await b.order();
    await assert.rejects(m3.store.commit({ order: { id: ob.id, fromVersion: ob.version, patch: { bays: "1" } } }), (e: unknown) => e instanceof CapExceeded);
    // S3: with the gate OFF a bay_taken_mrr is refunded directly (no blind swap to an allowlist bay).
    const m4 = mk({ availGate: false });
    const p4 = await paid(m4);
    const q1 = m4.store.jobs.find((j) => j.payload.order_ref === p4.r.rentalId && j.payload.action === "route")!;
    await m4.store.recordResult({ jobId: q1.payload.job_id, orderRef: p4.r.rentalId, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m4.d.now() });
    assert.equal(await svc.reofferOrExpire(m4.d, await p4.order()), "bay_unavailable", "gate off: refund, never a swap");
    assert.equal(m4.store.jobs.filter((j) => j.payload.order_ref === p4.r.rentalId && j.payload.action === "route").length, 1, "gate off: no second route job");
    assert.deepEqual(m4.store.refunds.map((r) => [r.reason, r.status]), [["bay_unavailable", "pending_owner"]]);
    console.log("no-free-bay / window / overlap / gate-off ok");
  }
  // ── checkout + routes + wiring ───────────────────────────────────────────
  {
    assert.equal(requestOutcome(409, { error: "no_capacity" }), "no_capacity");
    assert.equal(requestOutcome(409, { error: "order_not_payable" }), "order_closed");
    assert.deepEqual(payOutcome(409, { error: "no_capacity" }), { kind: "refused", code: "no_capacity" }, "POST 409: refused, nothing charged, order stays payable");
    assert.equal(PAY_ERROR_COPY.no_capacity.charged, "no");
    assert.match(ORDER_ERROR_COPY.no_capacity, /fewer rigs/);
    const rc = readFileSync("src/app/hashrate/rent/RentCheckout.tsx", "utf8");
    assert.match(rc, /gate \? \[\{ label: "Checking your rigs are still free" \}\]/, "ring: G3 step when the gate is on");
    assert.match(rc, /if \(gate\) setPhase\("checking"\)/);
    const route = readFileSync("src/app/api/rentals/pay/[ref]/route.ts", "utf8");
    assert.match(route, /r\.error === "no_capacity"\) return j\(409/, "pay route: no_capacity -> 409");
    const staging = readFileSync("src/lib/rentals/phase2/staging.ts", "utf8");
    assert.match(staging, /availGate: env\.RENTALS_AVAIL_GATE === "1"/, "gate is env-only, off unless =1");
    assert.match(staging, /setCapacityGuard\(async \(ref\) => \(await payCapacity\(deps, ref\)\) === "ok"\)/);
    // rail_unavailable stays main's rail-agnostic text (no BTC/ETH named); funnel outcome is allow-listed client-side.
    const ln1 = await svc.createRental(mk().d, { ...base, idempotency_key: idem(), rail: "lightning" } as never);
    assert.equal((ln1 as { message?: string }).message, "That payment rail is not available. Pay with USDC on Base (rail x402_usdc).");
    assert.doesNotMatch(staging, /solanaRail/, "no solanaRail wiring (main's rail_unavailable copy)");
    assert.match(rc, /track\("rental_paid", funnelProps\(\{/, "rental_paid props go through the allow-list");
    console.log("checkout/routes/wiring ok");
  }
  // ── migration + rollback source asserts ──────────────────────────────────
  {
    const sql = readFileSync("supabase/migrations/20261017200000_phase2_bay_availability.sql", "utf8");
    const rb = readFileSync("supabase/rollback/20261017200000_phase2_bay_availability_rollback.sql", "utf8");
    assert.match(sql, /alter table public\.rental_bay_availability enable row level security/i, "RLS on");
    assert.match(sql, /revoke all on (table )?public\.rental_bay_availability from public, anon, authenticated/i);
    for (const fn of ["rental_report_bay_availability", "rental_bay_availability_read", "rental_free_bays"]) {
      const def = sql.slice(sql.indexOf(`function public.${fn}(`));
      assert.match(def.slice(0, 600), /security definer/i, `${fn}: SECURITY DEFINER`);
      assert.match(def.slice(0, 600), /set search_path = ''/i, `${fn}: empty search_path`);
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`, "i"), `${fn}: revoked from anon/authenticated`);
    }
    assert.match(sql, /grant execute on function public\.rental_report_bay_availability\(jsonb\) to gm_node/i, "writer: gm_node only");
    assert.match(sql, /revoke all on function public\.rental_report_bay_availability\(jsonb\) from service_role/i, "writer: not service_role (Supabase default privileges)");
    assert.match(sql, /revoke all on table public\.rental_bay_availability from service_role/i, "no direct table access for service_role");
    assert.ok(!/grant execute on function public\.rental_report_bay_availability\(jsonb\) to [^;]*(service_role|anon|authenticated)/i.test(sql));
    assert.match(sql, /grant execute on function public\.rental_bay_availability_read\(int\) to service_role/i);
    assert.match(sql, /grant execute on function public\.rental_free_bays\(int\) to service_role/i);
    assert.ok(!/grant execute on function public\.rental_(bay_availability_read|free_bays)\([^)]*\) to [^;]*gm_node/i.test(sql), "readers: not gm_node");
    assert.match(sql, /values \(v_bay, v_free, v_reason, v_until, now\(\), v_seq\)/, "reported_at is the DB clock, never client-supplied");
    // B1: the AVAIL1 contract (AVAIL1 r2, the review-PASSed rev: REVIEW-PASS b56f4f4d, poller 654dc6a8, staged): one object {v:1, seq, bays:[{bay, free, reason, mrr_rented_until}]}.
    const AVAIL1_DOC = { v: 1, seq: 1760713200000, bays: [1, 2, 3, 4].map((bay) => ({ bay, free: bay !== 2, reason: bay === 2 ? "mrr_rented" : "ok", mrr_rented_until: bay === 2 ? "2026-10-17T18:00:00.000Z" : null })) };
    assert.match(sql, /create function public\.rental_report_bay_availability\(p_doc jsonb\)/, "writer takes the AVAIL1 document");
    assert.match(sql, /perform pg_advisory_xact_lock\(hashtext\('rental_bay_availability'\)\);\s*\n\s*-- Out-of-order[^\n]*\n\s*select max\(seq\)/, "N2: writer lock taken before the seq read");
    assert.match(sql, /jsonb_typeof\(p_doc\) <> 'object' then raise exception 'avail_bad_doc'/, "an object, not an array");
    assert.match(sql, /\(p_doc->>'v'\) is distinct from '1' then raise exception 'avail_bad_version'/, "v must be 1");
    assert.match(sql, /v_seq <= v_last_seq and v_last_at > now\(\) - interval '300 seconds' then raise exception 'avail_stale_seq'/, "seq replay guard while the stored report is < 300 s old");
    const docKeys = Object.keys(AVAIL1_DOC).sort().join(","), rowKeys = Object.keys(AVAIL1_DOC.bays[0]).sort().join(",");
    assert.equal(docKeys, "bays,seq,v");
    assert.equal(rowKeys, "bay,free,mrr_rented_until,reason");
    for (const k of ["p_doc->>'v'", "p_doc->'seq'", "p_doc->'bays'"]) assert.ok(sql.includes(k), `writer reads ${k}`);
    for (const k of ["e->'bay'", "e->'free'", "e->>'reason'", "e->'mrr_rented_until'"]) assert.ok(sql.includes(k), `writer reads ${k}`);
    // S2: the until hint never fails the report (parse errors -> null; only mrr_rented, future, <= 90 days).
    assert.match(sql, /begin v_until := \(e->>'mrr_rented_until'\)::timestamptz; exception when others then v_until := null; end;/);
    assert.match(sql, /if v_reason <> 'mrr_rented' or v_until < now\(\) or v_until > now\(\) \+ interval '90 days' then v_until := null; end if;/);
    // S6: the overlap trigger's committed states equal COMMITTED_STATES (both occurrences in the trigger body).
    const { COMMITTED_STATES } = await import("../src/lib/rentals/phase2/store");
    const trig = sql.slice(sql.indexOf("function public.rental_orders_bays_guard()"), sql.indexOf("create trigger rental_orders_bays_guard"));
    const lists = [...trig.matchAll(/state in \(([^)]*)\)/g)].map((m) => m[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort().join(","));
    assert.equal(lists.length, 2, "trigger has two state lists");
    for (const l of lists) assert.equal(l, [...COMMITTED_STATES].sort().join(","), "trigger states == COMMITTED_STATES");
    assert.match(sql, /'bay_unavailable'/);
    assert.match(sql, /create trigger rental_orders_bays_guard before update of bays on public\.rental_orders/i);
    assert.match(rb, /drop table if exists public\.rental_bay_availability/i);
    assert.match(rb, /drop trigger if exists rental_orders_bays_guard/i);
    assert.match(rb, /bay_unavailable/);
    console.log("migration source ok");
  }
  console.log("test-bay-availability: all paths ok");
})().catch((e) => { console.error(e); process.exit(1); });
