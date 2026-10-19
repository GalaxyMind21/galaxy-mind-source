"use client";

/* =====================================================================
 * Reveal · the mask comes off (Gauntlet v2).
 *
 * The whole run was played blind: real prices, hidden calendar. This
 * is the payoff screen · the chart redraws itself full-window, the
 * REAL dates fade onto the axis, named history pins itself (FTX, the
 * halving, the ETF day), and every trade the player made is plotted
 * against what actually happened. Then the benchmark race: player vs
 * the DCA bot vs the no-coiner, and the tier stamp.
 *
 * All choreography is CSS animation-delay stagger · declarative, no
 * rAF, and prefers-reduced-motion collapses every delay to zero via
 * the .g2-anim rules in globals.css.
 * ===================================================================== */

import { track } from "@vercel/analytics";
import {
  CTX_DAYS,
  RUN_DAYS,
  type FinalReport,
  type GameState,
  type RunSetup,
  coachLine,
  shareText,
} from "./engine";
import { useEffect, useState } from "react";
import { getHandle } from "@/lib/arcade";
import { encodeGauntletCard } from "@/lib/run-card";
import { nostrShareVariant, withAttribution } from "@/lib/share-templates";

const W = 100;
const H = 40;

const DIM = "rgba(235,225,210,0.55)";
const DIM2 = "rgba(235,225,210,0.66)";

function fmtUsd(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-US");
}

function monthLabel(t: number): string {
  return new Date(t * 1000).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "2-digit",
  });
}

