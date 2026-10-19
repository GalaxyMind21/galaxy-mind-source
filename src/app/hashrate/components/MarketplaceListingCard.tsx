import Link from "next/link";
import {
  MARKETPLACE_CARD_EYEBROW,
  MARKETPLACE_CARD_TITLE,
  MARKETPLACE_CARD_BODY,
  MARKETPLACE_CARD_CTA,
} from "@/lib/marketplace-listing";

// Secondary card directly below the direct-rent section on /hashrate
// (operator 2026-10-17). Deliberately quieter than the hero: glass-rest (not
// hero-glass), a smaller heading, and an outline button that is shorter
// and narrower than the filled Rent CTA. Static markup with no data
// dependency, so it renders the same whether rentals are open or paused
// and never shifts layout. Copy lives in lib/marketplace-listing.ts. The button goes to the /hashrate unit selector
// (2026-10-17): the marketplace profile page is login-walled, so it is never linked, and an internal link
// needs no referral disclosure.
export function MarketplaceListingCard() {
  return (
    <section aria-labelledby="marketplace-listing-h" className="glass-stage" data-marketplace-listing>
      <div className="glass-rest flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div className="min-w-0">
          <p className="micro-label text-[var(--text-tertiary)]">{MARKETPLACE_CARD_EYEBROW}</p>
          <h2 id="marketplace-listing-h" className="mt-2 text-[17px] font-semibold leading-snug text-[var(--text-primary)] sm:text-lg">
            {MARKETPLACE_CARD_TITLE}
          </h2>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-[var(--text-secondary)]">{MARKETPLACE_CARD_BODY}</p>
        </div>
        <Link
          href="/hashrate#rent-hero"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-[var(--accent)]/50 px-5 text-[15px] font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] motion-reduce:transition-none sm:self-center"
        >
          {MARKETPLACE_CARD_CTA}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
