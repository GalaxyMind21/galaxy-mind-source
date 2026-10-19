// /map · the Bitcoin circular economy, mapped (B8 · 2026-07-07).
//
// The directory's most unique asset · 120+ human-verified merchants
// across 20 countries · rendered as a flagship atlas page. The
// interactive explorer (client) handles the wow; the server-rendered
// country index below it handles crawlers and no-JS visitors with
// the same data, grouped once here and passed down so the two can
// never disagree.
//
// SEO intent: "bitcoin merchants map" / "where can I spend bitcoin"
// queries land here, then hand off to /v pages and the filtered
// directory.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import {
  COUNTRIES,
  VENDORS,
  countrySlug,
  vendorSlug,
  CATEGORY_LABELS,
} from "@/lib/vendors";
import { MapExplorer, type CountryGroup } from "./MapExplorer";
import { MapReturnPulse } from "./MapReturnPulse";
import { headers } from "next/headers";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/map";

const TITLE = "Online shops by country · Galaxy Mind";
const DESCRIPTION =
  "Countries of listed online shops that take native bitcoin. Dots are countries, not street pins. Cafes you walk into live on BTC Map.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    title: "Online shops, by country",
    description: DESCRIPTION,
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/map/opengraph-image", "Online shops, by country"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Online shops, by country",
    description: DESCRIPTION,
    site: "@GalaxyMind",
  },
};

// Growth 2026-09-09: quiet VendorHashrateModule after the country shelf so
// "bitcoin merchants map" SERP visitors (vs BTC Map walk-in pins) convert
// onto paid USA ASIC rentals — same module as country hubs and the money page.
export default async function MapPage() {
  const byCountry: Record<string, CountryGroup> = {};
  for (const v of VENDORS) {
    if (!v.country) continue;
    const g = (byCountry[v.country] ??= { count: 0, vendors: [] });
    g.count += 1;
    g.vendors.push({
      name: v.name,
      slug: vendorSlug(v),
      category: CATEGORY_LABELS[v.category],
      handle: v.handle,
    });
  }
  for (const g of Object.values(byCountry)) {
    g.vendors.sort((a, b) => a.name.localeCompare(b.name));
  }
  const countryCount = Object.keys(byCountry).length;
  const mappedVendorCount = Object.values(byCountry).reduce(
    (a, g) => a + g.count,
    0,
  );
  const sortedCountries = Object.entries(byCountry).sort(
    (a, b) => b[1].count - a[1].count,
  );

  const FAQ = [
    {
      q: "What are the dots on this map?",
      a: "Countries of listed online shops. Each dot is a country where a human-verified store in this directory is based or ships from. They are not points of interest on a street.",
    },
    {
      q: "Where do I find a cafe I can walk into?",
      a: "Use BTC Map (https://btcmap.org) and Blink. This atlas is the country view of independent online stores that take native bitcoin, not a walk-in pin map.",
    },
  ];

  const MAP_LD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${URL_}/#map`,
        url: URL_,
        name: "Online shops by country",
        description: `Human-verified online shops that accept bitcoin, grouped across ${countryCount} countries.`,
        isPartOf: { "@id": "https://galaxymind.space/#website" },
        publisher: { "@id": "https://galaxymind.space/#org" },
        inLanguage: "en-US",
        mainEntity: { "@id": `${URL_}/#country-list` },
      },
      {
        "@type": "ItemList",
        "@id": `${URL_}/#country-list`,
        name: "Countries of listed online shops",
        numberOfItems: sortedCountries.length,
        itemListElement: sortedCountries.map(([code, group], i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `https://galaxymind.space/spend-bitcoin-in/${countrySlug(code)}`,
          name: `${COUNTRIES[code]?.label ?? code} · ${group.count} shop${group.count === 1 ? "" : "s"}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      buildBreadcrumb([
        { name: "Galaxy Mind", url: "https://galaxymind.space" },
        { name: "Online shops by country", url: URL_ },
      ]),
    ],
  };

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(MAP_LD) }}
      />
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <p className="night-bench-kicker">
          Online shops by country · {mappedVendorCount} shops · {countryCount}{" "}
          countries
        </p>
        <h1 className="display-title mb-3">
          Online shops, by country.
        </h1>
        <p className="night-bench-lede mb-6">
          Every dot is a country of listed online shops that take native
          bitcoin. Not a street pin, and not a cafe finder. Walk-in spots
          live on BTC Map.
        </p>

        {(() => {
          const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
          const fresh = VENDORS.filter(
            (v) => v.listedAt >= weekAgo && v.country,
          )
            .sort((a, b) => b.listedAt - a.listedAt)
            .slice(0, 6);
          if (fresh.length === 0) return null;
          return (
            <div className="mb-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div className="mb-2 font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                New this week · on the map
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {fresh.map((v) => {
                  const cc = v.country!;
                  const info = COUNTRIES[cc];
                  return (
                    <li key={vendorSlug(v)}>
                      <Link
                        href={`/v/${vendorSlug(v)}`}
                        className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-ink)]"
                      >
                        {info?.flag ?? ""} {v.name}
                        <span className="text-[var(--text-tertiary)]">
                          {" "}
                          · {info?.label ?? cc}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 font-mono t-xs uppercase tracking-widest">
                <Link href="/today" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                  Daily briefing →
                </Link>
              </div>
            </div>
          );
        })()}

        <MapReturnPulse listedAts={VENDORS.map((v) => v.listedAt)} />

        <MapExplorer byCountry={byCountry} />

        <section className="mt-14">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-5">
            Every country · every listed shop
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedCountries.map(([cc, group]) => {
              const info = COUNTRIES[cc];
              if (!info) return null;
              return (
                <div
                  key={cc}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
                >
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      <Link
                        href={`/spend-bitcoin-in/${countrySlug(info.label)}`}
                        className="hover:text-[var(--accent-ink)] transition-colors"
                        title={`Spend bitcoin in ${info.label} · the country guide`}
                      >
                        {info.flag} {info.label}
                      </Link>
                    </h3>
                    <Link
                      href={`/?country=${cc.toLowerCase()}`}
                      className="t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors tabular-nums"
                    >
                      {group.count} →
                    </Link>
                  </div>
                  <ul className="space-y-0.5">
                    {group.vendors.slice(0, 6).map((v) => (
                      <li key={v.slug} className="truncate">
                        <Link
                          href={`/v/${v.slug}`}
                          className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
                        >
                          {v.name}
                        </Link>
                      </li>
                    ))}
                    {group.vendors.length > 6 && (
                      <li className="t-xs font-mono text-[var(--text-tertiary)]">
                        + {group.vendors.length - 6} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <VendorHashrateModule className="mt-12 mb-0" />

        <section className="mt-12 border-t border-[var(--border-subtle)] pt-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6 max-w-2xl">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {f.q}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[var(--text-tertiary)]">
            <a
              href="https://btcmap.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2"
            >
              BTC Map
            </a>{" "}
            for walk-in pins.
          </p>
        </section>

        <section className="mt-12 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8 text-center">
          <p className="text-sm sm:text-base text-[var(--text-secondary)] mb-4 max-w-xl mx-auto leading-relaxed">
            No country near you? Be the first ·{" "}
            <span className="text-[var(--text-primary)]">
              your country joins this atlas the day your online shop is
              verified.
            </span>
          </p>
          <Link
            href="/submit"
            className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
          >
            Submit your online shop →
          </Link>
        </section>
      </div>

      <FooterDisclaimer />
    </main>
  );
}
