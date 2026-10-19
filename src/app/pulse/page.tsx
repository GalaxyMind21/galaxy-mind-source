// /pulse · the Weekly Pulse + its archive. The weekly counterpart to
// /today: one page that composes this week's state of the Bitcoin
// circular economy (gauge, float, cheapest treasury, directory growth)
// and lists every prior week the cron has archived · a dated, evergreen
// record of the economy growing week over week.
//
// Live current week is always composed here; the archive rows come from
// KV (written by /api/cron/weekly-pulse). Degrades to just the live week
// when KV is empty.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { CitationBlock } from "@/components/CitationBlock";
import { OG_DIRECTORY } from "@/lib/og";
import {
  composePulse,
  readPulseArchive,
  weekLabel,
  type PulseSnapshot,
} from "@/lib/pulse";

export const revalidate = 1800;

const URL_ = "https://galaxymind.space/pulse";

export const metadata: Metadata = {
  title: "Weekly Pulse · Bitcoin circular economy, week by week · Galaxy Mind",
  description:
    "The Weekly Pulse: the Buying Gauge, bitcoin drained from the float, the cheapest public treasury, and new merchants, a dated archive week by week.",
  alternates: { canonical: URL_ },
  openGraph: {
    images: OG_DIRECTORY,
    title: "The Weekly Pulse · Bitcoin, week by week",
    description:
      "Gauge, float drain, cheapest treasury, new merchants · one weekly readout, archived every week.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Weekly Pulse · Bitcoin, week by week",
    description:
      "Gauge, float drain, cheapest treasury, new merchants · archived every week.",
    site: "@GalaxyMind",
  },
};

function floatWeekLine(delta: number | null): string {
  if (delta == null) return "building weekly history";
  if (delta > 0)
    return `${delta.toLocaleString("en-US")} BTC left the float this week`;
  if (delta < 0)
    return `${Math.abs(delta).toLocaleString("en-US")} BTC refilled this week`;
  return "float held flat this week";
}

function StatTile({
  label,
  href,
  value,
  suffix,
  sub,
  cta,
}: {
  label: string;
  href: string;
  value: string;
  suffix?: string;
  sub: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 card-lift elevate block"
    >
      <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
        {label}
      </div>
      <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] glow-text tabular-nums">
        {value}
        {suffix && (
          <span className="text-base font-normal text-[var(--text-tertiary)]">
            {suffix}
          </span>
        )}
      </div>
      <div className="micro-label mt-1 text-[var(--text-secondary)] truncate">
        {sub}
      </div>
      <div className="mt-3 t-xs text-[var(--text-tertiary)]">
        {cta} →
      </div>
    </Link>
  );
}

export default async function PulsePage() {
  const [pulse, archiveRaw] = await Promise.all([
    composePulse(),
    readPulseArchive(),
  ]);
  // The archive may already hold this week (if the cron ran) · the live
  // hero above covers it, so drop it from the "prior weeks" list.
  const archive = archiveRaw.filter(
    (s: PulseSnapshot) => s.weekOf !== pulse.weekOf,
  );

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          The Weekly Pulse · {weekLabel(pulse.weekOf)}
        </div>
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-3">
          This week in the{" "}
          <span className="headline-gradient glow-text">circular economy</span>.
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-lg max-w-2xl mb-4 leading-snug sm:leading-relaxed">
          Four readings that tell you where the Bitcoin economy stands
          this week · and an archive of every week before it. Each tile
          is the live number from its instrument.
        </p>
        <p className="micro-label mb-8">
          <Link
            href="/today"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Live daily briefing →
          </Link>
        </p>

        <h2 className="sr-only">This week&apos;s readings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Buying Gauge"
            href="/stack"
            value={pulse.gaugeScore == null ? "—" : String(pulse.gaugeScore)}
            suffix={pulse.gaugeScore == null ? undefined : "/100"}
            sub={pulse.gaugeTier ?? "updating"}
            cta="Should I buy?"
          />
          <StatTile
            label="Still in play"
            href="/float"
            value={pulse.inPlayM == null ? "—" : String(pulse.inPlayM)}
            suffix={pulse.inPlayM == null ? undefined : "M"}
            sub={floatWeekLine(pulse.floatWeekDelta)}
            cta="How much is left?"
          />
          <StatTile
            label="Cheapest treasury"
            href="/treasuries"
            value={
              pulse.cheapestMNav == null
                ? "—"
                : pulse.cheapestMNav.toFixed(2)
            }
            suffix={pulse.cheapestMNav == null ? undefined : "×"}
            sub={
              pulse.cheapestTicker == null
                ? "updating"
                : `${pulse.cheapestTicker} · ${(pulse.cheapestMNav ?? 1) < 1 ? "below NAV" : "smallest premium"}`
            }
            cta="mNAV head-to-head"
          />
          <StatTile
            label="Circular economy"
            href="/"
            value={String(pulse.vendorTotal)}
            suffix={` · ${pulse.countryCount}`}
            sub={
              pulse.newThisWeek > 0
                ? `+${pulse.newThisWeek} verified this week`
                : "vendors · countries"
            }
            cta="Spend bitcoin"
          />
        </div>

        {/* New this week · the growth story, named. */}
        <section className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="micro-label text-[var(--accent-ink)] mb-3">
            New merchants this week
          </h2>
          {pulse.newThisWeek > 0 ? (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {pulse.newThisWeekNames.join(" · ")}
              {pulse.newThisWeek > pulse.newThisWeekNames.length
                ? ` · and ${pulse.newThisWeek - pulse.newThisWeekNames.length} more`
                : ""}
              .{" "}
              <Link
                href="/"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Browse the directory →
              </Link>
            </p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              No new merchants verified this week yet.{" "}
              <Link
                href="/submit"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Run a shop? Get listed →
              </Link>
            </p>
          )}
        </section>

        {/* The archive · every prior week the cron has recorded. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            The archive
          </h2>
          {archive.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)] leading-relaxed max-w-2xl">
              This is the first recorded week. Come back next Monday · the
              pulse is captured every week, and prior weeks live here as a
              running record of the economy growing.
            </p>
          ) : (
            <ol className="space-y-2">
              {archive.map((s: PulseSnapshot) => (
                <li
                  key={s.weekOf}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
                >
                  <span className="micro-label text-[var(--text-secondary)]">
                    {weekLabel(s.weekOf)}
                  </span>
                  <span className="font-mono t-xs text-[var(--text-tertiary)] tabular-nums">
                    {s.gaugeScore != null && (
                      <>Gauge {s.gaugeScore} · </>
                    )}
                    {s.inPlayM != null && <>{s.inPlayM}M in play · </>}
                    {s.cheapestTicker != null && s.cheapestMNav != null && (
                      <>
                        {s.cheapestTicker} {s.cheapestMNav.toFixed(2)}× ·{" "}
                      </>
                    )}
                    {s.vendorTotal} merchants
                    {s.newThisWeek > 0 ? ` (+${s.newThisWeek})` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="mt-10">
          <InlineSubscribePrompt
            source="stack"
            headline="Get the pulse without checking"
            subhead="The monthly roundup and the weekly new-merchant digest land in your inbox · pick your channels."
          />
        </div>

        <div className="mt-10">
          <CitationBlock
            pageUrl={URL_}
            dataLabel="Galaxy Mind Weekly Pulse"
            lastUpdatedISO={pulse.composedAt}
            surface="today"
          />
        </div>
      </div>

      <FooterDisclaimer />
    </main>
  );
}
