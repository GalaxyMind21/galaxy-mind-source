"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { ASSETS, Asset } from "@/lib/assets";
import {
  recommend,
  AccountType,
  Tolerance,
  Sleeve,
  TOLERANCE_LABELS,
} from "@/lib/recommend";
import { track } from "@vercel/analytics";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { SiteHeader } from "@/components/SiteHeader";
import { AssetCard } from "@/components/AssetCard";
// AssetDetailModal pulls recharts (~40 KB gz) but only renders when a
// user taps an asset row · lazy like BacktestChart below (perf
// 2026-06-12). ssr:false is fine: it mounts client-side on demand.
const AssetDetailModal = dynamic(
  () =>
    import("@/components/AssetDetailModal").then((m) => ({
      default: m.AssetDetailModal,
    })),
  { ssr: false },
);
import { MarketStrip } from "@/components/MarketStrip";
import { AlertSubscribeCompact } from "@/components/AlertSubscribeCompact";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import {
  XSELL_OUT_HASHRATE_HOOK,
  XSELL_OUT_HASHRATE_TITLE,
} from "@/lib/hashrate-copy";
import { SaylorQuoteStrip } from "@/components/SaylorQuoteStrip";
import { ExpectedReturnPanel } from "@/components/ExpectedReturnPanel";
import { HowCalculated } from "@/components/HowCalculated";
import { ShareScenarioRow } from "@/components/ShareScenarioRow";
import { ScenarioCompare } from "@/components/ScenarioCompare";
import { WhatIfSignals } from "@/components/WhatIfSignals";
import { StickyPortfolioBar } from "@/components/StickyPortfolioBar";
import { FitChangeAlertOptIn } from "@/components/FitChangeAlertOptIn";
import { FitLastVisitPulse } from "@/components/FitLastVisitPulse";
import type { MarketSnapshot } from "../api/market/route";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";

// BacktestChart pulls in recharts (~40 KB gz) and only renders below-fold
// after the user submits a recommendation. Lazy-load so it's not in the
// initial JS payload — measurable LCP improvement on /fit first paint.
// ssr:false because the chart component reads window/timeouts in motion.
const BacktestChart = dynamic(
  () =>
    import("@/components/BacktestChart").then((m) => ({
      default: m.BacktestChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="micro-label rounded-lg bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] p-5 text-[var(--text-tertiary)] h-[376px] flex items-center justify-center">
        Loading backtest…
      </div>
    ),
  },
);


const TOLERANCE_OPTIONS: {
  value: Tolerance;
  label: string;
  subtitle: string;
}[] = [
  { value: 1, label: "Minimal", subtitle: "Sleep at night" },
  { value: 2, label: "Low", subtitle: "Modest swings OK" },
  { value: 3, label: "Moderate", subtitle: "30% drawdowns OK" },
  { value: 4, label: "High", subtitle: "Bring on leverage" },
  { value: 5, label: "Maxi", subtitle: "Send it" },
  { value: 6, label: "Ludicrous", subtitle: "2x ETFs / yolo" },
];

const ACCOUNT_OPTIONS: { value: AccountType; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "traditional", label: "Traditional IRA / 401k" },
  { value: "roth", label: "Roth IRA" },
];

// Quick-start presets — three named profiles that one-click set all three
// inputs. Picked to span the engine's range: pure income (Min), the
// classic accretion-tilted Roth (Mod), and the maxi long-horizon stack.
const PRESETS: {
  label: string;
  emoji: string;
  sub: string;
  h: number;
  t: Tolerance;
  a: AccountType;
}[] = [
  { label: "Sleep at night", emoji: "💤", sub: "Min · 5y · Taxable", h: 5,  t: 1, a: "taxable" },
  { label: "Balanced",       emoji: "🌗", sub: "Mod · 10y · Roth",   h: 10, t: 3, a: "roth" },
  { label: "Send it",        emoji: "🚀", sub: "Maxi · 15y · Roth",  h: 15, t: 5, a: "roth" },
];

const SLEEVE_COLORS: Record<Sleeve["role"], string> = {
  core_btc: "#F7931A",            // Bitcoin orange
  leveraged_eq: "#FCD34D",        // gold
  treasury_diversifier: "#FB7185",// rose
  treasury_diversifier_2: "#E11D48", // deep rose · sibling to treasury_diversifier (same hue family = the two non-MSTR treasury names read as a pair)
  income_low_vol: "#22C55E",      // green (STRC)
  income_fixed: "#10B981",        // emerald (STRF · adjacent green)
  income_high_yield: "#0EA5E9",   // sky blue (STRD)
  income_hybrid: "#A78BFA",       // lavender (STRK)
  preferred_diversifier: "#14B8A6", // teal (SATA)
  deriv_income: "#F472B6",        // pink (MSTY)
  speculative: "#DC2626",         // red
  ludicrous_lev: "#7C3AED",       // purple
};

