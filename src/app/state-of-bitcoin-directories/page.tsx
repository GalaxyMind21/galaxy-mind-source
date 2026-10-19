// /state-of-bitcoin-directories · the honest directory-landscape
// comparison (SEO sprint 2026-07-21). Purpose: (1) the linkable asset
// behind the broken-link outreach — top-ranking pages (including
// bitcoin.org's spend page) still recommend directories that are dead,
// and every outreach email needs a factual page to point at; (2) rank
// for "bitcoin directory" comparison queries; (3) E-E-A-T — crediting
// BTC Map generously and stating plainly what each tool is good at is
// what makes the page citable rather than promotional.
//
// EVERY liveness claim below was verified first-hand on the date in
// LAST_CHECKED (curl probes · see the commit). When re-checking,
// update the observations AND all THREE date sites together — a stale
// "state of" page is exactly the failure mode it documents:
//   1. LAST_CHECKED below (renders in the hero + an FAQ answer)
//   2. the Article JSON-LD dateModified in this file
//   3. this route's lastModified entry in src/app/sitemap.ts
//
// Growth 2026-09-14: quiet VendorHashrateModule after the short-version box so
// "bitcoin merchant directory" / Coinmap-vs-BTC Map SERP visitors (vs BTC Map's
// 27k+ physical pins, Cryptwerk's multi-coin catalogues, and Lightning Network
// Stores' vote ranks) convert onto paid USA ASIC rentals — same module as /v,
// category, country, online-stores, LATAM, /map, coffee, and how-many.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import { STALE_THRESHOLD_DAYS, VENDORS } from "@/lib/vendors";
import { OG_DIRECTORY } from "@/lib/og";

const URL_ = "https://galaxymind.space/state-of-bitcoin-directories";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

const LAST_CHECKED = "July 21, 2026";

const TITLE = "The State of Bitcoin Merchant Directories (2026) · Galaxy Mind";
const DESCRIPTION =
  "Which bitcoin merchant directories are still alive in 2026? Liveness-checked: Coinmap and Spendabit are gone, BTC Map owns the physical map.";

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

type DirStatus = "gone" | "caution" | "alive";

const DIRECTORIES: {
  name: string;
  url?: string;
  status: DirStatus;
  statusLabel: string;
  body: string;
}[] = [
  {
    name: "BTC Map",
    url: "https://btcmap.org",
    status: "alive",
    statusLabel: "Alive and growing",
    body: "The community successor to Coinmap and the clear winner for physical locations: tens of thousands of merchants on OpenStreetMap data, open API, active local communities, and per-location survey dates. If you want to spend bitcoin in person near you, BTC Map is the tool to use: OSM data, survey dates, open API. Its scope is physical places by design (OpenStreetMap maps the physical world), so online-only stores sit outside it.",
  },
  {
    name: "Coinmap",
    status: "gone",
    statusLabel: "Discontinued",
    body: "The original crowdsourced merchant map, and for years the default answer. It has been discontinued; coinmap.org now serves its operator's exchange landing page instead of a merchant map. Guides that still say \"check Coinmap\" are recommending a tool that no longer exists; the community's map lives on at BTC Map.",
  },
  {
    name: "Spendabit",
    status: "gone",
    statusLabel: "Unreachable",
    body: "The product-search engine for bitcoin commerce (\"search millions of things you can buy with bitcoin\"). As of our last check its homepage fails to respond at all, and archived copies of its pages still cite anchor merchants that shut down years ago. It is still linked from several high-ranking \"where to spend bitcoin\" resources, which is exactly why this page exists.",
  },
  {
    name: "SpendBitcoins",
    status: "gone",
    statusLabel: "Unreachable",
    body: "An early directory some articles still cite for its claimed database of merchants. The domain no longer responds to connections at all.",
  },
  {
    name: "acceptedhere.io",
    status: "gone",
    statusLabel: "Domain repurposed",
    body: "A former acceptance directory whose domain now redirects to an unrelated gambling site. A cautionary tale for old bookmarks: a dead directory's domain doesn't stay parked forever. We deliberately don't link it.",
  },
  {
    name: "Lightning Network Stores",
    url: "https://lightningnetworkstores.com",
    status: "caution",
    statusLabel: "Alive · vote-ranked",
    body: "The closest thing to an online-store directory that survived: a community catalog of Lightning-accepting websites ranked by user votes. It remains useful for discovery, but listings don't display verification dates, and the catalog mixes physical-goods stores with apps, services, and gambling sites, so expect to vet what you find.",
  },
  {
    name: "Cryptwerk",
    url: "https://cryptwerk.com",
    status: "caution",
    statusLabel: "Alive · multi-coin",
    body: "A large self-submission catalog spanning many cryptocurrencies, bitcoin among them. Scale is its pitch; the trade-off is that listings don't show per-merchant verification recency, so staleness is hard to judge from the outside.",
  },
  {
    name: "BitPay & CoinGate directories",
    url: "https://bitpay.com/directory",
    status: "caution",
    statusLabel: "Alive · processor-scoped",
    body: "The payment processors maintain the freshest big-brand lists. This is where you find which household names take bitcoin at checkout. By design they list merchants on their own payment rails, so independent merchants using other setups (BTCPay, native Lightning) don't appear.",
  },
  {
    name: "Galaxy Mind (this site)",
    url: SITE_URL,
    status: "alive",
    statusLabel: "Alive · human-verified",
    body: `Where this site fits: an online-store-first directory of independent merchants selling everyday goods for bitcoin. Every listing is checked automatically every day. A human confirms the date shown on the card at least every ${STALE_THRESHOLD_DAYS} days, or sooner when the automated check flags a change. The data is open (JSON API, RSS, MCP server), and there are no listing fees. It is deliberately curated rather than huge, and the goal is that nothing on it is dead.`,
  },
];

