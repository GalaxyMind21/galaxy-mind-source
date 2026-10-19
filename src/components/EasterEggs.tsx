"use client";

// Site-wide easter eggs. Mounted in the root layout so they live on
// every page. Listens for two triggers globally:
//
//   A. Click the ₿ brand logo 21 times (any logo, anywhere).
//      "Twenty-one. Like the supply." Triggers a full-screen orange
//      overlay with the supply curve and an asymptote at 21M.
//
//   E. Type one of the secret keywords:
//      • "saylor"     → "There is no second best." (or rotates)
//      • "21m"        → Same as logo trigger but smaller
//      • "fiat"       → Tiny ash/burn animation
//      • "moon"       → Rocket emoji animates from bottom of screen
//      • "hodl"       → "Never sell." floats in
//
//   K. The Konami code (up up down down left right left right B A)
//      → full-screen "swarm of cyber hornets" Saylor reveal.
//
// Easter egg events are tracked in Vercel Analytics so we can see
// which ones get discovered and how often.
//
// Score-based ribbons (#C) live in the StackContent component, not
// here — they need direct access to the verdict.score prop.

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import { SAYLOR_QUOTES } from "@/lib/saylor-quotes";

const LOGO_CLICK_TARGET = 21;
const KEYPRESS_BUFFER_LEN = 16;

// Konami code · canonical sequence. Arrow keys arrive as "ArrowUp"
// etc and the last two as single chars; we lowercase every key so one
// flat compare covers both. Triggers the cyber-hornets reveal.
const KONAMI: readonly string[] = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];

// Verbatim Saylor (April 2021). Operator-curated · kept here, not in
// the shared SAYLOR_QUOTES rotation, because it is the one long-form
// reveal rather than a short rotating line.
const HORNETS_QUOTE =
  "Bitcoin is a swarm of cyber hornets serving the goddess of wisdom, feeding on the fire of truth, exponentially growing ever smarter, faster, and stronger behind a wall of encrypted energy.";

const KEYWORD_QUOTES: Record<
  string,
  { text: string; subtext?: string; emoji?: string }
> = {
  saylor: {
    text: "There is no second best.",
    subtext: "· Michael Saylor",
  },
  hodl: {
    text: "Never sell. Just borrow against it.",
    subtext: "· Saylor's actual financial advice",
  },
  fiat: {
    text: "Fiat is a melting ice cube.",
    subtext: "· bitcoiner consensus, est. 2009",
    emoji: "🧊",
  },
  moon: {
    text: "Number go up.",
    subtext: "· peer-reviewed monetary theory",
    emoji: "🚀",
  },
  laser: {
    text: "Laser eyes activated.",
    subtext: "· Twitter, March 2021",
    emoji: "👁️",
  },
  pizza: {
    text: "May 22nd was 10,000 BTC.",
    subtext: "· the most expensive pizza in history",
    emoji: "🍕",
  },
};

// Single shared source · @/lib/saylor-quotes (pure data, imported by
// the loading screen, this egg, and the /float /treasuries /fit
// strips · one voice everywhere). Aliased to the existing name so
// the re-export and call sites below are unchanged.
const SAYLOR_ROTATING_QUOTES = SAYLOR_QUOTES;

