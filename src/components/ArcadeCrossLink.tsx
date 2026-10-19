// The arcade's "other cabinets" strip (operator request 2026-07-09;
// widened to all games as cabinets land). Each game page carries an
// unmissable door to its siblings, directly under the cabinet where
// a finished run leaves the player's eyes.
// Server component · plain links, zero client JS.

import Link from "next/link";
import { isStaticHtmlRoute } from "@/lib/nav";

const GAMES = {
  saylor: {
    href: "/super-saylor",
    name: "SUPER SAYLOR",
    pitch: "The flagship · a Mario-style run through 21 levels of bitcoin history, Peter Schiff at the summit.",
    cta: "Play Super Saylor",
  },
  kart: {
    href: "/bitcoin-kart",
    name: "BITCOIN KART",
    pitch: "The 3D racer · one chair, twelve tracks of bitcoin history, no second best.",
    cta: "Play Bitcoin Kart",
  },
  chop: {
    href: "/chop",
    name: "CHOP",
    pitch: "Slice today's live bitcoin block · every cube is an actual transaction.",
    cta: "Play CHOP",
  },
  gauntlet: {
    href: "/gauntlet",
    name: "The Bitcoin Gauntlet",
    pitch: "Trade a hidden window of actual history against the DCA bot · one scored run a day.",
    cta: "Enter the Gauntlet",
  },
  runner: {
    href: "/runner",
    name: "Node Runner",
    pitch: "One tap, actual candles as terrain · reach the present and you go to the moon.",
    cta: "Play Node Runner",
  },
  horizon: {
    href: "/horizon",
    name: "Timechain",
    pitch: "One tap to stack the next block · every 21 blocks the reward halves and the chain speeds up.",
    cta: "Play Timechain",
  },
  wen: {
    href: "/wen",
    name: "WEN",
    pitch: "An actual 90-day slice of the tape, dates redacted · five guesses at wen it was.",
    cta: "Play WEN",
  },
  trail: {
    href: "/trail",
    name: "THE HODL TRAIL",
    pitch: "Lead four plebs through 15 years of bitcoin history · one expedition a day, scored in sats.",
    cta: "Ride the Trail",
  },
} as const;

type GameKey = keyof typeof GAMES;

// Stable display order so the sibling cards keep the same arrangement
// across pages.
const ORDER: GameKey[] = ["saylor", "kart", "chop", "trail", "wen", "gauntlet", "runner", "horizon"];

export function ArcadeCrossLink({ from }: { from: GameKey }) {
  const others = ORDER.filter((k) => k !== from);
  return (
    <div
      className={`mt-4 grid gap-3 ${others.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {others.map((k) => {
        const g = GAMES[k];
        return (
          <Link
            key={k}
            href={g.href}
            prefetch={isStaticHtmlRoute(g.href) ? false : undefined}
            className="group flex flex-col gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-4 transition-colors hover:border-[var(--accent)]/50"
          >
            <span className="font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              Another cabinet
            </span>
            <span className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
              {g.name}
            </span>
            <span className="text-sm text-[var(--text-secondary)]">
              {g.pitch}
            </span>
            <span className="mt-1 t-xs font-medium text-[var(--accent-ink)] group-hover:underline">
              {g.cta} →
            </span>
          </Link>
        );
      })}
    </div>
  );
}
