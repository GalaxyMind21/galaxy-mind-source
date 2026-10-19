// GET /feed-gauge.xml · RSS feed of the daily Buying Gauge verdicts
// (2026-06-10). The no-email channel: RSS readers, aggregators, and
// automation (IFTTT/Zapier-style) can follow the daily score without
// surrendering an address. Complements /feed.xml (new vendors).
//
// Items come from the same stack:history KV list the sparkline uses ·
// newest 14 entries, one item per day, each linking to the frozen
// shareable verdict URL (/stack?s=..&t=..&d=..) so the linked page
// matches the score in the item title forever.

import { kvList } from "@/lib/kv";
import type { StackSnapshot } from "../api/cron/snapshot-stack/route";

export const revalidate = 3600;

const SITE_URL = "https://galaxymind.space";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET() {
  // Newest-first from KV · exactly the order RSS wants.
  const history = await kvList<StackSnapshot>("stack:history", 14);

  const valid = history.filter(
    (h) => typeof h.score === "number" && typeof h.date === "string",
  );

  const items = valid
    .map((h) => {
      // Escape the WHOLE assembled URL, never just the interpolated values ·
      // the literal '&' query separators must reach XML content as '&amp;'
      // or every conforming RSS parser rejects the feed as malformed.
      const link = esc(`${SITE_URL}/stack?s=${h.score}&t=${h.tier}&d=${h.date}`);
      const pub = new Date(h.date + "T00:05:00Z").toUTCString();
      return `    <item>
      <title>${esc(`Bitcoin Buying Gauge: ${h.score} · ${h.tier}`)}</title>
      <link>${link}</link>
      <guid isPermaLink="false">gauge-${esc(h.date)}</guid>
      <pubDate>${pub}</pubDate>
      <description>${esc(`The 10-signal Bitcoin buying score for ${h.date}: ${h.score}/100 (${h.tier}). Open methodology at ${SITE_URL}/methodology.`)}</description>
    </item>`;
    })
    .join("\n");

  // Newest snapshot's publish instant · same freshness hint /feed.xml
  // emits. Falls back to "now" when KV is unset (no-op client) so the
  // element is never empty.
  const lastBuild =
    valid.length > 0
      ? new Date(valid[0].date + "T00:05:00Z").toUTCString()
      : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Galaxy Mind · Bitcoin Buying Gauge (daily)</title>
    <link>${SITE_URL}/stack</link>
    <atom:link href="${SITE_URL}/feed-gauge.xml" rel="self" type="application/rss+xml"/>
    <description>Daily 0-100 Bitcoin buying score from 10 weighted market signals. Free, open methodology.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
