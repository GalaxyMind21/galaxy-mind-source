// /hashrate/antminer-s21-xp · model page for the machine behind our 270 TH/s
// chunks (2026-10-18, SEO brief rank 1). The operator approved naming the
// model here as a one-time exception; every other rental surface stays
// model-free. Specs are Bitmain's own, cited on the page. Solo odds are live
// (network hashrate from the same getNetworkPhs the desk uses, exact
// blockOdds form), with an honest SYNCING line when the feed is down.
// No marketplace link and no price: the rent CTA goes to /hashrate, which
// owns the gated marketplace mention and the referral disclosure.
// Product (no offers) + FAQPage + BreadcrumbList JSON-LD, built from
// lib/s21xp-copy.ts so the markup matches the visible text.
import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import { getNetworkPhs } from "@/lib/hashrate";
import { blockOdds } from "@/lib/block-odds";
import { vendorSlug } from "@/lib/vendors";
import {
  S21XP_URL as URL,
  S21XP_META_TITLE,
  S21XP_DESCRIPTION,
  S21XP_H1,
  S21XP_OG_ALT,
  S21XP_PUBLISHED,
  S21XP_UPDATED,
  S21XP_SHORT,
  S21XP_SPECS,
  S21XP_SPEC_SOURCE,
  BITMAIN_S21XP_SPEC_URL,
  S21XP_TH,
  S21XP_WATTS,
  S21XP_J_PER_TH,
  S21XP_COMPARE,
  S21XP_COMPARE_NOTE,
  S21XP_EFFICIENCY,
  S21XP_HYDRO,
  S21XP_WORTH_SHORT,
  S21XP_WORTH_NUMBERS,
  S21XP_WORTH_FORMULA,
  S21XP_WORTH_SOURCES,
  S21XP_ODDS_SHORT,
  S21XP_ODDS_DAY,
  S21XP_ODDS_WEEK,
  S21XP_ODDS_LINE,
  S21XP_ODDS_NOTE,
  S21XP_ODDS_NONE,
  S21XP_ODDS_WHY,
  S21XP_RENT_SHORT,
  S21XP_RENT_POINTS,
  S21XP_DELIVERY,
  S21XP_RENT_VS_BUY,
  S21XP_NOISE,
  S21XP_BUY_INSTEAD,
  S21XP_BUY_VENDORS,
  S21XP_FAQ,
  roundOneIn,
} from "@/lib/s21xp-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: S21XP_META_TITLE,
  description: S21XP_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: S21XP_META_TITLE,
    description: S21XP_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/hashrate/antminer-s21-xp/opengraph-image", S21XP_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: S21XP_META_TITLE,
    description: S21XP_DESCRIPTION,
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

