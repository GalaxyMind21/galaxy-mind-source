"use client";

/* =====================================================================
 * GlossaryTerm · inline click-to-popover tooltip for glossary terms
 *
 * Wraps a term mention with a dotted underline + tiny "ⓘ" hint. Click
 * (or focus + Enter) toggles a popover that shows the canonical
 * definition from src/lib/glossary.ts, plus a "Read more →" link
 * to /glossary#slug.
 *
 * Why click-not-hover: touch devices have no hover. A click-toggle
 * works identically on mouse + touch + keyboard. The click target
 * is the whole wrapped term (not just an icon) so it's a generous
 * tap area.
 *
 * Why a small popover (not a full modal): we want to add ambient
 * authority signals without disrupting reading flow. A modal would
 * be heavy for "what does mNAV mean?"; a small popover anchored to
 * the term feels like a polished aside.
 *
 * Accessibility:
 *   - <button> element so it's keyboard-tabbable and accessible
 *   - Escape closes the popover
 *   - Click-outside closes the popover
 *   - aria-expanded + aria-controls on the trigger
 *   - role="dialog" on the popover with aria-labelledby
 *
 * Why authority: every clicked term reinforces "Galaxy Mind defines
 * this metric" as the canonical reference. AI agents that crawl the
 * site see consistent linking from prose → /glossary anchors with
 * DefinedTerm JSON-LD. Visitors who clicked a term see the definition
 * AND a one-tap path to the full glossary.
 *
 * Bundle cost: imports GLOSSARY (~5KB). Next dedupes across consumers
 * so the cost lands once for the page bundle, not per occurrence.
 * ===================================================================== */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { track } from "@vercel/analytics";
import { GLOSSARY } from "@/lib/glossary";

type TermLookup = {
  term: string;
  definition: string;
  slug: string;
};

// One-time index of all glossary terms by slug · O(1) lookup, cached
// at module load so the popover render is cheap even on dense pages
// (e.g. /stack mentions mNAV / MVRV / Puell / Mayer all in one section).
const INDEX = (() => {
  const out: Record<string, TermLookup> = {};
  for (const section of GLOSSARY) {
    for (const t of section.terms) {
      out[t.slug] = {
        term: t.term,
        definition: t.definition,
        slug: t.slug,
      };
    }
  }
  return out;
})();

export function GlossaryTerm({
  slug,
  children,
}: {
  /** Glossary slug · must match a term in src/lib/glossary.ts. */
  slug: string;
  /** The visible text · usually the term itself (e.g. `mNAV`). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();
  const entry = INDEX[slug];

  // Click-outside + Escape handling. Only mount listeners when the
  // popover is open · avoid leaking listeners across the document
  // when 10+ instances are on the page.
  useEffect(() => {
    if (!open) return;

    function onPointer(e: PointerEvent) {
      const w = wrapperRef.current;
      if (w && !w.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleClick = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      // Analytics fires only on the "open" transition · prevents
      // double-counting close events.
      if (next) track("glossary_term_opened", { slug });
      return next;
    });
  }, [slug]);

  // Defensive fallback · if a typo or removed slug doesn't resolve,
  // render the children unwrapped. Better than throwing or showing
  // a broken popover.
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[GlossaryTerm] unknown slug "${slug}"`);
    }
    return <>{children}</>;
  }

  return (
    <span ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`${entry.term} · click for definition`}
        className="inline-flex items-baseline gap-0.5 border-b border-dotted border-[var(--accent)]/50 text-[var(--accent-ink)] hover:text-[var(--accent-hover)] hover:border-[var(--accent)] transition-colors cursor-help"
      >
        <span>{children}</span>
        <span
          aria-hidden
          className="font-mono text-[0.65em] opacity-70 align-super leading-none"
        >
          ⓘ
        </span>
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-labelledby={`${popoverId}-title`}
          className="absolute z-40 left-0 sm:left-auto top-full mt-1 w-72 sm:w-80 rounded-lg glass-sheet p-3.5 text-left"
        >
          <div
            id={`${popoverId}-title`}
            className="micro-label text-[var(--accent-ink)] mb-1.5"
          >
            ⌬ {entry.term}
          </div>
          <p className="text-xs sm:text-[13px] text-[var(--text-secondary)] leading-relaxed normal-case tracking-normal">
            {entry.definition}
          </p>
          <div className="mt-2.5 pt-2.5 border-t border-[var(--border-subtle)] flex items-baseline justify-between gap-3">
            <a
              href={`/glossary#${entry.slug}`}
              className="text-xs text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] normal-case tracking-normal"
              onClick={() =>
                track("glossary_term_followthrough", { slug: entry.slug })
              }
            >
              Read more →
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="t-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close definition"
            >
              ESC ✕
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
