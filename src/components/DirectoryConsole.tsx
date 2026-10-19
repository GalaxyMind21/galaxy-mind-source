"use client";

/* =====================================================================
 * DirectoryConsole · the homepage's instrument moment (2026-06-29)
 *
 * Ports the Supply Clock's machined language to the directory hero:
 * the merchant count in glass digit windows on a fixed-dark panel,
 * a GROWING status lamp, mono readouts (countries · new this week),
 * the road-to-milestone brass rod integrated as the instrument's
 * progress gauge, and the submit CTA in the panel footer. Replaces
 * the loose count + milestone + submit cluster that used to sit as
 * plain text in the hero's GROUP 3.
 *
 * Deliberate restraint: the page's hero number stays the H1 ("Spend
 * bitcoin."). This console is a cockpit gauge, not a second hero ·
 * digits are ~2.4rem, not the Supply Clock's 4.4rem.
 *
 * Conventions carried over from SupplyClock:
 *   · fixed-light text on a fixed-dark scene · identical in both
 *     themes (the instrument-dial rule)
 *   · .bezel-metal wrapper + .sc-digit glass digit cells (globals.css)
 *   · digits are decorative (aria-hidden) with an sr-only sentence;
 *     readouts and captions stay real text
 *   · no runtime randomness, no clock reads in render output · the
 *     one date-derived prop (newThisWeek) is computed by the parent
 *
 * Mobile: the console stays compact · digits + lamp + readouts. The
 * milestone rod remains sm+ only (mobile audit 2026-06-20 gated it ·
 * it stacked as a 3-line block pushing search + grid down) and the
 * footer submit stays sm+ because the page renders its own full-width
 * mobile submit button right below the hero.
 * ===================================================================== */

import Link from "next/link";

// AA-compliant dims for 10-11px type on the #0a0605 panel floor ·
// 0.66 composites to ~6:1, 0.55 to ~4.7:1 (review 2026-07-02 · the
// original 0.5/0.38 sat at 4.35:1 and 2.9:1, failing WCAG AA on the
// real links). Keep DIM > DIMMER so the hierarchy survives.
const DIM = "rgba(235,225,210,0.66)";
const DIMMER = "rgba(235,225,210,0.55)";
const BRIGHT = "#f2e8d8";

