// RSS 2.0 feed of the 30 most-recently-added vendors.
//
// Why this exists (Tier 3a): Bitcoin / Nostr power users live in RSS
// readers, and planet-style aggregators pick up valid feeds passively.
// A feed is a compounding, zero-touch distribution channel · once
// indexed somewhere it surfaces every new vendor without the operator
// having to post anything. The data + slug helpers already exist;
// this is just the wire-format wrapper.
//
// Format choice: RSS 2.0 (not Atom). RSS has wider client support
// across the Bitcoin/Nostr aggregator ecosystem (NewsBlur, Feedly,
// Inoreader, Tiny Tiny RSS, FreshRSS) and a simpler hand-written
// schema. <pubDate> is RFC 822, which is what aggregators ingest;
// using ISO would silently break ordering in some readers.

import { NextResponse } from "next/server";
import { VENDORS, filterActive, getDisplayHandle, vendorSlug } from "@/lib/vendors";

// Static is fine · public-facing dormancy filtering was removed
// 2026-05-20 (operator decision · customers don't care about
// dormancy, the operator prunes truly-dead vendors periodically).
export const dynamic = "force-static";
export const revalidate = 3600; // 1h edge cache · matches /opengraph-image

const SITE = "https://galaxymind.space";
const MAX_ITEMS = 30;

function rfc822(unixSec: number): string {
  // unixSec is UTC; toUTCString() emits RFC 1123 which is the
  // accepted modern superset of RFC 822 for feed dates.
  return new Date(unixSec * 1000).toUTCString();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  // Active only · same filter the homepage uses, so a stale vendor
  // doesn't surface in feed readers as if it were live. Sort by
  // addedAt descending (newest first); cap at MAX_ITEMS so the feed
  // stays under typical reader limits.
  // Public dormancy filter removed 2026-05-20 · empty Set keeps the
  // filterActive signature intact while showing every vendor.
  const items = filterActive(VENDORS, new Set<string>())
    .slice()
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, MAX_ITEMS);

  const latest = items[0]?.listedAt
    ? rfc822(items[0].listedAt)
    : rfc822(Math.floor(Date.now() / 1000));

  const itemsXml = items
    .map((v) => {
      const slug = vendorSlug(v);
      const url = `${SITE}/v/${slug}`;
      const title = `${v.name} · ${v.category}`;
      const handle = getDisplayHandle(v);
      const desc = `${v.description}\n\nHandle: ${handle}`;
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(v.listedAt)}</pubDate>
      <category>${escapeXml(v.category)}</category>
      <description>${escapeXml(desc)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Galaxy Mind · New Bitcoin Merchants</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Human-verified directory of merchants accepting Bitcoin. Newest additions, updated as vendors land.</description>
    <language>en-us</language>
    <lastBuildDate>${latest}</lastBuildDate>
    <ttl>60</ttl>
${itemsXml}
  </channel>
</rss>
`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
