"use client";

import type { ReactNode } from "react";
import type { ExpectedReturn } from "@/lib/recommend";
import { motion } from "framer-motion";
import { GlossaryTerm } from "@/components/GlossaryTerm";

const SP500_ARR = 0.07;

export function ExpectedReturnPanel({
  er,
  horizonYears,
}: {
  er: ExpectedReturn;
  horizonYears: number;
}) {
  // Display helpers
  const annPct = (er.annualCentral * 100).toFixed(1);
  const annLow = (er.annualLow * 100).toFixed(1);
  const annHigh = (er.annualHigh * 100).toFixed(1);

  const totalCentralX = (1 + er.totalCentral).toFixed(2);
  const totalLowX = (1 + er.totalLow).toFixed(2);
  const totalHighX = (1 + er.totalHigh).toFixed(2);

  const sp500Total = Math.pow(1 + SP500_ARR, horizonYears);
  const portfolioBeatsSP =
    er.totalCentral > sp500Total - 1 ? er.totalCentral - (sp500Total - 1) : 0;

  // Visual: a horizontal range bar showing low/central/high band
  // Map all three to a [0..100] visual scale with central in the middle.
  // Span from low to high; central marker shown as a vertical line.
  const lowAnn = er.annualLow;
  const highAnn = er.annualHigh;
  const span = Math.max(0.001, highAnn - lowAnn);
  const centralPct = ((er.annualCentral - lowAnn) / span) * 100;

  return (
    <div className="rounded-lg bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] p-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="t-xs font-medium text-[var(--text-tertiary)]">
          Expected Return
        </span>
        <span className="t-xs text-[var(--text-tertiary)]">
          {horizonYears}-year horizon
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat
          label="Annualized"
          value={`${annPct}%`}
          accent
          sub={`${annLow}–${annHigh}%`}
        />
        <Stat
          label={<GlossaryTerm slug="sharpe-ratio">Vol / Sharpe</GlossaryTerm>}
          value={`${(er.portfolioVolatility * 100).toFixed(0)}%`}
          sub={`Sharpe ${er.sharpeRatio.toFixed(2)}`}
          tone={er.sharpeRatio >= 1 ? "good" : er.sharpeRatio >= 0.5 ? "neutral" : "warn"}
        />
        <Stat
          label="Total"
          value={`${totalCentralX}×`}
          sub={`${totalLowX}–${totalHighX}×`}
        />
        <Stat
          label="$10k becomes"
          value={`$${(10000 * (1 + er.totalCentral)).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          sub={`vs S&P $${(10000 * sp500Total).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          tone={portfolioBeatsSP > 0 ? "good" : "warn"}
        />
      </div>

      {/* Range bar */}
      <div className="relative h-2 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden mb-1">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ duration: 0.6 }}
          className="h-full"
          style={{
            background:
              "linear-gradient(90deg, rgba(239,68,68,0.5) 0%, rgba(247,147,26,0.7) 50%, rgba(74,222,128,0.5) 100%)",
          }}
        />
        <motion.div
          initial={{ left: "50%", opacity: 0 }}
          animate={{ left: `${centralPct}%`, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="absolute top-[-2px] h-3 w-0.5 bg-[var(--accent)] glow-cta"
          style={{ boxShadow: "0 0 8px var(--accent)" }}
          aria-label="Central estimate"
        />
      </div>
      <div className="micro-label flex justify-between text-[var(--text-tertiary)] mb-3">
        <span>{annLow}%/yr</span>
        <span className="text-[var(--accent-ink)] glow-text">
          ★ {annPct}%/yr
        </span>
        <span>{annHigh}%/yr</span>
      </div>

      <p className="t-xs text-[var(--text-tertiary)] leading-relaxed">
        Central estimate, with a 1-sigma-ish band. Compounded over your
        horizon; assumes buy-and-hold. The band ignores cross-asset
        correlation (slightly conservative on the downside, slightly
        aggressive on the upside) · actual outcomes can land outside,
        especially for short horizons or leveraged sleeves.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  // ReactNode so a label can carry a GlossaryTerm popover (the
  // Vol / Sharpe stat · B1 glossary wiring 2026-07-07).
  label: ReactNode;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: "good" | "neutral" | "warn";
}) {
  // -ink, not the fill token: this is a percentage rendered as TEXT. Same
  // bug BacktestChart had; the two Stat components are copies.
  const color = accent
    ? "var(--accent-ink)"
    : tone === "good"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : "var(--text-primary)";
  return (
    <div>
      <div className="t-xs text-[var(--text-tertiary)] mb-1">
        {label}
      </div>
      <div
        className="font-mono text-lg sm:text-xl font-semibold"
        style={{
          color,
          textShadow: accent ? "0 0 12px var(--accent-glow)" : undefined,
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="font-mono t-xs text-[var(--text-tertiary)] mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}
