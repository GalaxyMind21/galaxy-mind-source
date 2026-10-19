// Landing page for a shared WEN result (/wen/c/<seg>). A share click
// opens here: the result as a rich card (the sibling opengraph-image
// is the social preview) plus one loud door into today's puzzle.
// Per-result and infinite in the param space, so it is noindex · it
// exists to convert a share click into a play, not to rank.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ShareHabitHandoff } from "@/components/ShareHabitHandoff";
import { cardGridLine, decodeWenCard } from "@/lib/wen";

export const metadata: Metadata = {
  title: "A WEN result · Galaxy Mind",
  description:
    "Someone dated a mystery slice of the bitcoin tape. See how close they got, then take today's puzzle.",
  robots: { index: false, follow: true },
  twitter: { card: "summary_large_image" },
};

export default async function WenCardPage({
  params,
}: {
  params: Promise<{ data: string }>;
}) {
  const { data } = await params;
  const card = decodeWenCard(data);

  const n = card?.n ?? 0;
  const sats = card?.sats ?? 0;
  const grid = card ? cardGridLine(card.cells) : "";
  const bull = card?.cells.some((c) => c.band === "bull") ?? false;

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10 sm:pt-16 pb-16 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Galaxy Mind · WEN{n > 0 ? ` #${n}` : ""}
        </div>

        <h1 className="display-title font-semibold mb-4">
          {card ? (
            <>
              <span className="headline-gradient glow-text">
                {sats.toLocaleString("en-US")}
              </span>
              {" "}sats
            </>
          ) : (
            <>
              Wen was{" "}
              <span className="headline-gradient glow-text">this</span>?
            </>
          )}
        </h1>

        {card && grid && (
          <div className="text-2xl sm:text-3xl mb-3 leading-none">{grid}</div>
        )}
        {card && (
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-8">
            {bull
              ? "They hit the bullseye · dated a redacted 90 day slice of the actual bitcoin tape to within a week."
              : "Their closeness score on dating a redacted 90 day slice of the actual bitcoin tape. Every arrow was one guess."}
          </p>
        )}
        {!card && (
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-8">
            A daily puzzle on the actual bitcoin tape · dates redacted,
            five guesses, scored in sats.
          </p>
        )}

        <Link
          href="/wen"
          className="inline-flex px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.25em] font-semibold hover:shadow-[0_0_24px_var(--accent-glow)] transition-all"
        >
          Play today&apos;s WEN →
        </Link>
        <p className="mt-3 font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Same puzzle for everyone · new tape at 00:00 UTC
        </p>

        <ShareHabitHandoff source="wen" />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
