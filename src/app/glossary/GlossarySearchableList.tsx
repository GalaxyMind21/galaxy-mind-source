"use client";

/* =====================================================================
 * GlossarySearchableList · client-side fuzzy filter for /glossary
 *
 * Why: /glossary has 28+ terms across 4 sections. Returning visitors
 * who land here via a /stack or /treasuries GlossaryTerm tooltip's
 * "Read more →" link want to skim or jump to a specific term without
 * scrolling the whole page. A search box at the top short-circuits
 * the scroll.
 *
 * The original /glossary page renders the dl/dt/dd structure
 * server-side (good for SEO + JSON-LD). This component takes the
 * same GLOSSARY data as a prop and re-renders it client-side with
 * a search filter on top · the parent page server-renders this
 * component for the empty-search case so the initial paint matches
 * the prior implementation, then the client interactivity attaches.
 *
 * Filter algorithm: case-insensitive substring match on term name,
 * definition body, expansion, and slug. Multi-token query splits on
 * whitespace and requires ALL tokens to match (AND semantics) ·
 * matches what users expect from search-style inputs.
 *
 * Sections that have no matching terms collapse out entirely so the
 * filtered view stays tight.
 *
 * Mobile: input is full-width, sticky to the top of the article so
 * scrolling through long results keeps the search affordance visible.
 * ===================================================================== */

import { useMemo, useState } from "react";
import { track } from "@vercel/analytics";
import type { GlossarySection } from "@/lib/glossary";

function matchesTokens(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    if (!lower.includes(tok)) return false;
  }
  return true;
}

export function GlossarySearchableList({
  sections,
}: {
  sections: GlossarySection[];
}) {
  const [query, setQuery] = useState("");
  const [trackedThisSession, setTrackedThisSession] = useState(false);

  const filtered = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return sections;

    const out: GlossarySection[] = [];
    for (const section of sections) {
      const terms = section.terms.filter((t) => {
        const haystack = `${t.term} ${t.definition} ${t.expansion ?? ""} ${t.slug}`;
        return matchesTokens(haystack, tokens);
      });
      if (terms.length > 0) out.push({ ...section, terms });
    }
    return out;
  }, [query, sections]);

  function handleQueryChange(v: string) {
    setQuery(v);
    if (v.trim().length >= 2 && !trackedThisSession) {
      track("glossary_search_used");
      setTrackedThisSession(true);
    }
  }

  const totalTerms = sections.reduce((sum, s) => sum + s.terms.length, 0);
  const filteredTerms = filtered.reduce((sum, s) => sum + s.terms.length, 0);

  return (
    <>
      {/* Search input · sticky to top so scrolling long lists keeps
          the filter affordance reachable. Mirrors the focus-glow
          pattern from /submit's handle field for visual continuity. */}
      <div className="sticky top-2 z-10 mb-6 -mx-1 px-1 py-1.5">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Filter terms · mNAV, MVRV, Sharpe..."
            aria-label="Filter glossary terms"
            className="w-full px-4 py-2.5 pr-20 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none focus:lit-active transition-all text-[var(--text-primary)] font-mono text-sm placeholder:text-[var(--text-tertiary)]"
          />
          <span
            aria-live="polite"
            className="absolute right-3 top-1/2 -translate-y-1/2 t-xs text-[var(--text-tertiary)] tabular-nums pointer-events-none"
          >
            {query.trim() ? `${filteredTerms}/${totalTerms}` : `${totalTerms} terms`}
          </span>
        </div>
      </div>

      {/* Empty state · helpful, not punitive. Shows what was searched
          and an obvious affordance to clear. */}
      {query.trim() && filtered.length === 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-6 text-center">
          <p className="text-sm text-[var(--text-secondary)] mb-2">
            No terms match{" "}
            <span className="font-mono text-[var(--text-primary)]">
              &ldquo;{query}&rdquo;
            </span>
            .
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex items-baseline gap-1 t-xs font-medium text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            ✕ Clear filter
          </button>
        </div>
      )}

      <div className="space-y-12">
        {filtered.map((section) => (
          <section
            key={section.slug}
            id={section.slug}
            aria-labelledby={`${section.slug}-heading`}
            className="scroll-mt-20"
          >
            <h2
              id={`${section.slug}-heading`}
              className="text-xl font-semibold text-[var(--text-primary)] mb-1"
            >
              {section.title}
            </h2>
            <p className="text-xs text-[var(--text-tertiary)] mb-6 leading-relaxed">
              {section.blurb}
            </p>

            <dl className="space-y-6">
              {section.terms.map((t) => (
                <div
                  key={t.slug}
                  id={t.slug}
                  className="scroll-mt-20 border-l-2 border-[var(--border-subtle)] hover:border-[var(--accent)]/50 transition-colors pl-4"
                >
                  <dt className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                    <span className="font-semibold text-base text-[var(--text-primary)] font-sans">
                      {t.term}
                    </span>
                    <a
                      href={`#${t.slug}`}
                      aria-label={`Direct link to ${t.term}`}
                      className="font-mono t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                    >
                      #{t.slug}
                    </a>
                  </dt>
                  <dd className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                    {t.definition}
                  </dd>
                  {t.expansion && (
                    <p className="mt-2 text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">
                      {t.expansion}
                    </p>
                  )}
                  {/* Link row is now UNCONDITIONAL (SEO 2026-07-25): the
                      per-term /glossary/[slug] pages existed and were in
                      the sitemap, but nothing on the site linked them —
                      the hub only ever emitted `#slug` anchors, so all 35
                      leaf pages were orphans with no internal PageRank
                      and no crawl path except the sitemap. The `#slug`
                      anchor above is deliberately left alone: its visible
                      label IS `#slug`, and it's the deep-link target the
                      /stack and /treasuries GlossaryTerm tooltips use. */}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 t-xs uppercase tracking-widest">
                    <a
                      href={`/glossary/${t.slug}`}
                      className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                    >
                      Full definition →
                    </a>
                    {(t.internalUrl || t.sourceUrl) && (
                      <>
                      {t.internalUrl && (
                        <a
                          href={t.internalUrl}
                          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                        >
                          See it live →
                        </a>
                      )}
                      {t.sourceUrl && (
                        <a
                          href={t.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        >
                          Source ↗
                        </a>
                      )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
