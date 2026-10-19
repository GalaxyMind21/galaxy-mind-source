// /how-to-accept-bitcoin · SEO/AEO doorway for the high-volume merchant
// intent "how to accept bitcoin payments / accept bitcoin as a business".
// Supply-side counterpart to /how-to-help-grow-bitcoin: it funnels
// merchants into the directory (/submit) and shows shoppers who already
// accept it (/). FAQ + HowTo steps are phrased to match real searches for
// featured-snippet / AI Overview pickup. Server-rendered, ISR, Article +
// HowTo + FAQPage JSON-LD. Built 2026-06-20.
// Growth 2026-09-22: quiet VendorHashrateModule after the Start here grid so
// merchant-accept readers (directory funnel into /submit + /badge) also see a
// live open-TH path onto paid USA ASIC rentals — same module as help-grow,
// /v, online-stores, LATAM, /map, coffee, how-many, state-of, nostr-vendors,
// spend-and-replace.
// 2026-10-18: practical setup walkthrough (Square, Lightning address,
// self-hosted BTCPay) from lib/accept-walkthrough-copy.ts. Square claims
// re-sourced to Square's own help and product pages; the unsourced seller
// count was dropped and the 1% fee from 2027 added.
// 2026-10-18 SEO/AEO pass: small-business and Lightning meta title and
// description, a quotable first sentence, BreadcrumbList, a BTCPay HowTo,
// two more FAQs, a visible "Last updated" matching dateModified, and links
// to the buying guide and the spend pages.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { VENDORS } from "@/lib/vendors";
import {
  SQUARE_SUMMARY,
  WALKTHROUGH_PATHS,
  WALKTHROUGH_NOTE,
  WALKTHROUGH_SOURCES,
  ACCEPT_GUIDE_URL,
  ACCEPT_META_TITLE,
  ACCEPT_SOCIAL_TITLE,
  ACCEPT_DESCRIPTION,
  ACCEPT_PUBLISHED,
  ACCEPT_UPDATED,
} from "@/lib/accept-walkthrough-copy";

const URL = ACCEPT_GUIDE_URL;
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: ACCEPT_META_TITLE,
  description: ACCEPT_DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: ACCEPT_SOCIAL_TITLE,
    description: ACCEPT_DESCRIPTION,
    siteName: "Galaxy Mind",
    images: pageOgImage("/how-to-accept-bitcoin/opengraph-image", "How to Accept Bitcoin Payments"),
  },
  twitter: {
    card: "summary_large_image",
    title: ACCEPT_SOCIAL_TITLE,
    description: ACCEPT_DESCRIPTION,
    creator: "@GalaxyMind",
  },
};

const UPDATED_LABEL = new Date(`${ACCEPT_UPDATED}T12:00:00Z`).toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const LINK_CLS =
  "text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]";

export default async function HowToAcceptBitcoinPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const vendorCount = VENDORS.length;

  const STEPS = [
    {
      n: "1",
      title: "Decide how you want to settle",
      body: "You do not have to hold bitcoin to accept it. Most processors let you auto-convert each payment to dollars the instant it lands, or keep some or all of it in BTC. Pick what fits your books · you can change it later.",
    },
    {
      n: "2",
      title: "Turn it on at your point of sale",
      body: `Check whether your existing checkout already supports it. ${SQUARE_SUMMARY} The customer scans a QR code or taps to pay. For many shops it is already a setting, not a project.`,
      href: "#setup-square",
      hrefLabel: "Square setup walkthrough ↓",
    },
    {
      n: "3",
      title: "No native support? Add a Lightning option",
      body: "If your point of sale does not support it yet, the simplest path is a Lightning-enabled payment processor or a self-hosted option like BTCPay Server. Even a plain Lightning Address (name@domain) lets a customer pay you from any wallet. Lightning settles in seconds for a fraction of a cent.",
      href: "#setup-lightning-address",
      hrefLabel: "Lightning address and BTCPay walkthroughs ↓",
    },
    {
      n: "4",
      title: "Show that you accept it",
      body: "Put a small bitcoin-accepted sticker or QR at the register and on your site. Bitcoiners actively seek out places to spend, so signage alone brings in customers who specifically want to pay in sats. Online shops can also embed a verified badge that links back here.",
      href: "/badge",
      hrefLabel: "Your verified badge →",
    },
    {
      n: "5",
      title: "Get listed so people can find you",
      body: `Physical walk-in shops belong on BTC Map. Submit here only if you sell online. This directory tracks ${vendorCount} human-verified online shops that take native bitcoin. Free, no listing fee, a couple of minutes.`,
      href: "/submit",
      hrefLabel: "List your shop →",
    },
    {
      n: "6",
      title: "Keep stacking what you take in",
      body: "Whether you auto-convert to dollars or keep BTC, you can still grow a stack on your own terms · use what you need for the business, hold what you want for the long run. Bitcoin as money and a growing stack are not mutually exclusive.",
      href: "/spend-and-replace",
      hrefLabel: "Spend and replace, explained →",
    },
  ];

  const FAQ = [
    {
      q: "How do I accept bitcoin payments as a business?",
      a: "Three common paths. (1) If you use Square in the US, it may already be on: eligible sellers get bitcoin payments over the Lightning Network by default, settled in dollars unless they choose bitcoin, with a 0% processing fee through 2026 and 1% after. (2) Get a free Lightning address from a Lightning wallet app, or use a Lightning-enabled processor that converts to your currency. (3) Self-host BTCPay Server for an online store with no processing fee. Then add signage and get listed so people can find you.",
    },
    {
      q: "Where is the bitcoin setting in Square?",
      a: "In Square Dashboard, go to Banking, then Bitcoin, to set it up and choose dollars or bitcoin. In the Square POS app, Bitcoin shows under Settings, then Checkout, then Payment, where you can reorder it or turn it off. Eligible US sellers have it on by default; it is not offered to businesses located in New York.",
    },
    {
      q: "How do I get a Lightning address for my shop?",
      a: "Install a Lightning wallet app that offers one. Many give you a free address that looks like yourshop@wallet.example when you sign up. Print it with its QR code at the register or add it to your order page, and check each payment in your app before handing over the goods. Apps that hold your coins are the quickest start, so move savings to your own wallet regularly.",
    },
    {
      q: "How do I accept Lightning payments?",
      a: "Get a Lightning address from a Lightning wallet app and show its QR code at the register or on your order page. For an exact amount, create an invoice in the app and let the customer scan it. Square sellers in the US take Lightning through Square itself, and online stores can add Lightning to BTCPay Server. Payments settle in seconds for a fraction of a cent.",
    },
    {
      q: "What are the limits on Square bitcoin payments?",
      a: "Each payment can be up to the bitcoin equivalent of $600, with a $20,000 daily limit. Square settles each payment in dollars by default unless you choose to keep bitcoin, and bitcoin payments are not offered to businesses located in New York.",
    },
    {
      q: "Is it free to accept bitcoin?",
      a: "It is close to free. Square charges a 0% processing fee on bitcoin payments through December 31, 2026, then 1%. Lightning Network fees are typically a fraction of a cent regardless of the amount, far below the 1.5 to 3.5 percent of card networks. Self-hosting BTCPay Server has no processor fee at all beyond the tiny on-chain or Lightning cost.",
    },
    {
      q: "Do I have to hold bitcoin if I accept it?",
      a: "No. Most processors can auto-convert each payment to dollars the moment it lands, so accepting bitcoin does not mean taking on price risk. You can also choose to keep a percentage in BTC if you want exposure. It is your call, per transaction or as a default.",
    },
    {
      q: "How does a customer pay with bitcoin in a store?",
      a: "At checkout the terminal shows a QR code (or an NFC tap). The customer scans it with any bitcoin wallet, confirms, and the Lightning payment settles in seconds. It feels the same as a card tap or a mobile-wallet payment, just instant and final. Physical walk-in spots should also pin themselves on BTC Map.",
    },
    {
      q: "How do I let people know my business accepts bitcoin?",
      a: `If you sell online, put a badge on your site and list here. Galaxy Mind keeps a free, human-verified directory of ${vendorCount} online shops that take native bitcoin · submitting yours takes a couple of minutes and there is no listing fee. Physical walk-in shops belong on BTC Map.`,
    },
  ];

  const btcpay = WALKTHROUGH_PATHS.find((p) => p.id === "setup-btcpay");
  const btcpaySteps = btcpay ? btcpay.blocks.flatMap((b) => b.items) : [];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: "How to Accept Bitcoin Payments",
        description: ACCEPT_DESCRIPTION,
        url: URL,
        mainEntityOfPage: URL,
        image: `${SITE_URL}/how-to-accept-bitcoin/opengraph-image`,
        author: { "@id": `${SITE_URL}/#org` },
        about: [
          { "@type": "Thing", name: "Bitcoin payments" },
          { "@type": "Thing", name: "Lightning Network" },
        ],
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        datePublished: ACCEPT_PUBLISHED,
        dateModified: ACCEPT_UPDATED,
        citation: WALKTHROUGH_SOURCES.map((src) => src.href),
      },
      {
        "@type": "HowTo",
        "@id": `${URL}#howto`,
        url: URL,
        name: "How to accept bitcoin payments as a business",
        description:
          "Start accepting bitcoin at your business in a few steps: choose how you settle, enable it at your point of sale or add a Lightning option, show that you take it, and get listed.",
        step: STEPS.map((s) => ({
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
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      ...(btcpay && btcpaySteps.length > 0
        ? [
            {
              "@type": "HowTo",
              "@id": `${URL}#setup-btcpay`,
              name: "How to set up BTCPay Server for an online store",
              description: btcpay.fit,
              url: `${URL}#setup-btcpay`,
              step: btcpaySteps.map((text, i) => ({
                "@type": "HowToStep",
                position: i + 1,
                text,
              })),
            },
          ]
        : []),
      buildBreadcrumb([
        { name: "Galaxy Mind", url: `${SITE_URL}/` },
        { name: "How to accept bitcoin payments", url: URL },
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
          {" · Accept bitcoin"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          For merchants
        </div>
        <h1 className="display-title mb-4">
          How to accept bitcoin payments
        </h1>
        <p className="t-xs text-[var(--text-tertiary)] font-sans">
          Last updated <time dateTime={ACCEPT_UPDATED}>{UPDATED_LABEL}</time> · By Galaxy Mind
        </p>

        <section className="hero-glass my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            To accept bitcoin payments at a small business, turn it on in a
            checkout you already use, add a free Lightning address, or
            self-host BTCPay Server for an online store. Lightning payments
            settle in seconds for a fraction of a cent. If you use <span className="text-[var(--accent-ink)]">Square</span>{" "}
            in the US, it may already be on · {SQUARE_SUMMARY}{" "}
            Otherwise a Lightning address, a Lightning-enabled processor or
            BTCPay Server gets you there in an afternoon. You choose whether to keep dollars or hold BTC. If you
            sell online,{" "}
            <Link href="/submit" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              get listed
            </Link>
            . Physical walk-in shops belong on BTC Map.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            Start accepting it in six steps
          </h2>
          <div className="space-y-3">
            {STEPS.map((w) => (
              <div
                key={w.n}
                id={`step-${w.n}`}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate"
              >
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] shrink-0">
                    {w.n}
                  </span>
                  <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">
                    {w.title}
                  </h3>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {w.body}
                </p>
                {w.href ? (
                  <Link
                    href={w.href}
                    className="inline-block mt-3 t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                  >
                    {w.hrefLabel}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8" aria-labelledby="setup-walkthrough">
          <h2 id="setup-walkthrough" className="text-2xl font-semibold tracking-tight mb-2">
            Set it up: three practical paths
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-6">
            Pick the one that matches how you sell today. Each step links to the provider&apos;s own documentation.
          </p>
          <div className="space-y-5">
            {WALKTHROUGH_PATHS.map((p) => (
              <section
                key={p.id}
                id={p.id}
                aria-labelledby={`${p.id}-title`}
                className="hero-glass rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 elevate scroll-mt-20"
              >
                <div className="micro-label text-[var(--accent-ink)] mb-2">{p.eyebrow}</div>
                <h3 id={`${p.id}-title`} className="text-lg sm:text-xl font-semibold text-[var(--text-primary)] mb-1">
                  {p.title}
                </h3>
                <p className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed mb-4">{p.fit}</p>
                <div className="space-y-4">
                  {p.blocks.map((b) => (
                    <div key={b.heading}>
                      <h4 className="font-mono t-xs uppercase tracking-[0.18em] text-[var(--text-primary)] mb-2">
                        {b.heading}
                      </h4>
                      <ul className="list-disc pl-5 space-y-1.5 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                        {b.items.map((it) => (
                          <li key={it}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-lg border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
                  <span className="font-semibold text-[var(--text-primary)]">Trade-off · </span>
                  {p.tradeoff}
                </p>
                <div className="mt-4">
                  <div className="micro-label text-[var(--text-tertiary)] mb-1.5">Sources</div>
                  <ul className="space-y-1 text-xs font-sans">
                    {p.sources.map((src) => (
                      <li key={src.href}>
                        <a
                          href={src.href}
                          rel="noopener"
                          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] break-words"
                        >
                          {src.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--text-tertiary)] leading-relaxed">{WALKTHROUGH_NOTE}</p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Start here</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/submit"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">
                + /submit
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                List your shop
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Free, human-verified, live in a couple of minutes. Sell online only.
              </div>
            </Link>
            <Link
              href="/badge"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">
                ⌁ /badge
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Your verified badge
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Embed a live badge that links back to your listing.
              </div>
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group elevate"
            >
              <div className="micro-label text-[var(--accent-ink)] mb-2">
                ⌂ Vendor directory
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                {vendorCount} online shops already accept it
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                See who is doing it, and how they show it.
              </div>
            </Link>
          </div>
        </section>

        <p className="mb-10 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
          New to bitcoin yourself? Read{" "}
          <Link href="/how-to-buy-bitcoin" className={LINK_CLS}>
            how to buy bitcoin as a beginner
          </Link>
          , see{" "}
          <Link href="/how-to-pay-with-lightning" className={LINK_CLS}>
            how customers pay with Lightning
          </Link>
          , or{" "}
          <Link href="/spend-bitcoin-on" className={LINK_CLS}>
            browse shops that take bitcoin by category
          </Link>
          .
        </p>

        <VendorHashrateModule className="mb-10" />

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
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
      </article>
      <FooterDisclaimer />
    </main>
  );
}
