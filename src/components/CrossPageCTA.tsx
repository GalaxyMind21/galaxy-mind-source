/* =====================================================================
 * CrossPageCTA · "see also" cards at the bottom of each tool page
 *
 * Reusable component that renders 1-2 cards inviting the visitor to
 * jump to a related page. The content graph this builds:
 *
 *   /stack      → /float ("supply side") · /treasuries ("who's buying")
 *   /float      → /treasuries ("who's buying") · /stack ("decision aid")
 *   /treasuries → /float ("how much is left") · /stack ("when to buy")
 *   /fit        → /stack ("when to deploy your sleeve") · /treasuries ("treasury holdings")
 *
 * Each card has the destination's accent + a concrete reason to click.
 * Server component · just static markup · zero runtime cost.
 *
 * Why on every page: a casual visitor who landed via X / Nostr / a
 * shared OG card on ONE page should see a clear next step before
 * they leave. The footer-disclaimer immediately closes the visit;
 * a "→ Curious about X? Try /Y" card three sections above invites
 * exploration instead.
 * ===================================================================== */

type CtaCard = {
  href: string;
  eyebrow: string;
  title: string;
  hook: string;
  /** brand-color accent for hover · matches the destination page */
  accentClass?: string;
};

type TailLink = {
  href: string;
  label: string;
  hint?: string;
};

type Props = {
  /** Heading shown above the cards · defaults to "Keep exploring" */
  heading?: string;
  cards: CtaCard[];
  /** Optional habit/email rung shown as a quiet line beneath the cards.
   *  Lets pages whose CTA destinations are all tool pages still ladder
   *  the visitor up to the daily-check habit or the email list, so the
   *  block always offers at least one retention anchor. */
  tailLink?: TailLink;
};

export function CrossPageCTA({
  heading = "Keep exploring",
  cards,
  tailLink,
}: Props) {
  return (
    <section
      aria-labelledby="cross-page-cta-heading"
      className="nb-panel p-5 sm:p-6"
    >
      <h3
        id="cross-page-cta-heading"
        className="night-bench-kicker mb-3"
      >
        {heading}
      </h3>
      <div
        className={`grid gap-3 ${
          cards.length === 1
            ? "grid-cols-1"
            : cards.length === 3
              ? "grid-cols-1 sm:grid-cols-3"
              : cards.length === 4
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
                : "grid-cols-1 sm:grid-cols-2"
        }`}
      >
        {cards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className={`group card-lift flex flex-col rounded-xl border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/35 p-4 ${c.accentClass ?? ""}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[0.8125rem] text-[var(--text-tertiary)]">
                {c.eyebrow}
              </span>
              <span className="text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]">
                →
              </span>
            </div>
            <div className="text-base font-medium text-[var(--text-primary)]">
              {c.title}
            </div>
            <div className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
              {c.hook}
            </div>
          </a>
        ))}
      </div>
      {tailLink && (
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]/60 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {tailLink.hint && (
            <span className="text-[0.8125rem] text-[var(--text-tertiary)]">
              {tailLink.hint}
            </span>
          )}
          <a
            href={tailLink.href}
            className="text-[0.8125rem] text-[var(--text-secondary)] underline decoration-[var(--text-tertiary)]/40 underline-offset-2 hover:text-[var(--text-primary)]"
          >
            {tailLink.label} →
          </a>
        </div>
      )}
    </section>
  );
}
