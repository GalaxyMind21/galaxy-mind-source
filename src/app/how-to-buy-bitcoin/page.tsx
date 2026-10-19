// /how-to-buy-bitcoin · beginner guide (2026-10-18). How to think about a
// first purchase, the main ways to buy with honest trade-offs, fees and
// spreads, moving coins to your own wallet, avoiding scams, and a short
// reading list. General education only, with a not-financial-advice line.
// No exchange picks, no affiliate or referral links, retailer-free book links.
// Server-rendered, ISR, Article + HowTo + FAQPage + ItemList JSON-LD built
// from lib/buy-guide-copy.ts so the markup always matches the visible text.
// 2026-10-18 SEO/AEO pass: query-led meta title, BreadcrumbList, a visible
// "Last updated" that matches dateModified, a seventh book, and cross-links
// to the merchant guide and the spend pages.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { pageOgImage } from "@/lib/og";
import {
  BUY_GUIDE_URL as URL,
  BUY_GUIDE_TITLE,
  BUY_GUIDE_META_TITLE,
  BUY_GUIDE_SOCIAL_TITLE,
  BUY_GUIDE_DESCRIPTION,
  BUY_GUIDE_OG_ALT,
  BUY_GUIDE_PUBLISHED,
  BUY_GUIDE_UPDATED,
  BOOKS_COUNT_WORD,
  BUY_GUIDE_SHORT,
  NOT_ADVICE,
  BUY_STEPS,
  BUY_METHODS,
  FEES_POINTS,
  WALLET_POINTS,
  SCAM_POINTS,
  BOOKS,
  BUY_FAQ,
} from "@/lib/buy-guide-copy";

const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: BUY_GUIDE_META_TITLE,
  description: BUY_GUIDE_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: BUY_GUIDE_SOCIAL_TITLE,
    description: BUY_GUIDE_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/how-to-buy-bitcoin/opengraph-image", BUY_GUIDE_OG_ALT),
  },
  twitter: {
    card: "summary_large_image",
    title: BUY_GUIDE_SOCIAL_TITLE,
    description: BUY_GUIDE_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

const LINK_CLS =
  "text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]";
const CARD_CLS =
  "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
      {items.map((it) => (
        <li key={it}>{it}</li>
      ))}
    </ul>
  );
}

const UPDATED_LABEL = new Date(`${BUY_GUIDE_UPDATED}T12:00:00Z`).toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const NEXT_READS = [
  { href: "/should-i-buy-bitcoin", tag: "◐ Buying Gauge", title: "Should I buy bitcoin today?", sub: "A live, data-driven read on market conditions." },
  { href: "/is-it-too-late-to-buy-bitcoin", tag: "⧗ Supply", title: "Is it too late to buy bitcoin?", sub: "Scarcity and adoption, answered with data." },
  { href: "/how-to-pay-with-lightning", tag: "⌁ Lightning", title: "Pay with Lightning", sub: "Spend at shops, even from a dollar balance." },
  { href: "/how-to-accept-bitcoin", tag: "⇄ Merchants", title: "Accept bitcoin payments", sub: "Take bitcoin and Lightning at your own shop or online store." },
  { href: "/spend-and-replace", tag: "↺ Habit", title: "Spend and replace", sub: "Use bitcoin as money without shrinking your stack." },
  { href: "/", tag: "⌂ Vendor directory", title: "Shops that take bitcoin", sub: "Every listing confirmed by a person, with its date shown." },
];

