// Box-only SQL test of supabase/migrations/20261017200000_phase2_bay_availability.sql on PGlite (Postgres 16, WASM).
// Not in `npm run verify` (PGlite isn't a repo dependency). Run: node scripts/sqltest/test-bay-availability-pglite.mjs <dir containing node_modules/@electric-sql/pglite>
// Payloads are the EXACT AVAIL1 shape sent by the staged node rental-poller (AVAIL1 r2, the review-PASSed rev: REVIEW-PASS b56f4f4d, poller 654dc6a8):
//   select public.rental_report_bay_availability($1::jsonb) with {"v":1,"seq":<ms>,"bays":[{"bay","free","reason","mrr_rented_until"}x4]}
import { readFileSync } from "node:fs"; import { join } from "node:path"; import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(join(process.argv[2], "node_modules/@electric-sql/pglite/dist/index.js")).href);
const db = new PGlite();
let PASS = 0, FAIL = 0; const check = (n, c) => { if (c) { PASS++; console.log("PASS " + n); } else { FAIL++; console.log("FAIL " + n); } };
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role gm_node nologin;
  create table public.rental_orders (id uuid primary key default gen_random_uuid(), state text not null, bays text);
  create table public.rental_refunds (id serial primary key, reason text not null, constraint rental_refunds_reason_check check (reason in ('underpaid','overpaid','late','duplicate','cap_exceeded','delivery_failed','kill_switch','cancelled','expired_unapplied')));`);
const STATUS_COL = readFileSync("supabase/migrations/20261016120000_phase2_rentals_staging.sql", "utf8").match(/status text not null default '[^']+' check \(status in \([^)]*\)\)/)[0];
const OLD_PENDING = STATUS_COL.match(/default '([^']+)'/)[1];
await db.exec(`alter table public.rental_refunds add column ${STATUS_COL}`);
const mig = readFileSync("supabase/migrations/20261017200000_phase2_bay_availability.sql", "utf8").replace(/^set local lock_timeout[^\n]*\n/m, "");
await db.exec(mig);
const err = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return String(e.message); } };
// Exactly what rental-poller.mjs builds (line ~887): JSON.stringify({ v: 1, seq, bays: rows }), rows = {bay, free, reason, mrr_rented_until}.
const row = (bay, reason = "ok", until = null) => ({ bay, free: reason === "ok", reason, mrr_rented_until: until });
const avail1 = (seq, rows = [1, 2, 3, 4].map((b) => row(b))) => JSON.stringify({ v: 1, seq, bays: rows });
const as = async (role, sql, params) => { await db.exec(`set role ${role}`); try { return await err(sql, params); } finally { await db.exec("reset role"); } };
const report = (d) => as("gm_node", "select public.rental_report_bay_availability($1::jsonb)", [d]);
const free = async () => { await db.exec("set role service_role"); try { return (await db.query("select * from public.rental_free_bays()")).rows.map((r) => Object.values(r)[0]).join(","); } finally { await db.exec("reset role"); } };
const fresh = async () => { await db.exec("set role service_role"); try { return (await db.query("select bay, free, fresh, mrr_rented_until from public.rental_bay_availability_read()")).rows; } finally { await db.exec("reset role"); } };
const SEQ = Date.now();
check("no reports yet: nothing free (fail closed)", (await free()) === "");
check("AVAIL1 payload accepted from gm_node (4 ok bays)", (await report(avail1(SEQ))) === null && (await free()) === "1,2,3,4");
check("replayed seq refused while fresh (avail_stale_seq)", /avail_stale_seq/.test(await report(avail1(SEQ))));
check("older seq refused while fresh", /avail_stale_seq/.test(await report(avail1(SEQ - 1))));
const until3h = new Date(Date.now() + 3 * 3600e3).toISOString();
check("mixed AVAIL1 report: mrr_rented keeps its hint, direct_active not free", (await report(avail1(SEQ + 1, [row(1), row(2, "mrr_rented", until3h), row(3, "direct_active"), row(4)]))) === null
  && (await free()) === "1,4" && (await fresh()).find((r) => r.bay === 2).mrr_rented_until !== null);
check("v:2 refused (avail_bad_version)", /avail_bad_version/.test(await report(JSON.stringify({ v: 2, seq: SEQ + 2, bays: [row(1)] }))));
check("missing v refused", /avail_bad_version/.test(await report(JSON.stringify({ seq: SEQ + 2, bays: [row(1)] }))));
check("string seq refused (avail_bad_seq)", /avail_bad_seq/.test(await report(JSON.stringify({ v: 1, seq: String(SEQ + 2), bays: [row(1)] }))));
check("array form (old #109 contract) refused (avail_bad_doc)", /avail_bad_doc/.test(await report(JSON.stringify([{ ...row(1), seq: SEQ + 2 }]))));
check("free/reason mismatch refused", /avail_free_mismatch/.test(await report(avail1(SEQ + 2, [{ bay: 1, free: true, reason: "killed", mrr_rented_until: null }]))));
check("unknown reason refused", /avail_bad_reason/.test(await report(avail1(SEQ + 2, [{ bay: 1, free: false, reason: "nope", mrr_rented_until: null }]))));
check("duplicate bay refused", /avail_dup_bay/.test(await report(avail1(SEQ + 2, [row(1), row(1)]))));
check("bay 65 refused", /avail_bad_bay/.test(await report(avail1(SEQ + 2, [row(65)]))));
check("empty bays refused", /avail_bad_bays/.test(await report(avail1(SEQ + 2, []))));
// S2: mrr_rented_until never fails the report; kept only for mrr_rented, future, <= 90 days.
const r2 = await report(avail1(SEQ + 3, [row(1, "mrr_rented", "not a date"), row(2, "mrr_rented", new Date(Date.now() - 3600e3).toISOString()), row(3, "mrr_rented", new Date(Date.now() + 91 * 86400e3).toISOString()), row(4, "killed", until3h)]));
const f2 = await fresh();
check("S2: bad / past / >90 d / non-rented until -> stored null, report still accepted", r2 === null && f2.every((r) => r.mrr_rented_until === null));
check("S2: a non-string non-null until is refused (avail_bad_until)", /avail_bad_until/.test(await report(avail1(SEQ + 4, [{ bay: 1, free: false, reason: "mrr_rented", mrr_rented_until: 12345 }]))));
check("client reported_at ignored (server clock)", (await report(JSON.stringify({ v: 1, seq: SEQ + 5, reported_at: "2000-01-01T00:00:00Z", bays: [{ ...row(1), reported_at: "2000-01-01T00:00:00Z" }] }))) === null
  && (await db.query("select reported_at > now() - interval '5 seconds' as ok from public.rental_bay_availability where bay = 1")).rows[0].ok === true);
await db.exec("update public.rental_bay_availability set reported_at = now() - interval '181 seconds'");
check("181 s old: nothing free", (await free()) === "" && (await fresh()).every((r) => r.fresh === false));
await db.exec("update public.rental_bay_availability set reported_at = now() - interval '301 seconds'");
check("older seq accepted once the stored report is > 300 s old (clock stepped back)", (await report(avail1(5))) === null && (await free()) === "1,2,3,4");
for (const r of ["anon", "authenticated"]) {
  const a = await as(r, "select * from public.rental_free_bays()"), b = await as(r, "select * from public.rental_bay_availability"), c = await as(r, "select public.rental_report_bay_availability($1::jsonb)", [avail1(SEQ + 99)]), d = await as(r, "select * from public.rental_bay_availability_read()");
  check(`${r}: no reader, no table, no writer`, [a, b, c, d].every((x) => /permission denied/.test(x || "")));
}
{
  const a = await as("gm_node", "select * from public.rental_free_bays()"), b = await as("gm_node", "select * from public.rental_bay_availability"), c = await as("gm_node", "update public.rental_bay_availability set free = true");
  check("gm_node: writer only (no readers, no table)", [a, b, c].every((x) => /permission denied/.test(x || "")));
  const s1 = await as("service_role", "select public.rental_report_bay_availability($1::jsonb)", [avail1(SEQ + 100)]), s2 = await as("service_role", "select * from public.rental_bay_availability");
  check("service_role: no writer, no direct table access", [s1, s2].every((x) => /permission denied/.test(x || "")));
}
const secdef = (await db.query("select proname, prosecdef, proconfig from pg_proc where proname in ('rental_report_bay_availability','rental_free_bays','rental_bay_availability_read') order by 1")).rows;
check("3 functions SECURITY DEFINER with search_path=''", secdef.length === 3 && secdef.every((r) => r.prosecdef && (r.proconfig || []).some((c) => c === 'search_path=""' || c === "search_path=''")));
// Overlap trigger (states must equal COMMITTED_STATES: paid, delivering, active).
await db.exec("insert into public.rental_orders (state, bays) values ('delivering','1'), ('delivering','2'), ('completed','3')");
check("trigger: overlapping bays on a committed order -> cap_exceeded", /cap_exceeded/.test(await err("update public.rental_orders set bays = '1' where bays = '2'")));
check("trigger: a bay held only by a non-committed order can be reused", (await err("update public.rental_orders set bays = '3' where bays = '2'")) === null);
check("refund reason bay_unavailable allowed", (await err("insert into public.rental_refunds (reason) values ('bay_unavailable')")) === null);
// Rollback refuses while bay_unavailable refunds exist, then runs clean.
const rb = readFileSync("supabase/rollback/20261017200000_phase2_bay_availability_rollback.sql", "utf8").replace(/^set local lock_timeout[^\n]*\n/m, "");
check("rollback refuses with bay_unavailable refunds", /bay_unavailable refunds exist/.test((await (async () => { try { await db.exec(rb); return ""; } catch (e) { return String(e.message); } })())));
await db.exec("delete from public.rental_refunds");
check("rollback runs clean", (await (async () => { try { await db.exec(rb); return true; } catch { return false; } })()) && (await db.query("select to_regclass('public.rental_bay_availability') as t")).rows[0].t === null);
console.log(`PASS=${PASS} FAIL=${FAIL}`); process.exit(FAIL ? 1 : 0);
