"use client";
// Rigs × days calculator on /hashrate. The total is exact: the server's USDC price is linear in
// rigs × days (usdcAtomicFor = cents × 10 × TH × days), so per-rig-day × rigs × days equals what
// getQuote returns at checkout. The one action is a same-tab link to /hashrate/rent with the
// choice pre-filled.
import { useState } from "react";
import { track } from "@vercel/analytics";

const DAY_CHOICES = [1, 2, 3, 5, 7];

/** "12.34" × n in integer micro-USDC so floats never drift a cent. */
export function totalUsdc(perRigDayUsdc: string, rigs: number, days: number): string {
  const micro = Math.round(Number(perRigDayUsdc) * 1e6);
  const t = micro * rigs * days;
  return (t / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** P(at least one block) for `th` TH/s over `days`, at network hashrate networkPhs PH/s. */
export function blockOdds(th: number, days: number, networkPhs: number | null): number | null {
  if (!networkPhs || networkPhs <= 0) return null;
  const share = th / 1000 / networkPhs;
  return 1 - Math.exp(-share * 144 * days);
}

export function oddsLabel(p: number | null): string {
  if (p == null || !(p > 0)) return "—";
  const n = 1 / p;
  return `1 in ${n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(0)}`;
}

export function RentBuilder({
  perRigDayUsdc,
  maxRigs,
  maxDays,
  rigTh,
  networkPhs,
  title,
  oddsTitle,
  oddsNote,
  cta,
}: {
  perRigDayUsdc: string | null;
  maxRigs: number;
  maxDays: number;
  rigTh: number;
  networkPhs: number | null;
  title: string;
  oddsTitle: string;
  oddsNote: string;
  cta: string;
}) {
  const cap = Math.max(1, maxRigs);
  const [rigs, setRigs] = useState(1);
  const [days, setDays] = useState(1);
  const dayChoices = DAY_CHOICES.filter((d) => d <= maxDays);
  const th = rigs * rigTh;
  const href = `/hashrate/rent?rigs=${rigs}&days=${days}`;
  const odds = blockOdds(th, days, networkPhs);
  return (
    <div className="rent-glass rounded-2xl p-5 sm:p-6" data-rent-builder>
      <p className="micro-label text-[var(--accent-ink)]">{title}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-[14px] text-[var(--text-secondary)]">Hashrate</p>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" aria-label="Less hashrate" disabled={rigs <= 1} onClick={() => setRigs((r) => Math.max(1, r - 1))} className="h-11 w-11 rounded-full border border-[var(--nb-hair-2)] text-xl text-[var(--text-primary)] disabled:opacity-35">−</button>
            <span className="min-w-[6ch] text-center font-mono text-2xl tabular-nums text-[var(--text-primary)]" aria-live="polite">{th.toLocaleString("en-US")}<span className="ml-1 text-[14px] text-[var(--text-tertiary)]">TH/s</span></span>
            <button type="button" aria-label="More hashrate" disabled={rigs >= cap} onClick={() => setRigs((r) => Math.min(cap, r + 1))} className="h-11 w-11 rounded-full border border-[var(--nb-hair-2)] text-xl text-[var(--text-primary)] disabled:opacity-35">+</button>
          </div>
          <p className="mt-1.5 font-mono text-[12px] text-[var(--text-tertiary)]">in steps of {rigTh.toLocaleString("en-US")} TH/s</p>
        </div>
        <div>
          <p className="text-[14px] text-[var(--text-secondary)]">Days</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Days">
            {dayChoices.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={d === days}
                onClick={() => setDays(d)}
                className={`h-11 min-w-[44px] rounded-full px-4 font-mono text-[15px] tabular-nums transition-colors ${d === days ? "bg-[var(--accent)] text-black" : "border border-[var(--nb-hair-2)] text-[var(--text-primary)] hover:border-[var(--accent)]/60"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-4 border-t border-[var(--nb-hair-2)] pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[14px] text-[var(--text-secondary)]">Total</p>
          <p className="font-mono text-3xl tabular-nums text-[var(--text-primary)]" data-builder-total>
            {perRigDayUsdc ? `$${totalUsdc(perRigDayUsdc, rigs, days)}` : "—"}
            <span className="ml-2 text-[14px] text-[var(--text-tertiary)]">USDC</span>
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
            {oddsTitle}: <span className="font-mono text-[var(--text-secondary)]">{oddsLabel(odds)}</span>
          </p>
        </div>
        <a
          href={href}
          onClick={() => { try { track("rental_builder_cta", { rigs, days }); } catch { /* ignore */ } }}
          className="lit-primary inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent)] px-7 text-[16px] font-semibold text-black"
        >
          {cta} →
        </a>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{oddsNote}</p>
    </div>
  );
}
