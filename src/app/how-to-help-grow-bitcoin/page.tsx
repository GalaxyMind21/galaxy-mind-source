// /how-to-help-grow-bitcoin · SEO/AEO doorway for the broad, high-volume
// "how can I help grow bitcoin / support bitcoin adoption / help bitcoin
// succeed" query cluster (bitcoin.org "Support Bitcoin", Bitcoin Magazine
// "Simple Steps to Help Bitcoin"). It is a multi-answer "how to help"
// intent; spend-and-replace is method #1 and the rest funnel into the
// site's tools (directory, /submit, /stack, /float, /glossary). FAQ
// questions are phrased to match real searches for featured-snippet / AI
// Overview pickup. Server-rendered, ISR, Article + FAQPage JSON-LD.
// Built 2026-06-18.
// Growth 2026-09-21: quiet VendorHashrateModule after the Start here grid so
// help-grow readers (who already see rent-a-machine as way #7) convert onto
// paid USA ASIC rentals with live open-TH — same module as /v, online-stores,
// LATAM, /map, coffee, how-many, state-of, nostr-vendors, spend-and-replace.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import { VENDORS } from "@/lib/vendors";
import {
  XSELL_HELP_TITLE,
  XSELL_HELP_BODY,
  XSELL_HELP_LINK,
  XSELL_HELP_FAQ_Q,
  XSELL_HELP_FAQ_A,
} from "@/lib/hashrate-copy";

const URL = "https://galaxymind.space/how-to-help-grow-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "How to Help Grow Bitcoin · Galaxy Mind",
  description:
    "How to help grow bitcoin: spend and replace, onboard a merchant, hold your own keys, run a node, use Lightning, teach it, no selling your stack required.",
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: "How to Help Grow Bitcoin",
    description:
      "Concrete, no-permission-needed ways to grow bitcoin: spend and replace, onboard merchants, self-custody, run a node, use Lightning, orange-pill.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/how-to-help-grow-bitcoin/opengraph-image", "How to Help Grow Bitcoin"),
  },
  twitter: {
    card: "summary_large_image",
    title: "How to Help Grow Bitcoin",
    description:
      "Want to help bitcoin? Here are the concrete things that actually move adoption, starting with spending it without shrinking your stack.",
    creator: "@GalaxyMind",
  },
};

export default async function HowToHelpGrowBitcoinPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const vendorCount = VENDORS.length;

  const WAYS = [
    {
      n: "1",
      title: "Spend and replace",
      body: "Pay a merchant in bitcoin, then immediately rebuy the same amount with fiat. Your stack is unchanged, but bitcoin gets used as money and a merchant has a reason to keep accepting it. This is the habit that does the most work for most people, and it does not require selling anything.",
      href: "/spend-and-replace",
      hrefLabel: "How spend and replace works →",
    },
    {
      n: "2",
      title: "Ask merchants if they take bitcoin",
      body: "Even when the answer is no, the question plants the idea and raises awareness. And the answer is increasingly yes: Square now turns on bitcoin payments for eligible US sellers by default, so many shops can already accept it at checkout without realizing.",
      href: "/",
      hrefLabel: "Find merchants that already do →",
    },
    {
      n: "3",
      title: "Onboard a merchant",
      body: `If you know a business that should take bitcoin, help them set it up and get them listed. The Galaxy Mind directory tracks ${vendorCount} verified merchants accepting native bitcoin, and anyone can submit one in a couple of minutes.`,
      href: "/submit",
      hrefLabel: "Submit a merchant →",
    },
    {
      n: "4",
      title: "Hold your own keys",
      body: "Move bitcoin off exchanges into self-custody. Self-custodied coins are actual bitcoin under your control, not an IOU, which is the entire point of the system. It also removes counterparty risk and strengthens the case that bitcoin is money you actually own.",
      href: "/glossary/self-custody",
      hrefLabel: "What self-custody means →",
    },
    {
      n: "5",
      title: "Run a node and use Lightning",
      body: "Running your own node lets you validate the rules yourself instead of trusting someone else, and contributes bandwidth to the network. Paying over the Lightning Network keeps everyday transactions instant and nearly free, which is the rail that working circular economies run on.",
      href: "/glossary/lightning-network",
      hrefLabel: "What the Lightning Network is →",
    },
    {
      n: "6",
      title: "Learn it, then teach it",
      body: "Understand the metrics and the mechanics, then share them in plain language. The fastest adoption happens person to person. The Galaxy Mind glossary defines every term in standalone, quotable language so you can point someone at a clear answer instead of jargon.",
      href: "/glossary",
      hrefLabel: "Browse the glossary →",
    },
    {
      n: "7",
      title: XSELL_HELP_TITLE,
      body: XSELL_HELP_BODY,
      href: "/hashrate#your-shot",
      hrefLabel: `${XSELL_HELP_LINK} →`,
    },
  ];

  const FAQ = [
    {
      q: "How can I help grow bitcoin?",
      a: `The most effective thing most people can do is use bitcoin as money without shrinking their stack: spend it at a merchant, then immediately rebuy the same amount with fiat (spend and replace). Beyond that, ask merchants whether they accept bitcoin, help onboard a business, hold your own keys, run a node, pay over Lightning, and teach others in plain language. None of these require selling your bitcoin.`,
    },
    {
      q: "What can I do to support bitcoin adoption?",
      a: "Adoption grows from everyday use, and price appreciation alone doesn't create it. Concrete actions: spend and replace so bitcoin circulates, get merchants you know listed and accepting it, take your coins into self-custody, run a node to validate independently, use the Lightning Network for everyday payments, and educate the people around you. Each one makes bitcoin more usable as money.",
    },
    {
      q: "Does spending bitcoin actually help it grow?",
      a: "Yes, when you spend and replace. Spending circulates bitcoin as a medium of exchange and gives merchants a reason to keep accepting it, while rebuying the same amount with fiat keeps your savings intact. If everyone only ever hoards, bitcoin stays a savings account and never becomes money, so circulation is what turns it into a working economy.",
    },
    {
      q: "How do I get a merchant to accept bitcoin?",
      a: "Ask. Many point-of-sale systems already support it (Square now turns on bitcoin payments over the Lightning Network for eligible US sellers by default, with the seller receiving dollars unless they choose bitcoin), so it is often just a toggle. For others, help them pick a Lightning-enabled processor. Once they accept it, get them listed so other bitcoiners can find and spend with them.",
    },
    {
      q: "Do I have to sell my bitcoin to help grow it?",
      a: "No. The whole point of spend and replace is that you can use bitcoin as money while keeping your stack exactly where it is. And several of the most useful things you can do, like running a node, self-custodying, onboarding a merchant, or teaching someone, cost no bitcoin at all.",
    },
    {
      q: XSELL_HELP_FAQ_Q,
      a: XSELL_HELP_FAQ_A,
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: "How to Help Grow Bitcoin",
        description:
          "Concrete ways anyone can help grow bitcoin and support adoption, without selling their stack.",
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
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
        // eslint-disable-next-line react/no-danger
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
          {" · Help grow bitcoin"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Ways to support adoption
        </div>
        <h1 className="display-title mb-4">
          How to help grow bitcoin
        </h1>

        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            Bitcoin&apos;s economy grows when people use it as money. The thing
            most people can do today is{" "}
            <Link
              href="/spend-and-replace"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              spend and replace
            </Link>
            : use bitcoin as money, then rebuy the same amount with fiat so your
            stack never shrinks. Below are concrete, no-permission-needed ways to
            help, from onboarding a single merchant to running a node. None of
            them require selling your bitcoin.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            What actually helps
          </h2>
          <div className="space-y-3">
            {WAYS.map((w) => (
              <div
                key={w.n}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
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
                <Link
                  href={w.href}
                  className="inline-block mt-3 t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                >
                  {w.hrefLabel}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Start here</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/spend-and-replace"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ↻ /spend-and-replace
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Use bitcoin without losing it
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The spend-and-replace habit, explained.
              </div>
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⌂ Vendor directory
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                {vendorCount} merchants that take bitcoin
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Somewhere to spend, and somewhere to submit one.
              </div>
            </Link>
          </div>
        </section>

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
