// /spend-bitcoin-in/[country] · programmatic country landing pages
// (growth pass 2026-07-08).
//
// The site's unique asset is the human-verified roster, but until now
// "where can I spend bitcoin in Germany?" had no Galaxy Mind page to
// rank for · countries existed only as client-side filters and one
// section on /map. These 20 pages are that answer: server-rendered
// from the SAME roster the directory uses (never a separate copy),
// one per country, with ItemList JSON-LD for search engines and AI
// answerers. Static at build (generateStaticParams over COUNTRIES),
// revalidated hourly, and they appear/disappear automatically as
// countries enter the roster.
//
// Thin-country honesty: a one-merchant country gets singular copy and
// the same real data · being the FIRST verified shop in a country is
// the story, not something to hide.
//
// Growth 2026-09-04: quiet VendorHashrateModule after the shelf so
// country-hub visitors (SERP "spend bitcoin in X") convert onto paid
// hashrate. Same module as /spend-bitcoin-on, category pages, and
// /v listings. Not a homepage hero.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { HUB_PROSE } from "@/lib/hub-prose";
import { OG_DIRECTORY } from "@/lib/og";
import { DirectoryShelf } from "@/components/DirectoryShelf";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  countrySlug,
  vendorSlug,
} from "@/lib/vendors";

export const revalidate = 3600;

type Params = { country: string };

// slug → ISO code, built once from the same COUNTRIES record the
// whole site uses.
const SLUG_TO_CC: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRIES).map(([cc, info]) => [countrySlug(info.label), cc]),
);

function vendorsIn(cc: string) {
  return VENDORS.filter((v) => v.country === cc).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function generateStaticParams(): Params[] {
  return Object.values(COUNTRIES).map((info) => ({
    country: countrySlug(info.label),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { country } = await params;
  const cc = SLUG_TO_CC[country];
  if (!cc) return {};
  const info = COUNTRIES[cc];
  const list = vendorsIn(cc);
  const url = `https://galaxymind.space/spend-bitcoin-in/${country}`;
  const title = `Spend Bitcoin in ${info.label} · ${list.length} verified merchant${list.length === 1 ? "" : "s"} · Galaxy Mind`;
  const description = `Spend bitcoin in ${info.label}: ${list.length} human-verified merchant${list.length === 1 ? "" : "s"} accepting BTC on-chain or via Lightning for everyday goods and services.`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
    images: OG_DIRECTORY, title, description, url, siteName: "Galaxy Mind", type: "website" },
    twitter: { card: "summary_large_image", title, description, site: "@GalaxyMind" },
  };
}

export default async function CountryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { country } = await params;
  const cc = SLUG_TO_CC[country];
  if (!cc) notFound();
  const info = COUNTRIES[cc];
  const list = vendorsIn(cc);
  if (list.length === 0) notFound(); // roster moved on · page retires

  const categories = [...new Set(list.map((v) => CATEGORY_LABELS[v.category]))];
  const others = Object.entries(COUNTRIES)
    .filter(([c]) => c !== cc && VENDORS.some((v) => v.country === c))
    .map(([c, i]) => ({ cc: c, ...i }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Verified Bitcoin merchants in ${info.label}`,
    description: `Human-verified merchants in ${info.label} accepting bitcoin (on-chain or Lightning) for everyday goods and services.`,
    numberOfItems: list.length,
    itemListElement: list.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://galaxymind.space/v/${vendorSlug(v)}`,
      name: v.name,
    })),
  };

  // De-templated prose (2026-08-04) · unique roster-grounded intro + FAQ
  // per hub from lib/hub-prose. {COUNT} interpolates the LIVE count so
  // the answers never go stale. Absent entry → the page renders exactly
  // as before, so a future country needs no prose to launch.
  const prose = HUB_PROSE[cc];
  const fillCount = (s: string) => s.replaceAll("{COUNT}", String(list.length));
  const faqData = prose
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: prose.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: fillCount(f.a) },
        })),
      }
    : null;

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      {/* Static roster data + house strings only · no user input.
          safeJsonLd escapes for defense in depth. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      {faqData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(faqData) }}
        />
      )}

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <p className="night-bench-kicker">
          {info.label} · {list.length} verified
        </p>
        <h1 className="display-title mb-3">
          Spend bitcoin in {info.label}.
        </h1>
        <p className="night-bench-lede mb-8">
          {list.length === 1
            ? `${info.label} has its first human-verified bitcoin merchant · vetted for native on-chain or Lightning payments, no wrapped-coin gateways.`
            : `Every merchant below is human-verified to accept bitcoin for everyday goods · native on-chain or Lightning, no wrapped-coin gateways. ${categories.length > 1 ? `From ${categories.slice(0, 3).join(", ").toLowerCase()} and beyond.` : ""}`}
        </p>

        <DirectoryShelf vendors={list} />

        <VendorHashrateModule className="mt-10 mb-10" />

        {prose && (
          <section className="mt-10 max-w-2xl">
            <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
              {prose.intro}
            </p>
          </section>
        )}

        {prose && (
          <section className="mt-10 max-w-2xl">
            <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
              Questions people ask
            </h2>
            <dl className="space-y-4">
              {prose.faq.map((f) => (
                <div key={f.q}>
                  <dt className="text-sm font-semibold text-[var(--text-primary)]">
                    {f.q}
                  </dt>
                  <dd className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                    {fillCount(f.a)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href={`/?country=${cc}`}
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Filter the full directory →
          </Link>
          <Link
            href="/map"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            See {info.label} on the map
          </Link>
        </div>

        <section className="mt-12 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            Run a shop in {info.label}?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xl">
            Listing is free and human-verified · your shop gets its own
            page, a spot on the world map, and this country page. The
            circular economy grows one merchant at a time.
          </p>
          <Link
            href="/submit"
            className="inline-flex px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-all"
          >
            Submit your shop →
          </Link>
        </section>

        <section className="mt-12">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
            Spend bitcoin elsewhere
          </h2>
          <div className="flex flex-wrap gap-2">
            {others.map((o) => (
              <Link
                key={o.cc}
                href={`/spend-bitcoin-in/${countrySlug(o.label)}`}
                className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] t-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
              >
                {o.flag} {o.label}
              </Link>
            ))}
          </div>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
