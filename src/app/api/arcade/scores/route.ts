// GET /api/arcade/scores?game=gauntlet|runner|horizon|wen|saylor|summit|kart|trail
// [&day=N] · public board
// reads. Top 20 + total entrants. Short CDN cache keeps a viral
// moment off the KV bill without making the board feel stale.

import { NextResponse } from "next/server";
import { gauntletNumber } from "@/app/gauntlet/engine";
import { isKvConfigured, kvHMGet, kvZCard, kvZTop } from "@/lib/kv";
import { rateLimit } from "@/lib/rate-limit";
import { X_PROFILE_HASH, type XProfile } from "@/lib/arcade-identity";

export const runtime = "nodejs";

const TOP_N = 20;

export async function GET(req: Request) {
  const rl = await rateLimit(req, {
    name: "arcade-scores",
    limit: 60,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { rows: [], total: 0, configured: true },
      { status: 429, headers: rl.headers },
    );
  }

  const url = new URL(req.url);
  const game = url.searchParams.get("game");
  if (
    game !== "gauntlet" &&
    game !== "runner" &&
    game !== "horizon" &&
    game !== "wen" &&
    game !== "saylor" &&
    game !== "summit" &&
    game !== "kart" &&
    game !== "trail" &&
    game !== "chop"
  ) {
    return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
  }

  if (!isKvConfigured()) {
    return NextResponse.json({ rows: [], total: 0, configured: false });
  }

  let key: string;
  if (game === "gauntlet") {
    const now = gauntletNumber(Date.now());
    const dayRaw = url.searchParams.get("day");
    const day = dayRaw == null ? now : Math.floor(Number(dayRaw));
    // Today or the last week only · boards expire from KV anyway,
    // this just keeps the param from becoming a key-space scanner.
    if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
    }
    key = `gm:lb:g:v2:${day}`;
  } else if (game === "runner") {
    // v3 · integer days*1e6+sats packing (2026-07-10). v2 was saturated
    // with min(sats,9999) fractions · every long run showed 9,999 sats.
    // With ?day=N (the gauntlet number = daily tape seed) serve TODAY's
    // board · same tape for everyone, so it's the fair head-to-head.
    // No day param = the all-time hall of fame.
    const dayRaw = url.searchParams.get("day");
    if (dayRaw == null) {
      key = "gm:lb:runner:v3";
    } else {
      const now = gauntletNumber(Date.now());
      const day = Math.floor(Number(dayRaw));
      // Same window guard as the gauntlet · daily keys hold ~8 days.
      if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
        return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
      }
      key = `gm:lb:runner:day:v3:${day}`;
    }
  } else if (game === "wen") {
    // Same daily/all-time split as the runner · ?day=N (gauntlet number,
    // the shared arcade day) serves today's race, no param = hall of fame.
    const dayRaw = url.searchParams.get("day");
    if (dayRaw == null) {
      key = "gm:lb:wen:v1";
    } else {
      const now = gauntletNumber(Date.now());
      const day = Math.floor(Number(dayRaw));
      if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
        return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
      }
      key = `gm:lb:wen:day:v1:${day}`;
    }
  } else if (game === "trail") {
    // Same daily/all-time split as WEN · ?day=N serves today's race,
    // no param = the hall of fame (best-ever single-day sats).
    const dayRaw = url.searchParams.get("day");
    if (dayRaw == null) {
      key = "gm:lb:trail:v1";
    } else {
      const now = gauntletNumber(Date.now());
      const day = Math.floor(Number(dayRaw));
      if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
        return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
      }
      key = `gm:lb:trail:day:v1:${day}`;
    }
  } else if (game === "saylor") {
    key = "gm:lb:saylor:v1"; // all-time only · the game is not daily
  } else if (game === "summit") {
    // Daily Summit is daily-ONLY · a day param is required (there is
    // no all-time board across different mountains). Same 7-day window
    // guard as the other daily boards.
    const dayRaw = url.searchParams.get("day");
    const now = gauntletNumber(Date.now());
    const day = dayRaw == null ? NaN : Math.floor(Number(dayRaw));
    if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
    }
    key = `gm:lb:summit:day:v1:${day}`;
  } else if (game === "chop") {
    // CHOP is daily-ONLY: the chart is generated from the live tip, so
    // runs are only comparable within a UTC day (same contract as the
    // Summit and the Daily Circuit).
    const dayRaw = url.searchParams.get("day");
    const now = gauntletNumber(Date.now());
    const day = dayRaw == null ? NaN : Math.floor(Number(dayRaw));
    if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
    }
    key = `gm:lb:chop:day:v1:${day}`;
  } else if (game === "kart") {
    // Daily Circuit is daily-ONLY (same contract as the Summit): a day
    // param is required and only the last week's boards still exist.
    const dayRaw = url.searchParams.get("day");
    const now = gauntletNumber(Date.now());
    const day = dayRaw == null ? NaN : Math.floor(Number(dayRaw));
    if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
      return NextResponse.json({ rows: [], total: 0 }, { status: 400 });
    }
    key = `gm:lb:kart:day:v1:${day}`;
  } else {
    key = "gm:lb:horizon:v3";
  }

  const [top, total] = await Promise.all([kvZTop(key, TOP_N), kvZCard(key)]);

  // X-linked rows: members shaped "x:{userId}" carry display metadata in
  // the profile hash · ONE HMGET enriches the whole page. Enrichment is
  // board-global (nothing viewer-specific), so the 30s CDN cache below
  // stays valid — per-viewer state lives only in no-store /api/auth/x/me.
  const xIds = top
    .filter((r) => r.member.startsWith("x:"))
    .map((r) => r.member.slice(2));
  const profiles = new Map<string, XProfile>();
  if (xIds.length > 0) {
    const got = await kvHMGet<XProfile>(X_PROFILE_HASH, xIds);
    xIds.forEach((id, i) => {
      const p = got[i];
      if (p && typeof p.h === "string") profiles.set(id, p);
    });
  }

  return NextResponse.json(
    {
      rows: top.map((r) => {
        if (r.member.startsWith("x:")) {
          const p = profiles.get(r.member.slice(2));
          // unlinked (profile deleted) rows stay anonymous but honest ·
          // the row ages off its board TTL
          if (!p) return { name: "unlinked rider", score: r.score };
          return {
            name: `@${p.h}`,
            score: r.score,
            verified: true as const,
            ...(p.a ? { avatar: p.a } : {}),
          };
        }
        return { name: r.member, score: r.score };
      }),
      total,
      configured: true,
    },
    {
      headers: {
        ...rl.headers,
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
