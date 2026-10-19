// /spend-bitcoin-in/tennessee · state guide (2026-10-18, SEO brief rank 2).
// A static sibling of the /spend-bitcoin-in/[country] hubs, so it wins the
// route over the dynamic segment. Answer-first: the July 1, 2026 kiosk ban
// with citations and an "as of" date, hand-checked walk-in anchors, BTC Map
// for every other walk-in pin, and verified online shops from the SAME
// roster the directory uses. Never mentions mining, hashrate or where any
// machines run. Article + CollectionPage/ItemList + FAQPage + BreadcrumbList
// JSON-LD built from lib/state-guide-copy.ts so the markup matches the page.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import { VENDORS, CATEGORY_LABELS, vendorSlug } from "@/lib/vendors";
import {
  TN_URL as URL,
  TN_META_TITLE,
  TN_DESCRIPTION,
  TN_H1,
  TN_OG_ALT,
  TN_PUBLISHED,
  TN_UPDATED,
  TN_AS_OF,
  TN_SHORT,
  NOT_LEGAL_ADVICE,
  TN_LAW_URL,
  TN_BILL_URL,
  TN_TDFI_URL,
  TN_AG_URL,
  TN_DOCKET_URL,
  FTC_ATM_URL,
  TN_LAW_QUOTE,
  TN_LAW_SUMMARY,
  TN_LAW_SCOPE,
  TN_WHY,
  TN_LAWSUIT,
  TN_ATM_MEANING,
  TN_DIRECTORY_INTRO,
  TN_DIRECTORY_PLACES,
  TN_CHAIN_PLACE,
  TN_CONFERENCE_TIP,
  BTCMAP_URL,
  TN_CITIES,
  TN_MAP_NOTE,
  TN_ONLINE_INTRO,
  TN_GET_BITCOIN,
  TN_BUSINESS,
  TN_ABOUT_TITLE,
  TN_TREASURY_LINE,
  TN_ABOUT_BODY,
  TN_FAQ,
  type TnPlace,
  isUsShop,
  onlinePicks,
} from "@/lib/state-guide-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TN_META_TITLE,
  description: TN_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: TN_META_TITLE,
    description: TN_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/spend-bitcoin-in/tennessee/opengraph-image", TN_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: TN_META_TITLE,
    description: TN_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

const LINK_CLS =
  "text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]";
const CARD_CLS =
  "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate";
const H2_CLS = "text-2xl font-semibold tracking-tight mb-4";
const H3_CLS = "text-base font-semibold text-[var(--text-primary)] mb-2";
const BODY_CLS = "text-sm text-[var(--text-secondary)] leading-relaxed font-sans";
const CTA_CLS =
  "inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black";

const UPDATED_LABEL = new Date(`${TN_UPDATED}T12:00:00Z`).toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
      {items.map((it) => (
        <li key={it}>{it}</li>
      ))}
    </ul>
  );
}

function PlaceCard({ p }: { p: TnPlace }) {
  const inDir = p.inDirectory && VENDORS.some((v) => v.name === p.name);
  return (
    <div className={CARD_CLS} data-tn-place={p.name}>
      <h3 className={H3_CLS}>{p.name}</h3>
      <p className={BODY_CLS}>{p.body}</p>
      <p className="mt-3 text-xs text-[var(--text-tertiary)] font-sans">
        <a href={p.href} className={LINK_CLS} rel="noopener" target="_blank">
          Visit their site
        </a>
        {inDir && (
          <>
            {" · "}
            <Link href={`/v/${vendorSlug({ name: p.name })}`} className={LINK_CLS}>
              See their Galaxy Mind listing
            </Link>
          </>
        )}
        {" · "}Last checked <time dateTime={TN_UPDATED}>{UPDATED_LABEL}</time>
      </p>
    </div>
  );
}

