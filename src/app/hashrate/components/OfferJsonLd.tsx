// Service/Offer structured data for the rental offering. REMOVABLE BY
// DESIGN: if Google's Rich Results test ever flags it, delete the
// mount in page.tsx and nothing else changes.
//
// Honesty contract (2026-10-17, B1 one price): the Offer is the direct price,
// the same getQuote every surface uses (1 rig × 1 day, USDC). It renders only
// while direct rentals are open with a live price; otherwise the node is
// omitted. Never a fallback price in structured data.

import { headers } from "next/headers";
import { PAGE_DESCRIPTION } from "@/lib/hashrate-copy";
import { safeJsonLd } from "@/lib/json-ld";
import { humanCheckoutLinkable } from "@/lib/rentals/phase2/human";
import { rentOffer } from "@/lib/rentals/direct";
import { RIG_TH } from "@/lib/rentals/limits";
import { payRailsLabel } from "@/lib/rentals/rails";

const SITE_URL = "https://galaxymind.space";

export async function OfferJsonLd() {
  const offer = await rentOffer({ open: humanCheckoutLinkable() });
  if (!offer.open || !offer.price || (offer.board && offer.board.available === 0)) return null;
  const price = Number(Number(offer.price.perRigDayUsdc).toFixed(2));
  if (!(price > 0)) return null;

  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Galaxy Mind · Bitcoin hashrate rental",
          description: PAGE_DESCRIPTION,
          url: `${SITE_URL}/hashrate`,
          provider: { "@id": `${SITE_URL}/#org` },
          makesOffer: [
            {
              "@type": "Offer",
              name: `Bitcoin hashrate rental · ${RIG_TH} TH/s · 1 day`,
              url: `${SITE_URL}/hashrate/rent?rigs=1&days=1`,
              availability: "https://schema.org/InStock",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price,
                priceCurrency: "USD",
                description: `Per ${RIG_TH} TH/s per day, paid in ${payRailsLabel()}. Rent 1 to 7 days directly with Galaxy Mind.`,
              },
            },
          ],
        }),
      }}
    />
  );
}
