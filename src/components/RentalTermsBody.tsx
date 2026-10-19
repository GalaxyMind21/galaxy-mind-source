import { RENTAL_TERMS_DRAFT_HTML } from "@/lib/rental-terms-draft-html";
import { RENTAL_TERMS_VERSION } from "@/lib/rentals/phase2/terms";
import { mrrOnly } from "@/lib/rentals/mode";
import { MARKETPLACE_TERMS_BANNER_BODY } from "@/lib/marketplace-listing";

/** Banner shown in RENTALS_MODE=mrr_only (the default since 2026-10-17). The terms below stay as the record. */
export const TERMS_CLOSED_BANNER_TITLE = "Direct rentals closed October 17, 2026";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Effective date (YYYY-MM-DD) taken from the version constant create_rental submits ("2026-10-16-draft" -> "2026-10-16"). */
export function rentalTermsEffectiveDate(version: string = RENTAL_TERMS_VERSION): string {
  const m = version.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new Error(`RENTAL_TERMS_VERSION has no date: ${version}`);
  return m[1];
}

/** "2026-10-16-draft" -> "Effective October 16, 2026". Always derived from the constant. */
export function rentalTermsVersionLabel(version: string = RENTAL_TERMS_VERSION): string {
  const [y, mo, d] = rentalTermsEffectiveDate(version).split("-").map(Number);
  return `Effective ${MONTHS[mo - 1]} ${d}, ${y}`;
}

// Readable long-form styling without a typography plugin.
const ARTICLE =
  "text-sm sm:text-base leading-relaxed text-[var(--text-secondary)] " +
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg sm:[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[var(--text-primary)] " +
  "[&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] " +
  "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1.5 " +
  "[&_strong]:text-[var(--text-primary)] [&_hr]:my-8 [&_hr]:border-[var(--border-subtle)] " +
  "[&_blockquote]:my-6 [&_blockquote]:rounded-xl [&_blockquote]:border [&_blockquote]:border-[var(--border-subtle)] [&_blockquote]:p-5 " +
  "[&_a]:text-[var(--accent-ink)] [&_a]:underline [&_a]:underline-offset-4 [&_a]:break-all " +
  "[&_code]:rounded [&_code]:px-1 [&_code]:text-[var(--text-primary)]";

export function RentalTermsBody({ closed = mrrOnly() }: { closed?: boolean } = {}) {
  return (
    <article className="max-w-2xl mx-auto px-6 pt-12 pb-20" data-terms-effective={rentalTermsEffectiveDate()}>
      <div className="micro-label text-[var(--text-tertiary)] mb-3">Rental Terms</div>
      <h1 className="display-title mb-3 text-[var(--text-primary)]">Galaxy Mind Rental Terms</h1>
      <p className="mb-8 text-xs text-[var(--text-tertiary)]" data-terms-version-label>
        {rentalTermsVersionLabel()}
      </p>
      {closed && (
        <aside role="note" className="glass-rest mb-8 rounded-2xl border border-[var(--accent)]/30 p-4 sm:p-5" data-terms-closed-banner>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{TERMS_CLOSED_BANNER_TITLE}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{MARKETPLACE_TERMS_BANNER_BODY}</p>
        </aside>
      )}
      <div className={ARTICLE} dangerouslySetInnerHTML={{ __html: RENTAL_TERMS_DRAFT_HTML }} />
    </article>
  );
}