export default async function StateOfDirectoriesPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const FAQ = [
    {
      q: "Is Coinmap still active?",
      a: "No. Coinmap was discontinued and coinmap.org no longer serves a merchant map. The community-maintained successor for physical merchant mapping is BTC Map (btcmap.org), built on OpenStreetMap data.",
    },
    {
      q: "Is Spendabit still working?",
      a: `No. As of ${LAST_CHECKED}, spendabit.co fails to respond. Several high-ranking articles and resource pages still link it as a way to find things to buy with bitcoin.`,
    },
    {
      q: "What is the best bitcoin merchant directory in 2026?",
      a: `It depends on the job. For physical places near you: BTC Map. For big brands at checkout: the BitPay and CoinGate directories. For independent online stores selling everyday goods, human-verified with visible check dates: the Galaxy Mind directory of ${VENDORS.length} merchants.`,
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL_}#article`,
        headline: "The state of bitcoin merchant directories, 2026",
        description: DESCRIPTION,
        url: URL_,
        dateModified: "2026-07-21",
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
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Galaxy Mind", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "State of bitcoin directories",
            item: URL_,
          },
        ],
      },
    ],
  };

  const lamp = (s: DirStatus) =>
    s === "alive"
      ? "bg-[var(--success)]"
      : s === "caution"
        ? "bg-[var(--warning)]"
        : "bg-[var(--danger)]";

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      {/* Static house strings only · no user input; safeJsonLd()
          escapes `<` and U+2028/U+2029. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="t-xs font-medium text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · Directory report"}
        </nav>

        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          Field report · last checked {LAST_CHECKED}
        </div>
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-4">
          The state of bitcoin{" "}
          <span className="headline-gradient glow-text">directories</span>.
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-lg max-w-2xl mb-8 leading-snug sm:leading-relaxed">
          Ask the internet where to spend bitcoin and it will confidently
          send you to tools that died years ago. We probed every
          directory the top-ranking guides still recommend. Here is
          what actually responds in 2026, what each survivor is good
          at, and where the dead ones&apos; jobs migrated.
        </p>

        <div className="space-y-4 mb-12">
          {DIRECTORIES.map((d) => (
            <section
              key={d.name}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {d.url ? (
                    d.url.startsWith(SITE_URL) ? (
                      <Link
                        href="/"
                        className="hover:text-[var(--accent-ink)] transition-colors"
                      >
                        {d.name}
                      </Link>
                    ) : (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[var(--accent-ink)] transition-colors"
                      >
                        {d.name} ↗
                      </a>
                    )
                  ) : (
                    d.name
                  )}
                </h2>
                <span className="inline-flex items-center gap-2 t-xs text-[var(--text-tertiary)] shrink-0">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${lamp(d.status)}`}
                    aria-hidden
                  />
                  {d.statusLabel}
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                {d.body}
              </p>
            </section>
          ))}
        </div>

        <section className="mb-12 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short version
          </div>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans">
            Physical places near you →{" "}
            <a
              href="https://btcmap.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              BTC Map
            </a>
            . Big brands at checkout → the processor directories. Independent{" "}
            <Link
              href="/online-stores-that-accept-bitcoin"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              online stores that accept bitcoin
            </Link>
            , human-verified with dates you can see →{" "}
            <Link href="/" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              this directory
            </Link>
            . And if a guide sends you to Coinmap or Spendabit, its
            author hasn&apos;t clicked their own links in a while.
          </p>
        </section>

        <VendorHashrateModule className="mb-12" />

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
      </article>
    </main>
  );
}
