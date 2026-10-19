"use client";

/* =====================================================================
 * SystemHealthStrip · radical-transparency social-proof strip
 *
 * A compact, premium "the lights are on" readout: how many vendors,
 * how many subscribers, how many countries, and how fresh the live
 * market data is. Three jobs at once · social proof (people are here),
 * trust (data is fresh, we're honest when it isn't), and a soft
 * repeat-visit hook ("let's see how many joined this week").
 *
 * Design contract (learned the hard way · see /api/subscriber-count):
 *   - Each metric fails INDEPENDENTLY and SILENTLY. A null subscriber
 *     count (Resend down) hides that cell · it never renders "0" or a
 *     spinner, because a dead-looking number is worse than no number.
 *   - Static metrics (vendors, countries, new-this-month) come from the
 *     VENDORS import · zero network, always present.
 *   - Dynamic metrics (subscribers, data freshness) are fetched and
 *     fade in. Until they resolve, their cells are simply absent · no
 *     layout-shift placeholder text.
 *
 * Theme: pure CSS-var styling so light + dark both work with no JS.
 * ===================================================================== */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { VENDORS } from "@/lib/vendors";

/** Heartbeat shape we rely on · see src/app/api/heartbeat/route.ts. */
type Heartbeat = { asOf?: string; degraded?: boolean };

/** Relative "Xm ago" / "Xh ago" from an ISO timestamp. Coarse on
 *  purpose · this is a freshness vibe, not a precise clock. */
function relativeAge(iso: string, nowMs: number): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const secs = Math.max(0, Math.round((nowMs - then) / 1000));
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Cell({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-3 sm:px-5 py-1 text-center">
      <span
        className={[
          "font-mono text-lg sm:text-xl font-semibold tabular-nums leading-none",
          accent ? "text-[var(--accent-ink)]" : "text-[var(--text-primary)]",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="mt-1 font-mono t-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </span>
    </div>
  );
}

export function SystemHealthStrip() {
  // ---- Static, build-time metrics (no network) --------------------
  // Deliberately NOT showing a "new this month" count here: listedAt
  // (immutable, set once at first listing, unaffected by re-verification)
  // CAN now express "added in the last N days" honestly — the original
  // blocker (verifiedAt being the only timestamp, and moving on every
  // re-check) is gone. This just isn't the surface for it: the momentum
  // signal already lives in the homepage's RecentlyAddedStrip, and a
  // second copy of the same number here would be redundant, not more
  // honest. Vendor + country counts stay because they're unambiguous.
  const { vendorCount, countryCount } = useMemo(() => {
    const vendors = VENDORS.length;
    const countries = new Set(
      VENDORS.map((v) => v.country).filter(Boolean),
    ).size;
    return { vendorCount: vendors, countryCount: countries };
  }, []);

  // ---- Dynamic metrics (fetched, fade in, fail silently) ----------
  const [subscribers, setSubscribers] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let alive = true;

    // Subscriber count · null (Resend down / unconfigured) hides the cell.
    fetch("/api/subscriber-count")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.count === "number") setSubscribers(j.count);
      })
      .catch(() => {});

    // Data freshness · from the lightweight heartbeat (~120 B).
    fetch("/api/heartbeat")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Heartbeat | null) => {
        if (!alive || !j) return;
        if (j.degraded) setDegraded(true);
        if (j.asOf) {
          const age = relativeAge(j.asOf, Date.now());
          if (age) setFreshness(age);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      aria-label="Galaxy Mind at a glance"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-2 sm:px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-center gap-y-3 divide-x divide-[var(--border-subtle)]">
        <Cell value={vendorCount.toLocaleString()} label="Vendors" accent />
        <Cell value={countryCount.toLocaleString()} label="Countries" />
        {subscribers != null && subscribers >= 100 && (
          <Cell value={subscribers.toLocaleString()} label="Subscribers" />
        )}
        {freshness && (
          <Cell
            value={degraded ? "updating" : freshness}
            label={degraded ? "Live data" : "Data updated"}
            accent={!degraded}
          />
        )}
      </div>
      <p className="mt-3 text-center t-xs font-medium text-[var(--text-tertiary)]">
        Live ·{" "}
        <Link
          href="/about"
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--accent-ink)] transition-colors"
        >
          how this works
        </Link>
      </p>
    </section>
  );
}
