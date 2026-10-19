// Landing page for a shared BITCOIN KART race (/bitcoin-kart/card/<seg>).
// A shared link opens here: the run summary as a rich card (the sibling
// opengraph-image is the social preview) plus a prominent door into the
// live game. Per-run and infinite in the param space, so it is noindex
// with a canonical on /bitcoin-kart · it exists to convert a share click
// into a play, not to rank. NOTE: src/proxy.ts carves this path out of
// the game's static no-inline CSP · a Next page needs the nonce policy.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import {
  decodeKartCard,
  formatKartCardTime,
  KART_TRACK_NAMES,
  KART_DRIVER_NAMES,
  KART_CLASS_LABELS,
} from "@/lib/kart-card";
import { gauntletNumber } from "@/lib/gauntlet-day";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ data: string }>;
}): Promise<Metadata> {
  const { data } = await params;
  const run = decodeKartCard(data);
  const title = run
    ? `${KART_TRACK_NAMES[run.trackId]} in ${formatKartCardTime(run.timeMs)} · Bitcoin Kart · Galaxy Mind`
    : "A Bitcoin Kart race · Galaxy Mind";
  const description = run?.day != null
    ? `Daily Circuit #${run.day}: same track, class, and mirror for everyone today. See the time, then race it yourself.`
    : "Someone raced Team Fiat around the bitcoin timeline. See the time, then take the same track.";
  return {
    title,
    description,
    robots: { index: false, follow: true },
    twitter: { card: "summary_large_image" },
    // The param space is infinite · every card canonicalizes to the game
    // so shared links never compete with /bitcoin-kart in search.
    alternates: { canonical: "https://galaxymind.space/bitcoin-kart" },
  };
}

export default async function KartCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const run = decodeKartCard(data);

  const trackName = run ? KART_TRACK_NAMES[run.trackId] : "the Orange Circuit";
  const driverName = run ? KART_DRIVER_NAMES[run.driverId] : null;
  const day = run?.day ?? null;
  const rank = run?.rank ?? null;
  const klass = run?.klass ?? null;
  const mirror = run?.mirror ?? false;

  const isTodaysCircuit = day != null && day === gauntletNumber(Date.now());
  // dare cards carry a ghost id · the CTA boots straight into a race
  // against the sharer's actual line (decode already shape-gates the id)
  const ghostId = run?.ghostId ?? null;
  const stamp =
    day != null ? `DAILY CIRCUIT #${day}` : rank === 1 ? "P1 FINISH" : "RACE RESULT";
  const stampColor =
    rank === 1 ? "var(--success)" : "var(--accent)";

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Galaxy Mind · Bitcoin Kart
        </div>

        <div
          className="inline-flex rounded-lg border-2 px-5 py-2 font-mono text-2xl sm:text-3xl font-bold tracking-[0.12em] mb-6"
          style={{ color: stampColor, borderColor: stampColor }}
        >
          {stamp}
        </div>

        {run ? (
          <>
            <h1 className="display-title font-semibold mb-2 tabular-nums">
              {formatKartCardTime(run.timeMs)}
            </h1>
            <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-2">
              on {trackName}
              {driverName ? ` as ${driverName}` : ""}
              {day != null
                ? " · the same track, class, and mirror everyone raced today."
                : "."}
            </p>

            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-sm tabular-nums mb-8">
              {rank != null && (
                <span
                  className={
                    rank === 1
                      ? "text-[var(--success)]"
                      : "text-[var(--accent-ink)]"
                  }
                >
                  P{rank}
                  {rank === 1 ? " · no second best" : ""}
                </span>
              )}
              {klass && (
                <span className="text-[var(--text-tertiary)]">
                  {KART_CLASS_LABELS[klass]} class
                </span>
              )}
              {mirror && (
                <span className="text-[var(--text-tertiary)]">MIRROR</span>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="display-title font-semibold mb-2">Bitcoin Kart</h1>
            <p className="text-[var(--text-secondary)] text-sm sm:text-base mb-8">
              One chair. Ten racers. No second best. Team Bitcoin against Team
              Fiat across twelve tracks of bitcoin history.
            </p>
          </>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href={ghostId ? `/bitcoin-kart?ghost=${ghostId}` : "/bitcoin-kart"}
            className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
          >
            {ghostId
              ? "Race this ghost →"
              : isTodaysCircuit
                ? "Take today's circuit →"
                : "Race this track →"}
          </Link>
          <Link
            href="/arcade"
            className="micro-label px-5 py-3 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all hover:border-[var(--accent)] inline-flex items-center"
          >
            The Arcade
          </Link>
        </div>

        <p className="mt-8 text-xs text-[var(--text-tertiary)] leading-relaxed">
          The Daily Circuit is one deterministic track, class, and mirror combo
          per UTC day, the same for everyone. Unofficial fan game and
          affectionate parody. Not financial advice.
        </p>

        <ShareHabitHandoff source="kart" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
