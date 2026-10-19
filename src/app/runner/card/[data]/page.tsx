// Landing page for a shared Runner run (/runner/card/<seg>). A shared
// link opens here: the run summary as a rich card (the sibling
// opengraph-image is the social preview) plus a prominent door into the
// live game. Per-run and infinite in the param space, so it is noindex ·
// it exists to convert a share click into a play, not to rank.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import { decodeRunCard } from "@/lib/run-card";

export const metadata: Metadata = {
  title: "A Runner result · Galaxy Mind",
  description:
    "Someone ran the actual bitcoin price tape. See how far they got, then take your own run.",
  robots: { index: false, follow: true },
  twitter: { card: "summary_large_image" },
};

export default async function RunnerCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeRunCard(data);

  const present = run?.present ?? false;
  const days = run?.days ?? 0;
  const sats = run?.sats ?? 0;
  const combo = run?.combo ?? 0;
  const era = run?.era ?? null;
  const handle = run?.handle ?? null;

  const verdict = present ? "Reached the present" : "Rekt";
  const verdictColor = present ? "var(--success)" : "var(--accent)";

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Galaxy Mind · Node Runner
          {handle ? ` · ${handle}` : ""}
        </div>

        <div
          className="inline-flex rounded-lg border-2 px-5 py-2 font-mono text-2xl sm:text-3xl font-bold tracking-[0.12em] mb-6"
          style={{ color: verdictColor, borderColor: verdictColor }}
        >
          {verdict.toUpperCase()}
        </div>

        <h1 className="display-title font-semibold mb-2">
          <span className="tabular-nums">{days.toLocaleString("en-US")}</span>{" "}
          days survived
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-2">
          {present
            ? "Every candle of actual bitcoin history since the drop, cleared · then launched to the moon."
            : "Days of the actual bitcoin price tape cleared before the fall."}
        </p>

        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-sm tabular-nums mb-8">
          <span className="text-[var(--accent-ink)]">
            {sats.toLocaleString("en-US")} sats
          </span>
          {combo >= 3 && (
            <span className="text-[var(--success)]">×{combo} peak combo</span>
          )}
          {!present && era && (
            <span className="text-[var(--text-tertiary)]">killed by {era}</span>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/runner"
            className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
          >
            Take your run →
          </Link>
          <Link
            href="/arcade"
            className="micro-label px-5 py-3 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all hover:border-[var(--accent)] inline-flex items-center"
          >
            The Arcade
          </Link>
        </div>

        <p className="mt-8 text-xs text-[var(--text-tertiary)] leading-relaxed">
          The terrain is actual daily closes · the run only ends at the present,
          and the dates stay hidden until you fall. Not financial advice.
        </p>

        <ShareHabitHandoff source="runner" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
