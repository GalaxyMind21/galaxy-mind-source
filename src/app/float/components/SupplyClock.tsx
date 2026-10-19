"use client";

/* =====================================================================
 * THE SUPPLY CLOCK · /float hero instrument (full redesign 2026-06-29)
 *
 * Third-generation hero (reservoir cylinder → 21M hourglass → this).
 * The operator's brief: the page must create a felt sense of urgency
 * that there is not much bitcoin left to buy, and the instrument must
 * look rich, not basic. The design answer is the debt-clock pattern:
 * the single most battle-tested urgency device is a huge number,
 * visibly falling, in real time. So the number IS the instrument.
 *
 * Anatomy, top to bottom:
 *   1. Status rail · brand mark, live status lamp (DRAINING /
 *      REFILLING / SYNCING / BASELINE), current block height.
 *   2. The clock · in-play BTC in machined digit windows, ticking
 *      DOWN between daily snapshots at yesterday's observed net
 *      drain (drainPerSecond). Anchored to snapshot.asOf so the
 *      extrapolated value is roughly CONTINUOUS across the daily
 *      snapshot boundary (next snapshot ≈ inPlay + dailyDelta ≈
 *      where the extrapolation already sits). Decimals spin fast,
 *      integers roll slow · both flash on change via keyed remount
 *      (see .sc-digit in globals.css).
 *   3. The 21M strata bar · every coin that will ever exist, in one
 *      bar: LOST+HELD (dark vault), ETF+GOV+CO (dim amber), IN PLAY
 *      (molten translucent lava · bubbles + sheen, the only thing
 *      alive), UNMINED (dashed outline · the drip that halves).
 *   4. Urgency readouts · % of mined supply locked away, net daily
 *      flow, straight-line runway (suppressed when meaningless, see
 *      lib/float-urgency), days to the next supply cut.
 *
 * Honesty rules (non-negotiable, mirror the rest of the site):
 *   · isFallback → clock frozen at the baseline, lamp = BASELINE,
 *     the page-level "awaiting first snapshot" badge stays.
 *   · dailyDelta null → no tick, no invented motion, lamp = SYNCING.
 *   · dailyDelta ≥ 0 → lamp = REFILLING (it happens; say so).
 *   · runway line is labeled a thought experiment, not a forecast.
 *   · extrapolation capped at 48h so a stalled cron can't quietly
 *     drain the display forever.
 *
 * Perf + a11y contracts:
 *   · No SVG text (the hourglass-era garble class of bug is gone by
 *     construction); smallest HTML type is 10px mono labels.
 *   · No runtime randomness or clock reads in render output · deterministic
 *     bubble field, ticking starts in an effect (hydration-safe).
 *   · All motion is CSS or a coarse interval; prefers-reduced-motion
 *     stills the CSS globally and drops the tick to once a minute.
 *   · Interval pauses when the tab is hidden.
 *   · The visual (clock + bar) is one labeled role="img"; the
 *     readout tiles are real text below it for screen readers.
 *   · Fixed-light palette on a fixed-dark scene · renders identically
 *     in both themes (same convention as the 21M grid's dark backing).
 * ===================================================================== */

import { useEffect, useState } from "react";
import type { FloatSnapshot } from "@/lib/float-snapshot";
import {
  blockSubsidyAt,
  daysUntilNextHalving,
} from "@/lib/bitcoin-supply";
import {
  computeTension,
  drainPerSecond,
  projectDepletionYears,
} from "@/lib/float-urgency";
import { useSinceLastVisit } from "../hooks/useSinceLastVisit";

type Props = {
  snapshot: FloatSnapshot;
  dailyDelta: number | null;
  btcPrice?: number | null;
  isFallback?: boolean;
};

// Extrapolation ceiling · if the daily cron stalls, the clock stops
// drifting after two missed snapshots instead of draining forever.
const EXTRAPOLATION_CAP_S = 48 * 3600;

