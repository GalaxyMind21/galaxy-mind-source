// Homepage server shell (SEO sprint 2026-07-21). The interactive
// directory lives in HomeClient.tsx ("use client" · the former
// page.tsx, moved verbatim). This thin server layer exists for TWO
// reasons: (1) CollectionPage + ItemList JSON-LD with the CSP nonce,
// because a client component can't read it — same "schema lives in
// the server layer" convention as every other route. (2) Decode
// ?country= / ?category= here and pass them into HomeClient as the
// initial grid, so /?country=de SSR is five German shops instead of
// 120 cards that JS then hides (Ahrefs slow-page, 2026-08-27).
// Canonical stays `/` (root layout) so the query URLs don't compete
// with /spend-bitcoin-in/[country].
//
// Homepage <title>/description still come from the root layout's
// default metadata — deliberately unchanged (per-route layouts
// override for their own pages).
import { headers } from "next/headers";
import { HomeDirectoryLd } from "@/components/HomeDirectoryLd";
import { parseDirectoryUrl } from "@/lib/vendor-filter";
import { parseVisitorCountry, visitorCountryLabel } from "@/lib/geo-hint";
import VendorsPage from "./HomeClient";
import { HomeRentHero, type HomeRentView } from "@/components/HomeRentHero";
import { getUnitSnapshot, unitsView } from "@/lib/mrr-units";
import { mrrOnly } from "@/lib/rentals/mode";
import * as RC from "@/lib/mrr-page-copy";
import { homeFaqLd } from "@/lib/home-faq";
import { getRequestLocale, translate } from "@/lib/locale";

const SITE_URL = "https://galaxymind.space";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const initialUrl = parseDirectoryUrl(await searchParams);
  // Visitor country from Vercel's edge header, for the "Shopping from
  // {country}?" hint (lib/geo-hint.ts). Read per request, never stored;
  // this response is already private/no-store because of the nonce.
  const visitorCountry = parseVisitorCountry(hdrs.get("x-vercel-ip-country"));
  const visitorLabel = visitorCountryLabel(visitorCountry);

  // Hashrate rental tile (mrr_only, rendered below the directory): live free-chunk count from the same cached
  // feed /hashrate uses. Only the count and its fetch time reach the client.
  let rentView: HomeRentView | null = null;
  if (mrrOnly()) {
    const v = unitsView(await getUnitSnapshot(), Date.now());
    rentView = v.state === "live" ? { state: "live", at: v.at, freeCount: v.freeCount } : { state: v.state };
  }

  // CollectionPage + ItemList over every /v/[slug] page · the same
  // shape the hub pages emit, scoped to the full roster. Static
  // roster data + house strings only, no user input; safeJsonLd()
  // escapes `<` and U+2028/U+2029 for defense in depth (same
  // pattern as the root layout's SITE_LD block).
  // Home FAQ (competitor teardown lesson A4, 2026-10-18): same message
  // keys and locale as the visible <HomeFaq /> list, so the FAQPage text
  // always matches what a visitor reads.
  const locale = await getRequestLocale();
  const faqLd = homeFaqLd((k) => translate(locale, k), SITE_URL);


  return (
    <>
      {/* Directory JSON-LD is built by a client component so it ships
          once (in the HTML), not twice (HTML + RSC payload). The FAQPage
          node stays server-resolved for the request locale and rides
          along as an extra @graph node. */}
      <HomeDirectoryLd
        nonce={nonce}
        extraNodes={[
          faqLd,
        ]}
      />
      <VendorsPage
        initialUrl={initialUrl}
        visitorCountry={visitorCountry}
        visitorCountryLabel={visitorLabel}
        rentHero={
          rentView ? (
            <HomeRentHero
              view={rentView}
              copy={{
                kicker: RC.HOME_RENT_KICKER, title: RC.HOME_RENT_TITLE, sub: RC.HOME_RENT_SUB, live: RC.HOME_RENT_LIVE,
                none: RC.HOME_RENT_NONE, cta: RC.HOME_RENT_CTA,
              }}
            />
          ) : null
        }
      />
    </>
  );
}