function horizonBand(years: number): string {
  if (years <= 2) return "Short";
  if (years <= 7) return "Medium";
  if (years <= 15) return "Long";
  return "Generational";
}

// URL state helpers. Reading is done in an effect (post-mount) to avoid
// SSR/CSR mismatch — the server has no access to URL search params and
// would render defaults, while the client would read overrides.
function writeURLState(
  horizon: number,
  tolerance: Tolerance,
  account: AccountType,
) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  sp.set("h", String(horizon));
  sp.set("t", String(tolerance));
  sp.set("a", account);
  const url = `${window.location.pathname}?${sp.toString()}`;
  window.history.replaceState(null, "", url);
}

export function FitClient() {
  // Defaults — server-rendered HTML uses these. URL state is loaded in an
  // effect after mount so the first paint matches what the server emitted.
  const [horizon, setHorizon] = useState(5);
  const [tolerance, setTolerance] = useState<Tolerance>(3);
  const [account, setAccount] = useState<AccountType>("taxable");
  const [hydrated, setHydrated] = useState(false);
  // Recommendation is ALWAYS visible (live recompute on input change ·
  // no submit gate). The `submitted` boolean was removed 2026-05-22
  // after the audit caught a regression: handleReset toggled it false
  // but the only re-enable path was the "See Recommendation" button,
  // which T-A4 had just hidden on sm+. So desktop users who reset
  // would have no way to bring the result back.
  const [universeOpen, setUniverseOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);

  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  // Track when we last successfully fetched market data so the UI can
  // show a "signals may be stale" indicator if /api/market has been
  // failing for an extended period. Without this, users continue
  // seeing + acting on stale BTC price / mNAV / F&G with no visible
  // warning.
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Hydrate inputs from URL search params after mount · falling back
  // to the user's last-modeled profile from localStorage when the URL
  // is bare. Tier 3f: allocation is a low-frequency decision and the
  // tool was anonymous between visits · "you last modeled
  // Maxi·15y·Roth" is the recall that converts a one-shot tool into
  // a "let me revisit my plan" check.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const urlH = parseInt(sp.get("h") ?? "", 10);
    const urlT = parseInt(sp.get("t") ?? "", 10);
    const urlA = sp.get("a");
    const hasUrlState =
      (Number.isFinite(urlH) && urlH >= 1 && urlH <= 30) ||
      (Number.isFinite(urlT) && urlT >= 1 && urlT <= 6) ||
      urlA === "taxable" ||
      urlA === "traditional" ||
      urlA === "roth";

    if (hasUrlState) {
      // URL wins · respects shareable links.
      if (Number.isFinite(urlH) && urlH >= 1 && urlH <= 30) setHorizon(urlH);
      if (Number.isFinite(urlT) && urlT >= 1 && urlT <= 6) {
        setTolerance(urlT as Tolerance);
      }
      if (urlA === "taxable" || urlA === "traditional" || urlA === "roth") {
        setAccount(urlA);
      }
    } else {
      // No URL state · try LS recall. Quiet fallback, no banner.
      try {
        const raw = window.localStorage.getItem("gm:fit:lastInputs");
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<{
            h: number;
            t: number;
            a: "taxable" | "traditional" | "roth";
          }>;
          if (
            typeof parsed.h === "number" &&
            Number.isFinite(parsed.h) &&
            parsed.h >= 1 &&
            parsed.h <= 30
          ) {
            setHorizon(parsed.h);
          }
          if (
            typeof parsed.t === "number" &&
            Number.isFinite(parsed.t) &&
            parsed.t >= 1 &&
            parsed.t <= 6
          ) {
            setTolerance(parsed.t as Tolerance);
          }
          if (
            parsed.a === "taxable" ||
            parsed.a === "traditional" ||
            parsed.a === "roth"
          ) {
            setAccount(parsed.a);
          }
        }
      } catch {
        /* malformed LS · ignore, fall through to defaults */
      }
    }
    setHydrated(true);
  }, []);

  // Live market signals: fetch on mount, then poll every 3 minutes so the
  // displayed BTC price / mNAV / F&G / vol stay current for users who sit
  // on the page. The /api/market route caches for 5 min on the server, so
  // most polls hit the edge cache (no upstream pressure). Polling pauses
  // when the tab is hidden — no point burning fetches while users aren't
  // looking, and avoids re-rendering allocation deps on a hidden tab.
  useEffect(() => {
    let cancelled = false;
    const POLL_MS = 3 * 60 * 1000;

    async function load(initial = false) {
      try {
        const r = await fetch("/api/market", { cache: "no-store" });
        if (!r.ok) throw new Error("market fetch failed");
        const d = (await r.json()) as MarketSnapshot;
        if (!cancelled) {
          setMarket(d);
          setLastFetchedAt(Date.now());
          if (initial) setMarketLoading(false);
        }
      } catch (e) {
        if (!cancelled && initial) setMarketLoading(false);
        // On non-initial failure, keep showing the last good snapshot.
        // Log so a streak of failures surfaces in the browser console
        // (was completely silent — users would just see frozen data
        // without any indication anything was wrong).
        console.warn("[/fit] market poll failed:", e);
      }
    }

    // Initial fetch
    load(true);

    // Poll while tab is visible. The visibilitychange handler kicks an
    // immediate refresh on tab-return so a user who left for an hour
    // gets the latest signals as soon as they look back.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(() => load(false), POLL_MS);
    }
    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        load(false);
        startPolling();
      } else {
        stopPolling();
      }
    }
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Sync state → URL only after hydration so we don't fight against
  // restoreFromURL on first paint.
  useEffect(() => {
    if (!hydrated) return;
    writeURLState(horizon, tolerance, account);
    // Also persist to LS for next-visit recall (Tier 3f). URL is
    // the authoritative state for share-links; LS is the fallback
    // when the user lands on bare /fit. Best-effort try/catch ·
    // privacy/quota errors silently drop the save.
    try {
      window.localStorage.setItem(
        "gm:fit:lastInputs",
        JSON.stringify({ h: horizon, t: tolerance, a: account }),
      );
    } catch {
      /* best-effort · LS unavailable */
    }
  }, [hydrated, horizon, tolerance, account]);

  const mNAVByTicker = useMemo(() => {
    const m: Record<string, number | null> = {};
    market?.treasuries.forEach((t) => {
      m[t.ticker] = t.mNAV;
    });
    return m;
  }, [market]);

  const resultRef = useRef<HTMLDivElement>(null);

  const recommendInputs = useMemo(
    () => ({
      horizonYears: horizon,
      volatilityTolerance: tolerance,
      accountType: account,
      mNAVByTicker,
      fearGreed: market?.fearGreed ?? null,
      btcVol30d: market?.btcVol30d ?? null,
    }),
    [horizon, tolerance, account, mNAVByTicker, market],
  );

  const result = useMemo(() => recommend(recommendInputs), [recommendInputs]);

  // Adjacent scenarios — what happens at the next-lower / next-higher tolerance?
  const scenarios = useMemo(() => {
    const out: { label: string; tolerance?: Tolerance; horizon?: number; weights: Map<string, number> }[] = [];
    if (tolerance > 1) {
      const r = recommend({ ...recommendInputs, volatilityTolerance: (tolerance - 1) as Tolerance });
      out.push({
        label: `${TOLERANCE_LABELS[(tolerance - 1) as Tolerance]}`,
        tolerance: (tolerance - 1) as Tolerance,
        weights: tickersToMap(r.allocation),
      });
    }
    if (tolerance < 6) {
      const r = recommend({ ...recommendInputs, volatilityTolerance: (tolerance + 1) as Tolerance });
      out.push({
        label: `${TOLERANCE_LABELS[(tolerance + 1) as Tolerance]}`,
        tolerance: (tolerance + 1) as Tolerance,
        weights: tickersToMap(r.allocation),
      });
    }
    return out;
  }, [recommendInputs, tolerance]);

  const currentWeights = useMemo(
    () => tickersToMap(result.allocation),
    [result.allocation],
  );

  function handleReset() {
    setHorizon(5);
    setTolerance(3);
    setAccount("taxable");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const allocTickers = new Set(result.allocation.map((s) => s.asset.ticker));

  return (
    <main className="night-bench min-h-screen flex-1">
      <SiteHeader />
      <AssetDetailModal
        asset={detailAsset}
        onClose={() => setDetailAsset(null)}
        marketSnapshot={market}
      />

      {/* Sticky portfolio reminder · appears once the user scrolls past
          ResultCard. Mirrors the StickyScoreBar pattern on /stack so the
          page's primary answer (sleeve mix) stays in peripheral vision
          while reading the supporting sections (expected return,
          scenario compare, backtest, how-calculated). Top 3 sleeves +
          a "+N more" hint keep the chip information-dense without
          overflowing on mobile. */}
      {result.allocation.length > 0 && (
        <StickyPortfolioBar
          topSleeves={[...result.allocation]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map((s) => ({ ticker: s.asset.ticker, pct: s.weight }))}
          summary={`${TOLERANCE_LABELS[tolerance]} · ${horizon}y · ${
            ACCOUNT_OPTIONS.find((o) => o.value === account)?.label ?? account
          }`}
          totalSleeves={result.allocation.length}
        />
      )}

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-12">
        {/* Hero system matches / · /float · /treasuries: mono kicker +
            fluid display-title with ONE gradient word (visual sweep
            2026-07-07 · this was the last major surface off-system). */}
        <p className="night-bench-kicker">
          Allocation engine · live signals
        </p>
        <h1 className="display-title mb-3">
          Find your bitcoin fit.
        </h1>
        {/* Tagline · plain-language lead. States the value first (how
            much to own + the mix), then the scope nuance (this is the
            brokerage/retirement sleeve, not self-custody spot). On mobile
            only the first sentence shows (audit 2026-06-20) so the presets
            and first input land near the fold; the scope nuance returns
            at sm+. */}
        <p className="night-bench-lede mb-4 sm:mb-6">
          How much Bitcoin should you own, and in what form?{" "}
          <span className="hidden sm:inline">Set your time horizon, risk tolerance, and account type · get a portfolio mix of Bitcoin and Bitcoin-linked stocks for the brokerage and retirement-account part of your stack.</span>
        </p>

        {/* Quick-start presets · 2026-05-20 audit promoted these
            ABOVE MarketStrip so a one-click path to a recommendation
            is the first actionable surface a visitor sees. Casual
            visitors don't yet need BTC/mNAV/F&G context to dial
            inputs · they need it when reading the recommendation.
            Visually subordinate to the tolerance buttons below
            (which use the same emoji+label+sub card pattern);
            presets are pills so the user reads them as shortcuts,
            not duplicates of the manual controls. */}
        <div className="mb-8">
          <div className="flex items-baseline gap-2 mb-2">
            <label className="micro-label text-[var(--text-secondary)]">
              Quick start
            </label>
            <span className="t-xs text-[var(--text-tertiary)]">
              or fine-tune below ↓
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active =
                horizon === p.h && tolerance === p.t && account === p.a;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setHorizon(p.h);
                    setTolerance(p.t);
                    setAccount(p.a);
                    track("preset_click", { preset: p.label });
                  }}
                  title={p.sub}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 sm:py-1.5 min-h-11 sm:min-h-0 rounded-full border font-mono t-xs uppercase tracking-widest transition-all ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)] lit-active"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
                  }`}
                >
                  <span aria-hidden>{p.emoji}</span>
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* MarketStrip · live signals for the recommendation context.
            Desktop shows it here under the presets. On mobile it is
            hidden here (it pushed the inputs down ~130px) and re-rendered
            right above the result, where the numbers are decision-relevant
            (mobile audit 2026-06-20). */}
        <div className="mb-8 hidden lg:block">
          <MarketStrip data={market} loading={marketLoading} />
          {/* Staleness indicator: if /api/market has been failing for
              >2× the poll interval (~6 min), warn the user that the
              displayed signals are not live. Without this, a sustained
              upstream outage would leave users acting on hours-old
              data with no visible warning. */}
          {lastFetchedAt != null && Date.now() - lastFetchedAt > 6 * 60_000 && (
            <div
              className="micro-label mt-2 text-[var(--warning)] text-right"
              role="status"
            >
              ⚠ live signals stale ({Math.round((Date.now() - lastFetchedAt) / 60_000)} min old)
            </div>
          )}
          {/* Degraded honesty strip · distinct from the staleness
              indicator above: stale = our polling stopped; degraded =
              upstreams themselves are down and the engine is running
              on neutral fallbacks. Same shared predicate as the crons
              (lib/snapshot-quality.ts), computed client-side from the
              polled snapshot. */}
          <div className="mt-3">
            <DataStatusBanner
              degraded={market != null && isMarketSnapshotDegraded(market)}
            />
          </div>
        </div>

        <Field
          title="Time Horizon"
          value={
            <span>
              <span className="text-[var(--accent-ink)] glow-text">{horizon}</span>{" "}
              <span className="text-[var(--text-secondary)]">
                {horizon === 1 ? "YEAR" : "YEARS"}
              </span>
            </span>
          }
        >
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={horizon}
            onChange={(e) => setHorizon(parseInt(e.target.value, 10))}
            className="vol-slider"
            aria-label="Time horizon in years"
          />
          {/* flex, not grid-cols-4: "Generational" is 12 wide-tracked mono
              characters and a quarter-column at 390px is 83px, so the label
              overflowed its cell by 18px and collided with the pill beside
              it. Sized to content and spread edge-to-edge, the row still
              reads left-to-right as short -> long under the slider, and the
              active pill now hugs its own word. */}
          <div className="micro-label flex items-center justify-between gap-1 mt-3">
            {(["Short", "Medium", "Long", "Generational"] as const).map(
              (label) => (
                <div
                  key={label}
                  className={`text-center py-1.5 px-2 rounded ${
                    horizonBand(horizon) === label
                      ? "text-[var(--accent-ink)] bg-[var(--accent)]/10"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {label}
                </div>
              ),
            )}
          </div>
        </Field>

        <Field title="Volatility Tolerance">
          {/* Mobile: 3-col label-only grid (compact). sm: 3-col with
              subtitles. lg: full 6-col row with subtitles. The subtitle
              is hidden below sm so 6 buttons fit cleanly without each
              one feeling cramped. */}
          <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2">
            {TOLERANCE_OPTIONS.map((opt) => {
              const active = tolerance === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTolerance(opt.value)}
                  title={opt.subtitle}
                  className={`group relative px-2 py-2 sm:px-3 sm:py-3 min-h-11 rounded-lg border text-center sm:text-left transition-all ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 lit-active"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--text-tertiary)]"
                  }`}
                >
                  <div
                    className={`font-mono text-[12px] sm:text-xs uppercase tracking-widest ${
                      active
                        ? "text-[var(--accent-ink)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {opt.label}
                  </div>
                  <div className="hidden sm:block t-xs text-[var(--text-tertiary)] mt-1 leading-tight">
                    {opt.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          title="Account Type"
          hint="ROC dividends defer tax in taxable accounts. Roth favors growth (gains tax-free). Traditional IRA can hold spot ETFs but not raw BTC."
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {ACCOUNT_OPTIONS.map((opt) => {
              const active = account === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccount(opt.value)}
                  className={`px-3 py-2.5 rounded-lg border font-mono text-xs uppercase tracking-widest transition-all ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)] lit-active"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Scroll helper · the recommendation is ALWAYS visible
            below (live recompute on input change · no actual
            "submit" step). The full-orange primary CTA misled users
            into thinking they needed to click it to compute. Down-
            graded to a quiet bordered jump-link, hidden on sm+ where
            the result is much closer to the viewport · audit
            2026-05-22. The live-update notice below now does the
            heavy framing work. */}
        <p className="mt-8 mb-6 text-center t-xs text-[var(--text-tertiary)]">
          Recommendation updates live · scroll down to view
        </p>
      </section>

      <section ref={resultRef} className="max-w-3xl mx-auto px-4 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            // No per-input `key` here · was previously
            // key={`${horizon}-${tolerance}-${account}`} which made
            // EVERY slider tick fully unmount + remount the entire
            // result subtree (ResultCard + BacktestChart + Scenario
            // Compare + FitChangeAlertOptIn). BacktestChart's lazy
            // recharts import + /api/history fetch re-ran on each
            // change, FitChangeAlertOptIn's Turnstile widget reset
            // mid-typing, and the framer enter-animation replayed
            // jarringly. With no key the motion.div animates once on
            // initial mount; allocation updates flow through React
            // diffing (numbers re-render smoothly · no remount).
            // Audit 2026-05-22 · also removed the `{submitted && ...}`
            // gate that was structurally dead after T-A4.
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-6 space-y-5"
          >
              {/* Live market signals · hidden at the top of the page on
                  mobile (it delayed the inputs by a screen); shown HERE on
                  mobile, right where the recommendation is read and the
                  signals are decision-relevant (mobile audit 2026-06-20). */}
              <div className="lg:hidden space-y-3">
                <MarketStrip data={market} loading={marketLoading} />
                <DataStatusBanner
                  degraded={market != null && isMarketSnapshotDegraded(market)}
                />
              </div>

              <FitLastVisitPulse
                horizon={horizon}
                tolerance={tolerance}
                account={account}
                result={result}
              />

              <ResultCard
                allocation={result.allocation}
                rationale={result.portfolioRationale}
                onAssetClick={setDetailAsset}
                signals={{
                  mNAV: market?.treasuries.find((t) => t.ticker === "MSTR")?.mNAV ?? null,
                  fg: market?.fearGreed ?? null,
                  vol: market?.btcVol30d ?? null,
                }}
              />

              <ExpectedReturnPanel
                er={result.expectedReturn}
                horizonYears={horizon}
              />

              <ShareScenarioRow
                allocation={result.allocation}
                horizon={horizon}
                tolerance={tolerance}
                account={account}
              />

              {/* Peak-interest opt-in · right after the user can see
                  AND share their recommendation. Captures email +
                  POSTs the (h, t, a) tuple so the server's baseline
                  for the weekly change-check is the recommendation
                  they're staring at. Compact one-row to keep visual
                  weight low; full prefs management lives at /prefs. */}
              <FitChangeAlertOptIn
                horizon={horizon}
                tolerance={tolerance}
                account={account}
              />

              {/* Side-by-side scenario comparison · collapsed by default
                  to avoid visual weight. Lets users see "what changes if
                  I take +1 risk tier?" without resetting their main view. */}
              <ScenarioCompare
                current={result}
                inputs={{ horizonYears: horizon, tolerance, account }}
                signals={{
                  mNAVByTicker,
                  fearGreed: market?.fearGreed ?? null,
                  btcVol30d: market?.btcVol30d ?? null,
                }}
              />

              {/* Market-signal what-if · the sibling of ScenarioCompare
                  (which varies YOUR profile). Drags the three live signals
                  the engine reads and re-runs the same pure recommend()
                  client-side. Collapsed by default. */}
              <WhatIfSignals base={recommendInputs} live={result} />

              <BacktestChart allocation={result.allocation} />

              <HowCalculated
                recommendation={result}
                inputs={{ horizonYears: horizon, tolerance, accountType: account }}
                signals={{
                  btcPrice: market?.btcPrice ?? null,
                  mNAV:
                    market?.treasuries.find((t) => t.ticker === "MSTR")?.mNAV ??
                    null,
                  fearGreed: market?.fearGreed ?? null,
                  fearGreedLabel: market?.fearGreedLabel ?? null,
                  btcVol30d: market?.btcVol30d ?? null,
                }}
              />

              {result.caveats.length > 0 && <CaveatsBlock caveats={result.caveats} />}

              <ScenarioPills
                scenarios={scenarios}
                currentWeights={currentWeights}
                onPick={(t) => setTolerance(t)}
              />

              <AvoidBlock
                avoid={result.avoid}
                onClick={(a) => setDetailAsset(a)}
              />

              <button
                onClick={handleReset}
                className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
              >
                ↺ Reset
              </button>
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Asset Universe · collapsed by default once a recommendation
          exists, since it visually duplicates the directory experience
          and the user already has tailored picks above. Open it when
          they want to browse adjacent assets. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-20">
        <button
          type="button"
          onClick={() => setUniverseOpen((o) => !o)}
          className="w-full flex items-center justify-between py-3 group"
          aria-expanded={universeOpen}
        >
          <span className="t-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] transition-colors">
            {universeOpen ? "Hide" : "Browse"} the asset universe ({ASSETS.length})
          </span>
          <span
            className="font-mono text-sm text-[var(--accent-ink)] transition-transform"
            style={{ transform: universeOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▸
          </span>
        </button>
        <AnimatePresence>
          {universeOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
                {ASSETS.map((a) => (
                  <AssetCard
                    key={a.ticker}
                    asset={a}
                    highlighted={allocTickers.has(a.ticker)}
                    onClick={() => setDetailAsset(a)}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Cross-page CTAs · the natural follow-ups for an allocator
          who just got their portfolio. /stack tells them WHEN to
          deploy a sleeve; /treasuries shows live MSTR mNAV which
          drives the MSTR sleeve sizing. */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-8">
        {/* hashrate strip REMOVED 2026-08-13 · see HomeClient note */}
        <CrossPageCTA
          cards={[
            {
              href: "/stack",
              eyebrow: "WHEN DO I DEPLOY?",
              title: "The Buying Gauge",
              hook: "Your allocation is for the long-run; timing the entry still matters. The dial says when the dip is genuine.",
            },
            {
              href: "/treasuries",
              eyebrow: "MSTR LIVE MNAV",
              title: "Treasuries Scoreboard",
              hook: "MSTR's mNAV directly drives your leveraged-sleeve sizing. See where it's trading right now vs XXI / MPJPY / Strive.",
            },
            {
              href: "/hashrate",
              eyebrow: "RENT HASHRATE",
              title: XSELL_OUT_HASHRATE_TITLE,
              hook: XSELL_OUT_HASHRATE_HOOK,
            },
          ]}
        />
      </section>

      {/* Buying Gauge mailing list · secondary CTA. /fit visitors are
          allocators looking at multi-year horizons; they're a strong
          fit for "tell me when the gauge enters extreme territory"
          since timing the entry across a 5-15 year horizon matters
          most at the regime crossings. */}
      <AlertSubscribeCompact source="fit" />

      {/* Related-pages strip · mirrors the see-also row inside
          CitationBlock on /stack and /treasuries. Routes definitional
          traffic to /glossary, methodology to /faq, brand context to
          /about. Internal-link weight to supporting pages from the
          allocation engine. */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-8 flex flex-wrap items-baseline gap-x-4 gap-y-1 t-xs text-[var(--text-tertiary)]">
        <span>Related</span>
        <a
          href="/glossary"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          Glossary →
        </a>
        <a
          href="/faq"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          FAQ →
        </a>
        <a
          href="/about"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          About →
        </a>
      </div>

      {/* Quiet bitcoin-meme-culture flourish · rotating Saylor lines
          in the calm space before the legal footer (shared list ·
          one voice with the gauge + eggs). */}
      <SaylorQuoteStrip />

      <FooterDisclaimer />
    </main>
  );
}

function tickersToMap(allocation: Sleeve[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of allocation) m.set(s.asset.ticker, s.weight);
  return m;
}

function Field({
  title,
  value,
  hint,
  children,
}: {
  title: string;
  value?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <label className="micro-label text-[var(--text-secondary)]">
          {title}
        </label>
        {value && (
          <div className="font-mono text-lg sm:text-xl font-semibold">
            {value}
          </div>
        )}
      </div>
      {children}
      {hint && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
      {children}
    </div>
  );
}

function ResultCard({
  allocation,
  rationale,
  onAssetClick,
  signals,
}: {
  allocation: Sleeve[];
  rationale: string;
  onAssetClick: (a: Asset) => void;
  signals: { mNAV: number | null; fg: number | null; vol: number | null };
}) {
  return (
    <div
      data-fit-result
      role="region"
      aria-label="Recommended portfolio · updates live as inputs change"
      className="rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 pulse-border"
    >
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <SectionLabel>Your Portfolio</SectionLabel>
        <span className="t-xs font-medium text-[var(--text-tertiary)]">
          {allocation.length} {allocation.length === 1 ? "asset" : "assets"} ·
          100%
        </span>
      </div>

      <p className="text-[var(--text-primary)] leading-relaxed mb-2">
        {rationale}
      </p>
      <p className="t-xs text-[var(--text-tertiary)] leading-relaxed mb-5">
        A starting point to learn from, not financial advice. You decide
        what you actually do. Note: these are mostly custodial or paper
        instruments with issuer and counterparty risk · self-custodied
        spot bitcoin has neither, and is the sovereign baseline this is
        measured against.
      </p>

      <SignalBadges signals={signals} />

      <div
        className="h-5 w-full rounded-full overflow-hidden flex bg-[var(--bg-elevated-2)] mb-6"
        role="img"
        aria-label="Portfolio allocation breakdown"
      >
        {allocation.map((s, i) => (
          <motion.div
            key={s.asset.ticker}
            initial={{ width: 0 }}
            animate={{ width: `${s.weight * 100}%` }}
            transition={{ duration: 0.5, delay: i * 0.05, ease: "easeOut" }}
            style={{ background: SLEEVE_COLORS[s.role] }}
            title={`${s.asset.ticker} · ${(s.weight * 100).toFixed(0)}%`}
          />
        ))}
      </div>

      <div className="space-y-4">
        {allocation.map((s, i) => (
          <motion.button
            key={s.asset.ticker}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => onAssetClick(s.asset)}
            className="w-full text-left grid grid-cols-[auto_3rem_1fr] gap-x-3 sm:gap-x-4 items-baseline group hover:bg-[var(--bg-elevated-2)] rounded-md -mx-2 px-2 py-1.5 transition-colors"
          >
            <span className="flex items-baseline gap-2.5">
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0 translate-y-[-1px]"
                style={{ background: SLEEVE_COLORS[s.role] }}
                aria-hidden
              />
              <span className="font-mono text-base sm:text-lg font-semibold text-[var(--accent-ink)] glow-text tabular-nums w-10 text-right">
                {(s.weight * 100).toFixed(0)}%
              </span>
            </span>
            <span className="font-mono text-sm text-[var(--text-primary)] font-semibold group-hover:underline">
              {s.asset.ticker}
            </span>
            <span className="col-start-3 row-start-1 text-xs text-[var(--text-tertiary)] truncate">
              {s.asset.name}
            </span>
            <span className="col-start-2 col-span-2 text-xs text-[var(--text-secondary)] leading-relaxed mt-1">
              {s.rationale}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// Inline pill row showing which live signals shaped this recommendation.
function SignalBadges({
  signals,
}: {
  signals: { mNAV: number | null; fg: number | null; vol: number | null };
}) {
  const items: { label: string; value: string; tone: string }[] = [];
  if (signals.mNAV != null) {
    let tone = "neutral";
    if (signals.mNAV >= 1.6) tone = "bad";          // rich premium → engine trims
    else if (signals.mNAV < 0.85) tone = "warn";    // distressed → engine trims 50%
                                                    // (was missing — silently neutral)
    else if (signals.mNAV < 1.05) tone = "good";    // treasury-cheap entry zone
    items.push({ label: "MSTR mNAV", value: `${signals.mNAV.toFixed(2)}x`, tone });
  }
  if (signals.fg != null) {
    let tone = "neutral";
    if (signals.fg >= 80) tone = "bad";
    else if (signals.fg <= 20) tone = "good";
    items.push({ label: "F&G", value: String(signals.fg), tone });
  }
  if (signals.vol != null) {
    let tone = "neutral";
    if (signals.vol >= 70) tone = "warn";
    items.push({ label: "30d vol", value: `${signals.vol.toFixed(0)}%`, tone });
  }
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <span className="t-xs font-medium text-[var(--text-tertiary)] mr-1">
        Live signals applied
      </span>
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-baseline gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] px-2.5 py-0.5"
        >
          <span className="micro-label text-[var(--text-tertiary)]">
            {it.label}
          </span>
          <span
            className="font-mono text-xs font-semibold"
            style={{
              color:
                it.tone === "bad"
                  ? "var(--danger)"
                  : it.tone === "warn"
                    ? "var(--warning)"
                    : it.tone === "good"
                      ? "var(--success)"
                      : "var(--text-primary)",
            }}
          >
            {it.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function CaveatsBlock({ caveats }: { caveats: string[] }) {
  return (
    <div>
      <SectionLabel>Caveats</SectionLabel>
      <div className="space-y-2">
        {caveats.map((c, i) => (
          <div
            key={c}
            className="flex gap-2.5 items-start text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--warning)]/25 rounded-lg p-3"
          >
            <span
              className="micro-label text-[var(--warning)] shrink-0 mt-0.5"
              aria-hidden
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="leading-relaxed">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScenarioPills({
  scenarios,
  currentWeights,
  onPick,
}: {
  scenarios: {
    label: string;
    tolerance?: Tolerance;
    weights: Map<string, number>;
  }[];
  currentWeights: Map<string, number>;
  onPick: (t: Tolerance) => void;
}) {
  if (scenarios.length === 0) return null;
  return (
    <div>
      <SectionLabel>Try a different tolerance</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {scenarios.map((sc) => {
          const deltas = computeDeltas(currentWeights, sc.weights);
          return (
            <button
              key={sc.label}
              onClick={() => sc.tolerance != null && onPick(sc.tolerance)}
              className="text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated-2)] transition-colors group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="micro-label text-[var(--text-secondary)] group-hover:text-[var(--accent-ink)]">
                  {sc.label} →
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {deltas.slice(0, 4).map((d) => (
                  <span
                    key={d.ticker}
                    className="font-mono t-xs tabular-nums px-1.5 py-0.5 rounded"
                    style={{
                      color: d.delta >= 0 ? "var(--success)" : "var(--danger)",
                      background:
                        d.delta >= 0
                          ? "rgba(74,222,128,0.08)"
                          : "rgba(239,68,68,0.08)",
                    }}
                  >
                    {d.ticker} {d.delta >= 0 ? "+" : ""}
                    {(d.delta * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function computeDeltas(
  current: Map<string, number>,
  next: Map<string, number>,
): { ticker: string; delta: number }[] {
  const all = new Set([...current.keys(), ...next.keys()]);
  const deltas: { ticker: string; delta: number }[] = [];
  for (const t of all) {
    const c = current.get(t) ?? 0;
    const n = next.get(t) ?? 0;
    const d = n - c;
    if (Math.abs(d) >= 0.01) deltas.push({ ticker: t, delta: d });
  }
  // Sort by absolute magnitude
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return deltas;
}

function AvoidBlock({
  avoid,
  onClick,
}: {
  avoid: Asset[];
  onClick: (a: Asset) => void;
}) {
  return (
    <div>
      <SectionLabel>Avoid for your profile</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {avoid.map((a) => (
          <button
            key={a.ticker}
            onClick={() => onClick(a)}
            className="w-full text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 opacity-70 hover:opacity-100 transition-opacity"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-sm font-semibold text-[var(--text-secondary)]">
                {a.ticker}
              </span>
              <span className="micro-label text-[var(--warning)]">
                mismatch
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] leading-snug">
              {a.notes}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