export function Reveal({
  setup,
  state,
  report,
  streak,
  newBadges,
  boardRank,
  onAgain,
}: {
  setup: RunSetup;
  state: GameState;
  report: FinalReport;
  streak: number;
  newBadges: string[];
  /** Today's public-board rank · null until the score post returns it. */
  boardRank: number | null;
  onAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Full-window geometry (context + run), log-free linear scale.
  const prices = setup.prices;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prices) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const X = (i: number) => (i / (prices.length - 1)) * W;
  const Y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  let d = "";
  for (let i = 0; i < prices.length; i++) {
    d += (i === 0 ? "M" : "L") + X(i).toFixed(2) + " " + Y(prices[i]).toFixed(2);
  }
  const runX0 = X(CTX_DAYS);

  // Date axis · run start, three interior quarter marks, run end.
  const axis = [0, 60, 120, 180, RUN_DAYS].map((day) => ({
    x: X(CTX_DAYS + day),
    label: monthLabel(setup.times[CTX_DAYS + day]),
  }));

  const benchMax = Math.max(report.youFinal, report.dcaFinal, report.cashFinal);
  const bench = [
    { label: "YOU", value: report.youFinal, color: "var(--accent)" },
    { label: "DCA BOT", value: report.dcaFinal, color: "#31C48D" },
    { label: "NO-COINER", value: report.cashFinal, color: "#8C8C96" },
  ];

  // Daily runs post to the board · include the player's handle + rank
  // in the share. Practice runs are unscored, so no handle line.
  const baseText =
    setup.mode === "daily"
      ? shareText(report, setup.number, streak, {
          handle: getHandle(),
          rank: boardRank,
        })
      : shareText(report, setup.number, streak);
  // Swap the trailing bare /gauntlet URL for a per-run card link · X
  // unfurls its dynamic OG image into a preview of THIS result, and the
  // page it lands on has a Play button (lib/run-card + /gauntlet/card).
  const cardUrl =
    "galaxymind.space/gauntlet/card/" +
    encodeGauntletCard({
      tier: report.tier,
      alpha: report.alpha,
      number: setup.mode === "daily" ? setup.number : null,
      rank: setup.mode === "daily" ? boardRank : null,
      handle: setup.mode === "daily" ? getHandle() : null,
      liquidated: state.liquidated,
    });
  const text = baseText.replace("galaxymind.space/gauntlet", cardUrl);
  // X gets the @GalaxyMind attribution line; the clipboard variants
  // (Copy result / Copy for Nostr) stay handle-free · a pasted note on
  // Nostr with an X @ reads wrong there (share-templates.ts).
  const intent =
    "https://x.com/intent/tweet?text=" +
    encodeURIComponent(withAttribution(text));

  // Delight moment · the reveal mounting means a run just finished, the
  // best time to invite a home-screen install (InstallNudge · 2026-07-10).
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
    } catch {
      /* no window · ignore */
    }
  }, []);

  function copyGrid() {
    try {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
          track("gauntlet2_copy");
        },
        () => {
          /* write rejected (permission/focus) · never claim success */
        },
      );
    } catch {
      /* clipboard unavailable · button just doesn't confirm */
    }
  }

  // Nostr hand-off · hashtag variant to the clipboard (no compose-
  // intent URL standard across Nostr clients; same pattern as the
  // submit-success screen and WEN).
  const [copiedNostr, setCopiedNostr] = useState(false);
  function copyNostr() {
    try {
      navigator.clipboard.writeText(nostrShareVariant(text)).then(
        () => {
          setCopiedNostr(true);
          setTimeout(() => setCopiedNostr(false), 1600);
          track("gauntlet2_copy_nostr");
        },
        () => {
          /* write rejected · never claim success */
        },
      );
    } catch {
      /* clipboard unavailable */
    }
  }

  // Challenge links (practice only) · seed + mint-day, base36. The
  // recipient's client shifts the seeded window back by the days
  // elapsed, landing on this exact stretch of history.
  const [challenged, setChallenged] = useState(false);
  function copyChallenge() {
    const day = Math.floor(Date.now() / 86_400_000).toString(36);
    const url = `https://galaxymind.space/gauntlet?w=${setup.seed.toString(36)}.${day}&a=${report.alpha.toFixed(1)}`;
    const dare = `I traded a hidden window of actual bitcoin history blind and finished ${report.alpha >= 0 ? "+" : ""}${report.alpha.toFixed(1)}% vs the DCA bot.\n\nSame window, same bills, dates masked. Beat me:\n${url}`;
    try {
      navigator.clipboard.writeText(dare).then(
        () => {
          setChallenged(true);
          setTimeout(() => setChallenged(false), 1600);
          track("gauntlet2_challenge_mint");
        },
        () => {
          /* write rejected · never claim success */
        },
      );
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="px-4 sm:px-6 py-5 max-h-full overflow-y-auto">
      {/* The unmasking line */}
      <div
        className="micro-label g2-anim mb-1"
        style={{ color: DIM, animationDelay: "0.1s" }}
      >
        The mask comes off
      </div>
      <div
        className="g2-anim text-lg sm:text-xl font-semibold mb-3"
        style={{ color: "#F2EFE9", animationDelay: "0.3s" }}
      >
        You were trading{" "}
        <span className="text-[var(--accent)]">
          {report.windowStartIso} → {report.windowEndIso}
        </span>
      </div>

      {/* Full-window chart · draw-on, then annotations */}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + 6}`} preserveAspectRatio="none" className="w-full h-[250px] sm:h-[320px] block" aria-hidden>
          {/* context zone shade */}
          <rect x="0" y="0" width={runX0} height={H} fill="rgba(235,225,210,0.05)" />
          <path
            d={d}
            fill="none"
            stroke="#F7931A"
            strokeWidth="0.55"
            strokeLinejoin="round"
            pathLength={1}
            className="g2-draw"
            style={{ filter: "drop-shadow(0 0 2.5px rgba(247,147,26,0.55))" }}
          />
          {/* run-start divider */}
          <line x1={runX0} y1="0" x2={runX0} y2={H} stroke={DIM} strokeWidth="0.18" strokeDasharray="0.8 0.8" />
          {/* era markers */}
          {report.eras.map((era, i) => {
            const x = X(CTX_DAYS + era.runDay);
            return (
              <g key={era.iso} className="g2-anim" style={{ animationDelay: `${1.3 + i * 0.18}s` }}>
                <line x1={x} y1="1.5" x2={x} y2={H} stroke="#ff3a4f" strokeWidth="0.2" strokeDasharray="0.7 0.7" opacity="0.75" />
              </g>
            );
          })}
          {/* trades */}
          {state.trades.map((t, i) => {
            const x = X(CTX_DAYS + t.day);
            const y = Y(t.price);
            const delay = `${1.7 + i * 0.06}s`;
            if (t.kind === "buy" || t.kind === "margin-open") {
              return (
                <path key={i} className="g2-anim" style={{ animationDelay: delay }} d={`M${x} ${y + 1.2}l1 1.8h-2z`} fill={t.kind === "buy" ? "#31C48D" : "#7ec0ff"} />
              );
            }
            if (t.kind === "liq") {
              return (
                <g key={i} className="g2-anim" style={{ animationDelay: delay }} stroke="#ff3a4f" strokeWidth="0.4">
                  <line x1={x - 0.9} y1={y - 0.9} x2={x + 0.9} y2={y + 0.9} />
                  <line x1={x - 0.9} y1={y + 0.9} x2={x + 0.9} y2={y - 0.9} />
                </g>
              );
            }
            return (
              <path key={i} className="g2-anim" style={{ animationDelay: delay }} d={`M${x} ${y - 1.2}l1 -1.8h-2z`} fill={t.kind === "forced" ? "#FB923C" : "#ff3a4f"} />
            );
          })}
          {/* date axis */}
          {axis.map((a, i) => (
            <text key={i} x={Math.min(Math.max(a.x, 3), W - 3)} y={H + 4.5} textAnchor="middle" fontSize="2.6" fill={DIM} className="g2-anim" style={{ animationDelay: `${0.9 + i * 0.1}s`, fontFamily: "monospace" }}>
              {a.label}
            </text>
          ))}
        </svg>
        {/* era labels · HTML chips over the svg for legibility */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {report.eras.map((era, i) => (
            <div
              key={era.iso}
              className="micro-label g2-anim absolute px-1.5 py-0.5 rounded border"
              style={{
                left: `${Math.min(84, Math.max(1, ((CTX_DAYS + era.runDay) / (prices.length - 1)) * 100 - 4))}%`,
                top: `${6 + (i % 3) * 15}%`,
                color: "#ff8a95",
                borderColor: "rgba(255,58,79,0.5)",
                background: "rgba(10,6,5,0.85)",
                animationDelay: `${1.3 + i * 0.18}s`,
              }}
            >
              {era.label}
            </div>
          ))}
        </div>
      </div>

      {/* Legend for the trade glyphs */}
      <div className="micro-label g2-anim flex flex-wrap gap-x-4 gap-y-1 mt-1" style={{ color: DIM, animationDelay: "1.9s" }}>
        <span><span style={{ color: "#31C48D" }}>▲</span> buy</span>
        <span><span style={{ color: "#ff3a4f" }}>▼</span> sell</span>
        <span><span style={{ color: "#FB923C" }}>▼</span> forced sale</span>
        <span><span style={{ color: "#7ec0ff" }}>▲</span> margin</span>
        {state.liquidated && <span><span style={{ color: "#ff3a4f" }}>✕</span> liquidated</span>}
      </div>

      {/* Benchmark race */}
      <div className="mt-5 space-y-2">
        {bench.map((b, i) => (
          <div key={b.label} className="g2-anim flex items-center gap-3" style={{ animationDelay: `${2.1 + i * 0.15}s` }}>
            <span className="micro-label w-24 shrink-0" style={{ color: DIM2 }}>
              {b.label}
            </span>
            <div className="flex-1 h-4 rounded-sm overflow-hidden" style={{ background: "rgba(235,225,210,0.08)" }}>
              <div
                className="h-full rounded-sm g2-bar"
                style={{
                  width: `${Math.max(2, (b.value / benchMax) * 100)}%`,
                  background: b.color,
                  boxShadow: `0 0 10px -2px ${b.color}`,
                }}
              />
            </div>
            <span className="font-mono text-sm tabular-nums w-20 text-right shrink-0" style={{ color: "#F2EFE9" }}>
              {fmtUsd(b.value)}
            </span>
          </div>
        ))}
      </div>

      {/* Stamp + verdict */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div
          className="g2-stamp inline-block px-5 py-2.5 rounded-lg border-2 font-mono text-xl sm:text-2xl font-bold tracking-[0.15em]"
          style={{
            color: report.tierTone,
            borderColor: report.tierTone,
            textShadow: `0 0 18px ${report.tierTone}`,
            transform: "rotate(-3deg)",
          }}
        >
          {report.tier}
        </div>
        <div>
          <div className="font-mono text-lg tabular-nums" style={{ color: "#F2EFE9" }}>
            {report.alpha >= 0 ? "+" : ""}
            {report.alpha.toFixed(1)}% vs the DCA bot
          </div>
          <div className="micro-label" style={{ color: DIM }}>
            {report.grid}
            {setup.number != null && streak > 1 ? ` · streak ${streak}` : ""}
          </div>
          {setup.mode === "daily" && boardRank != null && (
            <div className="micro-label mt-0.5" style={{ color: "var(--accent)" }}>
              #{boardRank} on today&apos;s board · played as {getHandle()}
            </div>
          )}
        </div>
      </div>

      <p className="g2-anim mt-3 text-sm leading-relaxed max-w-xl" style={{ color: DIM2, animationDelay: "2.7s" }}>
        {report.alpha > 0
          ? "You beat the bot that never thinks. Genuinely rare · most runs end the other way. Screenshot it, because the tape does not owe you a repeat."
          : "The bot that never thinks beat you. It has no feed, no fear, and no opinion · it just bought every payday. That is the whole thesis, played out on your own trades."}
      </p>

      {/* The personalized lesson · names the single most costly move so
          a loss teaches instead of just stinging (games audit
          2026-07-09). This is the "one more run" hook. */}
      <div
        className="g2-anim mt-4 max-w-xl rounded-lg border-l-2 px-4 py-3"
        style={{
          animationDelay: "3.05s",
          borderColor: "var(--accent)",
          background: "rgba(247,147,26,0.06)",
        }}
      >
        <div className="font-mono t-xs uppercase tracking-[0.22em] mb-1" style={{ color: "var(--accent-ink)" }}>
          Your tell
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "#F2EFE9" }}>
          {coachLine(state, setup, report)}
        </p>
      </div>

      {/* Badges */}
      {report.badges.length > 0 && (
        <div className="g2-anim mt-4 flex flex-wrap gap-2" style={{ animationDelay: "2.9s" }}>
          {report.badges.map((b) => (
            <span
              key={b.id}
              title={b.hint}
              className="micro-label px-2 py-1 rounded border"
              style={{
                color: newBadges.includes(b.id) ? "var(--accent)" : DIM2,
                borderColor: newBadges.includes(b.id)
                  ? "rgba(247,147,26,0.6)"
                  : "rgba(235,225,210,0.2)",
              }}
            >
              {newBadges.includes(b.id) ? "◆ " : ""}
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="g2-anim mt-5 flex flex-wrap gap-2" style={{ animationDelay: "3.1s" }}>
        <a
          href={intent}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("gauntlet2_share", { mode: setup.mode })}
          className="px-6 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
        >
          Share on X →
        </a>
        <button
          type="button"
          onClick={copyNostr}
          className="micro-label px-5 py-2.5 rounded-lg border transition-all hover:border-[var(--accent)]"
          style={{ borderColor: "rgba(235,225,210,0.25)", color: "#F2EFE9" }}
        >
          {copiedNostr ? "Copied" : "Copy for Nostr"}
        </button>
        <button
          type="button"
          onClick={copyGrid}
          className="micro-label px-5 py-2.5 rounded-lg border transition-all hover:border-[var(--accent)]"
          style={{ borderColor: "rgba(235,225,210,0.25)", color: "#F2EFE9" }}
        >
          {copied ? "Copied" : "Copy result"}
        </button>
        {setup.mode === "practice" && (
          <button
            type="button"
            onClick={copyChallenge}
            className="micro-label px-5 py-2.5 rounded-lg border transition-all"
            style={{ borderColor: "rgba(126,192,255,0.5)", color: "#7ec0ff" }}
            title="Copies a link that loads this exact hidden window for a friend"
          >
            {challenged ? "Link copied" : "Challenge a friend"}
          </button>
        )}
        <button
          type="button"
          onClick={onAgain}
          className="micro-label px-5 py-2.5 rounded-lg border transition-all hover:border-[var(--accent)]"
          style={{ borderColor: "rgba(235,225,210,0.25)", color: "#F2EFE9" }}
        >
          {setup.mode === "daily" ? "Practice a random window" : "Run another window"}
        </button>
        <a
          href="/today"
          className="micro-label px-5 py-2.5 rounded-lg border transition-all hover:border-[var(--accent)]"
          style={{ borderColor: "rgba(247,147,26,0.45)", color: "var(--accent)" }}
        >
          See today&apos;s numbers →
        </a>
        <a
          href="/runner"
          className="micro-label px-5 py-2.5 rounded-lg border transition-all"
          style={{ borderColor: "rgba(235,225,210,0.2)", color: DIM2 }}
        >
          Runner arcade
        </a>
      </div>
    </div>
  );
}
