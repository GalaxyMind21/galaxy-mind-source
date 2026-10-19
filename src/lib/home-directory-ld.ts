// Home-page directory JSON-LD (CollectionPage + ItemList over every
// /v/[slug] page + the roster Dataset), plus any extra @graph nodes the
// server passes in (the home FAQPage). Moved out of app/page.tsx on
// 2026-10-18 so a CLIENT component can build it: a server component's
// JSON-LD is serialized twice, once as the <script> in the HTML and again
// inside the RSC flight payload, and this ~18 KB ItemList was the largest
// single duplicate on the home page. Built from the same static roster the
// client bundle already ships, so the output is byte-identical to before.
// Static roster data + house strings only, no user input.
import { VENDORS, vendorSlug, STALE_THRESHOLD_DAYS } from "@/lib/vendors";

const SITE_URL = "https://galaxymind.space";

export function buildHomeDirectoryLd(extraNodes: object[] = []) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/#directory`,
        url: SITE_URL,
        name: "Verified Bitcoin merchant directory",
        description:
          "Human-verified directory of merchants that accept bitcoin for everyday goods, on-chain or over Lightning.",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        mainEntity: { "@id": `${SITE_URL}/#directory-list` },
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}/#directory-list`,
        name: "Merchants that accept bitcoin",
        numberOfItems: VENDORS.length,
        itemListElement: VENDORS.map((v, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE_URL}/v/${vendorSlug(v)}`,
          name: v.name,
        })),
      },
      // Dataset node for the roster itself (2026-07-29).
      //
      // /float, /stack and /treasuries each declared one; the vendor
      // directory — the site's most distinctive dataset and its
      // most-visited surface — did not. The payoff is NOT Google
      // Dataset Search (niche, and a merchant directory is a marginal
      // fit for it). It is the citation contract: /api/vendors.json is
      // CORS-open and openly quotable, but carried no declared license,
      // format, or provenance anywhere in structured data, so an agent
      // asking "may I quote and attribute this?" found nothing and the
      // cautious default is to omit the source. Same reasoning as the
      // license fix on /treasuries.
      {
        "@type": "Dataset",
        "@id": `${SITE_URL}/#vendor-dataset`,
        name: "Verified Bitcoin merchant directory",
        description:
          `Human-verified directory of merchants that accept bitcoin for everyday goods, on-chain or over Lightning. Each entry carries the merchant's platform identity (X or Nostr), category, country, and the UTC date a human last confirmed they accept bitcoin. Every entry is monitored daily and reviewed by a human when something changes, with a ${STALE_THRESHOLD_DAYS}-day backstop for entries where nothing does.`,
        url: SITE_URL,
        keywords: [
          "Bitcoin",
          "merchants accepting Bitcoin",
          "spend bitcoin",
          "Lightning Network",
          "bitcoin vendors",
          "circular economy",
        ],
        creator: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        license: "https://creativecommons.org/licenses/by/4.0/",
        isAccessibleForFree: true,
        variableMeasured: [
          "handle",
          "platform",
          "name",
          "description",
          "category",
          "country",
          "listedAt",
          "verifiedAt",
        ],
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${SITE_URL}/api/vendors.json`,
            name: "Full directory (JSON)",
          },
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${SITE_URL}/api/vendors.json?category=consumables`,
            name: "Filtered example · category, country, platform and since are composable",
          },
        ],
      },
      ...extraNodes,
    ],
  };
}
