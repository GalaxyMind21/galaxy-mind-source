// /status · public data-health page (2026-06-10).
//
// Turns the operational discipline that already exists (degraded
// gating, cron snapshots, freshness timestamps) into a visible trust
// signal: per-source freshness and a plain statement of whether the
// numbers on each surface are live or running on fallbacks. No
// competing Bitcoin dashboard shows its own health this honestly.
//
// Public-safe by construction: everything rendered here is already
// derivable from public endpoints (/api/market, /api/float, the
// history APIs). The auth-gated cron-health endpoint is NOT consumed
// · per-cron internals stay operator-only.

import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { SiteHeader } from "@/components/SiteHeader";
import { getMarketSnapshot } from "@/lib/market";
import { getFloatData } from "@/lib/float-data";
import {
  isMarketSnapshotDegraded,
  weightBearingSources,
} from "@/lib/snapshot-quality";
import { kvList } from "@/lib/kv";
import {
  VENDORS,
  formatVerifiedDate,
  isStale,
  oldestVerifiedAt,
  STALE_THRESHOLD_DAYS,
} from "@/lib/vendors";
import { checkConstantsFreshness } from "@/lib/constants-freshness";
import { isTreasuryBoardEmpty } from "@/lib/treasuries";

export const revalidate = 300;

const TITLE = "System Status · Galaxy Mind";
const DESCRIPTION =
  "Live health of every Galaxy Mind data source: market signals, treasury mNAV, Bitcoin float snapshots, and vendor re-verification freshness.";
