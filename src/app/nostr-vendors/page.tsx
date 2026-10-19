// /nostr-vendors · SEO landing page targeting Nostr-specific vendor
// discovery queries ("nostr vendors directory", "bitcoin merchants on
// nostr", "nostr shops accepting bitcoin").
//
// Why this exists separately from /:
// The main directory at / serves all vendors mixed by platform
// (X / Nostr / Lightning) for a directory-browsing experience. This
// page narrows to the 40 Nostr-platform vendors and is designed for
// search-engine discovery · keyword-dense intro, per-vendor cards
// that link into /v/[slug] for the full detail, and a FAQ section
// answering the common questions (what is Nostr, how do I pay a
// Nostr vendor, why does it matter).
//
// SEO landing-page anatomy:
//   1. Above-fold intro (H1 + 1-2 paragraphs) · keyword density
//   2. Server-rendered vendor grid (full HTML in first paint, no JS
//      gating required for indexability)
//   3. FAQ section (renders both as HTML and as JSON-LD FAQPage
//      schema for rich snippet treatment)
//   4. CTA back to the full directory + Nostr profile
//
// Audit 2026-05-25 created this page to capture long-tail queries
// the main / page doesn't rank for because its title is "Spend
// Bitcoin at Merchants That Accept BTC" (broad commerce intent).

// Growth 2026-09-15: quiet VendorHashrateModule after the Nostr shelf so
// Nostr-native directory visitors (same roster slice as /, vs BTC Map physical
// pins and Cryptwerk multi-coin catalogues) convert onto paid USA ASIC rentals
// — same module as /v, online-stores, LATAM, /map, coffee, how-many, state-of.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { DirectoryShelf } from "@/components/DirectoryShelf";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import {
  VENDORS,
  getPlatform,
} from "@/lib/vendors";
import { OG_DIRECTORY } from "@/lib/og";

const URL = "https://galaxymind.space/nostr-vendors";
const SITE_URL = "https://galaxymind.space";

// Live total across all platforms · interpolated into the FAQ answer +
// the "Full directory" link so the count never goes stale on a vendor
// add (was hardcoded "111"). Module scope so both FAQ_SCHEMA (built at
// module load) and the component body can reference it.
const TOTAL_VENDORS = VENDORS.length;

export const metadata: Metadata = {
  title: "Nostr Vendors Accepting Bitcoin · Galaxy Mind",
  description:
    "Nostr-native merchants accepting Bitcoin for everyday goods, with NIP-05 or npub identities, by category and country. Pay on-chain or over Lightning.",
  openGraph: {
    images: OG_DIRECTORY,
    title: "Bitcoin Nostr Vendors · Merchants Accepting BTC",
    description:
      "Directory of 40+ Nostr-native shops accepting Bitcoin. Browse by category, country, or freshness.",
    url: URL,
    siteName: "Galaxy Mind",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Nostr Vendors",
    description:
      "Curated directory of Nostr-native merchants accepting Bitcoin.",
    creator: "@GalaxyMind",
  },
  alternates: { canonical: URL },
};

// SAFE: FAQ_SCHEMA is a static server-controlled object literal · no
// user input ever flows in. safeJsonLd() escapes `<` and U+2028/U+2029
// for defense in depth. Same already-shipped pattern as the 8 other
// layouts (stack, treasuries, fit, root, about, faq, glossary, v/[slug]).
// Inline JSON-LD is mandatory because search engines (Google, Bing,
// Perplexity) do not fetch external JSON-LD documents.
const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      url: URL,
      name: "Bitcoin Nostr Vendors",
      description:
        "Curated directory of Nostr-native merchants accepting Bitcoin for everyday goods.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      provider: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is a Nostr vendor?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A Nostr vendor is a merchant whose primary online identity lives on Nostr · the censorship-resistant social protocol that uses public-key cryptography instead of accounts owned by a platform. Nostr vendors are identified by either an NIP-05 address (name@domain.tld) or a bech32 public key (npub1... / nprofile1...). The Galaxy Mind directory lists 40+ Nostr-native vendors accepting Bitcoin for everyday goods · everything from coffee and apparel to hardware wallets and digital services.",
          },
        },
        {
          "@type": "Question",
          name: "How do I pay a Nostr vendor with Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Most Nostr vendors take Bitcoin over one of three rails. Lightning is the most common: the merchant publishes a Lightning Address (name@domain.tld) or a BOLT-11 invoice in their Nostr profile, and you pay direct from any LN wallet such as Wallet of Satoshi, Phoenix, or Zeus. On-chain works too, where the merchant shares a BTC address by DM once you message them. Zaps are the third option, Nostr's native Lightning tipping built into most Nostr clients. Each vendor's page on Galaxy Mind lists their preferred rails and any Lightning Address they have already published.",
          },
        },
        {
          "@type": "Question",
          name: "Why does Nostr matter for Bitcoin commerce?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Nostr matters because it's identity infrastructure that mirrors Bitcoin's properties · decentralized, censorship-resistant, no platform that can deplatform a vendor. A Bitcoin merchant on X can be banned at any time; a Bitcoin merchant on Nostr controls their own identity via their private key and migrates between clients freely. Combined with Lightning for payments, Nostr is the closest thing to a fully-sovereign commerce stack that Bitcoiners have today. Galaxy Mind highlights Nostr-platform vendors specifically because supporting them strengthens that stack.",
          },
        },
        {
          "@type": "Question",
          name: "How do I find Nostr vendors in my country?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `The Galaxy Mind directory at / (homepage) has country and category filters that work across all ${TOTAL_VENDORS} vendors (X / Nostr / Lightning combined). This /nostr-vendors page is a Nostr-only view of the same data. Each vendor card shows the country flag · click into the /v/[slug] page for full details including the vendor's Nostr profile link (resolves to njump.me).`,
          },
        },
        {
          "@type": "Question",
          name: "Can I submit a Nostr vendor to the directory?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes · visit galaxymind.space/submit and paste your NIP-05 address or npub. The form auto-enriches from your kind:0 profile metadata (display name, picture, description) so you don't have to retype it. Submissions land in a moderation queue and are reviewed within 24-48 hours. The directory is human-curated and free.",
          },
        },
      ],
    },
  ],
};

