// /spend-bitcoin-on/[category] · programmatic category landing pages
// (growth pass round 2 · 2026-07-09). Companion to the country pages:
// "where can I spend bitcoin on apparel?" now has a canonical answer,
// one page per directory category, server-rendered from the same
// roster the directory filters. Categories are a closed set
// (CATEGORY_LABELS), so these are fully static.
//
// Growth 2026-09-03: quiet VendorHashrateModule after the shelf so
// category visitors (especially /hardware) convert onto paid
// hashrate. Same module as the category index and /v listings.
// Not a homepage hero.

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
  type VendorCategory,
} from "@/lib/vendors";

export const revalidate = 3600;

type Params = { category: string };

const CATS = Object.keys(CATEGORY_LABELS) as VendorCategory[];

const COFFEE_RE = /coffee|roaster|espresso/i;
const COFFEE_COUNT = VENDORS.filter((v) =>
  COFFEE_RE.test(`${v.name} ${v.description}`),
).length;

function vendorsOf(cat: VendorCategory) {
  return VENDORS.filter((v) => v.category === cat).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function generateStaticParams(): Params[] {
  return CATS.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category } = await params;
  if (!CATS.includes(category as VendorCategory)) return {};
  const cat = category as VendorCategory;
  const label = CATEGORY_LABELS[cat];
  const list = vendorsOf(cat);
  const url = `https://galaxymind.space/spend-bitcoin-on/${category}`;
  const titleLabel =
    ({ hardware: "Hardware", collectibles: "Collectibles", books: "Books" } as
      Partial<Record<typeof cat, string>>)[cat] ?? label;
  const title = `Spend Bitcoin on ${titleLabel} · ${list.length} verified merchant${list.length === 1 ? "" : "s"} · Galaxy Mind`;
  const description = `${label} you can buy with bitcoin: ${list.length} human-verified merchant${list.length === 1 ? "" : "s"} accepting BTC on-chain or via Lightning, monitored daily and human-reviewed on change.`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
    images: OG_DIRECTORY, title, description, url, siteName: "Galaxy Mind", type: "website" },
    twitter: { card: "summary_large_image", title, description, site: "@GalaxyMind" },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category } = await params;
  if (!CATS.includes(category as VendorCategory)) notFound();
  const cat = category as VendorCategory;
  const label = CATEGORY_LABELS[cat];
  const list = vendorsOf(cat);
  if (list.length === 0) notFound();

  const countryChips = [...new Set(list.map((v) => v.country).filter(Boolean))]
    .map((cc) => ({ cc: cc as string, ...COUNTRIES[cc as string] }))
    .filter((c) => c.label)
    .sort((a, b) => a.label.localeCompare(b.label));
  const siblings = CATS.filter((c) => c !== cat && vendorsOf(c).length > 0);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Verified Bitcoin merchants · ${label}`,
    description: `Human-verified ${label.toLowerCase()} merchants accepting bitcoin (on-chain or Lightning).`,
    numberOfItems: list.length,
    itemListElement: list.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://galaxymind.space/v/${vendorSlug(v)}`,
      name: v.name,
    })),
  };

  const prose = HUB_PROSE[`cat:${cat}`];
  const fillCount = (s: string) =>
    s
      .replaceAll("{COUNT}", String(list.length))
      .replaceAll("{COFFEE}", String(COFFEE_COUNT));
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
        <nav
          aria-label="Breadcrumb"
          className="micro-label mb-3 text-[var(--text-tertiary)]"
        >
          <Link
            href="/spend-bitcoin-on"
            className="hover:text-[var(--accent-ink)] transition-colors"
          >
            Spend by category
          </Link>
          <span aria-hidden className="mx-2">
            /
          </span>
          <span>{label}</span>
        </nav>
        <p className="night-bench-kicker">
          {label} · {list.length} verified
        </p>
        <h1 className="display-title mb-3">
          Spend bitcoin on {label.toLowerCase()}.
        </h1>
        <p className="night-bench-lede mb-8">
          Every merchant below is human-verified to accept bitcoin for
          everyday goods · native on-chain or Lightning, no wrapped-coin
          gateways.{" "}
          {countryChips.length > 1
            ? `Shipping and serving from ${countryChips.length} countries.`
            : ""}
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
            href={`/?category=${cat}`}
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Filter the full directory →
          </Link>
          {cat === "consumables" && (
            <Link
              href="/buy-coffee-with-bitcoin"
              className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
            >
              ☕ Buy coffee with bitcoin →
            </Link>
          )}
          {countryChips.slice(0, 6).map((c) => (
            <Link
              key={c.cc}
              href={`/spend-bitcoin-in/${countrySlug(c.label)}`}
              className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
            >
              {c.flag} {c.label}
            </Link>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            Sell {label.toLowerCase()} for bitcoin?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xl">
            Listing is free and human-verified · your shop gets its own
            page, the world map, and this category page.
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
            Spend bitcoin on everything else
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/spend-bitcoin-on"
              className="px-3 py-1.5 rounded-full border border-[var(--accent)]/40 t-xs text-[var(--accent-ink)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              All categories
            </Link>
            {siblings.map((c) => (
              <Link
                key={c}
                href={`/spend-bitcoin-on/${c}`}
                className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] t-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
              >
                {CATEGORY_LABELS[c]}
              </Link>
            ))}
          </div>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
