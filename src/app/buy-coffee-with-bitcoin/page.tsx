// /buy-coffee-with-bitcoin · question-page capture (SEO sprint
// 2026-07-21). The 2026-07 SERP research called "buy coffee with
// bitcoin" the single best category opportunity on the board: the
// current results are a think-piece about why nobody buys coffee
// with bitcoin, Quora, a barista blog, and two individual merchants —
// no directory, no list of actual BTC-accepting roasters. This page
// answers the question in the first sentence (PAA/AI-answer format)
// and backs it with the live verified roster.
//
// The vendor set is a KEYWORD filter over the same VENDORS array the
// directory renders (coffee/roaster/espresso in name+description) —
// self-maintaining: a new coffee vendor appears here on the next
// deploy with zero curation. If the filter ever catches a false
// positive, tighten the regex, don't hand-curate a list that drifts.
// Growth 2026-09-10: quiet VendorHashrateModule after the shelf chips so
// "buy coffee with bitcoin" SERP visitors (vs cafe/Lightning think-pieces and
// BTC Map / Blink walk-in pins) convert onto paid USA ASIC rentals — same
// module as /v, category, country, online-stores, LATAM, and /map.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { OG_DIRECTORY } from "@/lib/og";
import { DirectoryShelf } from "@/components/DirectoryShelf";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import {
  STALE_THRESHOLD_DAYS,
  VENDORS,
  vendorSlug,
} from "@/lib/vendors";

const URL_ = "https://galaxymind.space/buy-coffee-with-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

const COFFEE_RE = /coffee|roaster|espresso/i;
const coffeeVendors = VENDORS.filter((v) =>
  COFFEE_RE.test(`${v.name} ${v.description}`),
).sort((a, b) => b.listedAt - a.listedAt);

const N = coffeeVendors.length;
const TITLE = `Buy Coffee with Bitcoin · ${N} Verified Roasters That Ship · Galaxy Mind`;
const DESCRIPTION = `Buy coffee with bitcoin from ${N} human-verified roasters that ship beans for native BTC (Lightning or on-chain). Walk-in cups live on BTC Map.`;

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

export default async function BuyCoffeePage() {
  if (N === 0) notFound();
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const FAQ = [
    {
      q: "Can you buy coffee with bitcoin?",
      a: `Two jobs. A cup at a cafe is a walk-in pin: use BTC Map and Blink. Bags of beans that ship are this page: ${N} verified roasters and sellers take native bitcoin, over Lightning or on-chain, and send whole beans. Each listing shows the date a human last checked.`,
    },
    {
      q: "Does Starbucks accept bitcoin?",
      a: "No, not directly. Starbucks has never accepted bitcoin at the register; the closest anyone got was third-party payment apps, which have come and gone over the years. If you want beans that ship for bitcoin, independent roasters accept it natively.",
    },
    {
      q: "How do I actually pay a roaster in bitcoin?",
      a: "At checkout the store shows a bitcoin payment option, usually a Lightning invoice QR code. Scan it with any Lightning wallet, confirm, and the payment settles in seconds for a fraction of a cent in fees. On-chain payments work the same way with a regular bitcoin address.",
    },
    {
      q: "Isn't spending bitcoin a bad idea if it keeps going up?",
      a: "The circular-economy answer is spend and replace: pay the roaster in bitcoin, then rebuy the same amount with the fiat you would have spent. Your stack stays the same size, the merchant gets paid in bitcoin, and the circular economy grows. (In some countries spending bitcoin is a taxable event; check your local rules.)",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL_}#article`,
        headline: "Where to buy coffee beans with bitcoin",
        description: DESCRIPTION,
        url: URL_,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        mainEntity: { "@id": `${URL_}#list` },
      },
      {
        "@type": "ItemList",
        "@id": `${URL_}#list`,
        name: "Coffee roasters that ship beans for bitcoin",
        numberOfItems: N,
        itemListElement: coffeeVendors.map((v, i) => ({
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
            name: "Buy coffee beans with bitcoin",
            item: URL_,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="t-xs font-medium text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · Coffee beans"}
        </nav>

        <p className="night-bench-kicker">
          Coffee beans that ship · {N} verified
        </p>
        <h1 className="display-title mb-3">
          Coffee beans that ship for bitcoin.
        </h1>

        <section className="nb-panel my-6 p-6 sm:p-8">
          <p className="night-bench-kicker">The short answer</p>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            A cup at a cafe is a walk-in pin on BTC Map or Blink. This
            page is bags of beans.{" "}
            <span className="text-[var(--accent-ink)]">
              {N} verified roasters and sellers
            </span>{" "}
            below ship whole beans for native bitcoin, paid over Lightning
            or on-chain. Every one has been checked by a human within
            the last {STALE_THRESHOLD_DAYS} days or is flagged
            otherwise.
          </p>
        </section>

        <div className="mb-10">
          <DirectoryShelf vendors={coffeeVendors} />
        </div>

        <div className="mb-12 flex flex-wrap gap-2">
          <Link
            href="/spend-bitcoin-on/consumables"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            All consumables · honey, tea, food →
          </Link>
          <Link
            href="/online-stores-that-accept-bitcoin"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            Every online store that accepts bitcoin →
          </Link>
          <Link
            href="/spend-and-replace"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            ↻ Spend and replace
          </Link>
        </div>

        <VendorHashrateModule className="mb-12" />

        <section className="mb-12 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            Roast coffee and take bitcoin?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xl">
            Listing is free and human-verified · your roastery gets its
            own page, this list, and the country atlas. Bitcoiners are
            looking for beans that ship.
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

        <FooterDisclaimer />
      </div>
    </main>
  );
}