export function EasterEggs() {
  const [logoClicks, setLogoClicks] = useState(0);
  const [showSupply, setShowSupply] = useState(false);
  const [showHornets, setShowHornets] = useState(false);
  const [activeQuote, setActiveQuote] = useState<{
    key: string;
    text: string;
    subtext?: string;
    emoji?: string;
  } | null>(null);

  // ----- A. Logo click counter -----
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest("[data-egg-logo]");
      if (!target) return;
      setLogoClicks((c) => {
        const next = c + 1;
        if (next === LOGO_CLICK_TARGET) {
          setShowSupply(true);
          track("easter_egg_logo_21");
          // Reset the counter so it can fire again later.
          return 0;
        }
        return next;
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Auto-dismiss the supply overlay after 5 seconds.
  useEffect(() => {
    if (!showSupply) return;
    const t = setTimeout(() => setShowSupply(false), 5000);
    return () => clearTimeout(t);
  }, [showSupply]);

  // ----- E. Keyword typing -----
  useEffect(() => {
    let buffer = "";
    function onKey(e: KeyboardEvent) {
      // Don't fire when typing in form fields — would otherwise interrupt
      // legitimate input.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t && t.isContentEditable) return;
      // Only printable single-char keys.
      if (e.key.length !== 1) return;
      buffer = (buffer + e.key.toLowerCase()).slice(-KEYPRESS_BUFFER_LEN);
      // Check each keyword. First match wins.
      for (const key of Object.keys(KEYWORD_QUOTES)) {
        if (buffer.endsWith(key)) {
          const q = KEYWORD_QUOTES[key];
          setActiveQuote({ key, ...q });
          track("easter_egg_keyword", { keyword: key });
          buffer = ""; // reset so triggering twice requires retyping
          return;
        }
      }
      // Also check "21m" or "21million" → trigger logo overlay
      if (buffer.endsWith("21m") || buffer.endsWith("21million")) {
        setShowSupply(true);
        track("easter_egg_keyword", { keyword: "21m" });
        buffer = "";
        return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ----- K. Konami code -----
  useEffect(() => {
    let seq: string[] = [];
    function onKonami(e: KeyboardEvent) {
      // Same form-field guard as the keyword listener · don't hijack
      // arrow keys while someone is editing an input.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t && t.isContentEditable) return;
      // No preventDefault · the gauge's own arrow-key nav must keep
      // working. We only ever read the rolling buffer.
      seq = [...seq, e.key.toLowerCase()].slice(-KONAMI.length);
      if (seq.length === KONAMI.length && seq.every((k, i) => k === KONAMI[i])) {
        setShowHornets(true);
        track("easter_egg_konami");
        seq = [];
      }
    }
    document.addEventListener("keydown", onKonami);
    return () => document.removeEventListener("keydown", onKonami);
  }, []);

  // Auto-dismiss the hornets reveal after 7s · longer than the other
  // eggs because it is a full sentence to read.
  useEffect(() => {
    if (!showHornets) return;
    const t = setTimeout(() => setShowHornets(false), 7000);
    return () => clearTimeout(t);
  }, [showHornets]);

  // Auto-dismiss the quote bubble after 4 seconds.
  useEffect(() => {
    if (!activeQuote) return;
    const t = setTimeout(() => setActiveQuote(null), 4000);
    return () => clearTimeout(t);
  }, [activeQuote]);

  return (
    <>
      <SupplyOverlay show={showSupply} onClose={() => setShowSupply(false)} />
      <HornetsOverlay
        show={showHornets}
        onClose={() => setShowHornets(false)}
      />
      <QuoteBubble quote={activeQuote} onClose={() => setActiveQuote(null)} />
      {/* Visual progress indicator for the 21-click trigger · only
          shown after the first click so casual visitors don't notice
          it. Once they're 5+ clicks in, the count chip appears in the
          corner to confirm something's happening. */}
      <LogoClickHint count={logoClicks} />
    </>
  );
}

// =====================================================================
// Supply overlay — full-screen "21,000,000" celebration. Shows the
// asymptotic supply curve and a Saylor quote.
// =====================================================================
function SupplyOverlay({ show, onClose }: { show: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={onClose}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(247,147,26,0.25) 0%, rgba(0,0,0,0.92) 60%)",
            }}
          />
          <motion.div
            className="relative text-center px-6"
            initial={{ scale: 0.7, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <div className="micro-label text-[var(--accent-ink)] mb-3 glow-text">
              The number that matters
            </div>
            <div
              className="font-mono text-6xl sm:text-8xl font-bold text-[var(--accent-ink)] tabular-nums mb-3"
              style={{
                textShadow:
                  "0 0 32px var(--accent), 0 0 64px rgba(247,147,26,0.5)",
              }}
            >
              21,000,000
            </div>
            <div className="font-mono text-xs sm:text-sm uppercase tracking-[0.25em] text-[var(--text-secondary)] mb-6">
              There will only ever be
            </div>
            {/* Asymptotic supply curve · climbs sharply then flattens
                to 21M. Pure SVG, no library. */}
            <svg
              viewBox="0 0 320 100"
              className="w-72 sm:w-96 mx-auto"
              aria-hidden
            >
              <defs>
                <linearGradient id="supply-line" x1="0" x2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="1" />
                </linearGradient>
              </defs>
              <motion.path
                d="M 0 95 Q 30 90 60 70 Q 100 30 160 15 Q 240 8 320 7"
                fill="none"
                stroke="url(#supply-line)"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 6px var(--accent))" }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, ease: "easeOut" }}
              />
              {/* Asymptote line */}
              <line
                x1="0"
                x2="320"
                y1="7"
                y2="7"
                stroke="rgba(247,147,26,0.3)"
                strokeWidth="0.7"
                strokeDasharray="3 3"
              />
              <text
                x="316"
                y="4"
                textAnchor="end"
                fill="rgba(247,147,26,0.6)"
                fontSize="6"
                fontFamily="ui-monospace, monospace"
              >
                21M asymptote
              </text>
            </svg>
            <div className="mt-6 t-xs text-[var(--text-tertiary)]">
              click anywhere to dismiss
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =====================================================================
// Hornets reveal — full-screen Konami-triggered "swarm of cyber
// hornets" Saylor quote. Same visual language as SupplyOverlay so the
// two big reveals read as one family. Sits on a fixed near-black
// radial regardless of site theme · the small labels therefore use
// FIXED light colors, not theme vars, so they stay legible in light
// mode too (the on-dark-surface rule · same reason the gauge dial
// doesn't use --text-secondary).
// =====================================================================
function HornetsOverlay({
  show,
  onClose,
}: {
  show: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={onClose}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(247,147,26,0.22) 0%, rgba(0,0,0,0.94) 60%)",
            }}
          />
          <motion.div
            className="relative text-center px-6 max-w-3xl"
            initial={{ scale: 0.7, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <div className="micro-label text-[var(--accent-ink)] mb-5 glow-text">
              The swarm
            </div>
            <p
              className="text-2xl sm:text-4xl font-semibold leading-snug text-[var(--accent-ink)]"
              style={{
                textShadow:
                  "0 0 24px rgba(247,147,26,0.55), 0 0 56px rgba(247,147,26,0.25)",
              }}
            >
              {HORNETS_QUOTE}
            </p>
            <div
              className="mt-6 font-mono text-xs sm:text-sm uppercase tracking-[0.25em]"
              style={{ color: "rgba(245,245,247,0.72)" }}
            >
              · Michael Saylor
            </div>
            <div
              className="micro-label mt-8"
              style={{ color: "rgba(245,245,247,0.42)" }}
            >
              click anywhere to dismiss
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =====================================================================
// Quote bubble — small floating message in the bottom-center of the
// screen. Triggered by typed keywords.
// =====================================================================
function QuoteBubble({
  quote,
  onClose,
}: {
  quote: { key: string; text: string; subtext?: string; emoji?: string } | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {quote && (
        <motion.div
          // Bottom-center, above the mobile bottom nav (which is z-40)
          className="fixed bottom-24 lg:bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-md w-[90%] sm:w-auto"
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ duration: 0.25 }}
        >
          <div
            onClick={onClose}
            className="cursor-pointer rounded-xl border border-[var(--accent)] bg-[var(--bg-elevated)] p-4 sm:p-5 shadow-2xl backdrop-blur-md"
            style={{
              boxShadow:
                "0 0 28px rgba(247,147,26,0.4), 0 0 64px rgba(247,147,26,0.15)",
            }}
            role="dialog"
            aria-label={`Easter egg: ${quote.key}`}
          >
            <div className="flex items-baseline gap-3">
              {quote.emoji && (
                <span className="text-2xl flex-shrink-0" aria-hidden>
                  {quote.emoji}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm sm:text-base text-[var(--text-primary)] leading-tight">
                  {quote.text}
                </div>
                {quote.subtext && (
                  <div className="mt-1 t-xs font-medium text-[var(--accent-ink)]">
                    {quote.subtext}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =====================================================================
// Subtle "you found something" indicator — only appears after a few
// logo clicks so determined visitors get visual feedback they're on
// the right track. Disappears after a short pause without clicks.
// =====================================================================
function LogoClickHint({ count }: { count: number }) {
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    if (count === 0) return;
    setRecent(true);
    const t = setTimeout(() => setRecent(false), 1800);
    return () => clearTimeout(t);
  }, [count]);

  // Only show when there have been clicks AND they're recent (within
  // the last 1.8s). Hides itself if you stop clicking.
  const show = recent && count >= 5 && count < LOGO_CLICK_TARGET;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed top-20 right-4 z-30 t-xs font-medium text-[var(--accent-ink)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-full px-3 py-1.5 pointer-events-none"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 0.85, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {count} / 21
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Re-exported so /stack's gauge can use the same Saylor quotes for
// score-based easter egg ribbons.
export { SAYLOR_ROTATING_QUOTES };
