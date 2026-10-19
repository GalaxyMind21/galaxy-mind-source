// Landing page for a shared CHOP run (/chop/card/<seg>). A shared
// link opens here: the run summary as a rich card (the sibling
// opengraph-image is the social preview) plus a prominent door into
// the live game. Per-run and infinite in the param space, so it is
// noindex with a canonical on /chop · it exists to convert a share
// click into a play, not to rank. NOTE: src/proxy.ts carves this path
// out of the game's static no-inline CSP · a Next page needs the nonce
// policy. The /chop rewrite in next.config.ts is exact `/chop` only,
// so this route is reachable.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import { decodeChopCard } from "@/lib/chop-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ data: string }>;
}): Promise<Metadata> {
  const { data } = await params;
  const run = decodeChopCard(data);
  const title = run
    ? `${run.sats.toLocaleString("en-US")} sats in CHOP · Galaxy Mind`
    : "A CHOP result · Galaxy Mind";
  const description = run?.orphaned
    ? "Someone's block orphaned in CHOP. Slice today's live bitcoin block yourself."
    : "Someone sliced an actual bitcoin block in CHOP. See the score, then take your own cut.";
  return {
    title,
    description,
    robots: { index: false, follow: true },
    twitter: { card: "summary_large_image" },
    alternates: { canonical: "https://galaxymind.space/chop" },
  };
}

export default async function ChopCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeChopCard(data);

  const orphaned = run?.orphaned ?? false;
  const stamp = orphaned ? "BLOCK ORPHANED" : run ? "BLOCK CLEARED" : "CHOP";
  const stampColor = orphaned ? "#ff3a4f" : "var(--accent)";

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Galaxy Mind · CHOP
          {run?.height != null
            ? ` · block ${run.height.toLocaleString("en-US")}`
            : ""}
        </div>

        <div
          className="inline-flex rounded-lg border-2 px-5 py-2 font-mono text-2xl sm:text-3xl font-bold tracking-[0.12em] mb-6"
          style={{ color: stampColor, borderColor: stampColor }}
        >
          {stamp}
        </div>

        {run ? (
          <>
            <h1 className="display-title font-semibold mb-2">
              <span className="tabular-nums">
                {run.sats.toLocaleString("en-US")}
              </span>{" "}
              sats
            </h1>
            <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-2">
              {orphaned
                ? "Integrity hit zero. The chain moved on without them."
                : "Sliced from an actual bitcoin block · every cube was one of its transactions."}
            </p>

            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-sm tabular-nums mb-8">
              {run.grade && (
                <span className="text-[var(--accent-ink)]">
                  {run.grade}
                </span>
              )}
              {run.combo >= 1 && (
                <span className="text-[var(--success)]">
                  ×{run.combo} best combo
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="display-title font-semibold mb-2">CHOP</h1>
            <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-8">
              Slice the latest bitcoin block to the beat. Every cube
              is a transaction. Swipe through, chain a combo, seal the
              block.
            </p>
          </>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/chop"
            className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
          >
            Slice today&apos;s block →
          </Link>
          <Link
            href="/arcade"
            className="micro-label px-5 py-3 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all hover:border-[var(--accent)] inline-flex items-center"
          >
            The Arcade
          </Link>
        </div>

        <p className="mt-8 text-xs text-[var(--text-tertiary)] leading-relaxed">
          Every cube is an actual transaction from the latest mined block. A
          run is one block. Not financial advice.
        </p>

        <ShareHabitHandoff source="chop" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
