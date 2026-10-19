// /bitcoin-treasuries-below-nav · live landing for the defining 2026
// treasury query: companies whose stock trades BELOW the value of the
// bitcoin they hold (gross mNAV under 1.0 · the "spiral of doom" /
// reflexivity story). Competitors list holdings; none frames the
// below-NAV split as a decision AND shows the gross-vs-net nuance that
// can flip a headline discount once senior leverage is accounted for.
// Galaxy Mind already computes gross + EV + CEBE-net mNAV live in
// cebe.ts, so this is a new doorway over existing data, no new plumbing.
// Server-rendered, ISR revalidate=300, FAQPage JSON-LD. Built 2026-06-18.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { computeCebe } from "@/lib/cebe";
import { TREASURY_META, COUNTRY_FLAG } from "@/lib/treasuries";

const URL = "https://galaxymind.space/bitcoin-treasuries-below-nav";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Bitcoin Treasuries Below NAV (mNAV Under 1) · Galaxy Mind",
  description:
    "Which bitcoin treasuries trade below NAV? A live mNAV-under-1 scoreboard for MSTR, Metaplanet, XXI and Strive, plus the net-of-debt view that can flip it.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "Bitcoin Treasuries Trading Below NAV (mNAV Under 1)",
    description:
      "Live: which public Bitcoin treasuries trade below the value of their bitcoin, gross vs net of senior debt. The 'spiral of doom' story, with the actual numbers.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/bitcoin-treasuries-below-nav/opengraph-image", "Bitcoin Treasuries Trading Below NAV (mNAV Under 1)"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Treasuries Trading Below NAV",
    description:
      "mNAV under 1.0 means the stock is worth less than its bitcoin. Live for MSTR / Metaplanet / XXI / Strive, gross and net of debt.",
    creator: "@GalaxyMind",
  },
};

const fmtUsd = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "·" : `$${Math.round(n).toLocaleString()}`;
const fmtMnav = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "·" : `${n.toFixed(2)}x`;

