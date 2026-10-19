import type { Metadata } from "next";
import Link from "next/link";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { AlertSubscribeCompact } from "@/components/AlertSubscribeCompact";
import { WhatsNewFeed } from "@/components/WhatsNewFeed";
import { SiteHeader } from "@/components/SiteHeader";
import { VENDORS } from "@/lib/vendors";
import { OG_DIRECTORY } from "@/lib/og";
import { BITCOIN_ORG_SPEND_URL, INDEPENDENCE_CLAIM } from "@/lib/listing";
import { ABOUT_HASHRATE_BLURB } from "@/lib/hashrate-copy";

export const metadata: Metadata = {
  title: "About · Galaxy Mind",
  description:
    "Galaxy Mind: free, independent Bitcoin tools. Vendor directory, Buying Gauge, treasury mNAV scoreboard, and allocation engine. Built solo, open methodology.",
  alternates: { canonical: "https://galaxymind.space/about" },
  openGraph: {
    type: "website",
    images: OG_DIRECTORY,
    // Without an explicit url this block shipped NO og:url at all: the
    // openGraph object replaces the root's rather than merging into it,
    // so the root's url does not fill the gap (Ahrefs "Open Graph tags
    // incomplete", 2026-08-06). Enforced now by check-canonicals.
    url: "https://galaxymind.space/about",
    title: "About Galaxy Mind",
    description:
      "Free, independent Bitcoin tools: vendor directory, buying gauge, treasury scoreboard, allocation engine. Built solo. Not financial advice.",
  },
};

