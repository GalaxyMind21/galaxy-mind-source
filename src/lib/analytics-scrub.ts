// Scrub URLs before Vercel Analytics / Speed Insights send them (review S2, PR #92 follow-up).
// A payUrl is /hashrate/rent?pay=<rentalId>#s=<creatorSecret>. The secret lives in the fragment,
// which browsers never send to us, but both beacons report location.href, fragment included.
// Drop every #fragment and the ?pay= order id so neither ever reaches a third party.

/** Query params that must never leave the page in a beacon. */
export const SCRUBBED_PARAMS = ["pay"] as const;

/** Return the URL without its #fragment and without ?pay=. Unparseable input is cut at '#' and '?'. */
export function scrubBeaconUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of SCRUBBED_PARAMS) u.searchParams.delete(p);
    let out = u.toString();
    // URL keeps a bare "?" when the last param is removed; drop it.
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
  } catch {
    return String(raw).split("#")[0].split("?")[0];
  }
}
