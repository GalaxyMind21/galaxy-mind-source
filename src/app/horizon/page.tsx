// /horizon — Timechain · the one-tap block stacker (rebuild 2026-07-09).
//
// The third cabinet completes the arcade's triptych: the Gauntlet is
// price history traded blind, the Runner is price history survived,
// Timechain is the CHAIN itself · stack blocks, ride the halvings.
// The URL stays /horizon (nav, sitemap, llms.txt, board key all point
// here); only the game changed.

import { getFloatData } from "@/lib/float-data";
import { TimechainGame } from "./components/TimechainGame";
import { ArcadeCrossLink } from "@/components/ArcadeCrossLink";
import { ArcadeScoreboard } from "@/components/ArcadeScoreboard";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";

export const revalidate = 300; // fresh block height for the flavor line

export default async function HorizonPage() {
  // The live chain tip · flavor only ("the real chain is at block N").
  const floatData = await getFloatData({ days: 1, synthetic: false });
  const blockHeight = floatData.isFallback
    ? 0
    : (floatData.current.blockHeight ?? 0);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6 sm:pt-6">
      <InAppBrowserBanner />
      {/* Compact hero · the game sits above the fold on phone AND laptop. */}
      <div className="micro-label mb-2 text-[var(--text-tertiary)]">
        The Arcade · One tap
      </div>
      <h1 className="display-title mb-2 font-semibold text-[var(--text-primary)]">
        Time<span className="headline-gradient glow-text">chain</span>
      </h1>
      <p className="mb-4 max-w-2xl text-sm leading-snug text-[var(--text-secondary)] sm:text-base">
        Tap to stack the next block on the chain. Every 21 blocks the
        reward halves and the chain speeds up · how high can you build?
      </p>

      <TimechainGame liveTipHeight={blockHeight} />

      <ArcadeCrossLink from="horizon" />
        {/* The hashrate bridge that sat here was REMOVED 2026-08-13 ·
            see the register note in lib/hashrate-copy. */}

      <ArcadeScoreboard
        game="horizon"
        title="All-time board · biggest stacks"
      />

      {/* Crawlable rules · the game needs JS, the rules should not. */}
      <section className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="micro-label mb-2 text-[var(--accent-ink)]">
            The chain narrows
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Each block keeps only what overlaps the one below it · the
            overhang is sliced away. A perfect drop snaps flush and keeps
            the full width. Miss entirely and the chain is orphaned.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="micro-label mb-2 text-[var(--accent-ink)]">
            The halving is the clock
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Blocks start paying ₿50. Every 21 blocks the reward halves ·
            50, 25, 12.5 · and the chain slides faster. Being early pays
            more. That is not a game mechanic we invented.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="micro-label mb-2 text-[var(--accent-ink)]">
            Sats are the score
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Every block banks its reward, scaled by how cleanly you
            dropped it. Perfect streaks build a combo up to 3x. Your best
            posts to the public board under an anonymous arcade handle ·
            no accounts, nothing typed.
          </p>
        </div>
      </section>
    </div>
  );
}
