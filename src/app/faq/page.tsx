import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { safeJsonLd } from "@/lib/json-ld";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { AlertSubscribeCompact } from "@/components/AlertSubscribeCompact";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";
import { STALE_THRESHOLD_DAYS } from "@/lib/vendors";
import {
  BITCOIN_ORG_SPEND_URL,
  INDEPENDENCE_CLAIM,
} from "@/lib/listing";
import { SITE_FAQ_RENT_Q, SITE_FAQ_RENT_A } from "@/lib/hashrate-copy";
import { MARKETPLACE_REFERRAL_FAQ_NOTE } from "@/lib/marketplace-listing";

export const metadata: Metadata = {
  title: "FAQ · Galaxy Mind",
  description:
    "Answers on the Buying Gauge, mNAV, the vendor directory, and renting USA ASIC hashrate.",
  alternates: { canonical: "https://galaxymind.space/faq" },
  openGraph: {
    type: "website",
    images: OG_DIRECTORY,
    url: "https://galaxymind.space/faq",
    title: "FAQ · Galaxy Mind",
    description:
      "How is the Bitcoin Buying Gauge calculated? What is mNAV? How are vendors verified? Can I rent a miner? Open answers.",
  },
};

type FAQ = {
  q: string;
  a: React.ReactNode;
  category: string;
};

