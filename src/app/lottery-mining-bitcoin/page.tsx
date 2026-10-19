// /lottery-mining-bitcoin · SEO brief 2026-10-18 (rank 3, cluster B: solo /
// lottery mining, feeding the hashrate desk). An honest explainer: the odds
// are live from lib/lottery-odds.ts (same blockOdds() as the calculator and
// /hashrate), every other probability is a formula, and the page sells the
// experience, never a return. Article + HowTo + FAQPage + BreadcrumbList +
// DefinedTerm JSON-LD are built from lib/lottery-mining-copy.ts, the same
// strings the page renders. ISR every 10 minutes, matching the network feed.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb, buildHowTo } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import { getNetworkPhs } from "@/lib/hashrate";
import { humanizeYears } from "@/lib/block-odds";
import { lotteryRows, roundOneIn, ehLabel } from "@/lib/lottery-odds";
import {
  MARKETPLACE_REGISTER_URL,
  MARKETPLACE_REGISTER_CTA,
  MARKETPLACE_REFERRAL_NOTE,
  MARKETPLACE_LINK_REL,
} from "@/lib/marketplace-listing";
import * as C from "@/lib/lottery-mining-copy";

const SITE_URL = "https://galaxymind.space";
const URL = C.LOTTERY_URL;

export const revalidate = 600;

