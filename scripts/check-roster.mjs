#!/usr/bin/env node
/**
 * Roster smoke check. The listing ids live in server-only env (GALAXY_MIND_RIG_IDS, GALAXY_MIND_XP_UNIT_IDS); a missing
 * or malformed value doesn't fail the build, it shows an empty /hashrate. This catches that.
 *
 *   node scripts/check-roster.mjs --url https://galaxymind.space   after a production deploy: /api/hashrate must list
 *                                                                  at least --min rigs (default 1)
 *   node scripts/check-roster.mjs --env                            the current env parses to a non-empty roster and
 *                                                                  unit list (same rules as src/lib/fleet-ids.ts)
 *
 * Prints counts only, never an id. Exit 0 = ok, 1 = empty or unreadable, 2 = usage.
 */
const ID = /^\d{6}$/;
export function countIds(raw) {
  const seen = new Set();
  for (const part of String(raw ?? "").split(",")) {
    const id = (part.split("=")[0] ?? "").trim();
    if (ID.test(id)) seen.add(id);
  }
  return seen.size;
}
export function apiRigCount(body) {
  return body && Array.isArray(body.ourRigs) ? body.ourRigs.length : -1;
}

async function main(argv) {
  const mi = argv.indexOf("--min");
  const minRaw = mi >= 0 ? Number(argv[mi + 1]) : 1;
  const min = Number.isInteger(minRaw) && minRaw > 0 ? minRaw : 1;
  if (argv.includes("--env")) {
    const rigs = countIds(process.env.GALAXY_MIND_RIG_IDS), units = countIds(process.env.GALAXY_MIND_XP_UNIT_IDS);
    console.log(`roster env: ${rigs} rig ids, ${units} unit ids`);
    return rigs > 0 && units > 0 ? 0 : 1;
  }
  const i = argv.indexOf("--url");
  if (i < 0 || !argv[i + 1]) { console.error("usage: check-roster.mjs --url <base> [--min N] | --env"); return 2; }
  const url = new URL("/api/hashrate", argv[i + 1]);
  url.searchParams.set("roster_check", String(Date.now())); // skip any cached copy
  let n = -1;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    n = r.ok ? apiRigCount(await r.json()) : -1;
    if (!r.ok) console.error(`roster check: HTTP ${r.status}`);
  } catch (e) { console.error(`roster check: fetch failed (${e?.name ?? "error"})`); }
  console.log(`roster live: ${n < 0 ? "unreadable" : `${n} rigs`} (min ${min})`);
  return n >= min ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).then((c) => process.exit(c));