const FAQS: FAQ[] = [
  // ── BUYING GAUGE ──
  {
    category: "Buying Gauge",
    q: "How is the Buying Gauge calculated?",
    a: (
      <>
        Ten weighted contrarian signals each produce a 0–100 score, then
        the weighted sum becomes the headline verdict. Current weights:
        MVRV (16%), Mayer Multiple (14%), Puell Multiple (13%), Funding
        Rate (12%), Fear &amp; Greed (10%), Price-vs-30d-MA (9%), 30d
        Realized Vol (7%), Hour-of-Day (7%), Day-of-Week (6%), MSTR
        mNAV (6%). The full methodology + per-signal definitions are
        on the{" "}
        <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          /stack
        </Link>{" "}
        page (scroll to &quot;How this works&quot;).
      </>
    ),
  },
  {
    category: "Buying Gauge",
    q: "Why is it called a contrarian gauge?",
    a: (
      <>
        Because the highest scores fire when sentiment is darkest:
        extreme fear in the crowd, shorts paying longs in funding,
        miners capitulating, treasury equity trading at no premium.
        Historically those moments have been the best entries for
        long-horizon accumulators, the &quot;blood in the streets&quot;
        Baron Rothschild was talking about. The gauge is built to
        identify them with hard data instead of vibes.
      </>
    ),
  },
  {
    category: "Buying Gauge",
    q: "Why does the score barely move some days?",
    a: (
      <>
        Most weight (52%) is on signals that update once per day or
        slower (MVRV, Fear &amp; Greed, Puell Multiple, Day-of-Week,
        mNAV). So intraday score changes are bounded to ~1–2 points
        from price-derived signals + Hour-of-Day. The history sparkline
        below the gauge shows how the score has moved over the last
        30/90 days · that&apos;s where you see the meaningful motion.
      </>
    ),
  },
  {
    category: "Buying Gauge",
    q: "How accurate are the signal data sources?",
    a: (
      <>
        Every signal pulls from a public source: CoinGecko (BTC price),
        Yahoo Finance (price-derived MAs + vol + treasury equity prices),
        Coinmetrics community API (MVRV + Puell), OKX (perp funding
        rate), alternative.me (Fear &amp; Greed), bitcointreasuries.net
        (treasury holdings + market cap), mempool.space (block height).
        All requests have a 5-second timeout. Cron jobs refuse to fire
        on a degraded snapshot (4+ of 8 signals null) so we never email
        or post based on a fallback verdict.
      </>
    ),
  },

  // ── TREASURIES ──
  {
    category: "Treasuries",
    q: "What is mNAV and how do you calculate it?",
    a: (
      <>
        mNAV = market capitalization ÷ value of bitcoin held. For MSTR:
        market cap (shares × price) divided by (BTC holdings × current
        BTC price). A value of 1.0× means the stock trades at the
        underlying BTC value; above 1.0 means a premium (you&apos;re
        paying for the wrapper); below 1.0 means a discount (you&apos;re
        getting BTC exposure cheaper than spot). Source data is from{" "}
        <a
          href="https://bitcointreasuries.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          bitcointreasuries.net
        </a>
        ; we display the raw values used so the math is auditable.
      </>
    ),
  },
  {
    category: "Treasuries",
    q: "Why doesn't your mNAV match what I see elsewhere?",
    a: (
      <>
        Three common reasons: (1) <strong>intraday timing</strong>{" "}
        · mNAV moves every minute as price changes; (2){" "}
        <strong>different definitions</strong>. Some sources use
        diluted shares, we use basic; (3){" "}
        <strong>cost-basis vs spot</strong> · &quot;premium to BTC at
        cost&quot; is a different number than &quot;premium to BTC at
        current price.&quot; Our calculation matches{" "}
        <a
          href="https://bitcointreasuries.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          bitcointreasuries.net
        </a>{" "}
        exactly. We cross-check the raw inputs.
      </>
    ),
  },
  {
    category: "Treasuries",
    q: "Why isn't [my favorite treasury company] listed?",
    a: (
      <>
        We track the four treasuries with meaningful market interest:
        MSTR (Strategy), XXI (Twenty One Capital), MPJPY (Metaplanet),
        ASST (Strive Inc). If a company you want to see has
        substantive BTC holdings + public market data, DM{" "}
        <a
          href="https://x.com/GalaxyMind"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          @GalaxyMind
        </a>{" "}
        and we&apos;ll consider adding them. SMLR was previously listed
        but bitcointreasuries.net now reports zero holdings, so we
        dropped it.
      </>
    ),
  },

  // ── ALLOCATION ENGINE ──
  {
    category: "Allocation engine",
    q: "How does /fit decide what to recommend?",
    a: (
      <>
        Two stages. Stage 1 builds a base allocation from your inputs
        (horizon, risk tolerance, account type) using a sleeve-based
        model. Stage 2 applies live-signal tilts: MSTR mNAV influences
        treasury sleeve weight, Fear &amp; Greed influences leverage
        sleeve weight, BTC vol influences daily-reset 2x ETF weight.
        Results update live as you change inputs. Hard invariants
        (e.g., MSTY only at horizons ≤ 2 years; STRK never in Minimal
        portfolios) are tested in CI to prevent regressions.
      </>
    ),
  },
  {
    category: "Allocation engine",
    q: "Why doesn't your engine include [my favorite asset]?",
    a: (
      <>
        We only include Bitcoin or Bitcoin-adjacent assets with sufficient
        market history + clear thesis: spot BTC, spot BTC ETFs (IBIT,
        FBTC, BITB, MSBT), MSTR, MPJPY, XXI, ASST, the MSTR-issuer
        preferred stack (STRC, STRF, STRK), the Strive-issuer SATA
        preferred, MSTY for short-horizon income, and 2x leveraged
        Bitcoin ETFs (MSTU, MSTX, BITX, MST). Adding non-Bitcoin assets
        would change the engine&apos;s mandate.
      </>
    ),
  },
  {
    category: "Allocation engine",
    q: "Are these expected returns guaranteed?",
    a: (
      <>
        No. They are <em>central forward estimates</em>, best guesses
        based on stated assumptions about Bitcoin&apos;s future
        compounding rate, treasury accretion, and volatility decay on
        leveraged products. The 1-sigma band shown for each asset is
        approximate. For a 1-year horizon, realized returns can easily
        land outside the band; for 10+ years, convergence to the central
        estimate is more reliable. Update your own thesis as market
        structure evolves.
      </>
    ),
  },

  // ── VENDORS ──
  {
    category: "Vendor directory",
    q: "How do I get my business listed?",
    a: (
      <>
        Use the{" "}
        <Link href="/submit" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          submit form
        </Link>
        . It asks for your handle, what you sell, and your country, and
        it validates the handle against the platform you pick as you
        type. Every submission lands in a moderation queue and a person
        reviews it before anything goes live. Nothing is auto-added. New
        listings need an X or Nostr identity, because a Lightning
        address on its own proves a wallet resolves and not that an
        accountable merchant stands behind it. If a submission needs
        clarifying we DM you rather than reject it.
      </>
    ),
  },
  {
    category: "Vendor directory",
    q: "How are vendors verified?",
    a: (
      <>
        We confirm each vendor explicitly accepts Bitcoin (on-chain or
        Lightning) for everyday goods, then list the platform-canonical
        link (X profile, Nostr profile, or Lightning Address). Each
        card shows how long ago a human last confirmed it
        (&quot;Verified by a human 3 days ago&quot;); if that is older
        than {STALE_THRESHOLD_DAYS} days the entry is flagged
        &quot;Re-verify due&quot; instead. Every listing&apos;s platform
        profile is also checked automatically every day for
        reachability, and where a shop URL is listed, that page is
        watched for it to stop mentioning bitcoin or Lightning at all;
        anything that changes is queued for a person to review. The
        date on the card is the last time a human confirmed it, not the
        last automated check.
      </>
    ),
  },
  {
    category: "Vendor directory",
    q: "Why both X AND Nostr submissions?",
    a: (
      <>
        Bitcoin culture is migrating to Nostr but X is still where most
        vendors are discoverable. We support both because we want the
        directory to reflect <em>who actually accepts BTC</em>, not who
        happens to be on the platform we prefer. Lightning Address
        vendors get listed too, with a payment link instead of a
        social profile.
      </>
    ),
  },

  // ── HASHRATE ──
  {
    category: "Hashrate",
    q: SITE_FAQ_RENT_Q,
    a: (
      <>
        {SITE_FAQ_RENT_A}{" "}
        See{" "}
        <Link href="/hashrate" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          /hashrate
        </Link>
        .
      </>
    ),
  },

  // ── PROJECT ──
  {
    category: "Project",
    q: "Is this project open source?",
    a: (
      <>
        The repository is currently private. Source-availability is
        possible if there&apos;s enough interest. DM{" "}
        <a
          href="https://x.com/GalaxyMind"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          @GalaxyMind
        </a>{" "}
        if you&apos;d use it. The embed widget at{" "}
        <Link href="/embed" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          /embed
        </Link>{" "}
        is public + MIT-licensed; rip it apart however you like.
      </>
    ),
  },
  {
    category: "Project",
    q: "Do you use affiliate or referral links?",
    a: (
      <>
        {INDEPENDENCE_CLAIM} Visiting a shop from this directory
        does not pay us, and nothing is ranked for pay. The directory is
        listed on{" "}
        <a
          href={BITCOIN_ORG_SPEND_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          bitcoin.org&apos;s Spend Bitcoin page
        </a>
        , which is why the roster itself stays unpaid.{" "}
        {MARKETPLACE_REFERRAL_FAQ_NOTE}
      </>
    ),
  },
  {
    category: "Project",
    q: "How do you make money?",
    a: (
      <>
        Barely. Galaxy Mind has no ads, no paid tiers, and no
        email-list selling. Two things bring anything in, both visible:
        the Lightning support tip (the ⚡ button in the header), and
        the USA ASIC fleet we rent on{" "}
        <Link href="/hashrate" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          /hashrate
        </Link>
        , rented directly from us. No listing, ranking, or signal on
        this site is for sale.
      </>
    ),
  },
  {
    category: "Project",
    q: "What's on the roadmap?",
    a: (
      <>
        Right now: more vendors, more countries, more historical data
        accumulating in the snapshot tables. Beyond that: deeper
        plain-language explainers across the tools, and broader treasury
        coverage as upstream data allows. Long-term: whatever the
        audience asks for. Suggestions welcome via{" "}
        <a
          href="https://x.com/GalaxyMind"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          @GalaxyMind
        </a>
        .
      </>
    ),
  },
];

const CATEGORIES = ["Buying Gauge", "Treasuries", "Allocation engine", "Vendor directory", "Hashrate", "Project"];

// Plain-text extraction from the JSX answers so the FAQPage JSON-LD
// stays single-sourced with the visible content (audit 2026-07-12:
// /faq was the only Q&A surface without FAQPage markup — and AI
// answer engines lifting Q&A pairs is this site's stated
// distribution strategy). Static JSX only: strings, numbers, arrays,
// and elements whose children we recurse into.
function nodeToText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return nodeToText(el.props.children);
  }
  return "";
}

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: nodeToText(f.a).replace(/\s+/g, " ").trim(),
    },
  })),
};

