"use client";

/**
 * CalculatorClient · the interactive half of /solo-mining-calculator.
 *
 * Pure client math over the pure lib (blockOdds — the SAME function the
 * /hashrate cards quote, so the two surfaces can never disagree about
 * an odds number). The server shell passes the live network inputs and
 * renders the SYNCING branch itself, so this component always has real
 * numbers.
 */

import { useState } from "react";
import { blockOdds, humanizeYears } from "@/lib/block-odds";
import Link from "next/link";
import {
  CALC_COMBINE_TITLE,
  CALC_COMBINE_HINT,
  CALC_COMBINE_RESULT,
  CALC_COMBINE_NONE_OPEN,
  CALC_COMBINE_CTA,
  CALC_TH_LABEL,
  CALC_HOURS_LABEL,
  CALC_RESULT_ODDS,
  CALC_RESULT_PRIZE,
  CALC_RESULT_EXPECTED,
  CALC_RESULT_YEARS,
} from "@/lib/hashrate-copy";

// Presets match the house fleet's real sizes (Avalon 54 / S21 XP 270 /
// two S21 XPs / whole-fleet ballpark) so a visitor can jump straight to
// the numbers the rent page quotes. A 1 TH chip stays for the Bitaxe
// curiosity query that feeds this pSEO page.
const TH_PRESETS: { label: string; th: number }[] = [
  { label: "1 TH", th: 1 },
  { label: "54 TH", th: 54 },
  { label: "270 TH", th: 270 },
  { label: "540 TH", th: 540 },
];

const HOUR_PRESETS: { label: string; hours: number }[] = [
  { label: "3 h", hours: 3 },
  { label: "24 h", hours: 24 },
  { label: "7 d", hours: 168 },
  { label: "30 d", hours: 720 },
];

