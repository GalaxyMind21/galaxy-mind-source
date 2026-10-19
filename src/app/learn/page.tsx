// /learn · the hub behind the "Learn" nav group (SEO desk idea 14,
// 2026-10-18). Before this page the obvious URL was a 404. Server-rendered,
// static copy from lib/learn-hub-copy.ts, so the visible list and the
// CollectionPage + ItemList + BreadcrumbList JSON-LD can never disagree.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import {
  LEARN_URL as URL,
  LEARN_TITLE,
  LEARN_META_TITLE,
  LEARN_DESCRIPTION,
  LEARN_OG_ALT,
  LEARN_SHORT,
  LEARN_SECTIONS,
  LEARN_ALL_LINKS,
} from "@/lib/learn-hub-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: LEARN_META_TITLE,
  description: LEARN_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: LEARN_TITLE,
    description: LEARN_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/learn/opengraph-image", LEARN_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: LEARN_TITLE,
    description: LEARN_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

export default async function LearnPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${URL}#page`,
        name: LEARN_TITLE,
        description: LEARN_DESCRIPTION,
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        breadcrumb: { "@id": `${URL}#breadcrumb` },
        mainEntity: { "@id": `${URL}#guides` },
      },
      {
        "@type": "ItemList",
        "@id": `${URL}#guides`,
        name: "Galaxy Mind guides",
        numberOfItems: LEARN_ALL_LINKS.length,
        itemListElement: LEARN_ALL_LINKS.map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: l.title,
          description: l.blurb,
          url: `${SITE_URL}${l.href}`,
        })),
      },
      {
        "@id": `${URL}#breadcrumb`,
        ...buildBreadcrumb([
          { name: "Galaxy Mind", url: SITE_URL },
          { name: "Learn", url: URL },
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
      <article className="mx-auto max-w-4xl px-4 sm:px-6 pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · Learn"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">Guides</div>
        <h1 className="display-title mb-4">{LEARN_TITLE}</h1>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">Where to begin</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            {LEARN_SHORT}
          </p>
        </section>

        {LEARN_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="mb-10 scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight mb-2">{s.title}</h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-4">{s.intro}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none p-0">
              {s.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="glass-rest block h-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
                  >
                    <h3 className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                      {l.title}
                    </h3>
                    <p className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">{l.blurb}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-3">Ready to spend it?</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-5">
            The vendor directory lists independent shops that take bitcoin, and a person has checked every one of them.
          </p>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black"
          >
            Browse the vendor directory →
          </Link>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
