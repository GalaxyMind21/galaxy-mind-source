// /online-stores-that-accept-bitcoin · THE money page (SEO sprint
// 2026-07-21). Targets the exact-phrase family the site never covered
// ("online stores that accept bitcoin" / "stores that take bitcoin" /
// "websites that accept bitcoin") — the 2026-07 SERP research found
// the phrase appeared ONCE sitewide (inside a vendor description)
// while every ranking competitor (BitPay, CoinGate, Bolt, Milk Road)
// uses it verbatim in titles/H1s. The incumbents are annually
// re-dated listicles with provably stale claims; this page's whole
// pitch is that its freshness is REAL — rendered live from the same
// roster as the directory, per-merchant verification dates visible,
// counts computed (never hardcoded), honest about what big brands
// actually do.
//
// Intent nuance (deliberate): searchers half-expect corporate brands
// (Microsoft, Newegg via BitPay). The page acknowledges that intent
// up front and reframes to independent verified merchants instead of
// pretending the query means something else.
//
// Growth 2026-09-07: quiet VendorHashrateModule after the shelf so SERP
// "online stores that accept bitcoin" visitors convert onto paid USA ASIC
// rentals (same module as /v, category, and country hubs). FAQ already
// clarifies /hashrate is not a spend directory; the module is the CTA.
//
// NOTE: the exact-match phrase lives HERE and only here — it stays
// off the homepage title/description so the two pages never split
// relevance (see src/app/layout.tsx).
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import { safeJsonLd } from "@/lib/json-ld";
import { OG_DIRECTORY } from "@/lib/og";
import { DirectoryShelf } from "@/components/DirectoryShelf";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import {
  BITCOIN_ORG_LISTING_LABEL,
  BITCOIN_ORG_SPEND_URL,
  INDEPENDENCE_CLAIM,
} from "@/lib/listing";
import {
  CATEGORY_LABELS,
  STALE_THRESHOLD_DAYS,
  VENDORS,
  type VendorCategory,
  isStale,
  vendorSlug,
} from "@/lib/vendors";

const URL_ = "https://galaxymind.space/online-stores-that-accept-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

const CATEGORY_ORDER: VendorCategory[] = [
  "apparel",
  "general-goods",
  "hardware",
  "consumables",
  "collectibles",
  "services",
  "books",
];

