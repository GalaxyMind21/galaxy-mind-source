"use client";

/**
 * HashrateStrip · one-line live block-prize band linking /hashrate.
 *
 * The revenue page needs in-content presence on habit and high-traffic
 * surfaces — nav/footer only is not enough. This strip puts the live
 * prize + open capacity where returning visitors actually look, without
 * touching the host page's server render: it fetches the CDN-cached
 * /api/hashrate (s-maxage 300) once on mount.
 *
 * Honesty contract: renders NOTHING until a healthy payload arrives and
 * nothing on failure — absence beats a wrong number. All sentences live
 * in lib/hashrate-copy so the banned-vocabulary gate scans them.
 *
 * Open hashrate and the 3-hour entry price only render when machines are
 * actually bookable — never invent a sold-out explanation from a failed
 * rig feed (empty ourRigs is SYNCING, not "every machine is rented").
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import {
  STRIP_KICKER,
  STRIP_PRIZE,
  STRIP_OPEN_MANY,
  STRIP_OPEN_ONE,
  STRIP_OPEN_NONE,
  STRIP_OPEN_COMING,
  STRIP_OPEN_TH,
  STRIP_ENTRY,
  STRIP_CTA,
  STRIP_CTA_NONE,
} from "@/lib/hashrate-copy";
import { summarizeOpenFleet } from "@/lib/open-fleet";

type DeskPayload = {
  blockRewardBtc?: number | null;
  btcUsd?: number | null;
  ourRigs?: {
    status?: string;
    advertisedPh?: number | null;
    askBtcPerPhDay?: number | null;
  }[];
};

export function HashrateStrip({ className = "mt-4" }: { className?: string }) {
  // `open: null` means the rig feed did not answer — DISTINCT from
  // zero available. See the availability guard below.
  const [state, setState] = useState<{
    prize: number;
    open: number | null;
    openTh: number;
    entryUsd: number | null;
    coming: number;
    rented: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/hashrate");
        if (!res.ok) return;
        const desk = (await res.json()) as DeskPayload;
        if (!alive) return;
        if (desk.blockRewardBtc == null || desk.btcUsd == null) return;
        // An EMPTY rig list is a feed failure, never a real state: the
        // fleet is a fixed set of configured rig ids (GALAXY_MIND_RIG_IDS),
        // so "zero rigs known" can only mean MRR did not answer. Counting
        // it as zero-available would print "every machine is rented right
        // now" during an outage — a fabricated explanation for missing
        // data, which is exactly the failure class this codebase keeps
        // getting bitten by. Null it instead and drop the clause.
        const rigs = Array.isArray(desk.ourRigs) ? desk.ourRigs : [];
        if (rigs.length === 0) {
          setState({
            prize: desk.blockRewardBtc * desk.btcUsd,
            open: null,
            openTh: 0,
            entryUsd: null,
            coming: 0,
            rented: 0,
          });
          return;
        }
        const summary = summarizeOpenFleet(
          rigs.map((r) => ({
            status: r.status ?? "offline",
            advertisedPh: r.advertisedPh ?? null,
            askBtcPerPhDay: r.askBtcPerPhDay ?? null,
          })),
        );
        setState({
          prize: desk.blockRewardBtc * desk.btcUsd,
          open: summary.openCount,
          openTh: summary.openTh,
          entryUsd:
            summary.minDayBtc != null
              ? summary.minDayBtc * desk.btcUsd
              : null,
          coming: summary.comingCount,
          rented: summary.rentedCount,
        });
      } catch {
        /* degraded feed · render nothing */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state == null) return null;

  const openLine =
    state.open == null
      ? null
      : state.open === 0
        ? state.coming > 0
          ? STRIP_OPEN_COMING.replace("{N}", String(state.coming))
          : STRIP_OPEN_NONE
        : state.open === 1
          ? STRIP_OPEN_ONE
          : STRIP_OPEN_MANY.replace("{N}", String(state.open));

  const openThLine =
    state.open != null && state.open > 0 && state.openTh > 0
      ? STRIP_OPEN_TH.replace(
          "{TH}",
          state.openTh.toLocaleString("en-US"),
        )
      : null;

  const entryLine =
    state.entryUsd != null && state.open != null && state.open > 0
      ? STRIP_ENTRY.replace(
          "{PRICE}",
          state.entryUsd >= 10
            ? `$${Math.round(state.entryUsd)}`
            : `$${state.entryUsd.toFixed(2)}`,
        )
      : null;

  return (
    <Link
      href="/hashrate#your-shot"
      onClick={() =>
        track("hashrate_strip_click", { open: state.open ?? -1 })
      }
      className={`${className} flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-[var(--accent)]/25 bg-[var(--bg-elevated)] px-4 py-3 card-lift`.trim()}
    >
      <span className="t-xs font-medium text-[var(--text-tertiary)]">
        {STRIP_KICKER}
      </span>
      <span className="micro-label text-[var(--accent-ink)] tabular-nums">
        {STRIP_PRIZE.replace(
          "{PRIZE}",
          `$${Math.round(state.prize).toLocaleString("en-US")}`,
        )}
      </span>
      {openThLine && (
        <span className="micro-label text-[var(--success)] tabular-nums">
          {openThLine}
        </span>
      )}
      {openLine && (
        <span className="micro-label text-[var(--text-secondary)]">
          {openLine}
        </span>
      )}
      {entryLine && (
        <span className="micro-label text-[var(--text-secondary)] tabular-nums">
          {entryLine}
        </span>
      )}
      <span className="micro-label ml-auto text-[var(--accent-ink)]">
        {state.open === 0 ? STRIP_CTA_NONE : STRIP_CTA} →
      </span>
    </Link>
  );
}