export default async function NostrVendorsPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // Filter VENDORS to Nostr-platform only. Public dormancy hiding was
  // removed 2026-05-20 (homepage and /api/vendors.json show everyone;
  // the KV flag is operator-only). This page used to filterActive()
  // and showed a shorter roster than / — split truth vs the directory.
  // Sorted by addedAt desc so newest land at top.
  const nostrVendors = VENDORS.filter((v) => getPlatform(v) === "nostr").sort(
    (a, b) => b.addedAt - a.addedAt,
  );

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      {/* SAFE inline JSON-LD · same audited pattern as 8 other layouts.
          Static server-controlled FAQ_SCHEMA · no user input ever
          reaches dangerouslySetInnerHTML. safeJsonLd() escapes JSON-
          LD-risky chars (<, U+2028/U+2029). CSP nonce gates the script. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(FAQ_SCHEMA) }}
      />
      <SiteHeader />

      <article className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-16">
        <p className="night-bench-kicker">Nostr-native directory</p>
        <h1 className="display-title mb-4">
          Bitcoin Nostr vendors
        </h1>
        <p className="night-bench-lede mb-3">
          {nostrVendors.length}+ Nostr-native merchants accepting Bitcoin for
          everyday goods. Vendors here have NIP-05 (
          <code className="font-mono text-sm text-[var(--accent-ink)]">
            name@domain.tld
          </code>
          ) or bech32 (
          <code className="font-mono text-sm text-[var(--accent-ink)]">
            npub1…
          </code>
          ) identities on Nostr · the censorship-resistant identity layer that
          mirrors Bitcoin&apos;s properties. Pay via Lightning Address, BOLT-11
          invoice, on-chain BTC, or Nostr Zaps.
        </p>
        <p className="text-sm text-[var(--text-tertiary)] leading-relaxed max-w-3xl mb-8 font-sans">
          Every listing is reviewed by a human, and the directory is free.
          Looking for X-handle or Lightning-only vendors too?{" "}
          <Link
            href="/"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] underline-offset-4"
          >
            Browse the full directory →
          </Link>
        </p>

        <div className="mb-12">
          <DirectoryShelf vendors={nostrVendors} />
        </div>

        <VendorHashrateModule className="mb-12" />

        <section className="border-t border-[var(--border-subtle)] pt-12 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6">
            {FAQ_SCHEMA["@graph"][1].mainEntity!.map((q) => (
              <div key={q.name}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {q.name}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {q.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-8">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors"
            >
              Full directory · {TOTAL_VENDORS} vendors →
            </Link>
            <Link
              href="/submit"
              className="micro-label inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              + Submit your Nostr shop
            </Link>
            <Link
              href="/nostr-marketplaces"
              className="micro-label inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              What is a Nostr marketplace? →
            </Link>
            <a
              href="https://njump.me/nprofile1qqspwnkez659yrnzx2fu4kzpngtkak7v3sdpuh6jw83key38xru5wrcny0sdm"
              target="_blank"
              rel="noopener noreferrer"
              className="micro-label inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Follow @GalaxyMind on Nostr ↗
            </a>
          </div>
        </section>
      </article>

      <FooterDisclaimer />
    </main>
  );
}
