/* =====================================================================
 * FoundingBadge · Bitcoin-themed scarcity recognition for the first
 * 100 vendors in the directory.
 *
 * Renders a small mono pill on vendor detail pages with three tiers:
 *   · #1         → "★ GENESIS · #1"     (single-vendor honor, full glow)
 *   · #21        → "⚡ FOUNDING · #21"   (nod to Bitcoin's 21M cap)
 *   · #2 – #100  → "FOUNDING · #N"      (standard founding-100 badge)
 *   · #101+      → returns null         (no badge after the cap)
 *
 * Scoping: this component renders ONLY on the vendor detail surface
 * (VendorDetailModal + /v/[slug] page when added). Homepage vendor
 * cards stay clean · the founding-100 honor is a depth-of-detail
 * reward for visitors who clicked through to learn about a specific
 * vendor.
 *
 * Why bake the cap at 100: Bitcoin's whole pitch is scarcity. A
 * directory that rewards early adopters with a permanent, visible
 * marker creates a small but real "I want to be in this set" pull
 * for new vendor recruitment. Cap at exactly 100 because:
 *   · Round, memorable threshold
 *   · Honors today's full early-roster (we're at 84 vendors today,
 *     so the cap-to-current ratio leaves 16 slots of unclaimed honor)
 *   · After the cap, the badge becomes a stable archive marker · no
 *     ongoing question of "where does the founding tier end?"
 *
 * The number itself is permanent · `addedAt` is a stable index per
 * the README ("Don't re-number on removal"). Vendor #43 stays #43
 * forever, even if vendor #20 is later dormancy-removed.
 * ===================================================================== */

type Props = {
  addedAt: number;
  className?: string;
};

export function FoundingBadge({ addedAt, className = "" }: Props) {
  // Out-of-range guard · skips both the "removed/null" case and the
  // post-100 case in one check.
  if (addedAt < 1 || addedAt > 100) return null;

  const isGenesis = addedAt === 1;
  const isTwentyOne = addedAt === 21;

  let label: string;
  let title: string;
  let pillClass: string;

  if (isGenesis) {
    label = "★ GENESIS · #1";
    title =
      "Genesis · the very first vendor in the directory. There can only ever be one.";
    pillClass =
      "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent-ink)] lit-active";
  } else if (isTwentyOne) {
    label = "⚡ FOUNDING · #21";
    title =
      "Founding 100 · vendor #21, honoring Bitcoin's 21M supply cap.";
    pillClass =
      "border-[var(--accent)]/70 bg-[var(--accent)]/10 text-[var(--accent-ink)]";
  } else {
    label = `FOUNDING · #${addedAt}`;
    title = `Founding 100 · one of the first 100 vendors in the directory (joined as #${addedAt}).`;
    pillClass =
      "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--accent-ink)]";
  }

  return (
    <span
      className={`inline-flex items-baseline gap-1 px-2.5 py-1 rounded-full border font-mono t-xs uppercase tracking-[0.2em] whitespace-nowrap transition-colors ${pillClass} ${className}`}
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  );
}
