// Per-verdict OG image route.
//
// Why this exists:
// /stack/opengraph-image.tsx renders the LIVE verdict as the social
// preview for /stack. But when someone shares "the gauge hit 87 today!"
// on X, the live OG re-renders every 5 minutes — by tomorrow the link
// they tweeted shows a different score, breaking the moment-in-time
// they were celebrating.
//
// This route renders an OG card from URL parameters (?s=87&t=MOLTEN&d=2026-05-10)
// so a shared snapshot stays a snapshot. ShareVerdictButton points
// every share at /stack?s=...&t=...&d=... and generateMetadata in
// /stack/page.tsx routes Twitter/Facebook scrapers to this endpoint
// when those params are present.
//
// Security model: only THREE params are honored, each strictly
// validated (score 0-100 integer, tier ∈ {COLD,CHILL,WARM,HOT,MOLTEN},
// date YYYY-MM-DD). Anything else is silently ignored and we render a
// generic card. No prose / arbitrary text ever flows from query →
// rendered image, so no SSRF / XSS surface.

import { ImageResponse } from "next/og";
import { TIER_LABEL, type StackTier } from "@/lib/stack";
import { kvList, kvIncrWithTtl, isKvConfigured } from "@/lib/kv";
import { getClientIp } from "@/lib/client-ip";
import type { StackSnapshot } from "@/app/api/cron/snapshot-stack/route";
import { SANS, LAMP, benchFonts } from "@/lib/og-bench";

export const runtime = "nodejs";
// 1 day at the edge — snapshot URLs are deterministic so we can cache
// aggressively. Live (no-param) calls fall through to the same TTL but
// the score doesn't change anyway because we don't fetch market data
// here · the live OG is /stack/opengraph-image.tsx for that case.
export const revalidate = 86400;

const ACCENT = "#F7931A";
const BG = "#12110F";
const BG_ELEV = "#1C1A16";
const BORDER = "rgba(247, 238, 224, 0.085)";
const FG = "#F2EFE9";
const FG_MUTED = "#A5A096";