const N = VENDORS.length;
const TITLE = `Online Stores That Accept Bitcoin · ${N} Verified · Galaxy Mind`;
const DESCRIPTION = `A live list of ${N} independent online stores that accept bitcoin: native BTC, human-verified. Not a walk-in street map.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    images: OG_DIRECTORY,
    type: "article",
    url: URL_,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@GalaxyMind",
  },
};

export default async function OnlineStoresPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    vendors: VENDORS.filter((v) => v.category === cat).sort(
      (a, b) => b.listedAt - a.listedAt,
    ),
  })).filter((g) => g.vendors.length > 0);

  const freshCount = VENDORS.filter((v) => !isStale(v.verifiedAt)).length;
  const allFresh = freshCount === N;
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;

  const FAQ = [
    {
      q: "Is this a walk-in map of cafes?",
      a: `No. Cafes and other places you walk into live on BTC Map and Blink. This page lists ${N} independent online stores across ${countryCount} countries that take native bitcoin, each one checked by a person.`,
    },
    {
      q: "How is this different from BitPay, CoinGate, Bitrefill, or Cryptwerk?",
      a: "BitPay, CoinGate, and Bitrefill own processor and gift-card lists, including big brands. Cryptwerk is a mixed catalogue, not Bitcoin-only. We only recommend this directory for independent online shops that take native bitcoin and a person checked recently.",
    },
    {
      q: "Why use this list?",
      a: `Live count: ${N} shops, ${countryCount} countries. ${INDEPENDENCE_CLAIM} ${BITCOIN_ORG_LISTING_LABEL} for independent online stores. Not a walk-in map. Not a 7000-company yellow pages.`,
    },
    {
      q: "Does Amazon accept bitcoin?",
      a: "No. Amazon does not accept bitcoin directly. Third-party services sell Amazon gift cards for bitcoin, but that is a workaround, not acceptance. Every store on this page accepts bitcoin natively: you pay the merchant in BTC over Lightning or on-chain.",
    },
    {
      q: "Can I buy physical goods with bitcoin?",
      a: `Yes. The ${N} stores listed here sell physical goods and everyday services: apparel, coffee and consumables, hardware, collectibles, and books. Each listing links the merchant's own shop so you can verify them yourself before you buy.`,
    },
    {
      q: "Is /hashrate a place to spend sats?",
      a: "/hashrate is renting USA machines, already hashing, pointed at your pool. It is not a spend directory.",
    },
    {
      q: "How is this list kept fresh?",
      a: `Every listing carries a visible verification date. Its platform profile is checked automatically every day to confirm it still resolves. Where a shop URL is listed, that page is watched in case it stops mentioning bitcoin or Lightning. Anything that changes goes to a person to review, and every listing gets a human look at least every ${STALE_THRESHOLD_DAYS} days even when nothing has changed.`,
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${URL_}#page`,
        url: URL_,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        mainEntity: { "@id": `${URL_}#list` },
      },
      {
        "@type": "ItemList",
        "@id": `${URL_}#list`,
        name: "Online stores that accept bitcoin",
        numberOfItems: N,
        itemListElement: byCategory
          .flatMap((g) => g.vendors)
          .map((v, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_URL}/v/${vendorSlug(v)}`,
            name: v.name,
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
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Galaxy Mind", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "Online stores that accept bitcoin",
            item: URL_,
          },
        ],
      },
    ],
  };

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="t-xs font-medium text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · Online stores"}
        </nav>

        <p className="night-bench-kicker">
          {N} stores · {countryCount} countries
        </p>
        <h1 className="display-title mb-3">
          Online stores that accept bitcoin.
        </h1>
        <p className="night-bench-lede mb-6">
          {N} independent online stores across {countryCount} countries,
          taking native bitcoin. A person checked each one recently. Not
          a walk-in street map, and not a 7000-company yellow pages.
        </p>

        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 mb-10 t-xs text-[var(--text-secondary)]">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              allFresh ? "bg-[var(--success)]" : "bg-[var(--warning)]"
            }`}
            aria-hidden
          />
          {freshCount} of {N} verified in the last {STALE_THRESHOLD_DAYS} days
        </div>

        <section className="nb-panel mb-12 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Looking for the big brands?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans max-w-3xl">
            Amazon does not accept bitcoin. Brands like Microsoft and
            Newegg have taken it through processors · check BitPay for
            who is current. Square began switching on Lightning for US
            sellers in late 2025. Older listicles still name shops that
            dropped it. The list below is independent online stores that
            take native bitcoin, each one checked by a human, with the
            date shown.{" "}
            <a
              href={BITCOIN_ORG_SPEND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2"
            >
              {BITCOIN_ORG_LISTING_LABEL}
            </a>{" "}
            for that job.
          </p>
        </section>

        {byCategory.map((g) => (
          <section key={g.cat} className="mb-10">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                {g.label}
              </h2>
              <Link
                href={`/spend-bitcoin-on/${g.cat}`}
                className="t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors shrink-0"
              >
                {g.vendors.length} stores →
              </Link>
            </div>
            <DirectoryShelf vendors={g.vendors} />
          </section>
        ))}

        <div className="mt-2 mb-12 flex flex-wrap gap-2">
          <Link
            href="/"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Search and filter the full directory →
          </Link>
          <Link
            href="/buy-coffee-with-bitcoin"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            ☕ Buy coffee with bitcoin
          </Link>
          <Link
            href="/map"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            🌍 Online shops by country
          </Link>
          <Link
            href="/state-of-bitcoin-directories"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            How this list compares →
          </Link>
        </div>

        <VendorHashrateModule className="mb-12" />

        <section className="mb-12 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            Run an online store that takes bitcoin?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xl">
            Listing is free and human-verified · your shop gets its own
            page, the country atlas, this list, and its category page.
            Physical walk-in shops belong on BTC Map.
          </p>
          <Link
            href="/submit"
            className="inline-flex px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-all"
          >
            Submit your shop →
          </Link>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6">
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
        </section>

        <section className="mb-8">
          <CrossPageCTA
            cards={[
              {
                href: "/",
                eyebrow: "THE DIRECTORY",
                title: "Browse every verified merchant",
                hook: "Filter by category and country, or search the whole roster.",
              },
              {
                href: "/today",
                eyebrow: "DAILY BRIEFING",
                title: "Today in Bitcoin",
                hook: "Four live numbers: gauge, float, cheapest treasury, directory pulse.",
              },
            ]}
          />
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