// Assumed daily demand for the pressure fallback tile · keep in sync
// with HalvingRunway's default (same sourcing, same caveat).
const DAILY_DEMAND_BTC = 2700;

// Deterministic bubble field for the molten in-play segment. Fixed
// hand-tuned values, never runtime randomness, so server and client
// render identically and re-renders never re-roll positions (same
// discipline the hourglass established · scripts/test-supply-clock
// greps the source to enforce it). left/size in %, px; dur/delay in s.
const BUBBLES = [
  { left: 8, size: 7, dur: 5.2, delay: 0 },
  { left: 22, size: 4, dur: 6.4, delay: 1.8 },
  { left: 38, size: 9, dur: 4.6, delay: 0.9 },
  { left: 55, size: 5, dur: 7.1, delay: 2.6 },
  { left: 68, size: 6, dur: 5.6, delay: 0.4 },
  { left: 82, size: 8, dur: 6.9, delay: 3.4 },
  { left: 93, size: 4, dur: 5.9, delay: 1.2 },
];

// AA-compliant dims (review 2026-07-02, shared fix with the homepage
// DirectoryConsole) · 0.66 ≈ 6:1 and 0.55 ≈ 4.7:1 over the panel floor.
const DIM = "rgba(235,225,210,0.66)";
const DIMMER = "rgba(235,225,210,0.55)";
const BRIGHT = "#f2e8d8";

function fmtInt(v: number): string {
  return Math.floor(Math.max(0, v)).toLocaleString("en-US");
}

function fmtDec2(v: number): string {
  const clamped = Math.max(0, v);
  return Math.floor((clamped - Math.floor(clamped)) * 100)
    .toString()
    .padStart(2, "0");
}

/* The machined digit row. Each digit lives in its own glass window;
 * the cell KEY includes the digit value, so a change remounts the
 * cell and replays the .sc-digit flash exactly once. Separators and
 * decimals are lighter, panel-less type. Decimals hide on mobile so
 * the integer stays huge where the fold is tight. */
function ClockFace({ int, dec }: { int: string; dec: string }) {
  return (
    <div
      aria-hidden
      className="flex items-end justify-center select-none"
      style={{ fontSize: "clamp(2.05rem, 8.4vw, 4.4rem)" }}
    >
      <div className="flex items-stretch gap-[0.055em]">
        {int.split("").map((ch, i) =>
          ch === "," ? (
            <span
              key={`s${i}`}
              className="flex items-end pb-[0.1em] font-mono font-bold leading-none text-[0.5em]"
              style={{ color: "rgba(255,217,160,0.5)" }}
            >
              ,
            </span>
          ) : (
            <span
              key={`d${i}:${ch}`}
              className="sc-digit sc-cell flex items-center justify-center font-mono font-bold leading-none rounded-[0.12em]"
              style={{ width: "0.76em", height: "1.3em" }}
            >
              {ch}
            </span>
          ),
        )}
      </div>
      {/* spinning decimals · the debt-clock life sign. sm+ only. */}
      <div className="hidden sm:flex items-end pb-[0.1em] pl-[0.09em]">
        <span
          className="font-mono font-bold leading-none text-[0.44em]"
          style={{ color: "rgba(255,217,160,0.5)" }}
        >
          .
        </span>
        {dec.split("").map((ch, i) => (
          <span
            key={`x${i}:${ch}`}
            className="sc-digit font-mono font-bold leading-none text-[0.44em] text-center"
            style={{ width: "0.72em" }}
          >
            {ch}
          </span>
        ))}
      </div>
      <span
        className="flex items-end pb-[0.12em] pl-[0.16em] font-mono font-semibold leading-none text-[0.32em] tracking-[0.08em]"
        style={{ color: "rgba(255,217,160,0.65)" }}
      >
        BTC
      </span>
    </div>
  );
}

