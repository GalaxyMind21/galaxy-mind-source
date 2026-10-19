// GET /api/admin/chop-stats · operator-only CHOP gameplay report.
//
// Reads the anonymous event list written by /api/chop/stats and answers
// the questions the operator actually asked: how are people playing it,
// and for how long. Everything here is computed at read time from bucketed
// events — nothing is pre-aggregated, so adding a question costs no KV.
//
// Auth · ADMIN_SECRET (or CRON_SECRET) bearer, same gate as cron-health.
//
//   curl -H "Authorization: Bearer $ADMIN_SECRET" \
//     https://galaxymind.space/api/admin/chop-stats
//   ...?days=7   (default 14, max 60)
import { NextResponse } from "next/server";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { kvList, isKvConfigured } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEY = "gm:chop:events:v1";
const READ = 5000;

type Ev = {
  k?: string; d?: string; touch?: boolean; returning?: boolean;
  diff?: string | null; band?: string | null; out?: string | null;
  grade?: string | null; sec?: number | null; hits?: number | null;
  miss?: number | null; acc?: number | null; combo?: number | null;
  tut?: boolean; guide?: boolean; bombs?: number | null; fin?: number | null;
};

function tally(vals: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vals) if (v) out[v] = (out[v] || 0) + 1;
  return out;
}
function stats(vals: (number | null | undefined)[]) {
  const ns = vals.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (!ns.length) return null;
  const at = (p: number) => ns[Math.min(ns.length - 1, Math.floor(ns.length * p))];
  return {
    n: ns.length,
    median: at(0.5),
    p25: at(0.25),
    p75: at(0.75),
    mean: Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10,
  };
}

export async function GET(request: Request) {
  const auth = await verifyAdminAuthLimited(request);
  if (!auth.ok) return auth.response;

  if (!isKvConfigured()) {
    return NextResponse.json({ ok: true, configured: false, note: "KV unset · telemetry is a no-op" });
  }

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days")) || 14));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const all = await kvList<Ev>(KEY, READ);
  const evs = all.filter((e) => (e.d || "") >= cutoff);
  const boots = evs.filter((e) => e.k === "boot");
  const runs = evs.filter((e) => e.k === "run");

  // THE FUNNEL is the headline: a boot that never becomes a run is the
  // single most actionable number this endpoint produces.
  const completed = runs.filter((r) => r.out === "sealed" || r.out === "orphaned");
  const quits = runs.filter((r) => r.out === "quit");

  const byDay: Record<string, { boots: number; runs: number }> = {};
  for (const e of evs) {
    const d = e.d || "?";
    byDay[d] = byDay[d] || { boots: 0, runs: 0 };
    if (e.k === "boot") byDay[d].boots++; else byDay[d].runs++;
  }

  return NextResponse.json({
    ok: true,
    windowDays: days,
    sampleCappedAt: READ,
    asOf: new Date().toISOString(),
    funnel: {
      boots: boots.length,
      runsStarted: runs.length,
      runsFinished: completed.length,
      quitMidRun: quits.length,
      runsPerBoot: boots.length ? Math.round((runs.length / boots.length) * 100) / 100 : null,
      finishRate: runs.length ? Math.round((completed.length / runs.length) * 100) : null,
      returningShare: boots.length
        ? Math.round((boots.filter((b) => b.returning).length / boots.length) * 100)
        : null,
      touchShare: boots.length
        ? Math.round((boots.filter((b) => b.touch).length / boots.length) * 100)
        : null,
    },
    // "for how long" — per run, and how many runs a session strings together
    duration: { secondsPerRun: stats(runs.map((r) => r.sec)) },
    difficulty: tally(runs.map((r) => r.diff)),
    experienceBand: tally(runs.map((r) => r.band)),
    outcome: tally(runs.map((r) => r.out)),
    grades: tally(runs.map((r) => r.grade)),
    play: {
      accuracyPct: stats(runs.map((r) => r.acc)),
      bestCombo: stats(runs.map((r) => r.combo)),
      misses: stats(runs.map((r) => r.miss)),
      bombsCut: stats(runs.map((r) => r.bombs)),
      finaleTicks: stats(runs.map((r) => r.fin)),
      guideOnShare: runs.length
        ? Math.round((runs.filter((r) => r.guide).length / runs.length) * 100)
        : null,
      tutorialShare: runs.length
        ? Math.round((runs.filter((r) => r.tut).length / runs.length) * 100)
        : null,
    },
    byDay,
  });
}
