// GET /api/status — machine-readable health of every public data source.
//
// The JSON twin of the /status page. Agents, uptime monitors, and power
// users can poll this for the degraded flag, per-source freshness, vendor
// counts, float health, and hand-sourced-constant freshness. Reuses the
// SAME helpers the page renders from (weightBearingSources, getFloatData,
// checkConstantsFreshness) so the two can't drift. Public data only — the
// auth-gated cron-health endpoint stays operator-only.
//
// ALWAYS returns 200 — even on an internal error, with ok:false + a
// minimal degraded shape — so a monitor watching THIS endpoint never
// pages because our own status route hiccuped. CORS-open like
// /api/heartbeat so external monitors can poll cross-origin.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { getFloatData } from "@/lib/float-data";
import {
  isMarketSnapshotDegraded,
  weightBearingSources,
  WEIGHT_BEARING_SIGNAL_COUNT,
} from "@/lib/snapshot-quality";
import { kvList } from "@/lib/kv";
import { VENDORS, isStale } from "@/lib/vendors";
import { isTreasuryBoardEmpty } from "@/lib/treasuries";
import { checkConstantsFreshness } from "@/lib/constants-freshness";

// Health, not a live ticker · 2 min ISR is plenty. The CDN serves it and
// keeps serving stale while revalidating, so a poll spray never fans out
// to the upstream APIs more than once per window.
export const revalidate = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  // max-age: Vercel strips s-maxage/SWR from the browser-facing header,
  // so an explicit browser TTL is needed or monitors/browsers refetch
  // fully every time. 60s keeps a polling monitor honest within the
  // 2-min data cadence.
  "Cache-Control":
    "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
};

export type StatusResponse = {
  ok: boolean;
  asOf: string;
  degraded: boolean;
  signals: { reporting: number; total: number };
  sources: { name: string; ok: boolean }[];
  float: {
    inPlay: number | null;
    isFallback: boolean;
    partial: boolean;
    asOf: string | null;
  };
  vendors: {
    total: number;
    stale: number;
    countries: number;
    newThisMonth: number;
  };
  constants: { name: string; ok: boolean; ageDays: number; cadenceDays: number }[];
  history: { stack: string | null; treasuryMSTR: string | null };
};

export async function GET() {
  try {
    const [snapshot, float, stackHist, mstrHist] = await Promise.all([
      getMarketSnapshot(),
      getFloatData({ days: 2, synthetic: false }),
      kvList<{ date: string }>("stack:history", 1),
      kvList<{ date: string }>("treasury:history:MSTR", 1),
    ]);

    const sources = weightBearingSources(snapshot);
    const reporting = sources.filter((s) => s.ok).length;

    const now = new Date();
    const monthStartSec =
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
    const countries = new Set(
      VENDORS.map((v) => v.country).filter((c): c is string => !!c),
    ).size;

    const body: StatusResponse = {
      ok: true,
      asOf: snapshot.asOf,
      degraded:
        isMarketSnapshotDegraded(snapshot) ||
        isTreasuryBoardEmpty(snapshot.treasuries),
      signals: { reporting, total: WEIGHT_BEARING_SIGNAL_COUNT },
      sources,
      float: {
        inPlay: float.current.inPlay ?? null,
        isFallback: float.isFallback,
        partial: float.current.partial === true,
        asOf: float.asOf ?? null,
      },
      vendors: {
        total: VENDORS.length,
        stale: VENDORS.filter((v) => isStale(v.verifiedAt)).length,
        countries,
        newThisMonth: VENDORS.filter((v) => v.listedAt >= monthStartSec).length,
      },
      constants: checkConstantsFreshness(now).map((c) => ({
        name: c.label,
        ok: !c.stale,
        ageDays: c.ageDays,
        cadenceDays: c.cadenceDays,
      })),
      history: {
        stack: stackHist[0]?.date ?? null,
        treasuryMSTR: mstrHist[0]?.date ?? null,
      },
    };

    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (e) {
    console.error(
      "[/api/status] unhandled:",
      e instanceof Error ? (e.stack ?? e.message) : e,
    );
    return NextResponse.json(
      {
        ok: false,
        degraded: true,
        error: "status unavailable",
        asOf: new Date().toISOString(),
      },
      { headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