const URL = "https://galaxymind.space/status";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", url: URL, title: TITLE, description: DESCRIPTION, siteName: "Galaxy Mind", images: pageOgImage("/status/opengraph-image", TITLE) },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, creator: "@GalaxyMind" },
  alternates: { canonical: URL },
};

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-2 h-2 rounded-full ${
        ok ? "bg-[var(--success)]" : "bg-[var(--warning)]"
      }`}
    />
  );
}

function Row({
  ok,
  label,
  detail,
  asOf,
}: {
  ok: boolean;
  label: string;
  detail: string;
  asOf?: string | null;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-4 py-3 border-t border-[var(--border-subtle)] first:border-t-0">
      <div className="flex items-center gap-2.5 sm:w-64 shrink-0">
        <Dot ok={ok} />
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
      </div>
      <div className="t-xs text-[var(--text-secondary)] font-sans leading-relaxed flex-1">
        {detail}
      </div>
      {asOf && (
        <div className="t-xs text-[var(--text-tertiary)] tabular-nums shrink-0">
          {asOf}
        </div>
      )}
    </div>
  );
}

function fmtUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function StatusPage() {
  const [snapshot, float, stackHist, mstrHist] = await Promise.all([
    getMarketSnapshot(),
    getFloatData({ days: 2, synthetic: false }),
    kvList<{ date: string }>("stack:history", 1),
    kvList<{ date: string }>("treasury:history:MSTR", 1),
  ]);

  const treasuryBoardDown = isTreasuryBoardEmpty(snapshot.treasuries);
  const degraded = isMarketSnapshotDegraded(snapshot) || treasuryBoardDown;
  const down = [
    ...weightBearingSources(snapshot)
      .filter((x) => !x.ok)
      .map((x) => x.name),
    ...(treasuryBoardDown ? ["Treasury board (all tickers null)"] : []),
  ];
  const floatOk = !float.isFallback && float.current.partial !== true;
  const staleCount = VENDORS.filter((v) => isStale(v.verifiedAt)).length;
  const oldestVerified = oldestVerifiedAt(VENDORS);
  const constants = checkConstantsFreshness(new Date());

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)] pb-16">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-10">
        <div className="micro-label text-[var(--text-tertiary)] mb-2">
          Radical transparency
        </div>
        <h1 className="text-3xl tracking-tight">System status</h1>
        <p className="mt-3 text-sm sm:text-base text-[var(--text-secondary)] font-sans leading-relaxed max-w-2xl">
          Every number on this site comes from public upstream sources.
          When one goes down we show nulls and say so · never invented
          values. This page is the same honesty, aggregated.
        </p>

        <section className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-2">
            Market signals · gauge + treasuries + fit
          </h2>
          <Row
            ok={!degraded}
            label={degraded ? "Degraded" : "Healthy"}
            detail={
              down.length === 0
                ? "All 8 weight-bearing signals reporting."
                : `${8 - down.length} of 8 weight-bearing signals reporting · down: ${down.join(", ")}. ${
                    degraded
                      ? "Verdicts are running on best-effort neutral fallbacks; alert crons are paused by the same guard."
                      : "Below the degraded threshold (4 of 8) · verdicts remain live."
                  }`
            }
            asOf={fmtUtc(snapshot.asOf)}
          />
          <Row
            ok={stackHist.length > 0}
            label="Gauge history snapshots"
            detail={
              stackHist.length > 0
                ? `Daily cron writing · latest entry ${stackHist[0]?.date}.`
                : "No history entries readable · KV unavailable or accumulating."
            }
          />
          <Row
            ok={mstrHist.length > 0}
            label="Treasury mNAV snapshots"
            detail={
              mstrHist.length > 0
                ? `Daily cron writing · latest entry ${mstrHist[0]?.date}.`
                : "No history entries readable · KV unavailable or accumulating."
            }
          />
        </section>

        <section className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-2">
            Bitcoin float
          </h2>
          <Row
            ok={floatOk}
            label={
              float.isFallback
                ? "Fallback baseline"
                : float.current.partial
                  ? "Partial snapshot"
                  : "Healthy"
            }
            detail={
              float.isFallback
                ? "Serving the hardcoded baseline · daily snapshot cron has no readable entries yet."
                : float.current.partial
                  ? "Latest snapshot is missing at least one upstream cohort (shown as syncing, not zero) · the page shows a partial-data badge."
                  : `Daily snapshots healthy · ${float.history.length} days of history accumulated.`
            }
            asOf={fmtUtc(float.asOf)}
          />
        </section>

        <section className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-2">
            Vendor directory
          </h2>
          <Row
            ok={staleCount === 0}
            label={staleCount === 0 ? "All verified" : "Re-verification due"}
            detail={
              staleCount === 0
                ? `All ${VENDORS.length} vendors confirmed accepting BTC within the last ${STALE_THRESHOLD_DAYS} days. The oldest confirmation is ${formatVerifiedDate(oldestVerified)}.`
                : `${staleCount} of ${VENDORS.length} vendors past the ${STALE_THRESHOLD_DAYS}-day re-verification window (marked on their cards). The oldest confirmation is ${formatVerifiedDate(oldestVerified)}.`
            }
            asOf={fmtUtc(new Date(oldestVerified * 1000).toISOString())}
          />
        </section>

        <section className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-2">
            Hand-sourced constants · treasury share counts + senior claims
          </h2>
          <p className="t-xs text-[var(--text-secondary)] font-sans leading-relaxed mb-1">
            A few treasury figures cannot be pulled live (filing-based share
            counts for fast-diluting names, and senior-claims balance sheets).
            We hand-source and date them, and refresh on each new filing. Here
            is how current each one is.
          </p>
          {constants.map((c) => (
            <Row
              key={c.name}
              ok={!c.stale}
              label={c.label}
              detail={
                c.stale
                  ? `${c.ageDays} days old · past the ${c.cadenceDays}-day refresh cadence, due for an update from the latest filing. Source: ${c.source}.`
                  : `${c.ageDays} days old · within the ${c.cadenceDays}-day cadence. Source: ${c.source}.`
              }
              asOf={c.asOf}
            />
          ))}
        </section>

        <p className="mt-8 t-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
          Want the raw numbers? Every source above is queryable ·{" "}
          <a href="/docs/api" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            public API docs
          </a>
          . This page has a machine-readable twin for monitors and agents at{" "}
          <a href="/api/status" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            /api/status
          </a>
          . Methodology for each metric:{" "}
          <a href="/methodology" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            /methodology
          </a>
          .
        </p>
      </div>
    </main>
  );
}
