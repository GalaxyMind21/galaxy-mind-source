"use client";

/* =====================================================================
 * TimeMachine · "run your own numbers" calculator for spend-and-replace
 *
 * The page argues the thesis in prose; this makes it PERSONAL. Pick an
 * amount and a date, and see the three ways that purchase could have
 * gone:
 *
 *   1. Spent bitcoin, never replaced · the sats left forever. Their
 *      value today is the number the hoarder crowd fears · and the
 *      whole point is that this is the ONLY losing branch.
 *   2. Spend and replace · sats out, same-day rebuy. Stack unchanged,
 *      total fiat cost identical to paying cash. Zero future regret.
 *   3. Paid fiat, held bitcoin · same stack, same cost as branch 2.
 *
 * Branches 2 and 3 land on identical outcomes BY CONSTRUCTION · that
 * equality rendered side by side is the thesis in one glance.
 *
 * Honesty rule: if the chosen date was ABOVE today's price (bought
 * the top), branch 1's "regret" goes negative · we say so plainly
 * ("those sats are worth less today") instead of hiding the case.
 * The calculator must not be a bull-market-only toy.
 *
 * Data: lib/btc-history-client (five years of daily closes, one
 * module-cached fetch shared with the /gauntlet game). Fetch failure
 * renders a quiet "data unavailable" state, never a broken form.
 * ===================================================================== */

import { useEffect, useMemo, useState } from "react";
import { track } from "@vercel/analytics";
import { loadBtcHistory, type BtcPoint as Point } from "@/lib/btc-history-client";

const AMOUNTS = [50, 100, 500, 1000];

const DATE_PRESETS: { label: string; yearsAgo?: number; iso?: string }[] = [
  { label: "1y ago", yearsAgo: 1 },
  { label: "2y ago", yearsAgo: 2 },
  { label: "3y ago", yearsAgo: 3 },
  { label: "2024 halving", iso: "2024-04-20" },
  { label: "5y ago", yearsAgo: 5 },
];

function presetEpoch(preset: (typeof DATE_PRESETS)[number]): number {
  if (preset.iso) return Math.floor(new Date(preset.iso).getTime() / 1000);
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - (preset.yearsAgo ?? 1));
  return Math.floor(d.getTime() / 1000);
}

/** Closest available daily close at-or-before the requested time
 *  (falls forward to the first point when the request predates the
 *  series · the preset chips can't exceed the 5y window anyway). */
function priceAt(points: Point[], epoch: number): Point {
  let best = points[0];
  for (const pt of points) {
    if (pt.t <= epoch) best = pt;
    else break;
  }
  return best;
}

function fmtUsd(v: number): string {
  return (
    "$" +
    v.toLocaleString("en-US", {
      maximumFractionDigits: v >= 1000 ? 0 : 2,
      minimumFractionDigits: 0,
    })
  );
}

function fmtSats(btc: number): string {
  const sats = Math.round(btc * 100_000_000);
  return sats.toLocaleString("en-US") + " sats";
}

