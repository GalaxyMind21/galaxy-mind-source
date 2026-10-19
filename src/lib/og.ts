/* =====================================================================
 * lib/og.ts · shared openGraph image defaults (SEO audit 2026-07-25)
 *
 * THE BUG THIS FIXES
 *
 * Next merges page metadata over the root's, but `openGraph` is merged as
 * a WHOLE OBJECT: a page that declares an `openGraph` block WITHOUT an
 * `images` key does not inherit the root `app/opengraph-image.tsx` — it
 * REPLACES it, and ships no og:image at all. Verified live: /embed (no
 * openGraph block) inherited the card correctly, while
 * /online-stores-that-accept-bitcoin, /buy-coffee-with-bitcoin and every
 * /spend-bitcoin-in|on hub emitted og:title, og:description, og:url,
 * `twitter:card=summary_large_image` — and NO og:image, NO twitter:image.
 *
 * ~50 URLs, including the flagship spend-intent money page and all 26
 * vendor hubs, therefore rendered as a bare text link everywhere a link
 * is unfurled (X, Slack, Discord, LinkedIn, iMessage). `summary_large_image`
 * with no image is the worst case: the platform reserves the large card
 * and then has nothing to put in it.
 *
 * WHY TWO CONSTANTS, NOT ONE DEFAULT
 *
 * The root card renders vendor counts + categories + "Spend Bitcoin"
 * (app/opengraph-image.tsx). Stamping that onto an mNAV page would
 * contradict the page's own visible content — an image that argues with
 * the headline is worse than none. So: the directory/spend family gets
 * the directory card, the treasury/finance family gets the treasury card.
 * Both routes are real and already render.
 *
 * USAGE: spread into the page's existing openGraph block —
 *   openGraph: { title, description, url, images: OG_DIRECTORY }
 * Relative URLs resolve against `metadataBase` in app/layout.tsx.
 * ===================================================================== */

/** The vendor-directory / spend-intent card. */
export const OG_DIRECTORY = [
  {
    url: "/opengraph-image",
    width: 1200,
    height: 630,
    alt: "Galaxy Mind share card: a free, human-verified directory of online shops that take bitcoin, with shop and country counts. Buy from people, not platforms.",
  },
];

/** The treasury / mNAV card, for finance-side pages. */
export const OG_TREASURY = [
  {
    url: "/treasuries/opengraph-image",
    width: 1200,
    height: 630,
    alt: "Galaxy Mind · Bitcoin treasury mNAV scoreboard",
  },
];

/** Per-route sibling opengraph-image.tsx. Use this when the page
 *  already has a file-based OG card, so declaring `openGraph` does
 *  not drop it. */
export function pageOgImage(path: string, alt: string) {
  return [{ url: path, width: 1200, height: 630, alt }];
}

/** /submit's own seller-facing card (competitor teardown lesson A7). */
export const SUBMIT_OG_ALT =
  "Galaxy Mind share card for shops: List your shop free. A person reviews every submission, with no listing fees, no paid placement and no affiliate cut.";
