"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Recommendation, Tolerance } from "@/lib/recommend";

type Props = {
  recommendation: Recommendation;
  inputs: {
    horizonYears: number;
    tolerance: Tolerance;
    accountType: "taxable" | "traditional" | "roth";
  };
  signals: {
    btcPrice: number | null;
    mNAV: number | null;
    fearGreed: number | null;
    fearGreedLabel?: string | null;
    btcVol30d: number | null;
  };
};

const TOLERANCE_NAME = ["", "Minimal", "Low", "Moderate", "High", "Maxi", "Ludicrous"];
const ACCOUNT_NAME: Record<Props["inputs"]["accountType"], string> = {
  taxable: "Taxable brokerage",
  traditional: "Traditional IRA / 401(k)",
  roth: "Roth IRA",
};

export function HowCalculated({ recommendation, inputs, signals }: Props) {
  const [open, setOpen] = useState(false);
  const er = recommendation.expectedReturn;

  // Sort contributions by magnitude for the breakdown
  const sortedContribs = [...er.contributions].sort(
    (a, b) => b.contribution - a.contribution,
  );

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-elevated-2)] transition-colors"
      >
        <span className="flex items-baseline gap-2.5">
          <span className="t-xs font-medium text-[var(--text-tertiary)]">
            How was this calculated?
          </span>
          <span className="text-[var(--text-tertiary)] t-xs">
            ↳ {open ? "hide" : "show"} the pipeline
          </span>
        </span>
        <span
          className="text-[var(--accent-ink)] font-mono text-sm transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▸
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="border-t border-[var(--border-subtle)]"
          >
            <div className="px-5 py-5 space-y-5 text-xs leading-relaxed">
              {/* Inputs */}
              <Section title="Your inputs">
                <Row k="Horizon" v={`${inputs.horizonYears} year${inputs.horizonYears === 1 ? "" : "s"}`} />
                <Row k="Tolerance" v={`${TOLERANCE_NAME[inputs.tolerance]} (level ${inputs.tolerance}/6)`} />
                <Row k="Account" v={ACCOUNT_NAME[inputs.accountType]} />
              </Section>

              {/* Live signals */}
              <Section title="Live market signals applied">
                <Row
                  k="BTC price"
                  v={signals.btcPrice != null ? `$${signals.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "·"}
                  source="CoinGecko"
                />
                <Row
                  k="MSTR mNAV"
                  v={signals.mNAV != null ? `${signals.mNAV.toFixed(2)}×` : "·"}
                  source="bitcointreasuries.net"
                  note={
                    signals.mNAV == null
                      ? null
                      : signals.mNAV >= 1.6
                        ? "rich premium → trim treasury equity into core BTC"
                        : signals.mNAV < 1.05 && signals.mNAV >= 0.85
                          ? "compressed → accretion is cheap, hold full leveraged weight"
                          : signals.mNAV < 0.85
                            ? "below NAV → equity issuance is dilutive, trim leveraged sleeve"
                            : "neutral zone → no adjustment"
                  }
                />
                <Row
                  k="Fear & Greed"
                  v={signals.fearGreed != null ? `${signals.fearGreed}${signals.fearGreedLabel ? ` (${signals.fearGreedLabel})` : ""}` : "·"}
                  source="alternative.me"
                  note={
                    signals.fearGreed == null
                      ? null
                      : signals.fearGreed >= 80
                        ? "extreme greed → trim leveraged sleeves toward core BTC"
                        : signals.fearGreed >= 65
                          ? "greed → modest trim of leverage"
                          : signals.fearGreed <= 20
                            ? "extreme fear → tilt toward MSTR (mNAV usually compresses here)"
                            : signals.fearGreed <= 35
                              ? "fear → small tilt toward MSTR"
                              : "neutral zone → no adjustment"
                  }
                />
                <Row
                  k="BTC 30d realized vol"
                  v={signals.btcVol30d != null ? `${signals.btcVol30d.toFixed(0)}%` : "·"}
                  source="Yahoo BTC-USD"
                  note={
                    signals.btcVol30d == null
                      ? null
                      : signals.btcVol30d >= 90
                        ? "extreme → 2x ETF sleeves halved (decay risk)"
                        : signals.btcVol30d >= 70
                          ? "elevated → small trim of 2x leveraged products"
                          : "calm → no vol-based trim"
                  }
                />
              </Section>

              {/* Pipeline */}
              <Section title="Decision pipeline">
                <div className="text-[var(--text-secondary)] space-y-1.5">
                  <Step n="1">
                    Compute risk budget <span className="font-mono text-[var(--accent-ink)]">R</span>{" "}from tolerance + horizon (Roth tilts +0.07, Taxable tilts −0.04).
                  </Step>
                  <Step n="2">
                    Split <span className="font-mono">R</span> into <span className="font-mono">income / growth</span>{" "}blocks. Higher R → more growth.
                  </Step>
                  <Step n="3">
                    Within income, pick tier-specific preferreds (Minimal: STRC + STRF + SATA only · no STRK).
                  </Step>
                  <Step n="4">
                    Within growth, scale leveraged-equity (MSTR) share by tolerance × horizon.
                  </Step>
                  <Step n="5">
                    Apply MSTY carve-out only at h≤2 + High/Maxi tolerance (NAV decay disqualifies it elsewhere).
                  </Step>
                  <Step n="6">
                    Apply Ludicrous 2× ETF sleeve when t=6.
                  </Step>
                  <Step n="7">
                    Apply live-signal tilts: mNAV → BTC swap, Fear/Greed → leverage trim, BTC vol → 2× ETF damper.
                  </Step>
                  <Step n="8">
                    Per-issuer mNAV: pick cheapest among MPJPY / XXI / ASST for the diversifier sleeve.
                  </Step>
                  <Step n="9">
                    Hard horizon filter: drop assets where <span className="font-mono">h &lt; bestHorizonMin − 2</span>. Re-normalize.
                  </Step>
                  <Step n="10">
                    Round, sort, return.
                  </Step>
                </div>
              </Section>

              {/* Per-asset return contributions */}
              <Section title="Expected-return breakdown (annualized)">
                <div className="space-y-1">
                  {sortedContribs.map((c) => (
                    <div
                      key={c.ticker}
                      className="grid grid-cols-[3rem_3rem_1fr_auto] gap-x-3 items-baseline font-mono t-xs"
                    >
                      <span className="text-[var(--text-primary)] font-semibold">
                        {c.ticker}
                      </span>
                      <span className="text-[var(--text-tertiary)]">
                        {(c.weight * 100).toFixed(0)}%
                      </span>
                      <span className="text-[var(--text-tertiary)]">
                        × {(c.expected * 100).toFixed(1)}% expected
                      </span>
                      <span className="text-[var(--accent-ink)] glow-text tabular-nums">
                        = {(c.contribution * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[3rem_3rem_1fr_auto] gap-x-3 items-baseline font-mono t-xs pt-2 mt-1 border-t border-[var(--border-subtle)]">
                    <span className="col-span-3 text-[var(--text-secondary)] uppercase tracking-wider t-xs">
                      Portfolio annualized
                    </span>
                    <span className="text-[var(--accent-ink)] glow-text font-semibold">
                      {(er.annualCentral * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-[3rem_3rem_1fr_auto] gap-x-3 items-baseline font-mono t-xs">
                    <span className="col-span-3 text-[var(--text-secondary)] uppercase tracking-wider t-xs">
                      Compounded over {inputs.horizonYears}y
                    </span>
                    <span className="text-[var(--text-primary)] tabular-nums">
                      {((1 + er.totalCentral) * 1).toFixed(2)}×
                    </span>
                  </div>
                </div>
              </Section>

              <p className="t-xs text-[var(--text-tertiary)] leading-relaxed">
                Per-asset expected returns are central estimates the engine
                ships with · they encode a forward thesis, not historical
                performance. Update them in{" "}
                <code className="font-mono">src/lib/assets.ts</code>{" "}
                if your view differs. The portfolio number is a weighted sum,
                then compounded; the band ignores correlation
                (a known simplification).
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="micro-label text-[var(--text-secondary)] mb-2">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  k,
  v,
  source,
  note,
}: {
  k: string;
  v: string;
  source?: string;
  note?: string | null;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-x-3 items-baseline">
      <span className="micro-label text-[var(--text-tertiary)]">
        {k}
      </span>
      <div>
        <span className="font-mono text-xs text-[var(--text-primary)]">{v}</span>
        {source && (
          <span className="font-mono t-xs text-[var(--text-tertiary)] ml-2">
            via {source}
          </span>
        )}
        {note && (
          <div className="t-xs text-[var(--text-secondary)] leading-snug mt-0.5">
            → {note}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 items-baseline">
      <span className="font-mono t-xs text-[var(--text-tertiary)] tabular-nums w-5 shrink-0">
        {n}.
      </span>
      <span>{children}</span>
    </div>
  );
}