export function SupplyClock({
  snapshot,
  dailyDelta,
  btcPrice = null,
  isFallback = false,
}: Props) {
  const perSec = drainPerSecond(dailyDelta);
  const canTick = !isFallback && perSec > 0;

  // SSR + first client paint show the exact stored snapshot (no
  // hydration mismatch); the extrapolating tick starts after mount.
  const [display, setDisplay] = useState<number>(snapshot.inPlay);

  useEffect(() => {
    if (!canTick) {
      setDisplay(snapshot.inPlay);
      return;
    }
    const anchorMs = Date.parse(snapshot.asOf);
    if (!Number.isFinite(anchorMs)) return;
    const compute = () => {
      const elapsedS = Math.min(
        Math.max((Date.now() - anchorMs) / 1000, 0),
        EXTRAPOLATION_CAP_S,
      );
      setDisplay(Math.max(0, snapshot.inPlay - perSec * elapsedS));
    };
    compute();
    // Reduced motion: still honest (value updates) but calm · once a
    // minute instead of ~7 fps, and the CSS flash is already stilled.
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stepMs = reduced ? 60_000 : 150;
    let id = window.setInterval(compute, stepMs);
    const onVis = () => {
      window.clearInterval(id);
      if (!document.hidden) {
        compute();
        id = window.setInterval(compute, stepMs);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [canTick, perSec, snapshot.inPlay, snapshot.asOf]);

  const since = useSinceLastVisit(snapshot.inPlay);

  // ── Derived readings (all from props, all null-safe) ──────────────
  const total = snapshot.totalSupply;
  const c = snapshot.cohorts;
  const lostHeld = c.lost + c.lthOther;
  // Bar WIDTH still sums missing live cohorts as 0 (a null has no
  // pixels). Labels must not quote that 0 as a reading — those
  // slices are syncing, and lthOther has already absorbed them.
  const institutions =
    (c.governments ?? 0) + (c.etfs ?? 0) + (c.publicCompanies ?? 0);
  const liveUnknown =
    c.governments == null || c.etfs == null || c.publicCompanies == null;
  const pctOfTotal = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const mined = snapshot.minedSupply;
  const lockedOfMinedPct =
    mined > 0 ? ((mined - snapshot.inPlay) / mined) * 100 : null;

  const runwayYears = projectDepletionYears(snapshot.inPlay, dailyDelta);
  const issuancePerDay = blockSubsidyAt(snapshot.blockHeight) * 144;
  const demandRatio =
    issuancePerDay > 0 ? DAILY_DEMAND_BTC / issuancePerDay : null;
  const halvingDays = daysUntilNextHalving(snapshot.blockHeight);

  // Tension scales the molten glow · calm at healthy fill, hotter as
  // the float genuinely thins (lib guardrail: no crying wolf).
  const tension = computeTension(total > 0 ? snapshot.inPlay / total : 1);

  const lamp = isFallback
    ? { label: "BASELINE", pulse: false }
    : dailyDelta == null
      ? { label: "SYNCING", pulse: false }
      : dailyDelta >= 0
        ? { label: "REFILLING", pulse: true }
        : { label: "DRAINING", pulse: true };

  const usdInPlay =
    btcPrice != null && Number.isFinite(btcPrice) && btcPrice > 0
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 0,
        }).format(snapshot.inPlay * btcPrice)
      : null;

  // A11y: two NARROW role="img" scopes (the clock digits, the strata
  // bar) so everything textual around them (sub-label, USD line,
  // legend, tiles) stays real, screen-reader-readable text. Review
  // 2026-06-29: an earlier draft wrapped legend + USD inside one big
  // figure, silently hiding the cohort split and the dollar figure
  // from screen readers.
  const clockLabel =
    `${fmtInt(snapshot.inPlay)} bitcoin still in play` +
    (canTick ? ", and falling" : "") +
    (dailyDelta != null && dailyDelta < 0
      ? `. The float shrank by ${fmtInt(-dailyDelta)} bitcoin yesterday.`
      : ".");
  const barLabel = liveUnknown
    ? `Of all 21 million bitcoin: ${pctOfTotal(snapshot.inPlay).toFixed(1)} percent still in play, ` +
      `${pctOfTotal(c.yetToMine).toFixed(1)} percent not yet mined. ` +
      `ETF, government and public company holdings are syncing and are not shown as zero.`
    : `Of all 21 million bitcoin: ${pctOfTotal(lostHeld).toFixed(1)} percent lost or held long term, ` +
      `${pctOfTotal(institutions).toFixed(1)} percent with ETFs, governments and public companies, ` +
      `${pctOfTotal(snapshot.inPlay).toFixed(1)} percent still in play, ` +
      `${pctOfTotal(c.yetToMine).toFixed(1)} percent not yet mined.`;

  const strata: {
    key: string;
    label: string;
    btc: number;
    style: React.CSSProperties;
    swatch: React.CSSProperties;
  }[] = [
    {
      key: "lostHeld",
      label: "LOST + HELD",
      btc: lostHeld,
      style: {
        background:
          "repeating-linear-gradient(135deg, rgba(0,0,0,0.3) 0 6px, transparent 6px 13px), linear-gradient(180deg, #20150c 0%, #0f0a06 100%)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      },
      swatch: { background: "#20150c", border: "1px solid rgba(255,255,255,0.14)" },
    },
    {
      key: "institutions",
      label: "ETF + GOV + CO",
      btc: institutions,
      style: {
        background: "linear-gradient(180deg, #33200f 0%, #1a1108 100%)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      },
      swatch: { background: "#33200f", border: "1px solid rgba(255,255,255,0.14)" },
    },
    {
      key: "inPlay",
      label: "STILL IN PLAY",
      btc: snapshot.inPlay,
      style: {}, // molten segment renders its own layers below
      swatch: {
        background: "linear-gradient(180deg, #ffd9a0, #F7931A)",
        boxShadow: "0 0 8px rgba(247,147,26,0.5)",
      },
    },
    {
      key: "unmined",
      label: "UNMINED",
      btc: c.yetToMine,
      style: {
        background:
          "repeating-linear-gradient(135deg, rgba(255,217,160,0.10) 0 4px, transparent 4px 9px)",
        borderLeft: "1px dashed rgba(255,217,160,0.3)",
      },
      swatch: {
        background: "transparent",
        border: "1px dashed rgba(255,217,160,0.45)",
      },
    },
  ];

  return (
    // sc-scene marks this as a FIXED-DARK room. globals.css gives .sc-cell
    // a warm daylight seating in light theme (it is milled into a cream
    // panel on /hashrate); inside a night scene that would be a light
    // leak, so this class opts the digits back into the night seating.
    <div
      className="sc-scene relative rounded-2xl p-[1.5px]"
      style={{
        background:
          "linear-gradient(165deg, #8a7f6d 0%, #57514a 16%, #2a2622 42%, #131110 78%, #26221d 100%)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.06), 0 18px 50px -18px rgba(0,0,0,0.75), 0 0 60px -24px rgba(247,147,26,0.35)",
      }}
    >
      <div
        className="relative overflow-hidden rounded-[15px] px-4 pt-4 pb-5 sm:px-8 sm:pt-6 sm:pb-7"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #1d130c 0%, #120b07 45%, #0a0605 100%)",
        }}
      >
        {/* warm ambient bloom behind the clock face */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-6 h-56 sm:h-64"
          style={{
            background:
              "radial-gradient(58% 70% at 50% 42%, rgba(247,147,26,0.17) 0%, rgba(247,147,26,0.05) 55%, transparent 78%)",
          }}
        />

        {/* 1 · status rail */}
        <div className="relative flex items-center justify-between gap-3 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.24em]">
          <span style={{ color: DIM }}>⌬ The Bitcoin Float</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5" style={{ color: "#FFC56F" }}>
              <span className="relative flex h-2 w-2">
                {lamp.pulse && (
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                    style={{ background: "#F7931A" }}
                  />
                )}
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{
                    background: lamp.pulse ? "#F7931A" : "rgba(247,147,26,0.45)",
                  }}
                />
              </span>
              {lamp.label}
            </span>
            <span className="hidden sm:inline tabular-nums" style={{ color: DIMMER }}>
              Block {snapshot.blockHeight.toLocaleString("en-US")}
            </span>
          </span>
        </div>

        {/* 2 + 3 · the clock and the strata bar. role="img" scopes are
            deliberately NARROW (digits, bar) · sub-label, USD line and
            legend remain real text for screen readers. */}
        <div className="relative">
          <div className="mt-5 sm:mt-6">
            <div role="img" aria-label={clockLabel}>
              <ClockFace int={fmtInt(display)} dec={fmtDec2(display)} />
            </div>
            <div
              className="mt-2.5 text-center font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.28em]"
              style={{ color: DIM }}
            >
              Bitcoin still in play · of 21,000,000 ever
            </div>
            {usdInPlay && (
              <div
                className="mt-1.5 text-center font-mono t-xs sm:text-xs tabular-nums"
                style={{ color: DIMMER }}
              >
                {/* single template literal · a JSX line break after the
                    expression silently eats the following space (the
                    check-jsx-whitespace class of bug) */}
                {`≈ $${usdInPlay} of bitcoin still purchasable at today's spot`}
              </div>
            )}
          </div>

          {/* the 21M strata bar · its own narrow figure */}
          <div className="mt-6 sm:mt-7">
            <div
              role="img"
              aria-label={barLabel}
              className="relative h-[64px] sm:h-[80px] rounded-lg overflow-hidden"
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                background: "#0a0705",
                boxShadow:
                  "inset 0 2px 10px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div className="flex h-full">
                {strata.map((s) =>
                  s.key === "inPlay" ? (
                    <div
                      key={s.key}
                      className="relative h-full overflow-hidden"
                      style={{
                        width: `${pctOfTotal(s.btc)}%`,
                        background:
                          "linear-gradient(180deg, #ffd9a0 0%, #F7931A 42%, #a34a08 78%, #7a3505 100%)",
                        boxShadow: `0 0 ${18 + 22 * tension}px rgba(247,147,26,${(0.28 + 0.3 * tension).toFixed(2)}), inset 0 1px 0 rgba(255,246,230,0.55)`,
                      }}
                    >
                      {/* volume + depth */}
                      <div
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                          background:
                            "radial-gradient(120% 90% at 50% 8%, rgba(255,206,134,0.34) 0%, rgba(247,147,26,0) 52%, rgba(77,33,3,0.55) 100%)",
                        }}
                      />
                      {/* deterministic rising bubbles */}
                      {BUBBLES.map((b, i) => (
                        <span
                          key={i}
                          aria-hidden
                          className="sc-bubble"
                          style={
                            {
                              left: `${b.left}%`,
                              width: b.size,
                              height: b.size,
                              "--hg-rise": "78px",
                              "--hg-dur": `${b.dur}s`,
                              "--hg-delay": `${b.delay}s`,
                            } as React.CSSProperties
                          }
                        />
                      ))}
                      {/* slow specular sweep */}
                      <span
                        aria-hidden
                        className="sc-sheen absolute inset-y-0 left-0 w-1/3"
                        style={{
                          background:
                            "linear-gradient(90deg, transparent, rgba(255,243,214,0.30), transparent)",
                        }}
                      />
                      {/* engraved label · dark on molten, md+ only */}
                      <span
                        className="absolute inset-0 hidden md:flex items-center justify-center font-mono t-xs font-bold uppercase tracking-[0.22em]"
                        style={{ color: "rgba(42,19,0,0.85)" }}
                      >
                        In play
                      </span>
                    </div>
                  ) : (
                    <div
                      key={s.key}
                      className="h-full"
                      style={{ width: `${pctOfTotal(s.btc)}%`, ...s.style }}
                    />
                  ),
                )}
              </div>
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{ background: "rgba(255,255,255,0.10)" }}
              />
            </div>

            {/* legend · matches the 21M grid's cohort language */}
            <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1.5 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.16em]">
              {strata.map((s) => (
                <span key={s.key} className="flex items-baseline gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 self-center rounded-[3px]"
                    style={s.swatch}
                  />
                  <span style={{ color: DIMMER }}>{s.label}</span>
                  <span className="tabular-nums" style={{ color: BRIGHT }}>
                    {s.key === "institutions" && liveUnknown
                      ? "syncing"
                      : `${pctOfTotal(s.btc).toFixed(1)}%`}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* since-your-last-visit · personal drain receipt */}
        {since && (
          <div className="relative mt-4 text-center">
            <span
              className="inline-block rounded-full border px-3 py-1 font-mono t-xs uppercase tracking-[0.18em]"
              style={{
                color: "#FFC56F",
                borderColor: "rgba(247,147,26,0.35)",
                background: "rgba(247,147,26,0.08)",
              }}
            >
              ▼ {since.deltaBTC.toLocaleString("en-US")} BTC left the float since
              your last visit
            </span>
          </div>
        )}

        {/* 4 · urgency readouts */}
        <div
          className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-lg"
          style={{ background: "rgba(255,255,255,0.07)" }}
        >
          <ReadoutTile
            label="Spoken for"
            value={lockedOfMinedPct != null ? `${lockedOfMinedPct.toFixed(1)}%` : "···"}
            sub={
              lockedOfMinedPct != null
                ? "of every mined coin is locked away"
                : "computing"
            }
          />
          <ReadoutTile
            label="Net flow"
            value={
              dailyDelta == null
                ? "···"
                : dailyDelta < 0
                  ? `▼ ${fmtInt(-dailyDelta)}`
                  : `▲ ${fmtInt(dailyDelta)}`
            }
            sub={
              dailyDelta == null
                ? "first snapshots accumulating"
                : dailyDelta < 0
                  ? "BTC left the float yesterday"
                  : "BTC returned yesterday"
            }
          />
          {runwayYears != null ? (
            <ReadoutTile
              label="Runway*"
              value={`≈ ${runwayYears.toFixed(1)} yrs`}
              sub="until in-play hits zero at that pace"
            />
          ) : (
            <ReadoutTile
              label="Pressure"
              value={demandRatio != null ? `${demandRatio.toFixed(1)}×` : "···"}
              sub="daily demand vs newly mined supply"
            />
          )}
          <ReadoutTile
            label="The next cut"
            value={`${halvingDays.toLocaleString("en-US")} days`}
            sub={`new supply drops ${fmtInt(issuancePerDay)} → ${fmtInt(issuancePerDay / 2)} BTC/day`}
          />
        </div>
        {runwayYears != null && (
          <p
            className="relative mt-2 font-mono t-xs tracking-[0.06em]"
            style={{ color: DIMMER }}
          >
            * straight-line thought experiment at yesterday&apos;s pace, not a
            forecast · methodology below
          </p>
        )}

        {/* bottom rail · nameplate kept far from any ornament, on purpose */}
        <div
          className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3 font-mono t-xs uppercase tracking-[0.24em]"
          style={{ borderColor: "rgba(255,255,255,0.07)", color: DIMMER }}
        >
          <span>Galaxy Mind · Supply Clock</span>
          <span className="normal-case tracking-[0.04em]">
            {isFallback
              ? "static baseline · awaiting the first live snapshot"
              : canTick
                ? "live estimate · extrapolated between daily snapshots"
                : "daily snapshot · live extrapolation resumes with the next one"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ReadoutTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      className="px-3 py-3 sm:px-4 sm:py-3.5"
      style={{ background: "#100a06" }}
    >
      <div
        className="font-mono t-xs uppercase tracking-[0.22em]"
        style={{ color: DIMMER }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-mono text-lg sm:text-xl font-bold tabular-nums leading-none"
        style={{ color: BRIGHT }}
      >
        {value}
      </div>
      <div
        className="mt-1 font-mono t-xs leading-snug"
        style={{ color: DIM }}
      >
        {sub}
      </div>
    </div>
  );
}
