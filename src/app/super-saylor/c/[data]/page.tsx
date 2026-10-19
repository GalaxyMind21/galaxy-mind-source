// Landing page for a shared SUPER SAYLOR result (/super-saylor/c/<seg>).
// A share click opens here: the result as a rich card (the sibling
// opengraph-image is the social preview) plus one loud door into the
// game. For a Daily Summit share, that door carries the sharer's time
// as a challenge (?summit=<ms>&sd=<day>) · the game only activates the
// ghost when the day still matches (you can only race the same
// mountain). Per-result and infinite in the param space, so it is
// noindex · it exists to convert a share click into a play, not to rank.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import { decodeSaylorCard, fmtSummitMs } from "@/lib/saylor-card";
import { summitLevelFor } from "@/lib/gauntlet-day";

export const metadata: Metadata = {
  title: "A SUPER SAYLOR result · Galaxy Mind",
  description:
    "Someone ran the bitcoin timeline as Super Saylor. See how they did, then take your own climb.",
  robots: { index: false, follow: true },
  twitter: { card: "summary_large_image" },
};

export default async function SaylorCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const card = decodeSaylorCard(data);

  // Eyebrow, hero, sub-copy, and the play link (with the summit
  // challenge query when it is a summit share).
  let eyebrow = "Galaxy Mind · Super Saylor";
  let heroNode: React.ReactNode = (
    <>
      Run the <span className="headline-gradient glow-text">timeline</span>.
    </>
  );
  let sub =
    "A full platformer through bitcoin history · 21 levels, 21 rules, one chair.";
  let playHref = "/super-saylor";
  let playLabel = "Play Super Saylor →";

  if (card?.kind === "summit") {
    const lvl = summitLevelFor(card.day);
    eyebrow = `Galaxy Mind · Daily Summit #${card.day}`;
    heroNode = (
      <>
        <span className="headline-gradient glow-text">
          {fmtSummitMs(card.ms)}
        </span>
      </>
    );
    sub = `Level ${lvl} climbed${card.handle ? " by " + card.handle : ""} · the same mountain everyone races today. Can you climb it faster?`;
    playHref = `/super-saylor?summit=${card.ms}&sd=${card.day}`;
    playLabel = "Climb today's Summit →";
  } else if (card?.kind === "victory") {
    eyebrow = "Galaxy Mind · Super Saylor";
    heroNode = (
      <>
        <span className="headline-gradient glow-text">21/21</span>{" "}
        cleared
      </>
    );
    sub = `${card.handle ? card.handle + " " : ""}beat Peter Schiff at the summit · ${card.sats.toLocaleString("en-US")} sats, ${card.bears.toLocaleString("en-US")} bears orange-pilled, One Chair activated ${card.convictions}x.`;
  } else if (card?.kind === "run") {
    eyebrow = "Galaxy Mind · Super Saylor";
    heroNode = (
      <>
        <span className="headline-gradient glow-text">
          {card.sats.toLocaleString("en-US")}
        </span>{" "}
        sats
      </>
    );
    sub = `${card.handle ? card.handle + " " : ""}reached ${card.levels}/21 levels and orange-pilled ${card.bears.toLocaleString("en-US")} bears running the bitcoin timeline.`;
  }

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          {eyebrow}
        </div>

        <h1 className="display-title font-semibold mb-4">{heroNode}</h1>

        <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-8">
          {sub}
        </p>

        <Link
          href={playHref}
          className="inline-flex px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.25em] font-semibold hover:lit-primary transition-all"
        >
          {playLabel}
        </Link>
        <p className="mt-3 font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {card?.kind === "summit"
            ? "One mountain a day · same level for everyone · new climb at 00:00 UTC"
            : "Free to play · runs offline · no account"}
        </p>

        <div className="mt-8">
          <Link
            href="/arcade"
            className="t-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            The Arcade · five bitcoin games →
          </Link>
        </div>

        <ShareHabitHandoff source="saylor" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
