"use client";

/**
 * Quiet hashrate module on /v/[slug] · after related shops, before
 * subscribe. Service language only (USA machines, already hashing,
 * point at your pool). Live open-TH / 3h from /api/hashrate +
 * summarizeOpenFleet. No invented number: omit the figures until a
 * healthy payload with bookable machines arrives. Not mounted on the
 * homepage, and the house listing page skips it.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import {
  NAV_SUB,
  XSELL_OUT_HASHRATE_TITLE,
} from "@/lib/hashrate-copy";
import { summarizeOpenFleet } from "@/lib/open-fleet";

type DeskPayload = {
  btcUsd?: number | null;
  ourRigs?: {
    status?: string;
    advertisedPh?: number | null;
    askBtcPerPhDay?: number | null;
  }[];
};

export function VendorHashrateModule({
  className = "mb-10",
}: {
  className?: string;
}) {
  const [live, setLive] = useState<{
    openTh: number;
    dayUsd: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/hashrate");
        if (!res.ok) return;
        const desk = (await res.json()) as DeskPayload;
        if (!alive) return;
        const rigs = Array.isArray(desk.ourRigs) ? desk.ourRigs : [];
        // Empty list is a feed failure, never a real zero-open fleet.
        if (rigs.length === 0) return;
        if (desk.btcUsd == null || desk.btcUsd <= 0) return;
        const summary = summarizeOpenFleet(
          rigs.map((r) => ({
            status: r.status ?? "offline",
            advertisedPh: r.advertisedPh ?? null,
            askBtcPerPhDay: r.askBtcPerPhDay ?? null,
          })),
        );
        if (summary.openCount <= 0 || summary.openTh <= 0) return;
        const btc3 = summary.flagshipDayBtc ?? summary.minDayBtc;
        if (btc3 == null || btc3 <= 0) return;
        setLive({
          openTh: summary.openTh,
          dayUsd: btc3 * desk.btcUsd,
        });
      } catch {
        /* degraded feed · copy stays, numbers stay off */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const price =
    live == null
      ? null
      : live.dayUsd >= 10
        ? `$${Math.round(live.dayUsd)}`
        : `$${live.dayUsd.toFixed(2)}`;

  return (
    <section
      className={`${className} rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5`}
    >
      <p className="t-xs font-medium text-[var(--text-tertiary)] mb-1">
        Need hashrate, not a shop?
      </p>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
        {NAV_SUB}
      </p>
      {live && price && (
        <p className="micro-label text-[var(--text-secondary)] tabular-nums mb-3">
          {live.openTh.toLocaleString("en-US")} TH open · 1 day {price}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/hashrate"
          onClick={() => track("vendor_hashrate_cta", { dest: "desk" })}
          className="micro-label inline-flex items-baseline gap-1 text-[var(--accent-ink)] hover:underline underline-offset-2"
        >
          {XSELL_OUT_HASHRATE_TITLE} →
        </Link>
        <Link
          href="/hashrate/how-to-rent"
          onClick={() => track("vendor_hashrate_cta", { dest: "howto" })}
          className="micro-label inline-flex items-baseline gap-1 text-[var(--text-secondary)] hover:text-[var(--accent-ink)]"
        >
          How to rent →
        </Link>
      </div>
    </section>
  );
}
