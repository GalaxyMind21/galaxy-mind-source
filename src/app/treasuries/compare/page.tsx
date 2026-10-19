// /treasuries/compare · a cheapness-vs-leverage quadrant. Plots every
// tracked treasury at once: x = gross mNAV (cheap left, rich right),
// y = Amplification (more senior leverage up), bubble area = BTC held.
// It adjudicates the BTC Prague 2026 tension by LAYOUT, not a score: a
// low gross mNAV in the top-left is "cheap but heavily levered", while
// bottom-left is "cheap and clean". No ranking, no verdict. Server-
// rendered, ISR. Square-ish fixed viewBox with default preserveAspectRatio
// so text scales uniformly (never the preserveAspectRatio="none" warp).
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { computeCebe } from "@/lib/cebe";
import { OG_TREASURY } from "@/lib/og";

const URL = "https://galaxymind.space/treasuries/compare";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Bitcoin Treasury Comparison · mNAV & Leverage · Galaxy Mind",
  description:
    "Compare MSTR, XXI, Metaplanet and Strive: gross mNAV (cheapness) vs Amplification (senior leverage), bubbles sized by BTC held. Cheap-but-levered vs clean.",
  alternates: { canonical: URL },
  openGraph: {
    images: OG_TREASURY,
    type: "website",
    url: URL,
    title: "Bitcoin Treasury Comparison · cheapness vs leverage",
    description:
      "A live quadrant of every tracked Bitcoin treasury: gross mNAV vs Amplification, sized by BTC held.",
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Treasury Comparison · cheapness vs leverage",
    description: "MSTR / XXI / MPJPY / ASST on one quadrant · mNAV vs Amplification, live.",
    creator: "@GalaxyMind",
  },
};

// Per-ticker brand palette for the bubbles + ticker labels · matches the
// MNavHistoryChart colors (distinct on dark, color-blind-safe). These are
// fixed brand hues. Axis ticks, titles, and the bubble VALUE labels use
// theme vars (var(--text-*)) instead, so they stay legible when the card
// background flips between light and dark themes.
const COLORS: Record<string, string> = {
  MSTR: "#F7931A",
  XXI: "var(--cool-ink)",
  MPJPY: "#4ADE80",
  ASST: "#A78BFA",
};

