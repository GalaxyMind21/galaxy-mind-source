"use client";

// "Your slice of the float" · makes the abstract in-play number personal.
//
// Pure client-side: the live `inPlay` (BTC realistically in active play)
// comes from the page; the user's stack size lives only in localStorage.
// No network, no PII, no server roundtrip.
//
// Framing choice: a literal proportional bar would be invisible — a single
// stack is a vanishingly small slice of ~6M BTC — and a fake-scaled bar
// would misrepresent the magnitude. So we lead with a graspable "1 part in
// N" ratio and show the true (tiny) percentage alongside it. The smallness
// IS the point: it reinforces how scarce the spendable float really is.

import { useEffect, useState } from "react";

const LS_KEY = "gm:float:myStack";
const DEFAULT_STACK = "0.21"; // 21M motif · a friendly, on-brand starting point
const MAX_BTC = 21_000_000;

function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// Render a small percentage without ever falling into ugly exponential
// notation (which laypeople can't read). toPrecision(2) stays in fixed
// notation down to ~1e-6; below that we show a clean "smaller than" bound.
function fmtSmallPct(pct: number): string {
  if (!isFinite(pct) || pct <= 0) return "0%";
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  if (pct >= 1e-6) return `${parseFloat(pct.toPrecision(2)).toString()}%`;
  return "<0.000001%";
}

export function MyFloatShare({
  inPlay,
  isFallback = false,
}: {
  inPlay: number;
  isFallback?: boolean;
}) {
  const [raw, setRaw] = useState(DEFAULT_STACK);
  const [hydrated, setHydrated] = useState(false);

  // Restore the saved stack after mount (SSR + first client render both use
  // DEFAULT_STACK, so there's no hydration mismatch; the LS value lands one
  // tick later).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved !== null && saved !== "") setRaw(saved);
    } catch {
      /* private mode / disabled storage · just use the default */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_KEY, raw);
    } catch {
      /* ignore */
    }
  }, [raw, hydrated]);

  const stack = Math.max(0, Math.min(MAX_BTC, parseFloat(raw) || 0));
  const valid = stack > 0 && inPlay > 0;
  const pct = valid ? (stack / inPlay) * 100 : null;
  const oneIn = valid ? inPlay / stack : null;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 elevate">
      <div className="micro-label text-[var(--text-tertiary)] mb-2">
        Your slice of the float
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-snug mb-4 max-w-prose">
        The clock above is counting down the{" "}
        <span className="text-[var(--accent-ink)] tabular-nums">
          {fmtCompact(inPlay)} BTC
        </span>{" "}
        still realistically in play. Where does your stack sit inside it?
      </p>

      <label className="block">
        <span className="font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          My stack (BTC)
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_BTC}
          step="0.01"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          aria-label="Your bitcoin stack size in BTC"
          className="mt-1.5 block w-full sm:w-48 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 font-mono text-lg tabular-nums text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors"
        />
      </label>

      {valid ? (
        <div className="mt-4 space-y-1.5" aria-live="polite">
          <div className="font-mono text-2xl sm:text-3xl tabular-nums text-[var(--accent-ink)] glow-text">
            1 part in {fmtCompact(oneIn as number)}
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-snug">
            Your {stack} BTC is about{" "}
            <span className="text-[var(--text-primary)] tabular-nums">
              {fmtSmallPct(pct as number)}
            </span>{" "}
            of the Bitcoin still in active play. Scarce company.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-tertiary)]">
          Enter a stack size to see your slice.
        </p>
      )}

      <p className="mt-4 t-xs text-[var(--text-tertiary)] leading-snug max-w-prose">
        Conceptual only · your coins are not held in the &quot;in play&quot;
        bucket in any custodial sense, and this never leaves your browser.
        {isFallback ? " Float shown is baseline data, awaiting today's snapshot." : ""}
      </p>
    </div>
  );
}
