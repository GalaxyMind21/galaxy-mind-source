// /nostr-marketplaces · neutral "what is a Nostr marketplace" explainer
// (competitor teardown lesson A5, 2026-10-18). Leads with Galaxy Mind's
// strengths, then a factual table of Conduit, Shopstr and Plebeian Market
// (operator okayed the names Oct 18), each citing its own site. Explains signed listings, npub identity, Lightning checkout
// and encrypted order messages, how a marketplace differs from a directory,
// and why Galaxy Mind indexes verified shops across every platform.
// Server-rendered, ISR, Article + FAQPage JSON-LD from
// lib/nostr-marketplaces-copy.ts so markup and visible text match.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import { VENDORS, getPlatform } from "@/lib/vendors";
import {
  NM_URL as URL,
  NM_TITLE,
  NM_META_TITLE,
  NM_DESCRIPTION,
  NM_OG_ALT,
  NM_SHORT,
  NM_HOW,
  NM_LEAD_TITLE,
  NM_LEAD,
  NM_PROJECTS,
  NM_AS_OF,
  NM_COMPARE,
  NM_WHY,
  NM_FAQ,
} from "@/lib/nostr-marketplaces-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: NM_META_TITLE,
  description: NM_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: NM_TITLE,
    description: NM_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/nostr-marketplaces/opengraph-image", NM_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: NM_TITLE,
    description: NM_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

export default async function NostrMarketplacesPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const nostrCount = VENDORS.filter((v) => getPlatform(v) === "nostr").length;
  const total = VENDORS.length;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: NM_TITLE,
        description: NM_DESCRIPTION,
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "FAQPage",
        mainEntity: NM_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
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
        <nav
          aria-label="Breadcrumb"
          className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · "}
          <Link href="/nostr-vendors" className="hover:text-[var(--accent-ink)] transition-colors">
            Nostr vendors
          </Link>
          {" · Marketplaces"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">Explainer</div>
        <h1 className="display-title mb-4">{NM_TITLE}</h1>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{NM_SHORT}</p>
        </section>

        <section className="mb-10" data-nm-lead>
          <h2 className="text-2xl font-semibold tracking-tight mb-4">{NM_LEAD_TITLE}</h2>
          <ul className="space-y-2 text-base text-[var(--text-secondary)] leading-relaxed font-sans">
            {NM_LEAD.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-[var(--accent-ink)]">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-[var(--text-tertiary)]">
            {total} shops so far, {nostrCount} of them Nostr-native.{" "}
            <Link href="/" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Browse the directory →
            </Link>
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">How a Nostr marketplace works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {NM_HOW.map((b) => (
              <div
                key={b.title}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate"
              >
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">{b.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Marketplace or directory?</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] elevate">
            <table className="w-full text-sm font-sans">
              <caption className="sr-only">How a Nostr marketplace compares with a directory</caption>
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th scope="col" className="p-3 font-medium"><span className="sr-only">Question</span></th>
                  <th scope="col" className="p-3 font-medium">Nostr marketplace</th>
                  <th scope="col" className="p-3 font-medium">Directory (Galaxy Mind)</th>
                </tr>
              </thead>
              <tbody>
                {NM_COMPARE.map((r) => (
                  <tr key={r.label} className="border-t border-[var(--border-subtle)] align-top">
                    <th scope="row" className="p-3 text-left font-semibold text-[var(--text-primary)]">{r.label}</th>
                    <td className="p-3 text-[var(--text-secondary)]">{r.marketplace}</td>
                    <td className="p-3 text-[var(--text-secondary)]">{r.directory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" data-nm-projects>
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Three Nostr marketplaces</h2>
          <p className="text-sm text-[var(--text-tertiary)] mb-4 font-sans">
            Each row summarizes what the project says on its own site or GitHub, as of {NM_AS_OF}. Galaxy Mind is not affiliated with any of them.
          </p>
          <div className="space-y-3">
            {NM_PROJECTS.map((p) => (
              <div
                key={p.name}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">{p.name}</h3>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="t-xs text-[var(--text-tertiary)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent-ink)]"
                  >
                    {p.urlLabel} ↗
                  </a>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm font-sans">
                  <dt className="text-[var(--text-tertiary)]">What it is</dt>
                  <dd className="text-[var(--text-secondary)]">{p.what}</dd>
                  <dt className="text-[var(--text-tertiary)]">Checkout</dt>
                  <dd className="text-[var(--text-secondary)]">{p.checkout}</dd>
                  <dt className="text-[var(--text-tertiary)]">Code</dt>
                  <dd className="text-[var(--text-secondary)]">
                    {p.code}{" "}
                    <a
                      href={p.codeUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline decoration-dotted underline-offset-2 hover:text-[var(--accent-ink)]"
                    >
                      Source ↗
                    </a>
                  </dd>
                </dl>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Why Galaxy Mind lists shops from every platform</h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-6">{NM_WHY}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/nostr-vendors"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">Nostr vendors</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                {nostrCount} Nostr-native shops
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Every one confirmed by a person.
              </div>
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">⌂ Vendor directory</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                All {total} shops
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                X, Nostr and independent stores in one list.
              </div>
            </Link>
            <Link
              href="/submit"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">+ For shops</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                List your shop free
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Your npub, NIP-05 address or X handle is welcome.
              </div>
            </Link>
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {NM_FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">{f.q}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