export default async function HowToBuyBitcoinPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: BUY_GUIDE_TITLE,
        description: BUY_GUIDE_DESCRIPTION,
        url: URL,
        datePublished: BUY_GUIDE_PUBLISHED,
        dateModified: BUY_GUIDE_UPDATED,
        mainEntityOfPage: URL,
        image: `${SITE_URL}/how-to-buy-bitcoin/opengraph-image`,
        author: { "@id": `${SITE_URL}/#org` },
        about: [
          { "@type": "Thing", name: "Bitcoin" },
          { "@type": "Thing", name: "Self-custody" },
        ],
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "HowTo",
        "@id": `${URL}#howto`,
        name: "How to buy bitcoin as a beginner",
        description: BUY_GUIDE_SHORT,
        url: URL,
        step: BUY_STEPS.map((s) => ({
          "@type": "HowToStep",
          position: Number(s.n),
          name: s.title,
          text: s.body,
          url: `${URL}#step-${s.n}`,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${URL}#faq`,
        mainEntity: BUY_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "ItemList",
        "@id": `${URL}#books`,
        name: "Recommended bitcoin books",
        itemListElement: BOOKS.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Book",
            name: b.title,
            author: b.author.split(" and ").map((name) => ({ "@type": "Person", name })),
            datePublished: String(b.year),
            url: b.href,
          },
        })),
      },
      buildBreadcrumb([
        { name: "Galaxy Mind", url: `${SITE_URL}/` },
        { name: "How to buy bitcoin", url: URL },
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
          {" · Buy bitcoin"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">For beginners</div>
        <h1 className="display-title mb-4">{BUY_GUIDE_TITLE}</h1>
        <p className="t-xs text-[var(--text-tertiary)] font-sans">
          Last updated <time dateTime={BUY_GUIDE_UPDATED}>{UPDATED_LABEL}</time> · By Galaxy Mind
        </p>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            {BUY_GUIDE_SHORT}
          </p>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">{NOT_ADVICE}</p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Buy your first bitcoin in six steps</h2>
          <ol className="space-y-3 list-none p-0">
            {BUY_STEPS.map((s) => (
              <li key={s.n} id={`step-${s.n}`} className={`${CARD_CLS} scroll-mt-20`}>
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
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" id="ways-to-buy">
          <h2 className="text-2xl font-semibold tracking-tight mb-2">The main ways to buy</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-5">
            None is right for everyone. Each trades convenience against cost and privacy.
          </p>
          <div className="space-y-4">
            {BUY_METHODS.map((m) => (
              <section key={m.id} id={m.id} className={`hero-glass ${CARD_CLS} scroll-mt-20`}>
                <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-2">{m.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-3">{m.how}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-sans">
                  <div>
                    <dt className="micro-label text-[var(--accent-ink)] mb-1">Good for</dt>
                    <dd className="text-[var(--text-secondary)] leading-relaxed">{m.pros}</dd>
                  </div>
                  <div>
                    <dt className="micro-label text-[var(--text-tertiary)] mb-1">Watch out for</dt>
                    <dd className="text-[var(--text-secondary)] leading-relaxed">{m.cons}</dd>
                  </div>
                </dl>
                {m.links || m.internal ? (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 t-xs font-sans">
                    {m.links?.map((l) => (
                      <a key={l.href} href={l.href} rel="noopener" className={LINK_CLS}>
                        {l.label}
                      </a>
                    ))}
                    {m.internal?.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed">
            We name projects only as examples. We do not recommend one over another, earn nothing from any of them, and this page has no affiliate or referral links.
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" id="fees">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Fees and spreads</h2>
          <div className={CARD_CLS}>
            <Bullets items={FEES_POINTS} />
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" id="self-custody">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Moving coins to your own wallet</h2>
          <div className={CARD_CLS}>
            <Bullets items={WALLET_POINTS} />
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" id="scams">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Avoiding scams</h2>
          <div className={CARD_CLS}>
            <Bullets items={SCAM_POINTS} />
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" id="books">
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Recommended bitcoin books</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-5">
            {BOOKS_COUNT_WORD.charAt(0).toUpperCase() + BOOKS_COUNT_WORD.slice(1)} well-known titles, from easy first reads to technical depth. Each links to the author&apos;s or publisher&apos;s own page, or a free official copy.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none p-0">
            {BOOKS.map((b) => (
              <li key={b.title} className={`hero-glass ${CARD_CLS}`}>
                <a href={b.href} rel="noopener" className={`text-base font-semibold ${LINK_CLS}`}>
                  {b.title}
                </a>
                <div className="t-xs text-[var(--text-tertiary)] font-sans mt-1 mb-2">
                  {b.author} · {b.year}
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{b.blurb}</p>
                <div className="micro-label text-[var(--text-tertiary)] mt-3">{b.linkNote}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Keep reading</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {NEXT_READS.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className={`${CARD_CLS} hover:border-[var(--accent)]/60 transition-all group`}
              >
                <div className="micro-label text-[var(--accent-ink)] mb-2">{r.tag}</div>
                <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                  {r.title}
                </div>
                <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">{r.sub}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {BUY_FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">{f.q}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            Ready to use what you bought? Browse the{" "}
            <Link href="/" className={LINK_CLS}>
              directory of online shops that take bitcoin
            </Link>{" "}
            or{" "}
            <Link href="/spend-bitcoin-on" className={LINK_CLS}>
              find shops by category
            </Link>
            . Selling something yourself? Read{" "}
            <Link href="/how-to-accept-bitcoin" className={LINK_CLS}>
              how to accept bitcoin payments
            </Link>
            .
          </p>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">{NOT_ADVICE}</p>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