const VALID_TIERS: ReadonlySet<StackTier> = new Set([
  "COLD",
  "CHILL",
  "WARM",
  "HOT",
  "MOLTEN",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Tier-specific accent for the gauge arc · matches the on-page color
// vocabulary so shared cards feel continuous with the live tool.
function tierColor(tier: StackTier): string {
  if (tier === "MOLTEN" || tier === "HOT") return ACCENT;
  if (tier === "COLD") return "#7ec0ff"; // cold = blue (HOLD vibe)
  return BORDER;
}

function formatDate(iso: string): string | null {
  // iso matched DATE_RE (\d{4}-\d{2}-\d{2}) — but that's SHAPE-only.
  // H (audit 2026-05, Agent3 content-integrity): without a round-trip
  // check, Date.UTC silently rolls over out-of-range components, so
  // ?d=2026-13-40 → "February 9, 2027" and ?d=0000-00-00 →
  // "November 30, 1999" — letting an attacker craft a share URL whose
  // CACHED social billboard shows a fabricated "SNAPSHOT" date that
  // never corresponded to any real verdict ("Galaxy Mind predicted
  // X"). Re-validate that the constructed UTC date's components
  // EXACTLY equal the input; on mismatch return null and the caller
  // falls back to the generic no-date card.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Per-IP rate limit on the OG card render (audit 2026-05-21 · MEDIUM).
// Each render runs Satori (Node WASM) + PNG encode → ~50-200ms server-side.
// `revalidate = 86400` keys the cache per URL, so an attacker spraying
// `?s=$x&t=$y&d=$z` permutations bypasses the cache on every unique
// URL · ~180k distinct (score, tier, date) combinations. Without a
// rate limit, a script could exhaust Vercel free-tier compute minutes
// over a single afternoon.
//
// 30 renders/minute per IP is well above any legitimate use (social
// scrapers fetch once per share, and the per-URL edge cache absorbs
// repeats). KV-backed, fails OPEN when KV is unavailable (better to
// permit a legit scrape than block on a transient KV blip).
const OG_RATE_LIMIT_MAX = 30;
const OG_RATE_LIMIT_WINDOW_S = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sParam = url.searchParams.get("s");
  const tParam = url.searchParams.get("t");
  const dParam = url.searchParams.get("d");

  if (isKvConfigured()) {
    const ip = getClientIp(req);
    const count = await kvIncrWithTtl(
      `og:stack:rl:${ip}`,
      OG_RATE_LIMIT_WINDOW_S,
    );
    if (count != null && count > OG_RATE_LIMIT_MAX) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": String(OG_RATE_LIMIT_WINDOW_S) },
      });
    }
  }

  // Strict validation. If anything is malformed we render a generic
  // "Galaxy Mind · Bitcoin Buying Gauge" card with no score · this
  // keeps the card useful even when someone hand-edits the URL.
  let score: number | null = null;
  let tier: StackTier | null = null;
  let dateLabel: string | null = null;

  if (sParam !== null) {
    const parsed = Number.parseInt(sParam, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      score = parsed;
    }
  }
  if (tParam !== null && (VALID_TIERS as ReadonlySet<string>).has(tParam)) {
    tier = tParam as StackTier;
  }
  if (dParam !== null && DATE_RE.test(dParam)) {
    dateLabel = formatDate(dParam);
  }

  // Historical-snapshot integrity gate (audit 2026-05-21 · HIGH):
  //
  // Without this check, an attacker can craft ANY (score, tier, date)
  // URL and we'll mint a snapshot card cached at the social-network
  // edges for 24h. Example damage: "?s=12&t=COLD&d=2026-05-21" tweeted
  // after a known price pump renders a fabricated billboard reading
  // "Galaxy Mind said HOLD on the local top — they were wrong." That's
  // a reputation attack against a trust-promise site.
  //
  // Fix: verify the triple matches a real entry in stack:history. If
  // not, refuse to mint the snapshot card · fall back to the generic
  // branded card (no score, no tier label). 365-day history window is
  // plenty for any legit share.
  //
  // Gate condition (HARDENED 2026-06-14): runs whenever score+tier are
  // present, NOT only when a date is present. The earlier `dParam !==
  // null` condition left a hole · a dateless share /stack?s=12&t=COLD
  // becomes /api/og/stack?s=12&t=COLD (generateMetadata only appends `d`
  // when a date exists), which skipped verification and still rendered a
  // fabricated big-number card. Now a verifiable, matching date is
  // REQUIRED proof: a dateless (unverifiable) score/tier is refused and
  // falls back to the generic card. Legit shares always carry the date.
  //
  // Cost: one KV read per cache miss (~5-30ms). At the 24h edge TTL
  // this is amortized to roughly zero on any URL anyone actually
  // shares. KV outage → empty history → defaults to generic card
  // (fail-CLOSED · we'd rather show "GALAXY MIND" than risk a
  // fabricated billboard during a KV outage).
  if (score !== null && tier !== null) {
    try {
      const history = await kvList<StackSnapshot>("stack:history", 365);
      const real =
        dParam !== null ? history.find((h) => h.date === dParam) : null;
      if (!real || real.score !== score || real.tier !== tier) {
        // Unverified · null everything so hasSnapshot is false below.
        score = null;
        tier = null;
        dateLabel = null;
        console.warn(
          "[/api/og/stack] unverified snapshot rejected:",
          `s=${sParam} t=${tParam} d=${dParam}`,
        );
      }
    } catch (e) {
      console.error("[/api/og/stack] history lookup failed:", e);
      // Fail closed · don't trust unverifiable claims.
      score = null;
      tier = null;
      dateLabel = null;
    }
  }

  // If both score and tier resolved, this is a real snapshot. Otherwise
  // render a generic branded card (no big number, just the brand mark).
  const hasSnapshot = score !== null && tier !== null;

  // Gauge needle pose · score 0 → -90deg, score 100 → +90deg.
  const deg = hasSnapshot ? (score! / 100) * 180 - 90 : 0;
  const arcColor = tier ? tierColor(tier) : BORDER;
  const tierLabel = tier ? TIER_LABEL[tier] : "GALAXY MIND";

  // IMPORTANT · keep ALL text in this card to basic ASCII. This is a
  // dynamic nodejs route (not a static opengraph-image convention
  // file), so next/og's unreliable on-demand font fetch for any glyph
  // outside the bundled subset (the documented "★ / ₿" failure · see
  // opengraph-image.tsx) is a hard 500 here at request time, not a
  // tolerable build warning. A "·" middot in the brand line + the
  // SNAPSHOT ribbon was 500-ing every shared /stack card · removed.
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          backgroundImage: LAMP,
          color: FG,
          display: "flex",
          flexDirection: "column",
          fontFamily: SANS,
          padding: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 26, color: "#F2EFE9", letterSpacing: 5.2 }}>
            BITCOIN BUYING GAUGE
          </span>
          <span style={{ fontSize: 16, color: FG_MUTED, letterSpacing: 3.2 }}>
            GALAXY MIND
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 80,
          }}
        >
          <svg width="380" height="220" viewBox="0 0 400 220">
            <path
              d="M 30 200 A 170 170 0 0 1 370 200"
              stroke={BORDER}
              strokeWidth="3"
              fill="none"
            />
            {hasSnapshot && score! >= 65 && (
              <path
                d="M 200 30 A 170 170 0 0 1 370 200"
                stroke={arcColor}
                strokeWidth="5"
                fill="none"
                opacity={0.95}
              />
            )}
            {/* next/og's Satori does NOT support React Fragments —
                it coerces Symbol(react.fragment) to a string and
                throws "Cannot convert a Symbol value to a string",
                hard-500ing the route. The generic (no-snapshot) card
                has no Fragments and renders fine; the snapshot card
                used <>…</> here and below, which is what was 500-ing
                EVERY shared /stack card. Render the needle + hub as
                two independent conditional <svg> children instead. */}
            {hasSnapshot && (
              <line
                x1="200"
                y1="200"
                x2={200 + Math.cos(((deg - 90) * Math.PI) / 180) * 150}
                y2={200 + Math.sin(((deg - 90) * Math.PI) / 180) * 150}
                stroke={ACCENT}
                strokeWidth="5"
                strokeLinecap="round"
              />
            )}
            {hasSnapshot && (
              <circle cx="200" cy="200" r="9" fill={ACCENT} />
            )}
          </svg>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            {hasSnapshot ? (
              // Real flex <div> wrapper, NOT a Fragment · see the
              // Satori note above the gauge needle.
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 200,
                    color: ACCENT,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(score)}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 36,
                    letterSpacing: 7.2,
                    marginTop: 8,
                    color: arcColor,
                  }}
                >
                  {tierLabel.toUpperCase()}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  fontSize: 60,
                  color: FG,
                  lineHeight: 1.2,
                  maxWidth: 480,
                }}
              >
                When&apos;s the best time to buy Bitcoin?
              </div>
            )}
          </div>
        </div>

        {/* Snapshot ribbon · only when ?d= was provided. Tells viewers
            "this card preserves a moment in time" so they aren't
            confused if they click through and see a different live
            score. */}
        {dateLabel ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 8,
              fontSize: 18,
              color: FG_MUTED,
              letterSpacing: 3.6,
            }}
          >
            SNAPSHOT {dateLabel.toUpperCase()}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            fontSize: 18,
            color: FG_MUTED,
          }}
        >
          galaxymind.space/stack
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: benchFonts(),
      // EDGE CACHE (fixed 2026-07-25).
      //
      // next/og seeds `cache-control: public, immutable, no-transform,
      // max-age=0` on every ImageResponse, so the "24h edge cache" this
      // file's cost note assumed did not exist: every scrape re-rendered
      // the card AND re-ran the KV verification read. Social scrapers hit
      // a popular share repeatedly, so this was the most re-executed
      // route on the site.
      //
      // The TTL is SPLIT deliberately, because the integrity gate above
      // fails CLOSED: a transient KV blip nulls score/tier and renders
      // the GENERIC card. Caching that for a day would pin a branded-but-
      // numberless billboard onto a real shared verdict URL — and social
      // platforms cache by URL, so it would outlive the blip by far.
      //   · verified snapshot → content-addressed by (s,t,d), so it can
      //     never legitimately change: cache hard.
      //   · generic fallback → might be a failure artifact: cache briefly
      //     so it self-heals on the next scrape.
      headers: {
        "Cache-Control": hasSnapshot
          ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable"
          : "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