export default async function TreasuryComparePage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const all = snapshot.treasuries.map((q) => ({ q, cebe: computeCebe(q, snapshot.btcPrice) }));
  // Plottable = has both gross mNAV and amplification (CEBE available).
  const plot = all.filter(
    (r) => r.q.mNAV != null && r.cebe.amplificationRatio != null,
  );
  const pending = all.filter(
    (r) => r.q.mNAV == null || r.cebe.amplificationRatio == null,
  );

  // ── SVG scatter geometry ──────────────────────────────────────────
  const W = 640;
  const H = 460;
  const PAD = { top: 28, right: 28, bottom: 58, left: 58 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  // Axis ranges, clamped to keep all four tickers comfortably on canvas.
  const X_MIN = 0.5;
  const X_MAX = 1.6; // gross mNAV
  const Y_MIN = 1.0;
  const Y_MAX = 1.7; // amplification (1.0 = no senior leverage)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const xOf = (mnav: number) =>
    PAD.left + ((clamp(mnav, X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN)) * innerW;
  const yOf = (amp: number) =>
    PAD.top + innerH - ((clamp(amp, Y_MIN, Y_MAX) - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;
  const maxBtc = Math.max(1, ...plot.map((r) => r.q.btcHoldings ?? 0));
  const rOf = (btc: number) => 8 + 20 * Math.sqrt(Math.max(0, btc) / maxBtc);
  const navX = xOf(1.0); // NAV reference line

  const FAQ = [
    {
      q: "How do I read the treasury comparison quadrant?",
      a: "Left to right is gross mNAV · cheaper (below 1.0x, trading under the value of its bitcoin) on the left, richer on the right. Bottom to top is Amplification · how much senior leverage (debt and preferred) the company carries, with 1.0x at the bottom meaning none. Bubble size is bitcoin held. The point: a company can look cheap on gross mNAV (left) while carrying heavy leverage (top), which the BTC Prague 2026 debate argued you should not ignore.",
    },
    {
      q: "Which quadrant is best?",
      a: "There is no single best · it depends on what you want. Bottom-left is cheap and clean (low mNAV, low leverage). Top-left is cheap but heavily amplified (more upside if its bitcoin return beats its cost of capital, more risk if not). Right side is a premium to the bitcoin held. Galaxy Mind shows the layout, not a verdict. Not financial advice.",
    },
    {
      q: "What is Amplification on the vertical axis?",
      a: "Amplification is gross bitcoin-per-share divided by net (CEBE) bitcoin-per-share · equivalently holdings divided by holdings net of senior claims. 1.0x means no debt or preferred (the stock tracks bitcoin like an ETF); higher means each share carries more gross bitcoin than it nets after claims. See /what-is-amplification.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: URL,
        name: "Bitcoin Treasury Comparison · cheapness vs leverage quadrant",
        description:
          "Live quadrant comparing public Bitcoin treasury companies on gross mNAV vs Amplification, sized by BTC held.",
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
          {" · Compare"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Cheapness vs leverage · live
        </div>
        <h1 className="display-title mb-4">
          Treasury comparison quadrant
        </h1>
        <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans max-w-2xl mb-2">
          Every tracked treasury on one map: gross mNAV (cheapness) across,
          Amplification (senior leverage) up, bubble size by bitcoin held. A
          low gross mNAV can sit beside heavy leverage · the tension BTC Prague
          2026 surfaced, shown by position rather than a score.
        </p>
        <div className="font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] mb-6">
          Updated {updated} · live
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full h-auto"
            role="img"
            aria-label="Treasury comparison · gross mNAV versus Amplification"
          >
            {/* plot frame */}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={innerW}
              height={innerH}
              fill="none"
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            {/* NAV reference (mNAV = 1.0) */}
            <line
              x1={navX}
              x2={navX}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--cool-ink)"
              strokeWidth="1"
              strokeDasharray="4,4"
              opacity="0.6"
            />
            <text x={navX + 4} y={PAD.top + 12} fill="var(--cool-ink)" fontSize="11" fontFamily="ui-monospace, monospace">
              NAV
            </text>
            {/* x ticks */}
            {[0.5, 0.75, 1.0, 1.25, 1.5].map((v) => (
              <text
                key={v}
                x={xOf(v)}
                y={PAD.top + innerH + 18}
                textAnchor="middle"
                fill="var(--text-tertiary)"
                fontSize="11"
                fontFamily="ui-monospace, monospace"
              >
                {v.toFixed(2)}x
              </text>
            ))}
            <text
              x={PAD.left + innerW / 2}
              y={H - 12}
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="12"
              fontFamily="ui-monospace, monospace"
            >
              ← cheaper · gross mNAV · richer →
            </text>
            {/* y ticks */}
            {[1.0, 1.2, 1.4, 1.6].map((v) => (
              <text
                key={v}
                x={PAD.left - 8}
                y={yOf(v) + 4}
                textAnchor="end"
                fill="var(--text-tertiary)"
                fontSize="11"
                fontFamily="ui-monospace, monospace"
              >
                {v.toFixed(1)}x
              </text>
            ))}
            <text
              x={16}
              y={PAD.top + innerH / 2}
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize="12"
              fontFamily="ui-monospace, monospace"
              transform={`rotate(-90 16 ${PAD.top + innerH / 2})`}
            >
              amplification (leverage) ↑
            </text>
            {/* ticker bubbles */}
            {plot.map(({ q, cebe }) => {
              const cx = xOf(q.mNAV as number);
              const cy = yOf(cebe.amplificationRatio as number);
              const r = rOf(q.btcHoldings ?? 0);
              const color = COLORS[q.ticker] ?? "#fff";
              return (
                <g key={q.ticker}>
                  <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5" />
                  <text
                    x={cx}
                    y={cy - r - 5}
                    textAnchor="middle"
                    fill={color}
                    fontSize="13"
                    fontWeight="600"
                    fontFamily="ui-monospace, monospace"
                  >
                    {q.ticker}
                  </text>
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fill="var(--text-secondary)"
                    fontSize="10"
                    fontFamily="ui-monospace, monospace"
                  >
                    {(q.mNAV as number).toFixed(2)}×·{(cebe.amplificationRatio as number).toFixed(2)}×
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">
            Each bubble: gross mNAV (x) × Amplification (y), sized by BTC held.
            Dashed line = NAV (gross mNAV 1.0×). Refreshed every 5 minutes.
            {pending.length > 0
              ? ` Pending (no amplification yet, senior claims unsourced): ${pending.map((p) => p.q.ticker).join(", ")}.`
              : ""}
          </p>
        </div>

        <section className="mt-10 border-t border-[var(--border-subtle)] pt-8">
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
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link href="/treasuries" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Full scoreboard →
            </Link>
            <Link href="/gross-vs-net-mnav" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Gross vs net mNAV →
            </Link>
            <Link href="/what-is-amplification" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              What is Amplification →
            </Link>
            <Link href="/treasuries/methodology" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Methodology →
            </Link>
          </div>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