export function CalculatorClient({
  networkPhs,
  prizeUsd,
  ourOpenTh,
}: {
  networkPhs: number;
  prizeUsd: number;
  /** Combined advertised hashrate of OUR bookable machines, in TH.
   *  0 when the fleet is fully booked — the panel says so rather than
   *  quoting an addition we cannot currently sell. */
  ourOpenTh: number;
}) {
  const [th, setTh] = useState(270);
  const [hours, setHours] = useState(24);

  const odds = blockOdds({ ph: th / 1000, hours, networkPhs });

  // THE COMBINE PANEL. Same pure blockOdds() as everything else, run
  // twice: the visitor's own hashrate alone, then with our open fleet
  // added. The delta between those two IS the pitch, and it is just
  // arithmetic — no claim is being made beyond what the numbers say.
  const combinedOdds =
    ourOpenTh > 0
      ? blockOdds({ ph: (th + ourOpenTh) / 1000, hours, networkPhs })
      : null;
  const lift =
    odds != null && combinedOdds != null && combinedOdds.oneInN > 0
      ? odds.oneInN / combinedOdds.oneInN
      : null;

  const chipClass = (active: boolean) =>
    `micro-label rounded-full border px-3 py-1.5 transition-colors ${
      active
        ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40"
    }`;

  const inputClass =
    "w-32 rounded-xl border-0 bg-black/35 px-3.5 py-2.5 font-mono text-base tabular-nums text-[var(--text-primary)] shadow-[inset_0_0_0_1px_rgba(78,197,217,0.24)] focus:shadow-[inset_0_0_0_2px_#4EC5D9] focus:outline-none";

  return (
    <section className="instr rounded-3xl px-5 py-7 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="instr-face rounded-2xl p-5">
          <p className="micro-label text-[var(--text-tertiary)]">
            {CALC_TH_LABEL}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0.001}
              step="any"
              value={th}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setTh(v);
              }}
              className={inputClass}
              aria-label={`${CALC_TH_LABEL} (TH/s)`}
            />
            <span className="font-mono text-sm text-[var(--text-tertiary)]">
              TH/s
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {TH_PRESETS.map((p) => (
              <button
                key={p.th}
                type="button"
                onClick={() => setTh(p.th)}
                className={chipClass(th === p.th)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="instr-face rounded-2xl p-5">
          <p className="micro-label text-[var(--text-tertiary)]">
            {CALC_HOURS_LABEL}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={hours}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setHours(v);
              }}
              className={inputClass}
              aria-label={`${CALC_HOURS_LABEL} (hours)`}
            />
            <span className="font-mono text-sm text-[var(--text-tertiary)]">
              hours
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {HOUR_PRESETS.map((p) => (
              <button
                key={p.hours}
                type="button"
                onClick={() => setHours(p.hours)}
                className={chipClass(hours === p.hours)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="instr-warm mt-4 grid gap-4 rounded-2xl p-5 sm:grid-cols-3 sm:p-6">
        <div>
          <p className="micro-label text-[var(--text-tertiary)]">
            {CALC_RESULT_ODDS}
          </p>
          <p className="mt-1 font-mono text-3xl tabular-nums text-[var(--accent-ink)]">
            {odds == null || !Number.isFinite(odds.oneInN)
              ? "—"
              : odds.oneInN <= 1
                ? "certain"
                : `1 in ${Math.round(odds.oneInN).toLocaleString("en-US")}`}
          </p>
          {odds != null && Number.isFinite(odds.oneInN) && odds.oneInN > 1 && (
            <p className="font-mono text-sm tabular-nums text-[var(--text-secondary)]">
              {(() => {
                const pct = odds.pAtLeastOne * 100;
                if (pct >= 0.01) return `${pct.toFixed(2)}%`;
                if (pct >= 0.000001) return `${pct.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}%`;
                return `${pct.toExponential(1)}%`;
              })()}
            </p>
          )}
        </div>
        <div>
          <p className="micro-label text-[var(--text-tertiary)]">
            {CALC_RESULT_EXPECTED}
          </p>
          <p className="mt-1 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            {odds == null ? "—" : odds.expectedBlocks.toPrecision(2)}
          </p>
        </div>
        <div>
          <p className="micro-label text-[var(--text-tertiary)]">
            {CALC_RESULT_PRIZE}
          </p>
          <p className="mt-1 font-mono text-3xl tabular-nums text-[var(--text-primary)]">
            ${Math.round(prizeUsd).toLocaleString("en-US")}
          </p>
        </div>
      </div>

      {/* THE BRIDGE. Informational traffic lands here; this is the one
          element that turns "could I?" into a priced decision, without
          the page ever pretending to be the sales page. */}
      <div className="instr-cool mt-5 rounded-2xl p-5">
        <p className="micro-label text-[var(--instr-cool-ink)]">{CALC_COMBINE_TITLE}</p>
        {ourOpenTh > 0 ? (
          <>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {CALC_COMBINE_HINT}
            </p>
            {odds != null && combinedOdds != null && lift != null && (
              <p className="mt-3 font-mono text-sm tabular-nums text-[var(--text-primary)]">
                {CALC_COMBINE_RESULT.replace(
                  "{OWN}",
                  th.toLocaleString("en-US"),
                )
                  .replace("{WINDOW}", `${hours}h`)
                  .replace(
                    "{ALONE}",
                    `1 in ${Math.round(odds.oneInN).toLocaleString("en-US")}`,
                  )
                  .replace("{TOTAL}", ourOpenTh.toLocaleString("en-US"))
                  .replace(
                    "{BOTH}",
                    `1 in ${Math.round(combinedOdds.oneInN).toLocaleString("en-US")}`,
                  )
                  .replace(
                    "{LIFT}",
                    lift >= 10 ? String(Math.round(lift)) : lift.toFixed(1),
                  )}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {CALC_COMBINE_NONE_OPEN}
          </p>
        )}
        <p className="mt-3 text-sm">
          <Link
            href="/hashrate#your-shot"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            {CALC_COMBINE_CTA}
          </Link>
        </p>
      </div>

      {odds != null && Number.isFinite(odds.oneInN) && odds.oneInN > 1 && (
        <p className="mt-5 text-sm text-[var(--text-secondary)]">
          {CALC_RESULT_YEARS.replace(
            "{EVERY}",
            humanizeYears((odds.oneInN * hours) / 8760),
          )}
        </p>
      )}
    </section>
  );
}
