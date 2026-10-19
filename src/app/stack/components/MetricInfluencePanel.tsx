"use client";

/* =====================================================================
 * MetricInfluencePanel
 *
 * The "huge for engagement" feature: each slider controls one of the
 * six most-influential signals that feed the Buying Gauge. Move a
 * slider → the gauge needle responds in real time so the user can see
 * cause-and-effect.
 *
 * MATH:
 *   The engine computes the gauge score as a weighted average of each
 *   signal's normalized value. Each SignalReading already carries
 *   `.normalized` (0–100) and `.weight`. We just let the user override
 *   the normalized value for the 6 controlled signals and recompute
 *   the weighted sum (using LIVE normalized values for the other 4).
 *   Mathematically equivalent to the engine for those signals — no
 *   re-import of the engine library needed.
 *
 * UX:
 *   - Compact column suitable for a sidebar (lg+) or stacked under the
 *     gauge (mobile).
 *   - Each row: signal name (clickable for explanation), weight chip,
 *     live value chip, and a horizontal slider styled to match the
 *     orange-glow theme.
 *   - "Reset to live" button at the bottom snaps everything back.
 *   - "Surprise me" button randomizes positions for play.
 *   - Visually disabled (but still readable) when Sim Mode is running,
 *     since sim takes priority for the score override.
 * ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import type { SignalReading } from "@/lib/stack";

// All TEN signals exposed as user-controllable sliders. Bundling all
// of them is what makes "max all sliders → gauge says 100" work — if
// any signal is left as live (~50 typical), the math caps the max at
// ~85. Order: fundamentals first (by weight desc), then context (mNAV
// + temporal). The bottom four (Price vs MA30, Vol, Hour, Day) carry
// 29% of the weight combined and the gauge can't reach extremes
// without them.
const PLAYABLE_SIGNAL_NAMES = [
  "MVRV",
  "Mayer Multiple",
  "Puell Multiple",
  "Funding Rate",
  "Fear & Greed",
  "Price vs 30d MA",
  "30d Realized Vol",
  "MSTR mNAV",
  "Hour-of-Day",
  "Day-of-Week",
] as const;

type PlayableName = (typeof PLAYABLE_SIGNAL_NAMES)[number];

// Friendly labels (the engine's `.name` is already pretty good but we
// shorten a couple for tight space).
const SHORT_LABEL: Record<PlayableName, string> = {
  "MVRV": "MVRV",
  "Mayer Multiple": "Mayer",
  "Puell Multiple": "Puell",
  "Funding Rate": "Funding",
  "Fear & Greed": "F&G",
  "Price vs 30d MA": "vs MA30",
  "30d Realized Vol": "Vol 30d",
  "MSTR mNAV": "mNAV",
  "Hour-of-Day": "Hour",
  "Day-of-Week": "Day",
};

// One-line explanations for the (i) tooltip / explanation row.
const EXPLAIN: Record<PlayableName, string> = {
  "MVRV":
    "Market Value to Realized Value. Measures avg holder PnL · extremes mark cycle tops/bottoms.",
  "Mayer Multiple":
    "Price ÷ 200-day MA. Below 1.0 historically marks accumulation; above 2.4 marks tops.",
  "Puell Multiple":
    "Daily issuance USD ÷ 365d MA. Below 0.5 = miner capitulation, every major bottom.",
  "Funding Rate":
    "BTC perp funding (8h). Negative = shorts paying longs (contrarian buy signal).",
  "Fear & Greed":
    "Sentiment composite, 0=fear→100=greed. Inverted: low fear = good buying.",
  "Price vs 30d MA":
    "% deviation from 30-day moving average. Below MA = mean-reversion buying signal.",
  "30d Realized Vol":
    "30d annualized vol. Vol spikes (>100%) often bracket capitulation lows.",
  "MSTR mNAV":
    "MSTR market cap ÷ value of its BTC holdings. Below 1.05× = treasury-cheap.",
  "Hour-of-Day":
    "Historical avg log-return at this ET hour. Lower past returns score higher (good entry).",
  "Day-of-Week":
    "Historical avg log-return on this weekday. Same logic as Hour: drag to test other days.",
};

type Props = {
  signals: SignalReading[];
  isOverridden: boolean;
  disabled?: boolean;
  onSyntheticScore: (score: number | null) => void;
};

export function MetricInfluencePanel({
  signals,
  isOverridden,
  disabled = false,
  onSyntheticScore,
}: Props) {
  // Map signal name → reading for fast lookup.
  const byName = useMemo(() => {
    const m = new Map<string, SignalReading>();
    for (const s of signals) m.set(s.name, s);
    return m;
  }, [signals]);

  // Pull the playable signals; if any are missing (live data outage),
  // we still render their row but disable the slider.
  const playable = useMemo(() => {
    return PLAYABLE_SIGNAL_NAMES.map((name) => {
      const reading = byName.get(name);
      return {
        name,
        live: reading?.normalized ?? null,
        weight: reading?.weight ?? 0,
        rationale: reading?.rationale ?? null,
      };
    });
  }, [byName]);

  // Slider state — initialized from live normalized values. We keep
  // an explicit override map so we can detect when the user has
  // touched everything-back-to-live and emit null.
  const [overrides, setOverrides] = useState<Map<PlayableName, number>>(
    new Map(),
  );
  const trackedRef = useRef(false);
  const [explainOpen, setExplainOpen] = useState<PlayableName | null>(null);

  // ─── localStorage persistence (Tier 2c · saved personalization) ───
  // Restore the user's last weighting on mount and write back on every
  // change · turns the panel from a one-session toy into "my custom
  // view of the gauge." Filter against current PLAYABLE_SIGNAL_NAMES
  // on restore so a future signal rename can't poison the map.
  const LS_KEY = "gm:stack:influence-overrides";
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = new Set<string>(PLAYABLE_SIGNAL_NAMES);
      const next = new Map<PlayableName, number>();
      for (const entry of parsed) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] >= 0 &&
          entry[1] <= 100 &&
          valid.has(entry[0])
        ) {
          next.set(entry[0] as PlayableName, Math.round(entry[1]));
        }
      }
      if (next.size > 0) setOverrides(next);
    } catch {
      /* malformed LS · ignore, fall back to live */
    }
  }, []);
  useEffect(() => {
    // Skip the first run BEFORE restore has had a chance · we'd
    // otherwise clobber the stored value with the empty initial state.
    if (!restoredRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (overrides.size === 0) {
        window.localStorage.removeItem(LS_KEY);
      } else {
        window.localStorage.setItem(
          LS_KEY,
          JSON.stringify(Array.from(overrides.entries())),
        );
      }
    } catch {
      /* quota / privacy mode · best-effort */
    }
  }, [overrides]);

  // When live signal values shift (rare — happens on snapshot refetch),
  // we DON'T clobber the user's overrides. They stay until reset.
  // But if the user hasn't touched anything, the displayed slider value
  // tracks live (visually) so the panel reflects reality before play.

  /* ---------------- Synthetic score recompute ---------------- */
  const recompute = useCallback(
    (overridesNow: Map<PlayableName, number>) => {
      // Build the synthetic snapshot: for each signal, use the override
      // if present, else live. Weighted sum.
      let total = 0;
      let weightSum = 0;
      for (const s of signals) {
        const userVal = overridesNow.get(s.name as PlayableName);
        const val = userVal ?? s.normalized;
        total += val * s.weight;
        weightSum += s.weight;
      }
      if (weightSum <= 0) return null;
      // Normalize for safety in case weights don't quite sum to 1.0
      // (null-redistribution can drift; engine clamps but we double-check).
      return Math.round(total / weightSum);
    },
    [signals],
  );

  // Sync override → parent.
  useEffect(() => {
    if (overrides.size === 0) {
      onSyntheticScore(null);
      return;
    }
    const score = recompute(overrides);
    onSyntheticScore(score);
  }, [overrides, recompute, onSyntheticScore]);

  // External reset: parent clears the override (e.g., on hub
  // double-click) — we should clear our slider state too.
  //
  // RACE: a naive "if (!isOverridden && overrides.size>0)" effect
  // fires whenever the user makes the FIRST change (Surprise Me, etc.)
  // because in the instant between our setOverrides() and the parent's
  // setSyntheticScore() landing, isOverridden is still false from the
  // PREVIOUS render. That clobbers the change we just made. The fix:
  // only fire on a true→false TRANSITION of isOverridden.
  const prevIsOverriddenRef = useRef(isOverridden);
  useEffect(() => {
    if (prevIsOverriddenRef.current === true && isOverridden === false) {
      setOverrides(new Map());
    }
    prevIsOverriddenRef.current = isOverridden;
  }, [isOverridden]);

  /* ---------------- Handlers ---------------- */
  const handleSlider = useCallback(
    (name: PlayableName, value: number) => {
      if (disabled) return;
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(name, value);
        return next;
      });
      if (!trackedRef.current) {
        trackedRef.current = true;
        track("stack_panel_slider");
      }
    },
    [disabled],
  );

  const handleReset = useCallback(() => {
    setOverrides(new Map());
    onSyntheticScore(null);
  }, [onSyntheticScore]);

  const handleSurpriseMe = useCallback(() => {
    if (disabled) return;
    const next = new Map<PlayableName, number>();
    for (const name of PLAYABLE_SIGNAL_NAMES) {
      next.set(name, Math.floor(Math.random() * 101));
    }
    setOverrides(next);
    track("stack_panel_surprise");
  }, [disabled]);

  // Max / min buttons — directly verify the gauge reaches 100 / 0.
  // With all 10 sliders included the math now collapses cleanly:
  // synthetic = Σ(100 × wᵢ) / Σwᵢ = 100. Same for 0. Useful both as
  // a play affordance ("show me a perfect storm") and as an
  // accessibility shortcut.
  const handleAllTo = useCallback(
    (value: 0 | 100) => {
      if (disabled) return;
      const next = new Map<PlayableName, number>();
      for (const name of PLAYABLE_SIGNAL_NAMES) next.set(name, value);
      setOverrides(next);
      track(value === 100 ? "stack_panel_max" : "stack_panel_min");
    },
    [disabled],
  );

  /* ---------------- Render ---------------- */
  const noLiveData = signals.length === 0;
  const [open, setOpen] = useState(false);

  return (
    <div
      // The floating StickySubscribeChip hides itself while this panel
      // is on screen · on mobile it sat directly over the slider rows
      // (review 2026-06-12). Any element can opt in with this attr.
      data-occlusion-sensitive
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5"
      style={{
        // Subtle inner shadow + outer glow when actively overriding —
        // visually links the panel to the gauge state.
        boxShadow: isOverridden
          ? "inset 0 0 0 1px rgba(247,147,26,0.25), 0 0 24px rgba(247,147,26,0.18)"
          : "inset 0 0 0 1px rgba(255,255,255,0.02)",
        transition: "box-shadow 0.4s",
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="micro-label text-[var(--text-tertiary)]">
            Instruments
          </div>
          <div className="mt-0.5 font-mono text-xs text-[var(--text-secondary)]">
            Twist to experiment
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOverridden && (
            <span className="micro-label text-[var(--accent-ink)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-full px-2 py-0.5">
              What-if
            </span>
          )}
          <button
            type="button"
            className="micro-label md:hidden text-[var(--accent-ink)]"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {/* Body · collapsed on small screens like Asset Universe on /fit. */}
      <div className={open ? "block" : "hidden md:block"}>
      {noLiveData ? (
        <div className="font-mono t-xs text-[var(--text-tertiary)] py-4 text-center">
          Signals loading…
        </div>
      ) : (
        <>
        <div className="space-y-2">  {/* tighter than v1 to fit 10 rows */}
          {playable.map((s) => {
            const userVal = overrides.get(s.name);
            const displayed = userVal ?? s.live ?? 50;
            const isUnavailable = s.live == null;
            const isEdited = userVal != null;
            const sliderDisabled = disabled || isUnavailable;
            return (
              <div key={s.name} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExplainOpen((prev) => (prev === s.name ? null : s.name))
                    }
                    className={`text-left font-mono t-xs uppercase tracking-[0.18em] hover:text-[var(--accent-ink)] transition-colors ${
                      isEdited
                        ? "text-[var(--accent-ink)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {SHORT_LABEL[s.name]}
                    <span className="ml-1 opacity-50">(i)</span>
                  </button>
                  <div className="flex items-baseline gap-1.5">
                    <span className="micro-label text-[var(--text-tertiary)]">
                      {(s.weight * 100).toFixed(0)}%
                    </span>
                    <span
                      className={`font-mono text-xs tabular-nums w-7 text-right ${
                        isEdited
                          ? "text-[var(--accent-ink)]"
                          : isUnavailable
                            ? "text-[var(--text-tertiary)]"
                            : "text-[var(--text-primary)]"
                      }`}
                    >
                      {isUnavailable ? "·" : Math.round(displayed)}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={displayed}
                  onChange={(e) =>
                    handleSlider(s.name, Number(e.target.value))
                  }
                  disabled={sliderDisabled}
                  className="vol-slider w-full disabled:opacity-30"
                  aria-label={`${SHORT_LABEL[s.name]} (weight ${(s.weight * 100).toFixed(0)} percent)`}
                />
                {explainOpen === s.name && (
                  <div className="mt-1 t-xs text-[var(--text-tertiary)] leading-relaxed border-l-2 border-[var(--border-subtle)] pl-2">
                    {EXPLAIN[s.name]}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      {/* Footer actions · two rows so all four buttons get readable
          touch targets without horizontal cramping. Reset stands alone
          (it's the only "destructive" action); the play row groups the
          three exploratory buttons (min, surprise, max). */}
      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isOverridden || disabled}
            className="micro-label px-2.5 py-1.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↻ Reset to live
          </button>
          <button
            type="button"
            onClick={handleSurpriseMe}
            disabled={disabled || noLiveData}
            className="micro-label px-2.5 py-1.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            🎲 Surprise
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleAllTo(0)}
            disabled={disabled || noLiveData}
            className="micro-label px-2.5 py-1.5 rounded-full border border-[#7ec0ff]/30 text-[var(--cool-ink)] hover:bg-[#7ec0ff]/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Set every slider to 0 · gauge reads 0 (frozen)"
          >
            ❄ Min · 0
          </button>
          <button
            type="button"
            onClick={() => handleAllTo(100)}
            disabled={disabled || noLiveData}
            className="micro-label px-2.5 py-1.5 rounded-full border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Set every slider to 100 · gauge reads 100 (perfect storm)"
          >
            🔥 Max · 100
          </button>
        </div>
        </div>
        </>
      )}
      </div>

      {disabled && (
        <div className="micro-label mt-3 text-[var(--text-tertiary)] text-center">
          Sim mode active · instruments paused
        </div>
      )}
    </div>
  );
}
