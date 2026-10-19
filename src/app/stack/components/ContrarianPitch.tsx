/**
 * The contrarian thesis card.
 *
 * Lives right after the hero gauge to explain WHY the page glows hottest
 * during widespread fear — without this context, a first-time visitor
 * sees "score 67 HOT" and has no model for why that's good. With it,
 * the gauge becomes a tool for acting on the sentiment-vs-data divergence.
 *
 * Tone: dry-fintech humor. The Rothschild quote does most of the
 * personality work; the bullets keep it grounded with the actual signal
 * weights from the engine. Optional currentScore highlights the live
 * verdict in the closing line so the explanation feels personalized.
 */
import { GlossaryTerm } from "@/components/GlossaryTerm";

export function ContrarianPitch({
  currentScore,
  currentTier,
}: {
  currentScore: number;
  currentTier: string;
}) {
  const isMolten = currentScore >= 81;
  const isHot = currentScore >= 61 && currentScore <= 80;
  const isWarm = currentScore >= 41 && currentScore <= 60;

  // Personalized closing line based on what the gauge is currently showing.
  // currentTier is the action label (e.g. "STACK NOW") not the temperature word.
  const closingLine = isMolten
    ? `Right now the gauge says ${currentTier} (${currentScore}/100). That's exactly the divergence the page is built to surface. Whether you act on it is up to you.`
    : isHot
      ? `Right now the gauge says ${currentTier} (${currentScore}/100). The divergence is genuine but not extreme, the kind of setup that rewards conviction without requiring heroism.`
      : isWarm
        ? `Right now the gauge says ${currentTier} (${currentScore}/100). The market hasn't given you a clear edge in either direction. DCA on schedule.`
        : `Right now the gauge says ${currentTier} (${currentScore}/100). The crowd is excited; the data is unimpressed. Patience tends to be rewarded after readings like this.`;

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8">
      {/* Subtle red-orange gradient backdrop · "blood in the streets"
          visual cue without being literal */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 100% 0%, rgba(220, 60, 40, 0.10), transparent 70%), radial-gradient(ellipse 50% 60% at 0% 100%, rgba(247,147,26,0.08), transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="micro-label text-[var(--text-tertiary)]">
          The Contrarian Thesis
        </div>

        {/* The big quote */}
        <blockquote className="mt-6">
          <p
            className="text-2xl sm:text-3xl leading-tight text-[var(--text-primary)] italic"
            style={{
              fontFamily: "var(--font-site-sans), serif",
              letterSpacing: "-0.01em",
            }}
          >
            <span className="text-[var(--accent-ink)] text-4xl leading-none align-top mr-1">
              &ldquo;
            </span>
            Buy when there&apos;s blood in the streets, even if it&apos;s your own.
            <span className="text-[var(--accent-ink)] text-4xl leading-none align-top ml-1">
              &rdquo;
            </span>
          </p>
          <footer className="mt-3 font-mono text-xs text-[var(--text-tertiary)]">
            by Baron Rothschild (paraphrased, frequently)
          </footer>
        </blockquote>

        <div className="mt-8 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            The{" "}
            <span className="text-[var(--accent-ink)]">Bitcoin Buying Gauge</span>{" "}
            is a contrarian instrument by design. It glows brightest exactly
            when traditional sentiment is at its worst · when normal people
            are scared, valuations have compressed, and short-sellers are
            dominating the order book.
          </p>

          <p className="text-[var(--text-tertiary)] text-xs">
            Specifically, the gauge tilts toward STACK HUGE when:
          </p>

          <ul className="space-y-2 ml-1 text-sm">
            <li className="flex items-baseline gap-3">
              <span className="text-[var(--accent-ink)] font-mono text-xs w-12 shrink-0">
                +18%
              </span>
              <span>
                <strong className="text-[var(--text-primary)] font-normal">
                  <GlossaryTerm slug="mvrv">MVRV ratio</GlossaryTerm>{" "}drops below 1.0
                </strong>
                {" "}· meaning the average bitcoin holder is underwater on cost basis.
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-[var(--accent-ink)] font-mono text-xs w-12 shrink-0">
                +14%
              </span>
              <span>
                <strong className="text-[var(--text-primary)] font-normal">
                  <GlossaryTerm slug="funding-rate">Funding rate</GlossaryTerm>{" "}goes negative
                </strong>
                {" "}· shorts are paying longs to keep their positions open. The crowd is positioned for prices to go lower.
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-[var(--accent-ink)] font-mono text-xs w-12 shrink-0">
                +12%
              </span>
              <span>
                <strong className="text-[var(--text-primary)] font-normal">
                  <GlossaryTerm slug="fear-greed">Fear &amp; Greed</GlossaryTerm>{" "}reads &ldquo;Extreme Fear&rdquo;
                </strong>
                {" "}· the public sentiment composite is screaming sell.
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="text-[var(--accent-ink)] font-mono text-xs w-12 shrink-0">
                +7%
              </span>
              <span>
                <strong className="text-[var(--text-primary)] font-normal">
                  MSTR <GlossaryTerm slug="mnav">mNAV</GlossaryTerm>{" "}compresses below 1.05×
                </strong>
                {" "}· the most public bitcoin treasury company is trading at or below the value of its underlying coins. The smart money has stopped paying a premium.
              </span>
            </li>
          </ul>

          <p className="pt-2">
            Translated: when your group chat is depressing, your barber is
            confidently explaining why bitcoin is dead this time, and your
            normie friends finally stop asking · that&apos;s when this page
            lights up.
          </p>

          <p>
            It almost never feels good to act when the gauge says it should.
            That&apos;s the entire point of the page ·{" "}
            <em className="text-[var(--text-primary)] not-italic">
              to give you a single place to check whether the divergence
              between sentiment and data is in your favor
            </em>
            . Higher score = bigger divergence = better moment to act on
            conviction rather than feelings.
          </p>

          <p className="pt-2 text-[var(--text-primary)]">
            {closingLine}
          </p>
        </div>
      </div>
    </div>
  );
}