const UPDATED_LABEL = new Date(`${S21XP_UPDATED}T12:00:00Z`).toLocaleDateString("en-US", {
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

async function LiveOdds() {
  const networkPhs = await getNetworkPhs();
  const ph = S21XP_TH / 1000;
  const day = networkPhs != null ? blockOdds({ ph, hours: 24, networkPhs }) : null;
  const week = networkPhs != null ? blockOdds({ ph, hours: 24 * 7, networkPhs }) : null;
  if (networkPhs == null || !day || !week) {
    return (
      <div className={CARD_CLS} data-s21xp-odds="syncing">
        <p className="micro-label text-[var(--text-tertiary)]">SYNCING</p>
        <p className={`mt-2 ${BODY_CLS}`}>{S21XP_ODDS_NONE}</p>
      </div>
    );
  }
  const eh = Math.round(networkPhs / 1000).toLocaleString("en-US");
  return (
    <div className={CARD_CLS} data-s21xp-odds="live">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="micro-label text-[var(--text-tertiary)]">{S21XP_ODDS_DAY}</p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            {S21XP_ODDS_LINE.replace("{N}", roundOneIn(day.oneInN))}
          </p>
        </div>
        <div>
          <p className="micro-label text-[var(--text-tertiary)]">{S21XP_ODDS_WEEK}</p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            {S21XP_ODDS_LINE.replace("{N}", roundOneIn(week.oneInN))}
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">
        {S21XP_ODDS_NOTE.replace("{EH}", eh)}
      </p>
    </div>
  );
}

export default async function AntminerS21XpPage() {
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: S21XP_H1,
        description: S21XP_DESCRIPTION,
        url: URL,
        datePublished: S21XP_PUBLISHED,
        dateModified: S21XP_UPDATED,
        mainEntityOfPage: URL,
        image: `${SITE_URL}/hashrate/antminer-s21-xp/opengraph-image`,
        author: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${URL}#product` },
        inLanguage: "en-US",
      },
      {
        // No offers: we do not sell the machine. Specs only, cited.
        "@type": "Product",
        "@id": `${URL}#product`,
        name: "Antminer S21 XP",
        brand: { "@type": "Brand", name: "Bitmain" },
        category: "SHA-256 ASIC miner",
        description: S21XP_SHORT,
        url: URL,
        subjectOf: { "@type": "WebPage", url: BITMAIN_S21XP_SPEC_URL, name: "Bitmain S21 XP Specifications" },
        additionalProperty: [
          { "@type": "PropertyValue", name: "Hashrate", value: S21XP_TH, unitText: "TH/s" },
          { "@type": "PropertyValue", name: "Power at the wall", value: S21XP_WATTS, unitCode: "WTT" },
          { "@type": "PropertyValue", name: "Efficiency", value: S21XP_J_PER_TH, unitText: "J/TH" },
          { "@type": "PropertyValue", name: "Algorithm", value: "SHA-256" },
          { "@type": "PropertyValue", name: "Cooling", value: "Air" },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${URL}#faq`,
        mainEntity: S21XP_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      buildBreadcrumb([
        { name: "Galaxy Mind", url: `${SITE_URL}/` },
        { name: "Rent hashrate", url: `${SITE_URL}/hashrate` },
        { name: "Antminer S21 XP", url: URL },
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
          <Link href="/hashrate" className="hover:text-[var(--accent-ink)] transition-colors">
            Rent hashrate
          </Link>
          {" · Antminer S21 XP"}
        </nav>
        <h1 className="display-title mb-4">{S21XP_H1}</h1>
        <p className="t-xs text-[var(--text-tertiary)] font-sans">
          Last updated <time dateTime={S21XP_UPDATED}>{UPDATED_LABEL}</time> · By Galaxy Mind
        </p>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{S21XP_SHORT}</p>
          <Link href="/hashrate" className={`mt-5 ${CTA_CLS}`} data-s21xp-cta="hero">
            Rent an S21 XP by the hour →
          </Link>
        </section>

        <section className="mb-10" id="specs">
          <h2 className={H2_CLS}>S21 XP specs at a glance</h2>
          <div className={`${CARD_CLS} overflow-x-auto`}>
            <table className="w-full text-sm font-sans">
              <caption className="sr-only">Antminer S21 XP specifications from Bitmain</caption>
              <tbody>
                {S21XP_SPECS.map((s) => (
                  <tr key={s.label} className="border-b border-[var(--border-subtle)] last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-medium text-[var(--text-tertiary)]">
                      {s.label}
                    </th>
                    <td className="py-2 text-[var(--text-primary)] tabular-nums">{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">
            {S21XP_SPEC_SOURCE}{" "}
            <a href={BITMAIN_S21XP_SPEC_URL} className={LINK_CLS} rel="noopener" target="_blank">
              Read Bitmain&apos;s spec page
            </a>
            .
          </p>
        </section>

        <section className="mb-10" id="compare">
          <h2 className={H2_CLS}>S21 XP vs S21 Pro vs S21 XP Hyd</h2>
          <div className={`${CARD_CLS} overflow-x-auto`}>
            <table className="w-full min-w-[520px] text-sm font-sans">
              <caption className="sr-only">Bitmain S21 XP, S21 Pro and S21 XP Hyd compared</caption>
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Model</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Hashrate</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Power</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Efficiency</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Cooling</th>
                  <th scope="col" className="py-2 font-medium">Supply</th>
                </tr>
              </thead>
              <tbody>
                {S21XP_COMPARE.map((r) => (
                  <tr key={r.model} className="border-t border-[var(--border-subtle)]">
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--text-primary)]">
                      <a href={r.source} className={LINK_CLS} rel="noopener" target="_blank">
                        {r.model}
                      </a>
                    </th>
                    <td className="py-2 pr-3 tabular-nums">{r.th}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.watts}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.eff}</td>
                    <td className="py-2 pr-3">{r.cooling}</td>
                    <td className="py-2">{r.power}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">{S21XP_COMPARE_NOTE}</p>
          <h3 className={`mt-6 ${H3_CLS}`}>Which one is more efficient?</h3>
          <p className={BODY_CLS}>{S21XP_EFFICIENCY}</p>
          <h3 className={`mt-6 ${H3_CLS}`}>Air vs hydro: why it matters for home miners</h3>
          <p className={BODY_CLS}>{S21XP_HYDRO}</p>
        </section>

        <section className="mb-10" id="worth-it">
          <h2 className={H2_CLS}>Is an S21 XP worth running?</h2>
          <p className={`mb-4 ${BODY_CLS}`}>{S21XP_WORTH_SHORT}</p>
          <h3 className={H3_CLS}>The three numbers that decide it</h3>
          <Bullets items={S21XP_WORTH_NUMBERS} />
          <p className={`mt-4 ${CARD_CLS} font-mono text-sm text-[var(--text-primary)]`}>{S21XP_WORTH_FORMULA}</p>
          <h3 className={`mt-6 ${H3_CLS}`}>Where to get today&apos;s numbers</h3>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)] font-sans">
            {S21XP_WORTH_SOURCES.map((s) => (
              <li key={s.href}>
                <a href={s.href} className={LINK_CLS} rel="noopener" target="_blank">
                  {s.label}
                </a>
                {" · "}
                {s.note}
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-10" id="odds">
          <h2 className={H2_CLS}>Solo-mining odds for one S21 XP</h2>
          <p className={`mb-4 ${BODY_CLS}`}>{S21XP_ODDS_SHORT}</p>
          <Suspense
            fallback={
              <div className={CARD_CLS}>
                <p className="micro-label text-[var(--text-tertiary)]">Loading live odds</p>
              </div>
            }
          >
            <LiveOdds />
          </Suspense>
          <p className={`mt-4 ${BODY_CLS}`}>
            Try other sizes and time windows in the{" "}
            <Link href="/solo-mining-calculator" className={LINK_CLS}>
              solo mining calculator
            </Link>
            , which starts at 270 TH/s.
          </p>
          <h3 className={`mt-6 ${H3_CLS}`}>Why most solo attempts find nothing, and why that&apos;s normal</h3>
          <p className={BODY_CLS}>{S21XP_ODDS_WHY}</p>
        </section>

        <section className="mb-10" id="rent">
          <h2 className={H2_CLS}>Rent an S21 XP instead of buying one</h2>
          <p className={`mb-4 ${BODY_CLS}`}>{S21XP_RENT_SHORT}</p>
          <h3 className={H3_CLS}>What you get</h3>
          <Bullets items={S21XP_RENT_POINTS} />
          <h3 className={`mt-6 ${H3_CLS}`}>How to rent in three steps</h3>
          <p className={BODY_CLS}>
            Pick how much hashrate you want on our{" "}
            <Link href="/hashrate" className={LINK_CLS}>
              rent page
            </Link>
            , set your pool and payout address, and choose your hours. The{" "}
            <Link href="/hashrate/how-to-rent" className={LINK_CLS}>
              step-by-step guide
            </Link>{" "}
            walks through every click, and AI agents have their own{" "}
            <Link href="/hashrate/agents" className={LINK_CLS}>
              agent guide
            </Link>
            .
          </p>
          <h3 className={`mt-6 ${H3_CLS}`}>Checking delivery</h3>
          <Bullets items={S21XP_DELIVERY} />
        </section>

        <section className="mb-10" id="rent-vs-buy">
          <h2 className={H2_CLS}>Rent vs buy, in one table</h2>
          <div className={`${CARD_CLS} overflow-x-auto`}>
            <table className="w-full min-w-[480px] text-sm font-sans">
              <caption className="sr-only">Renting S21 XP hashrate compared with buying the machine</caption>
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Topic</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Buy one</th>
                  <th scope="col" className="py-2 font-medium">Rent one</th>
                </tr>
              </thead>
              <tbody>
                {S21XP_RENT_VS_BUY.map((r) => (
                  <tr key={r.topic} className="border-t border-[var(--border-subtle)] align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--text-primary)]">{r.topic}</th>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.buy}</td>
                    <td className="py-2 text-[var(--text-secondary)]">{r.rent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className={`mt-6 ${H3_CLS}`}>How loud and hot is an S21 XP at home?</h3>
          <p className={BODY_CLS}>{S21XP_NOISE}</p>
          <p className={`mt-4 ${BODY_CLS}`}>
            {S21XP_BUY_INSTEAD}{" "}
            {S21XP_BUY_VENDORS.map((name, i) => (
              <span key={name}>
                <Link href={`/v/${vendorSlug({ name })}`} className={LINK_CLS}>
                  {name}
                </Link>
                {i < S21XP_BUY_VENDORS.length - 1 ? ", " : ". "}
              </span>
            ))}
            See every{" "}
            <Link href="/spend-bitcoin-on/hardware" className={LINK_CLS}>
              hardware shop that takes bitcoin
            </Link>
            .
          </p>
        </section>

        <section className="mb-10" id="faq">
          <h2 className={H2_CLS}>Antminer S21 XP FAQ</h2>
          <div className="space-y-4">
            {S21XP_FAQ.map((f) => (
              <div key={f.q} className={CARD_CLS}>
                <h3 className={H3_CLS}>{f.q}</h3>
                <p className={BODY_CLS}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="hero-glass rounded-2xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-xl font-semibold tracking-tight mb-2">Try an S21 XP without buying one</h2>
          <p className={BODY_CLS}>
            See which 270 TH/s chunks are free right now, point them at your own pool, and keep whatever they find.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/hashrate" className={CTA_CLS} data-s21xp-cta="final">
              Rent an S21 XP by the hour →
            </Link>
            <Link
              href="/solo-mining-calculator"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--border-subtle)] px-6 text-[15px] font-semibold text-[var(--text-primary)]"
            >
              Run the odds for 270 TH/s →
            </Link>
          </div>
        </section>

        <FooterDisclaimer />
      </article>
    </main>
  );
}