export default async function FAQPage() {
  // Per-request CSP nonce from proxy.ts — without it the
  // strict-dynamic CSP blocks the inline JSON-LD script (same
  // pattern as /stack's layout and OvervaluedPage).
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      {/* SAFE inline JSON-LD · static server-controlled object,
          safeJsonLd() escapes JSON-LD-risky chars, CSP nonce gates
          the script tag. One FAQPage per URL. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(FAQ_JSON_LD) }}
      />
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <p className="night-bench-kicker">FAQ</p>
        <h1 className="display-title mb-6">
          How these tools work.
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
          The methodology is open. If something here doesn&apos;t match
          what you&apos;re seeing on the live tools, that&apos;s a bug
          report. DM{" "}
          <a
            href="https://x.com/GalaxyMind"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            @GalaxyMind
          </a>{" "}
          and we&apos;ll update.
        </p>

        {/* Glossary cross-link · most "what is X" questions belong on
            the glossary, not in the FAQ. Surfacing the link before the
            FAQ list itself routes definitional traffic correctly. */}
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed mb-10">
          Looking for a definition (mNAV, MVRV, Puell, Mayer, accretion,
          sleeve, Buying Gauge tier)?{" "}
          <a
            href="/glossary"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
          >
            See the glossary →
          </a>
        </p>

        {CATEGORIES.map((cat) => (
          <section key={cat} className="mb-10">
            <h2 className="micro-label text-[var(--accent-ink)] mb-4">
              {cat}
            </h2>
            {/* ONE list per category, hairline-divided, rather than a stack
                of identical boxes with 21px gutters between them. Measured
                before: 18 questions at a 70px row plus a 33px gap ran
                1,860px, so simply SEEING the questions took two screens on
                a page whose whole job is letting you find yours. Rows are
                now ~48px inside a single object, which is about half the
                height and also the more restrained read — dividers are the
                Night Bench idiom, a rank of bordered cards is a component
                library's. */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] divide-y divide-[var(--border-subtle)] overflow-hidden">
              {FAQS.filter((f) => f.category === cat).map((f, i) => (
                <details
                  key={i}
                  className="group open:bg-[var(--bg-elevated-2)]/50 transition-colors"
                >
                  <summary className="cursor-pointer list-none px-4 sm:px-5 py-3.5 flex items-baseline justify-between gap-3 hover:bg-[var(--bg-elevated-2)]/35 transition-colors">
                    <span className="font-semibold text-[var(--text-primary)] text-sm sm:text-base">
                      {f.q}
                    </span>
                    <span
                      className="font-mono text-[var(--accent-ink)] flex-shrink-0 group-open:rotate-45 transition-transform"
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <div className="px-4 sm:px-5 pb-4 -mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                    {f.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </article>

      <AlertSubscribeCompact source="faq" />

      <FooterDisclaimer />
    </main>
  );
}
