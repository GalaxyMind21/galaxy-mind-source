// /how-to-pay-with-lightning · "No bitcoin yet? You can still pay."
// competitor teardown lesson A2 (2026-10-18). Bitcoin.org sends newcomers who
// often hold dollars, not bitcoin. This guide shows that many directory shops
// take Lightning and that some everyday money apps can pay a Lightning invoice
// from a dollar balance. No affiliate or referral links, no endorsement, and
// every mention of an app carries the "check your app" caveat. Server-rendered,
// ISR, Article + HowTo + FAQPage JSON-LD built from lib/pay-guide-copy.ts so
// the markup always matches the visible text.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import {
  PAY_GUIDE_URL as URL,
  PAY_GUIDE_TITLE,
  PAY_GUIDE_META_TITLE,
  PAY_GUIDE_DESCRIPTION,
  PAY_GUIDE_OG_ALT,
  PAY_GUIDE_SHORT,
  PAY_STEPS,
  PAY_FAQ,
} from "@/lib/pay-guide-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: PAY_GUIDE_META_TITLE,
  description: PAY_GUIDE_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: PAY_GUIDE_TITLE,
    description: PAY_GUIDE_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/how-to-pay-with-lightning/opengraph-image", PAY_GUIDE_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: PAY_GUIDE_TITLE,
    description: PAY_GUIDE_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

export default async function HowToPayWithLightningPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: PAY_GUIDE_TITLE,
        description: PAY_GUIDE_DESCRIPTION,
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "HowTo",
        name: "How to pay a Lightning invoice without owning bitcoin",
        description: PAY_GUIDE_SHORT,
        step: PAY_STEPS.map((s) => ({
          "@type": "HowToStep",
          position: Number(s.n),
          name: s.title,
          text: s.body,
          url: `${URL}#step-${s.n}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: PAY_FAQ.map((f) => ({
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
          {" · Pay with Lightning"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">For shoppers</div>
        <h1 className="display-title mb-4">{PAY_GUIDE_TITLE}</h1>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            {PAY_GUIDE_SHORT}
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Pay in five steps</h2>
          <ol className="space-y-3 list-none p-0">
            {PAY_STEPS.map((s) => (
              <li
                key={s.n}
                id={`step-${s.n}`}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate scroll-mt-20"
              >
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] shrink-0">
                    {s.n}
                  </span>
                  <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">{s.title}</h3>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{s.body}</p>
                {s.href ? (
                  <Link
                    href={s.href}
                    className="inline-block mt-3 t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                  >
                    {s.hrefLabel}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed">
            We name apps only as examples. We do not recommend one over another, and this page has no affiliate or referral links.
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Ready to shop?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">⌂ Vendor directory</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Browse shops that take bitcoin
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Every listing was confirmed by a person, and each one shows its date.
              </div>
            </Link>
            <Link
              href="/glossary/lightning-network"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">⌁ Glossary</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                What the Lightning Network is
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                A plain-language explainer of bitcoin&apos;s fast payment network.
              </div>
            </Link>
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {PAY_FAQ.map((f) => (
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
