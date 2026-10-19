// Landing page for a shared Bitcoin Gauntlet run (/gauntlet/card/<seg>).
// A shared link opens here: the run summary as a rich card (the sibling
// opengraph-image is the social preview) plus a door into the game.
// Per-run and infinite in the param space, so it is noindex.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import { decodeGauntletCard } from "@/lib/run-card";

export const metadata: Metadata = {
  title: "A Bitcoin Gauntlet result · Galaxy Mind",
  description:
    "Someone traded eight months of hidden bitcoin history against a DCA bot. See how they did, then take the same trial.",
  robots: { index: false, follow: true },
  twitter: { card: "summary_large_image" },
};

function tierColor(tier: string): string {
  const t = tier.toUpperCase();
  if (t.includes("ORACLE")) return "var(--success)";
  if (t.includes("BOT SLAYER")) return "#4ADE80";
  if (t.includes("REKT")) return "#ff3a4f";
  if (t.includes("SHAKEN") || t.includes("OUTTRADED")) return "#FB923C";
  return "var(--accent)";
}

export default async function GauntletCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeGauntletCard(data);

  const alpha = run?.alpha ?? 0;
  const tier = run?.tier || "The Gauntlet";
  const num = run?.number ?? null;
  const rank = run?.rank ?? null;
  const handle = run?.handle ?? null;
  const liquidated = run?.liquidated ?? false;
  const beat = alpha >= 0;

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Galaxy Mind · The Bitcoin Gauntlet
          {handle ? ` · ${handle}` : ""}
        </div>

        <div
          className="inline-flex rounded-lg border-2 px-5 py-2 font-mono text-2xl sm:text-3xl font-bold tracking-[0.12em] mb-6"
          style={{ color: tierColor(tier), borderColor: tierColor(tier) }}
        >
          {tier.toUpperCase()}
        </div>

        <h1
          className="display-title font-semibold mb-2 tabular-nums"
          style={{ color: beat ? "var(--success)" : "#FB923C" }}
        >
          {beat ? "+" : ""}
          {alpha.toFixed(1)}%
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-2">
          vs the DCA bot, over eight months of actual bitcoin history with the
          dates hidden.
        </p>

        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-sm mb-8">
          <span className="text-[var(--text-tertiary)]">
            {num != null ? `Gauntlet #${num}` : "practice run"}
          </span>
          {rank != null && (
            <span className="text-[var(--accent-ink)]">#{rank} today</span>
          )}
          {liquidated && <span className="text-[#ff3a4f]">✕ liquidated</span>}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/gauntlet"
            className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
          >
            Take the trial →
          </Link>
          <Link
            href="/arcade"
            className="micro-label px-5 py-3 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all hover:border-[var(--accent)] inline-flex items-center"
          >
            The Arcade
          </Link>
        </div>

        <p className="mt-8 text-xs text-[var(--text-tertiary)] leading-relaxed">
          One shared window a day, actual prices, dates masked until the reveal.
          The bot gets the same salary and never thinks. Not financial advice.
        </p>

        <ShareHabitHandoff source="gauntlet" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