export default async function TreasuriesBelowNavPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const btcPrice = snapshot.btcPrice;

  const rows = snapshot.treasuries.map((q) => {
    const cebe = computeCebe(q, btcPrice);
    return { q, gross: q.mNAV, net: cebe.netMNav, ev: cebe.evMNav };
  });
  const ranked = [...rows].sort((a, b) => {
    if (a.gross == null && b.gross == null) return 0;
    if (a.gross == null) return 1;
    if (b.gross == null) return -1;
    return a.gross - b.gross;
  });

  const total = snapshot.treasuries.length;
  const belowNav = rows.filter((r) => r.gross != null && r.gross < 1.0);
  const belowNavCount = belowNav.length;
  // Names that look cheap on the headline (gross < 1) but sit at/above
  // parity once senior debt + preferred are netted out (CEBE net mNAV).
  const flipped = rows.filter(
    (r) => r.gross != null && r.gross < 1.0 && r.net != null && r.net >= 1.0,
  );
  const cheapest = ranked.find((r) => r.gross != null) ?? null;
  const cheapestMeta = cheapest ? TREASURY_META[cheapest.q.ticker] : null;
  const cheapestEff =
    cheapest?.gross != null && btcPrice != null ? btcPrice * cheapest.gross : null;
  const cheapestDiscount =
    cheapestEff != null && btcPrice != null && btcPrice > 0
      ? Math.round((1 - cheapestEff / btcPrice) * 100)
      : null;

  const bluf =
    cheapest == null || cheapestMeta == null || cheapest.gross == null
      ? "Live treasury data is temporarily unavailable; see the full scoreboard for current readings."
      : `${belowNavCount === 0 ? `None of the ${total} tracked Bitcoin treasuries currently trade below the value of the bitcoin they hold` : `${belowNavCount} of the ${total} tracked Bitcoin treasuries currently trade below the value of the bitcoin they hold (gross mNAV under 1.0)`}. The steepest discount is ${cheapestMeta.name} (${cheapest.q.ticker}) at ${fmtMnav(cheapest.gross)}${cheapest.gross < 1.0 ? `, an effective bitcoin price of ${fmtUsd(cheapestEff)}${cheapestDiscount != null ? `, about ${cheapestDiscount}% below spot` : ""}` : ` (still a premium)`}.${flipped.length > 0 ? ` But the headline can mislead: ${flipped.map((r) => r.q.ticker).join(" and ")} look cheap on gross mNAV yet sit at or above parity once senior debt and preferred are netted out, so the discount is thinner than it appears.` : ""}`;

  const FAQ = [
    {
      q: "What does mNAV below 1 mean for a Bitcoin treasury?",
      a: "mNAV (multiple of net asset value) is a treasury company's market cap divided by the value of the bitcoin it holds. Below 1.0 means the stock is worth less than the bitcoin on its balance sheet, so each dollar of stock buys more than a dollar of bitcoin exposure. It is a discount to net asset value, the opposite of the premium these stocks usually command.",
    },
    {
      q: "Is a Bitcoin treasury trading below NAV a buy?",
      a: "Not automatically. A discount can be a genuine value (more bitcoin per dollar through a regulated equity wrapper) or the market pricing in genuine risk: dilution, leverage, or a stalled accumulation flywheel. Crucially, gross mNAV ignores the capital structure. A company with large debt or preferred stack can look cheap on gross mNAV but sit at or above NAV once those senior claims are subtracted (its CEBE net mNAV). Check both lenses before calling it cheap. Not financial advice.",
    },
    {
      q: "Why is MSTR trading below its bitcoin?",
      a: "Strategy (MSTR) flipped from a large premium to around or below gross parity through 2026 as the broad treasury premium compressed. But MSTR also carries roughly $18 billion of convertible debt and preferred stock that rank ahead of common shareholders. Net of those senior claims (CEBE net mNAV) the picture is different from the gross headline. The live table above shows the current gross and net readings side by side.",
    },
    {
      q: "What is the 'spiral of doom' for treasury companies?",
      a: "The spiral of doom is the reflexive risk that sets in when a treasury company's stock falls below NAV. Above NAV it can issue shares accretively (raise a dollar, buy more than a dollar of bitcoin per share). Below NAV that flywheel reverses: issuing equity would be dilutive, cutting off the cheapest funding for more bitcoin, which can pressure the stock further. A persistent, deep discount is what makes the reflexivity a genuine risk rather than a simple buying opportunity.",
    },
    {
      q: "How is the below-NAV ranking calculated?",
      a: "Each company's gross mNAV is market cap (live) divided by bitcoin holdings times spot bitcoin price, refreshed every 5 minutes. Net (CEBE) mNAV divides by the bitcoin left for common shareholders after senior claims (debt plus preferred, net of cash), with the senior-claims figures hand-sourced from SEC filings and dated. The table sorts ascending by gross mNAV, so the steepest discount is first. Open methodology, reproducible from public data.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: URL,
        name: "Bitcoin Treasuries Trading Below NAV (mNAV Under 1)",
        description:
          "Live ranking of public Bitcoin treasury companies trading below the value of their bitcoin, with gross and net-of-senior-claims mNAV.",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        provider: { "@id": `${SITE_URL}/#org` },
        dateModified: snapshot.asOf,
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

  const updated = new Date(snapshot.asOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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
          {" · "}
          <Link href="/treasuries" className="hover:text-[var(--accent-ink)] transition-colors">
            Treasuries
          </Link>
          {" · Below NAV"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          mNAV under 1.0 · live
        </div>
        <h1 className="display-title mb-4">
          Bitcoin treasuries trading below NAV
        </h1>
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            {bluf}
          </p>
          <div className="mt-4 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
            Updated {updated} · live
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            Gross vs net, ranked by discount
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-elevated-2)]/50">
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">
                    #
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">
                    Company
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Gross mNAV
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Net mNAV
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Eff. BTC price
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const meta = TREASURY_META[r.q.ticker];
                  const eff =
                    r.gross != null && btcPrice != null ? btcPrice * r.gross : null;
                  const grossColor =
                    r.gross == null
                      ? "var(--text-tertiary)"
                      : r.gross < 1.0
                        ? "var(--cool-ink)"
                        : r.gross < 1.05
                          ? "var(--text-primary)"
                          : "var(--accent)";
                  const verdict =
                    r.gross == null
                      ? "·"
                      : r.gross < 1.0 && r.net != null && r.net >= 1.0
                        ? "Below NAV gross · at parity net"
                        : r.gross < 1.0
                          ? "Below NAV"
                          : r.gross < 1.05
                            ? "Near parity"
                            : "Premium";
                  return (
                    <tr key={r.q.ticker} className="border-t border-[var(--border-subtle)]">
                      <td className="p-3 font-mono text-sm text-[var(--text-tertiary)] tabular-nums">
                        {i + 1}
                      </td>
                      <td className="p-3">
                        <Link
                          href={`/treasuries/${r.q.ticker}`}
                          className="font-mono text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent-ink)] transition-colors"
                        >
                          {r.q.ticker}
                        </Link>
                        <span className="text-xs text-[var(--text-tertiary)] ml-2">
                          {meta?.name} {meta ? COUNTRY_FLAG[meta.country] : ""}
                        </span>
                      </td>
                      <td
                        className="p-3 text-right font-mono text-sm tabular-nums font-semibold"
                        style={{ color: grossColor }}
                      >
                        {fmtMnav(r.gross)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-[var(--text-secondary)] tabular-nums">
                        {fmtMnav(r.net)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-[var(--text-secondary)] tabular-nums">
                        {fmtUsd(eff)}
                      </td>
                      <td className="p-3 text-xs text-[var(--text-tertiary)] font-sans">
                        {verdict}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">
            Gross mNAV = market cap ÷ value of bitcoin held. Net mNAV = market cap ÷
            bitcoin left for common shareholders after senior claims (debt + preferred,
            net of cash). Below 1.0 is a discount. Net mNAV shows · where senior-claims
            data is still pending. Refreshed every 5 minutes.
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            Why below NAV cuts both ways
          </h2>
          <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            <p>
              A treasury company trading below NAV is selling for less than the bitcoin it
              owns. On the surface that is a discount: each dollar of stock buys more than a
              dollar of bitcoin exposure. It is the inverse of the premium these companies
              usually carry.
            </p>
            <p>
              The catch is reflexivity, the so-called{" "}
              <Link
                href="/glossary/spiral-of-doom"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                spiral of doom
              </Link>
              . Above NAV a company can issue shares accretively, raising a dollar to buy
              more than a dollar of bitcoin per share. Below NAV that flywheel reverses:
              new equity would be dilutive, which cuts off the cheapest fuel for more
              bitcoin and can pressure the stock further. A shallow, brief discount is
              noise; a deep, persistent one is the risk.
            </p>
            <p>
              And the headline number can mislead. Gross mNAV ignores the capital
              structure. A company with a large debt and preferred stack can look cheap on
              gross mNAV while sitting at or above parity once those senior claims are
              netted out. That is why this page shows both gross and net (CEBE) mNAV, and
              why the{" "}
              <Link
                href="/gross-vs-net-mnav"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                gross vs net mNAV
              </Link>{" "}
              distinction matters before you call anything cheap.
            </p>
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Go deeper</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/treasuries"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                $ /treasuries
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                The full live scoreboard
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Sortable table, 90-day mNAV sparklines, SEC filings, per-ticker detail.
              </div>
            </Link>
            <Link
              href="/gross-vs-net-mnav"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⚖ /gross-vs-net-mnav
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Gross vs net mNAV, all three lenses
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Why a headline discount can vanish once you account for debt.
              </div>
            </Link>
            <Link
              href="/cheapest-bitcoin-treasury"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ↓ /cheapest-bitcoin-treasury
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Cheapest treasury right now
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The full list ranked by mNAV, cheapest to richest.
              </div>
            </Link>
            <Link
              href="/should-i-buy-bitcoin"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ₿ /should-i-buy-bitcoin
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Should I buy bitcoin at all right now?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The live 0-100 buying gauge.
              </div>
            </Link>
          </div>
        </section>

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