export const metadata: Metadata = {
  title: C.LOTTERY_META_TITLE,
  description: C.LOTTERY_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: C.LOTTERY_H1,
    description: C.LOTTERY_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/lottery-mining-bitcoin/opengraph-image", C.LOTTERY_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: C.LOTTERY_H1,
    description: C.LOTTERY_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

const linkCls =
  "text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]";
const h2Cls = "text-2xl font-semibold tracking-tight mb-4";
const h3Cls = "text-lg font-semibold text-[var(--text-primary)] mb-2 mt-6";
const pCls = "text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-3";
const cardCls = "glass-rest rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate";

export default async function LotteryMiningPage() {
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  const networkPhs = await getNetworkPhs();
  const rows = networkPhs != null ? lotteryRows(networkPhs) : null;
  const asOf = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const one = rows?.find((r) => r.id === "one");

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: C.LOTTERY_H1,
        description: C.LOTTERY_DESCRIPTION,
        url: URL,
        dateModified: C.LOTTERY_MODIFIED,
        author: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isPartOf: { "@id": `${SITE_URL}/#website` },
        inLanguage: "en-US",
      },
      {
        "@id": `${URL}#howto`,
        ...buildHowTo({
          name: C.RENT_HOWTO_TITLE,
          description: C.LOTTERY_SHORT,
          url: `${URL}#rent`,
          totalTime: "PT15M",
          steps: C.RENT_HOWTO_STEPS.map((s) => ({ name: s.title, text: s.body })),
          supply: [{ name: "A bitcoin wallet you control" }],
          tool: [{ name: "A hashrate marketplace account" }, { name: "A solo mining pool" }],
        }),
      },
      {
        "@type": "FAQPage",
        "@id": `${URL}#faq`,
        mainEntity: C.LOTTERY_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "DefinedTerm",
        "@id": `${URL}#term`,
        name: "Lottery mining",
        description: C.LOTTERY_FAQ[0].a,
        url: URL,
      },
      {
        "@id": `${URL}#breadcrumb`,
        ...buildBreadcrumb([
          { name: "Galaxy Mind", url: SITE_URL },
          { name: "Rent hashrate", url: `${SITE_URL}/hashrate` },
          { name: "Lottery mining bitcoin", url: URL },
        ]),
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
      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav aria-label="Breadcrumb" className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4">
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">Galaxy Mind</Link>
          {" · "}
          <Link href="/hashrate" className="hover:text-[var(--accent-ink)] transition-colors">Rent hashrate</Link>
          {" · Lottery mining"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">Solo mining guide</div>
        <h1 className="display-title mb-4">{C.LOTTERY_H1}</h1>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{C.LOTTERY_SHORT}</p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.WHAT_TITLE}</h2>
          {C.WHAT_BODY.map((p) => <p key={p} className={pCls}>{p}</p>)}
          <p className={pCls}>
            The <Link href="/bitcoin-halving-countdown" className={linkCls}>halving countdown</Link> shows when the subsidy halves next.
          </p>
        </section>

        <section id="odds" className="mb-10 scroll-mt-20">
          <h2 className={h2Cls}>{C.ODDS_TITLE}</h2>
          <h3 className={h3Cls}>{C.FORMULA_TITLE}</h3>
          <p className={pCls}>{C.FORMULA_BODY}</p>
          {one && networkPhs != null ? (
            <p className={pCls} data-worked-example>
              {C.FORMULA_EXAMPLE_LEAD} the network runs at about {ehLabel(networkPhs)}, so one 270 TH/s chunk has p = 0.27 PH/s ÷ {Math.round(networkPhs).toLocaleString("en-US")} PH/s, or about 1 in {roundOneIn(1 / one.perBlock)} per block. Over one day (n = 144) that gives about 1 in {roundOneIn(one.dayOneIn)}, and over one week (n = 1,008) about 1 in {roundOneIn(one.weekOneIn)}.
            </p>
          ) : null}

          <h3 className={h3Cls}>{C.TABLE_TITLE}</h3>
          {rows && networkPhs != null ? (
            <div className={`${cardCls} overflow-x-auto p-0`}>
              <table className="w-full text-sm font-sans" data-live-odds>
                <thead>
                  <tr className="text-left text-[var(--text-tertiary)]">
                    <th scope="col" className="p-3 font-medium">Hashrate</th>
                    <th scope="col" className="p-3 font-medium">Chance in one day</th>
                    <th scope="col" className="p-3 font-medium">Chance in one week</th>
                    <th scope="col" className="p-3 font-medium">Average wait for a block</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                      <th scope="row" className="p-3 text-left font-medium text-[var(--text-primary)]">{r.label}</th>
                      <td className="p-3 tabular-nums text-[var(--text-secondary)]">1 in {roundOneIn(r.dayOneIn)}</td>
                      <td className="p-3 tabular-nums text-[var(--text-secondary)]">1 in {roundOneIn(r.weekOneIn)}</td>
                      <td className="p-3 tabular-nums text-[var(--text-secondary)]">{humanizeYears(r.expectedYears)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 pb-3 pt-1 text-xs text-[var(--text-tertiary)] leading-relaxed">
                Network: about {ehLabel(networkPhs)} as of {asOf}. {C.TABLE_NOTE}{" "}
                Source: <a href="https://mempool.space/mining" className={linkCls} rel="noopener noreferrer" target="_blank">mempool.space</a>.
              </p>
            </div>
          ) : (
            <p className={pCls} data-odds-syncing>{C.TABLE_SYNCING}</p>
          )}
          <p className={`${pCls} mt-4`}>
            Try any hashrate and window in the <Link href="/solo-mining-calculator" className={linkCls}>solo mining odds calculator</Link>.
          </p>

          <h3 className={h3Cls}>{C.MEMORY_TITLE}</h3>
          {C.MEMORY_BODY.map((p) => <p key={p} className={pCls}>{p}</p>)}
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.WORTH_TITLE}</h2>
          <h3 className={h3Cls}>{C.HASHPRICE_TITLE}</h3>
          {C.HASHPRICE_BODY.map((p) => <p key={p} className={pCls}>{p}</p>)}
          <p className={pCls}>
            Live hashprice: <a href="https://hashrateindex.com" className={linkCls} rel="noopener noreferrer" target="_blank">Hashrate Index</a>.
          </p>
          <h3 className={h3Cls}>{C.OWNED_TITLE}</h3>
          <p className={pCls}>{C.OWNED_BODY}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{C.WORTH_DISCLAIMER}</p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.COMPARE_TITLE}</h2>
          <div className={`${cardCls} overflow-x-auto p-0`}>
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th scope="col" className="p-3 font-medium"><span className="sr-only">Factor</span></th>
                  <th scope="col" className="p-3 font-medium">Rent hashrate</th>
                  <th scope="col" className="p-3 font-medium">Own a miner</th>
                </tr>
              </thead>
              <tbody>
                {C.COMPARE_ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-[var(--border-subtle)] align-top">
                    <th scope="row" className="p-3 text-left font-medium text-[var(--text-primary)]">{r.label}</th>
                    <td className="p-3 text-[var(--text-secondary)]">{r.rent}</td>
                    <td className="p-3 text-[var(--text-secondary)]">{r.own}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${pCls} mt-4`}>{C.COMPARE_CLOSE}</p>
        </section>

        <section id="rent" className="mb-10 scroll-mt-20">
          <h2 className={h2Cls}>{C.RENT_HOWTO_TITLE}</h2>
          <ol className="space-y-3 list-none p-0">
            {C.RENT_HOWTO_STEPS.map((s, i) => (
              <li key={s.title} className={cardCls}>
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] shrink-0">{i + 1}</span>
                  <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">{s.title}</h3>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className={`${pCls} mt-4`}>
            The full walkthrough is in <Link href="/hashrate/how-to-rent" className={linkCls}>how to rent hashrate, step by step</Link>.
          </p>
          <h3 className={h3Cls}>{C.MISTAKES_TITLE}</h3>
          <ul className="space-y-2 list-none p-0 mb-3">
            {C.MISTAKES.map((m) => (
              <li key={m} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                <span aria-hidden="true" className="text-[var(--accent)]">·</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
          <h3 className={h3Cls}>{C.ARRIVING_TITLE}</h3>
          <p className={pCls}>{C.ARRIVING_BODY}</p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.OWN_TITLE}</h2>
          {C.OWN_BODY.map((p) => <p key={p} className={pCls}>{p}</p>)}
          <p className={pCls}>
            Browse <Link href="/spend-bitcoin-on/hardware" className={linkCls}>hardware and mining shops that take bitcoin</Link>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.POOLS_TITLE}</h2>
          <p className={pCls}>{C.POOLS_BODY}</p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.FOUND_TITLE}</h2>
          {C.FOUND_BODY.map((p) => <p key={p} className={pCls}>{p}</p>)}
          <p className={pCls}>
            Source: the <a href="https://developer.bitcoin.org/devguide/" className={linkCls} rel="noopener noreferrer" target="_blank">Bitcoin developer guide</a>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.WON_TITLE}</h2>
          <p className={pCls}>{C.WON_LEAD}</p>
          <ul className="space-y-3 list-none p-0">
            {C.WON_CASES.map((w) => (
              <li key={w.href} className={cardCls}>
                <a href={w.href} className={`${linkCls} font-semibold`} rel="noopener noreferrer" target="_blank">{w.title}</a>
                <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{w.body}</p>
              </li>
            ))}
          </ul>
          <p className={`${pCls} mt-4`}>{C.WON_CLOSE}</p>
        </section>

        <section className="mb-10">
          <h2 className={h2Cls}>{C.REDDIT_TITLE}</h2>
          <ul className="space-y-2 list-none p-0 mb-3">
            {C.REDDIT_THEMES.map((t) => (
              <li key={t} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                <span aria-hidden="true" className="text-[var(--accent)]">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            Themes drawn from these threads:{" "}
            {C.REDDIT_SOURCES.map((s, i) => (
              <span key={s.href}>
                {i > 0 ? " · " : ""}
                <a href={s.href} className={linkCls} rel="noopener noreferrer" target="_blank">{s.label}</a>
              </span>
            ))}
          </p>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-10">
          <h2 className={h2Cls}>Frequently asked</h2>
          <div className="space-y-6">
            {C.LOTTERY_FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">{f.q}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="hero-glass rounded-3xl p-6 sm:p-8" data-lottery-cta>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">{C.CTA_TITLE}</h2>
          <p className={pCls}>{C.CTA_BODY}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/hashrate"
              className="lit-primary inline-flex min-h-[52px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black"
            >
              {C.CTA_PRIMARY} →
            </Link>
            <Link
              href="/solo-mining-calculator"
              className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-[var(--border-subtle)] px-6 text-[16px] font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]/60"
            >
              {C.CTA_SECONDARY} →
            </Link>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-tertiary)]" data-referral-note>{MARKETPLACE_REFERRAL_NOTE}</p>
          <a href={MARKETPLACE_REGISTER_URL} target="_blank" rel={MARKETPLACE_LINK_REL} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-[var(--accent-ink)] underline underline-offset-2">
            {MARKETPLACE_REGISTER_CTA}
            <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">{C.WORTH_DISCLAIMER}</p>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