export function TimeMachine() {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState(100);
  const [presetIdx, setPresetIdx] = useState(1); // default: 2y ago

  useEffect(() => {
    let alive = true;
    loadBtcHistory()
      .then((pts) => alive && setPoints(pts))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const result = useMemo(() => {
    if (!points || points.length === 0) return null;
    const then = priceAt(points, presetEpoch(DATE_PRESETS[presetIdx]));
    const now = points[points.length - 1];
    const btcSpent = amount / then.p;
    const valueNow = btcSpent * now.p;
    const multiple = now.p / then.p;
    const thenLabel = new Date(then.t * 1000).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      year: "numeric",
    });
    return { then, now, btcSpent, valueNow, multiple, thenLabel };
  }, [points, amount, presetIdx]);

  function shareHref(): string {
    if (!result) return "https://x.com/intent/tweet";
    const up = result.multiple >= 1;
    const text = up
      ? `I ran the spend-and-replace time machine: ${fmtUsd(amount)} of bitcoin spent in ${result.thenLabel} WITHOUT replacing would be ${fmtUsd(result.valueNow)} gone today. Replaced same day: $0 lost, stack intact.\n\nSpend it, replace it. galaxymind.space/spend-and-replace`
      : `I ran the spend-and-replace time machine on a top: even when the price fell after ${result.thenLabel}, replacing same day kept the stack whole. The math works in both directions.\n\ngalaxymind.space/spend-and-replace`;
    return "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
  }

  if (failed) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
        <div className="t-xs font-medium text-[var(--text-tertiary)]">
          Time machine
        </div>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
          Price history is not reporting right now. The thesis above
          stands on its own · come back in a minute for the numbers.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
      <div className="t-xs font-medium text-[var(--text-tertiary)] mb-1">
        The time machine
      </div>
      <h2 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] mb-4">
        Run your own purchase through it.
      </h2>

      {/* Amount chips · exclusive-select group. aria-pressed + a
          labelled group give AT the state the border color conveys
          visually (review 2026-07-07). */}
      <div
        className="flex flex-wrap items-center gap-2 mb-3"
        role="group"
        aria-label="Amount spent"
      >
        <span
          className="t-xs text-[var(--text-tertiary)] mr-1"
          aria-hidden
        >
          You spent
        </span>
        {AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={amount === a}
            onClick={() => {
              setAmount(a);
              track("time_machine_amount", { amount: a });
            }}
            className={`px-3 py-1.5 rounded-full border font-mono text-xs tracking-widest transition-all ${
              amount === a
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
            }`}
          >
            ${a}
          </button>
        ))}
      </div>

      {/* Date chips · same exclusive-select semantics as the amounts. */}
      <div
        className="flex flex-wrap items-center gap-2 mb-6"
        role="group"
        aria-label="Purchase date"
      >
        <span
          className="t-xs text-[var(--text-tertiary)] mr-1"
          aria-hidden
        >
          at a merchant
        </span>
        {DATE_PRESETS.map((pst, i) => (
          <button
            key={pst.label}
            type="button"
            aria-pressed={presetIdx === i}
            onClick={() => {
              setPresetIdx(i);
              track("time_machine_date", { preset: pst.label });
            }}
            className={`px-3 py-1.5 rounded-full border font-mono text-xs uppercase tracking-widest transition-all ${
              presetIdx === i
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
            }`}
          >
            {pst.label}
          </button>
        ))}
      </div>

      {!result ? (
        <div className="font-mono text-sm text-[var(--text-tertiary)] animate-pulse">
          Loading five years of price history...
        </div>
      ) : (
        <>
          {/* Context line */}
          <p className="text-sm text-[var(--text-secondary)] mb-5 leading-relaxed">
            BTC was{" "}
            <span className="font-mono text-[var(--text-primary)]">
              {fmtUsd(result.then.p)}
            </span>{" "}
            in {result.thenLabel} ·{" "}
            <span className="font-mono text-[var(--text-primary)]">
              {fmtUsd(result.now.p)}
            </span>{" "}
            today ·{" "}
            <span
              className={`font-mono ${result.multiple >= 1 ? "text-[var(--accent-ink)]" : "text-[var(--cool-ink)]"}`}
            >
              {result.multiple.toFixed(1)}×
            </span>
            . Your {fmtUsd(amount)} bought{" "}
            <span className="font-mono text-[var(--text-primary)]">
              {fmtSats(result.btcSpent)}
            </span>
            .
          </p>

          {/* The three branches */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--bg-elevated-2)]/60 p-4">
              <div className="micro-label text-[var(--warning)] mb-2">
                Spent · never replaced
              </div>
              <div className="font-mono text-2xl font-bold text-[var(--warning)] tabular-nums">
                {result.multiple >= 1 ? "-" : ""}
                {fmtUsd(result.valueNow)}
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                {result.multiple >= 1
                  ? "What those sats are worth today · gone from your stack. The only losing branch."
                  : "Those sats are worth less today than you paid · even so, the stack is lighter forever."}
              </p>
            </div>

            <div className="rounded-lg border border-[var(--success)]/40 bg-[var(--bg-elevated-2)]/60 p-4">
              <div className="micro-label text-[var(--success)] mb-2">
                Spend and replace
              </div>
              <div className="font-mono text-2xl font-bold text-[var(--success)] tabular-nums">
                $0
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                Sats out, same-day rebuy. Stack unchanged, total cost{" "}
                {fmtUsd(amount)} · identical to paying cash. Zero regret,
                and a merchant got paid in bitcoin.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60 p-4">
              <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
                Paid fiat · held BTC
              </div>
              <div className="font-mono text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                $0
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                Same stack, same {fmtUsd(amount)} cost · the identical
                outcome to spend-and-replace. That equality is the whole
                argument.
              </p>
            </div>
          </div>

          {/* Verdict + share */}
          <p className="mt-5 text-sm text-[var(--text-primary)] leading-relaxed">
            {result.multiple >= 1 ? (
              <>
                Replacing made spending bitcoin{" "}
                <strong className="text-[var(--accent-ink)]">
                  cost exactly what paying cash costs
                </strong>
                . Not replacing would have cost{" "}
                <strong className="text-[var(--warning)]">
                  {fmtUsd(result.valueNow)}
                </strong>{" "}
                of today&apos;s stack.
              </>
            ) : (
              <>
                This window bought the top · and replacing{" "}
                <strong className="text-[var(--accent-ink)]">
                  still kept the stack whole
                </strong>
                . The math protects you in both directions.
              </>
            )}
          </p>
          <div className="mt-4">
            <a
              href={shareHref()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("time_machine_share")}
              className="micro-label inline-flex items-baseline gap-2 px-4 py-2 rounded-lg border border-[var(--accent)]/50 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              Share this result →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
