// GET /api/subscriber-count — returns just the active subscriber count.
//
// Public endpoint powering the "Join N others" social-proof badge on
// the AlertSubscribe form. Returns ONLY the integer count — no emails,
// no PII, no list contents. Caller can show "Join 47 others" without
// us leaking who's subscribed.
//
// Cached at the edge for 5 minutes. The count rarely changes (a few
// per day at most) and the form badge doesn't need to be live-accurate;
// 5 min is a good balance of freshness vs Resend API cost.
//
// THE CACHE MUST BE AN EXPLICIT HEADER (fixed 2026-07-25).
//
// `export const revalidate` below governs Next's DATA cache, not this
// response's HTTP caching, and nothing here goes through a cached
// `fetch()` — lib/kv.ts issues `cache: "no-store"` by design. So the
// route was shipping `cache-control: public, max-age=0, must-revalidate`
// and every request was an `x-vercel-cache: MISS` (verified live), i.e.
// the "cached at the edge for 5 minutes" above was not true.
//
// Why that mattered more than a stale badge: `countSubscribers()` fast
// path is one `kvGet`, and this endpoint is fetched by SystemHealthStrip
// (homepage) and AlertSubscribeCompact (/fit, /faq, /about, /float,
// /treasuries, /stack) — so a social-proof badge was spending ~1 KV
// command PER PAGE VIEW against the 10K/day free tier that the snapshot
// crons, subscribe double-opt-in, and every rate limiter share. And
// lib/rate-limit.ts degrades OPEN when KV fails, so exhausting the
// budget removes the site's brakes.
//
// Same reasoning and shape as /api/heartbeat and /api/float-heartbeat,
// which attach an explicit CDN directive for exactly this reason.

import { NextResponse } from "next/server";
import { countSubscribers } from "@/lib/email";

export const revalidate = 300; // 5 min (data cache; see header note)

// Success: match the 5-min SUB_COUNT_TTL_S so the CDN and the KV cache
// expire together. SWR lets the CDN serve the old integer while one
// request refreshes, so a burst never fans out to KV.
const CACHE_OK = "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";
// Degraded: cache the null too (otherwise an outage returns to
// one-KV-command-per-view), but briefly, so the badge comes back fast.
const CACHE_NULL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

export async function GET() {
  const count = await countSubscribers();
  if (count == null) {
    // Resend unreachable / not configured. Return null so the client
    // can hide the badge entirely (better than showing "0" or
    // "Loading..." forever).
    return NextResponse.json(
      { count: null },
      { status: 200, headers: { "Cache-Control": CACHE_NULL } },
    );
  }
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": CACHE_OK } },
  );
}