export default function AboutPage() {
  // Derived live from the roster so the "about" copy can never go
  // stale the way a hardcoded "~80 vendors" did (audit 2026-05-16 ·
  // the README explicitly warns against trusting hardcoded counts).
  // Static-rendered, so it refreshes on every deploy — and a vendor
  // change always ships via a deploy anyway.
  const vendorCount = VENDORS.length;
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;
  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <p className="night-bench-kicker">About</p>
        <h1 className="display-title mb-6">
          A small set of free, honest tools for Bitcoiners.
        </h1>

        <div className="space-y-5 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed font-sans">
          <p>
            <span className="text-[var(--accent-ink)]">Galaxy Mind</span>{" "}
            is an independent project built by one person, with no
            company and no investors behind it. The premise: Bitcoiners
            deserve honest instruments for stacking, spending, and
            reading the moment they are in.
          </p>
          <p>
            The directory is listed on{" "}
            <a
              href={BITCOIN_ORG_SPEND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              bitcoin.org&apos;s Spend Bitcoin page
            </a>
            . That listing is revocable: the vendors have to keep
            genuinely accepting bitcoin, the site cannot promote illicit
            activity or gambling, and the roster has to stay curated and
            up to date. We keep the directory that way on purpose.{" "}
            {INDEPENDENCE_CLAIM}
          </p>
          <p>What it stands for, plainly:</p>
          <ul className="space-y-2">
            <li>
              <span className="text-[var(--accent-ink)]">Own your keys.</span>{" "}
              Self-custodied bitcoin is the baseline everything else is
              measured against. Nothing here pushes you off it.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">
                Verify, don&apos;t trust.
              </span>{" "}
              Every number shows its source and when it was last
              checked. The methodology is public. Check the math.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">
                No accounts, no KYC.
              </span>{" "}
              Nothing to sign up for and no email needed to use any of
              the tools. No cross-site tracking. Analytics is
              cookieless and aggregate only, so usage is visible
              without watching you.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">Spend your sats.</span>{" "}
              The directory exists so bitcoin gets used as money, not
              only held. Circular economy over number-go-up.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">
                Free and honest.
              </span>{" "}
              Free to use, free to embed, not financial advice.{" "}
              {INDEPENDENCE_CLAIM} If something is wrong, say so.
            </li>
          </ul>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            What&apos;s here
          </h2>
          <ul className="space-y-3">
            <li>
              <Link
                href="/"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /
              </Link>{" "}
              · A community-curated directory of merchants accepting
              Bitcoin for everyday goods. {vendorCount} vendors across{" "}
              {countryCount} countries, spanning X, Nostr, and Lightning. No backend; the data
              lives in a single TypeScript file. New shops go through{" "}
              <Link
                href="/submit"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                /submit
              </Link>
              {" "}
              and are listed only after a person confirms a bitcoin
              payment for an actual good.
            </li>
            <li>
              <Link
                href="/stack"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /stack
              </Link>{" "}
              · The Bitcoin Buying Gauge. 10 weighted contrarian signals
              (MVRV, Mayer Multiple, Puell Multiple, Funding Rate, Fear
              &amp; Greed, Price-vs-30d-MA, 30d Realized Vol, Hour-of-Day,
              Day-of-Week, MSTR mNAV) compute a single 0–100 score
              answering &quot;is this a better-than-average moment to
              accumulate?&quot; Daily snapshots build a history trail.
            </li>
            <li>
              <Link
                href="/treasuries"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /treasuries
              </Link>{" "}
              · Live mNAV scoreboard for the four major bitcoin treasury
              equities (MSTR, XXI, MPJPY, ASST). Side-by-side mNAV vs
              price-change history. Effective-BTC-price column shows
              what you ACTUALLY pay per BTC by buying each equity.
            </li>
            <li>
              <Link
                href="/fit"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /fit
              </Link>{" "}
              · A live allocation engine. Enter horizon, risk tolerance,
              account type (taxable / IRA / Roth) · get a portfolio of
              Bitcoin and Bitcoin-adjacent securities (sleeves spanning
              spot BTC, ETFs, treasury equities, preferreds, leveraged
              ETFs) sized for your profile. Updates live as you change
              inputs. Side-by-side scenario comparison built in.
            </li>
            <li>
              <Link
                href="/hashrate"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /hashrate
              </Link>{" "}
              · {ABOUT_HASHRATE_BLURB}
            </li>
            <li>
              <Link
                href="/today"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /today
              </Link>{" "}
              · The daily briefing: gauge, float, cheapest treasury,
              directory pulse, and the daily games.
            </li>
            <li>
              <Link
                href="/arcade"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /arcade
              </Link>{" "}
              · Eight bitcoin games, including a new WEN, Gauntlet,
              Trail, and CHOP every UTC day.
            </li>
            <li>
              <Link
                href="/float"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /float
              </Link>{" "}
              · How much bitcoin is left to buy. The in-play float as a
              live clock.
            </li>
            <li>
              <Link
                href="/map"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
              >
                /map
              </Link>{" "}
              · Every listed shop that has a country, on a 3D globe
              with an accurate day/night terminator.
            </li>
          </ul>

          {/* What's new · build-time changelog from git log. Lives
              between the "what's here" feature list and "methodology"
              so visitors evaluating legitimacy see active shipping
              before the engineering details. Renders nothing if the
              changelog is empty (graceful build outside a git repo). */}
          <WhatsNewFeed />

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            Methodology principles
          </h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-[var(--text-primary)]">
                Live data over editorial.
              </strong>{" "}
              Every signal pulls from a public source (CoinGecko, Yahoo
              Finance, OKX, Coinmetrics, alternative.me, mempool.space,
              bitcointreasuries.net). No human curation of scores.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">
                Graceful degradation.
              </strong>{" "}
              When an upstream goes down, that signal&apos;s weight
              redistributes proportionally rather than being replaced
              with an invented value. Cron jobs that depend on extreme
              readings refuse to fire on a degraded snapshot.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">
                Open methodology.
              </strong>{" "}
              The signal weights and tier boundaries are documented on
              each page. The recommendation engine&apos;s logic
              (mNAV-aware tilts, vol-decay caveats, horizon filters) is
              transparent.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">
                No retail-bait.
              </strong>{" "}
              There are no pop-ups, undisclosed partnerships, or
              newsletter dark patterns here. The Buying Gauge alert email
              opt-in is double-opt-in and never sells your address. Two
              things bring anything in, both visible: the Lightning
              support tip (the ⚡ button), and{" "}
              <Link
                href="/hashrate"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                /hashrate
              </Link>
              , where we rent our own USA ASIC fleet directly. No
              listing, ranking, or signal is for sale.
            </li>
          </ul>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            What this is NOT
          </h2>
          <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-4 sm:p-5">
            <p className="text-[var(--warning)] font-semibold mb-2">
              Not financial advice. Not investment advice. Not tax advice.
            </p>
            <p className="text-sm">
              Galaxy Mind is an information tool for educated adults who
              already understand Bitcoin and want better instrumentation.
              Every signal, every recommendation, every historical
              comparison is presented for your consideration · never as a
              prescription. Past performance doesn&apos;t predict future
              results. Position sizing, tax implications, and execution
              timing are 100% your responsibility. Consult a qualified
              advisor before making material financial decisions.
            </p>
          </div>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            Who built this
          </h2>
          <p>
            One person, in their off-hours, with help from{" "}
            <a
              href="https://claude.com/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              Claude Code
            </a>
            . X:{" "}
            <a
              href="https://x.com/GalaxyMind"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              @GalaxyMind
            </a>
            . Nostr: NIP-05 verified at{" "}
            <code className="text-[var(--text-primary)] t-xs">
              galaxymind.space
            </code>
            .
          </p>
          <p>
            Bug reports, feature requests, vendor submissions, and rude
            corrections all welcome via X or Nostr. Lightning tips are
            the only currency this site accepts.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            Want more answers?
          </h2>
          <p>
            See the{" "}
            <Link
              href="/faq"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
            >
              FAQ
            </Link>{" "}
            for specific questions about how each tool works, why we use
            the signals we do, and what we deliberately don&apos;t do.
            For plain-language definitions of every metric (mNAV, MVRV,
            Puell, Mayer, accretion, sleeve, and more) see the{" "}
            <Link
              href="/glossary"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
            >
              glossary
            </Link>
            . For exactly how vendors are vetted before they reach the
            directory, see the{" "}
            <Link
              href="/methodology"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
            >
              methodology
            </Link>
            .
          </p>
        </div>
      </article>

      <AlertSubscribeCompact source="about" />

      <FooterDisclaimer />
    </main>
  );
}