export default async function TennesseePage() {
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  // Same count the United States hub shows, so the CTA and that page agree.
  const usCount = VENDORS.filter((v) => v.country === "US").length;
  const picks = onlinePicks();
  const named = [...TN_DIRECTORY_PLACES, TN_CHAIN_PLACE];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: TN_H1,
        description: TN_DESCRIPTION,
        url: URL,
        datePublished: TN_PUBLISHED,
        dateModified: TN_UPDATED,
        mainEntityOfPage: URL,
        image: `${SITE_URL}/spend-bitcoin-in/tennessee/opengraph-image`,
        author: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isPartOf: { "@id": `${SITE_URL}/#website` },
        spatialCoverage: { "@type": "State", name: "Tennessee" },
        inLanguage: "en-US",
      },
      {
        "@type": "CollectionPage",
        "@id": `${URL}#collection`,
        name: TN_H1,
        url: URL,
        spatialCoverage: { "@type": "State", name: "Tennessee" },
        mainEntity: {
          "@type": "ItemList",
          name: "Places that take bitcoin in Tennessee",
          itemListElement: named.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: { "@type": "LocalBusiness", name: p.name, url: p.href, areaServed: { "@type": "State", name: "Tennessee" } },
          })),
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${URL}#faq`,
        mainEntity: TN_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      buildBreadcrumb([
        { name: "Galaxy Mind", url: `${SITE_URL}/` },
        { name: "United States", url: `${SITE_URL}/spend-bitcoin-in/united-states` },
        { name: "Tennessee", url: URL },
      ]),
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
      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · "}
          <Link href="/spend-bitcoin-in/united-states" className="hover:text-[var(--accent-ink)] transition-colors">
            United States
          </Link>
          {" · Tennessee"}
        </nav>
        <h1 className="display-title mb-4">{TN_H1}</h1>
        <p className="t-xs text-[var(--text-tertiary)] font-sans">
          Last updated <time dateTime={TN_UPDATED}>{UPDATED_LABEL}</time> · By Galaxy Mind
        </p>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{TN_SHORT}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/spend-bitcoin-in/united-states" className={CTA_CLS} data-tn-cta="primary">
              Shop online with bitcoin: {usCount} verified US shops →
            </Link>
            <a
              href={BTCMAP_URL}
              rel="noopener"
              target="_blank"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--border-subtle)] px-6 text-[15px] font-semibold text-[var(--text-primary)]"
            >
              Walk-in places on BTC Map →
            </a>
          </div>
        </section>

        <section className="mb-10" id="atm-ban">
          <h2 className={H2_CLS}>Bitcoin ATMs in Tennessee: banned since July 1, 2026</h2>
          <h3 className={H3_CLS}>What Public Chapter 766 says</h3>
          <p className={BODY_CLS}>{TN_LAW_SUMMARY}</p>
          <blockquote className="my-4 border-l-2 border-[var(--accent)]/50 pl-4 text-sm italic text-[var(--text-primary)] font-sans">
            &ldquo;{TN_LAW_QUOTE}.&rdquo;
          </blockquote>
          <p className={BODY_CLS}>
            {TN_LAW_SCOPE} Read the{" "}
            <a href={TN_LAW_URL} className={LINK_CLS} rel="noopener" target="_blank">
              bill text
            </a>
            , the{" "}
            <a href={TN_BILL_URL} className={LINK_CLS} rel="noopener" target="_blank">
              bill history
            </a>{" "}
            and the{" "}
            <a href={TN_TDFI_URL} className={LINK_CLS} rel="noopener" target="_blank">
              Department of Financial Institutions bulletin
            </a>
            .
          </p>
          <h3 className={`mt-6 ${H3_CLS}`}>Why Tennessee banned them</h3>
          <p className={BODY_CLS}>
            {TN_WHY}{" "}
            <a href={TN_AG_URL} className={LINK_CLS} rel="noopener" target="_blank">
              Read the Attorney General&apos;s release
            </a>
            .
          </p>
          <h3 className={`mt-6 ${H3_CLS}`}>Where the lawsuit stands (as of {TN_AS_OF})</h3>
          <p className={BODY_CLS}>
            {TN_LAWSUIT}{" "}
            <a href={TN_DOCKET_URL} className={LINK_CLS} rel="noopener" target="_blank">
              See the public docket
            </a>
            .
          </p>
          <h3 className={`mt-6 ${H3_CLS}`}>What this means if you used a bitcoin ATM</h3>
          <Bullets items={TN_ATM_MEANING} />
          <p className={`mt-3 ${BODY_CLS}`}>
            The FTC explains{" "}
            <a href={FTC_ATM_URL} className={LINK_CLS} rel="noopener" target="_blank">
              how bitcoin ATM scams work
            </a>
            .
          </p>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">{NOT_LEGAL_ADVICE}</p>
        </section>

        <section className="mb-10" id="where-to-spend">
          <h2 className={H2_CLS}>Places we have checked</h2>
          <p className={`mb-4 ${BODY_CLS}`}>{TN_DIRECTORY_INTRO}</p>
          <div className="space-y-4">
            {TN_DIRECTORY_PLACES.map((p) => (
              <PlaceCard key={p.name} p={p} />
            ))}
            <PlaceCard p={TN_CHAIN_PLACE} />
          </div>
          <p className={`mt-4 ${BODY_CLS}`}>
            {TN_CONFERENCE_TIP} For every other walk-in place, open{" "}
            <a href="https://btcmap.org/map" className={LINK_CLS} rel="noopener" target="_blank">
              Tennessee on BTC Map
            </a>
            .
          </p>
        </section>

        <section className="mb-10" id="other-cities">
          <h2 className={H2_CLS}>Other Tennessee cities</h2>
          <div className="space-y-4">
            {TN_CITIES.map((c) => (
              <div key={c.name} className={CARD_CLS}>
                <h3 className={H3_CLS}>{c.name}</h3>
                <p className={BODY_CLS}>{c.body}</p>
                <p className="mt-3 text-xs text-[var(--text-tertiary)] font-sans">
                  <a href={c.mapHref} className={LINK_CLS} rel="noopener" target="_blank">
                    {c.name} on BTC Map
                  </a>
                  {c.extra && (
                    <>
                      {" · "}
                      <a href={c.extra.href} className={LINK_CLS} rel="noopener" target="_blank">
                        {c.extra.label}
                      </a>
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
          <p className={`mt-4 ${BODY_CLS}`}>{TN_MAP_NOTE}</p>
        </section>

        <section className="mb-10" id="online">
          <h2 className={H2_CLS}>Shop online with bitcoin from Tennessee</h2>
          <p className={`mb-4 ${BODY_CLS}`}>{TN_ONLINE_INTRO}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {picks.map((v) => (
              <li key={v.name} className={CARD_CLS}>
                <Link href={`/v/${vendorSlug(v)}`} className={`font-semibold ${LINK_CLS}`}>
                  {v.name}
                </Link>
                <p className="mt-1 text-xs text-[var(--text-tertiary)] font-sans">{CATEGORY_LABELS[v.category]}</p>
              </li>
            ))}
          </ul>
          <p className={`mt-4 ${BODY_CLS}`}>
            See all {usCount} on the{" "}
            <Link href="/spend-bitcoin-in/united-states" className={LINK_CLS}>
              United States page
            </Link>
            , browse{" "}
            <Link href="/online-stores-that-accept-bitcoin" className={LINK_CLS}>
              online stores that accept bitcoin
            </Link>
            , or shop by category on{" "}
            <Link href="/spend-bitcoin-on" className={LINK_CLS}>
              spend bitcoin on
            </Link>
            .
          </p>
        </section>

        <section className="mb-10" id="get-bitcoin">
          <h2 className={H2_CLS}>How to get bitcoin in Tennessee without an ATM</h2>
          <Bullets items={TN_GET_BITCOIN} />
          <p className={`mt-4 ${BODY_CLS}`}>
            Our{" "}
            <Link href="/how-to-buy-bitcoin" className={LINK_CLS}>
              beginner&apos;s guide to buying bitcoin
            </Link>{" "}
            covers the main options and how to stay safe. When you&apos;re ready to spend, here is{" "}
            <Link href="/how-to-pay-with-lightning" className={LINK_CLS}>
              how to pay with Lightning
            </Link>{" "}
            at a counter, and how to{" "}
            <Link href="/spend-and-replace" className={LINK_CLS}>
              spend and replace
            </Link>{" "}
            what you use.
          </p>
        </section>

        <section className="mb-10" id="businesses">
          <h2 className={H2_CLS}>Tennessee businesses: start accepting bitcoin</h2>
          <p className={BODY_CLS}>{TN_BUSINESS}</p>
          <p className={`mt-4 ${BODY_CLS}`}>
            <Link href="/how-to-accept-bitcoin" className={LINK_CLS}>
              Accept bitcoin at your Tennessee business
            </Link>
            {" · "}
            <Link href="/submit" className={LINK_CLS}>
              List your shop
            </Link>
            {" · "}
            <Link href="/badge" className={LINK_CLS}>
              Get the listing badge
            </Link>
          </p>
        </section>

        <section className="mb-10" id="faq">
          <h2 className={H2_CLS}>Tennessee bitcoin FAQ</h2>
          <div className="space-y-4">
            {TN_FAQ.map((f) => (
              <div key={f.q} className={CARD_CLS}>
                <h3 className={H3_CLS}>{f.q}</h3>
                <p className={BODY_CLS}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="hero-glass mb-10 rounded-2xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate" id="about">
          <h2 className="text-xl font-semibold tracking-tight mb-2">{TN_ABOUT_TITLE}</h2>
          <p className={BODY_CLS}>
            {TN_TREASURY_LINE} {TN_ABOUT_BODY}
          </p>
        </section>

        <section className="mb-6" id="sources">
          <h2 className="text-lg font-semibold tracking-tight mb-2">Sources</h2>
          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">
            Legal status and business checks as of {TN_AS_OF}. Sources: Tennessee General Assembly (HB2505, Public
            Chapter 766), the Department of Financial Institutions, the Attorney General&apos;s office, the federal court
            docket, the FTC, BTC Map, and each business&apos;s own website and public posts. {NOT_LEGAL_ADVICE}
          </p>
        </section>

        <FooterDisclaimer />
      </article>
    </main>
  );
}
