"use client";

// Vercel Analytics + Speed Insights with a beforeSend that strips the #fragment and ?pay=
// (a payUrl's order id and secret) from every beacon. A client component, because the root
// layout is a server component and cannot hand a function prop across the boundary.
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { scrubBeaconUrl } from "@/lib/analytics-scrub";

export default function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={(e) => ({ ...e, url: scrubBeaconUrl(e.url) })} />
      <SpeedInsights beforeSend={(e) => ({ ...e, url: scrubBeaconUrl(e.url) })} />
    </>
  );
}