export function DirectoryConsole({
  total,
  countries,
  newThisWeek,
  goal,
  prev,
  onSubmit,
}: {
  total: number;
  countries: number;
  newThisWeek: number;
  /** Rolling milestone target (see roadMilestone in page.tsx). */
  goal: number;
  prev: number;
  onSubmit: () => void;
}) {
  const pct = goal > prev ? ((total - prev) / (goal - prev)) * 100 : 0;

  return (
    <div className="mt-6 rounded-2xl p-[1.5px] bezel-metal nb-seated">
      <div
        className="relative overflow-hidden rounded-[15px] px-4 py-4 sm:px-6 sm:py-5"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, #1d130c 0%, #120b07 50%, #0a0605 100%)",
        }}
      >
        {/* warm bloom behind the count */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-4 left-0 h-32 w-64"
          style={{
            background:
              "radial-gradient(60% 80% at 30% 30%, rgba(247,147,26,0.16) 0%, transparent 75%)",
          }}
        />

        {/* status rail */}
        <div className="relative flex items-center justify-between gap-3 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em]">
          <span style={{ color: DIM }}>Merchants accepting bitcoin</span>
          {/* Honest lamp (review 2026-07-02): Growing only when the
              rolling week actually produced verifications · otherwise a
              steady Live. Same honesty rule as SupplyClock's lamp. */}
          <span className="flex items-center gap-1.5" style={{ color: "#FFC56F" }}>
            <span className="relative flex h-2 w-2">
              {newThisWeek > 0 && (
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                  style={{ background: "#F7931A" }}
                />
              )}
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{
                  background: newThisWeek > 0 ? "#F7931A" : "rgba(247,147,26,0.55)",
                }}
              />
            </span>
            {newThisWeek > 0 ? "Growing" : "Live"}
          </span>
        </div>

        {/* count + readouts */}
        <div className="relative mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="sr-only">
            {total} merchants accepting bitcoin, across {countries} countries,{" "}
            {newThisWeek} verified in the last 7 days.
          </span>
          <div
            aria-hidden
            className="flex items-stretch gap-[0.055em] select-none"
            style={{ fontSize: "clamp(1.9rem, 5vw, 2.5rem)" }}
          >
            {String(total)
              .split("")
              .map((ch, i) => (
                <span
                  key={`d${i}:${ch}`}
                  className="sc-digit sc-cell flex items-center justify-center font-mono font-bold leading-none rounded-[0.12em]"
                  style={{ width: "0.76em", height: "1.3em" }}
                >
                  {ch}
                </span>
              ))}
          </div>
          <div className="flex items-center gap-6" aria-hidden>
            <div>
              <div
                className="font-mono t-xs uppercase tracking-[0.22em]"
                style={{ color: DIMMER }}
              >
                Countries
              </div>
              <div
                className="mt-0.5 font-mono text-lg sm:text-xl font-bold tabular-nums leading-none"
                style={{ color: BRIGHT }}
              >
                {countries}
              </div>
            </div>
            <div>
              <div
                className="font-mono t-xs uppercase tracking-[0.22em]"
                style={{ color: DIMMER }}
              >
                Verified this week
              </div>
              <div
                className="mt-0.5 font-mono text-lg sm:text-xl font-bold tabular-nums leading-none"
                style={{ color: newThisWeek > 0 ? "#FFC56F" : BRIGHT }}
              >
                {/* "0" not a bare middot on a quiet week (UX audit
                    2026-07-13): the clarifying "Road to N" rod is
                    hidden sm, so on mobile a lone "·" under the label
                    read as a render glitch on a trust instrument. */}
                {newThisWeek > 0 ? `+${newThisWeek}` : "0"}
              </div>
            </div>
          </div>
        </div>

        {/* road-to-milestone rod · the console's progress gauge. sm+
            only (mobile audit 2026-06-20 · on phones it pushed the
            search + grid down a full screen). */}
        <div className="relative mt-4 hidden sm:block">
          <div className="flex items-baseline justify-between font-mono t-xs uppercase tracking-[0.22em]">
            <span style={{ color: DIMMER }}>
              Road to {goal} ·{" "}
              <span className="tabular-nums" style={{ color: "#FFC56F" }}>
                {total}
              </span>
              /{goal} · {goal - total} to go
            </span>
            <a
              href="#email-updates"
              className="normal-case tracking-[0.04em] underline decoration-dotted hover:text-[#FFC56F] transition-colors"
              style={{ color: DIMMER }}
            >
              Get notified when we hit it →
            </a>
          </div>
          <div
            className="relative mt-2 h-[5px] w-full rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={total}
            aria-valuemin={prev}
            aria-valuemax={goal}
            aria-label={`${total} of ${goal} merchants toward the next directory milestone`}
            style={{
              background: "#0a0705",
              boxShadow:
                "inset 0 1px 3px rgba(0,0,0,0.8), inset 0 -1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <div
              className="h-full rounded-full lit-active transition-[width] duration-700"
              style={{
                width: `${Math.min(100, Math.max(0, pct))}%`,
                background:
                  "linear-gradient(90deg, rgba(247,147,26,0.85) 0%, #F7931A 50%, rgba(247,147,26,0.85) 100%)",
              }}
            />
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none flex justify-between px-[20%]"
            >
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="w-px h-full bg-black/45" />
              ))}
            </div>
            {pct > 0 && pct < 100 && (
              <span
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)] lit-primary animate-pulse"
                style={{ left: `calc(${Math.min(100, Math.max(0, pct))}% - 3px)` }}
              />
            )}
          </div>
        </div>

        {/* footer rail · cross-links + submit. Fixed-light link colors
            (theme vars would go dark-on-dark in light mode). */}
        <div
          className="relative mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t pt-3.5"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
        >
          <span className="micro-label flex items-center gap-3">
            <Link
              href="/stack"
              className="transition-colors hover:text-[#FFC56F]"
              style={{ color: DIM }}
            >
              Today&apos;s Buying Gauge →
            </Link>
            <span aria-hidden style={{ color: DIMMER }}>
              ·
            </span>
            <Link
              href="/embed"
              className="transition-colors hover:text-[#FFC56F]"
              style={{ color: DIMMER }}
            >
              Embed it
            </Link>
          </span>
          <button
            type="button"
            onClick={onSubmit}
            className="micro-label hidden sm:inline-flex items-baseline gap-2 px-3.5 py-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 text-[#FFC56F] hover:bg-[var(--accent)]/20 hover:lit-active transition-all"
          >
            + Submit a vendor
          </button>
        </div>
      </div>
    </div>
  );
}
