"use client";

/* =====================================================================
 * CitationBlock
 *
 * A small "Last updated · Cite as" footer block for data-heavy pages
 * (/stack, /treasuries). Two functions:
 *
 *   1. Freshness signal · explicit "Last updated YYYY-MM-DD HH:MM UTC"
 *      timestamp tells AI agents and human researchers exactly when
 *      the data they're reading was last refreshed. This is the single
 *      strongest E-E-A-T (Experience-Expertise-Authoritativeness-
 *      Trustworthiness) signal Google looks for on data pages.
 *
 *   2. Citation prompt · a copy-paste-ready citation string in a
 *      conventional format (Author, Site, URL, accessed date). Lowers
 *      friction for journalists, academic researchers, and bloggers
 *      to cite the page. External citations are the strongest possible
 *      authority signal · they directly compound search ranking.
 *
 * Why client component:
 * `accessed [date]` should reflect the visitor's local date when they
 * COPY the citation, not the SSR build time. We render with a stable
 * fallback at SSR (lastUpdated date) and hydrate the local date on
 * mount so there's no SSR-mismatch flash.
 *
 * The "Copy citation" button uses navigator.clipboard with a graceful
 * fallback for older browsers (document.execCommand). Track the click
 * via Vercel Analytics so we can measure adoption.
 * ===================================================================== */

import { useEffect, useMemo, useState } from "react";
import { track } from "@vercel/analytics";

type Props = {
  // Canonical page URL (no trailing slash, no query params).
  pageUrl: string;
  // Display name of the data ("Bitcoin Buying Gauge" /
  // "Bitcoin Treasury mNAV Scoreboard").
  dataLabel: string;
  // ISO timestamp (or Date) of the data's effective freshness. For
  // /stack this is the snapshot.asOf; for /treasuries it's the
  // last upstream poll. Pass null if you don't have one and the
  // component renders today's UTC midnight as a sensible default.
  lastUpdatedISO: string | null;
  // Optional analytics surface tag (e.g. "stack" / "treasuries") so
  // we can split copy-citation rates per page.
  surface?: string;
};

function formatUtcStamp(iso: string | null): string {
  if (!iso) {
    // Sensible fallback · today's UTC midnight. Means "we don't know
    // exactly when, but it was today." Better than blank.
    const d = new Date();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00 UTC`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // unparseable, show as-is
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Today in the VISITOR'S LOCAL timezone, formatted "May 10, 2026" ·
// the conventional citation "accessed" date. Local zone (not UTC) is
// the right call here: the reader thinks of "today" as their calendar
// day. A US visitor browsing on the evening of May 10 ET would see
// May 11 if we used UTC, which reads as a typo / time-traveling site.
// Computed at render time, not build time, so the citation shows when
// the visitor copies it.
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function CitationBlock({
  pageUrl,
  dataLabel,
  lastUpdatedISO,
  surface = "unknown",
}: Props) {
  const lastUpdated = useMemo(
    () => formatUtcStamp(lastUpdatedISO),
    [lastUpdatedISO],
  );

  // Hydrate `accessed` date on the client to avoid SSR-mismatch (server
  // and client may compute different UTC dates if the request crosses
  // midnight). Render the lastUpdated date as the SSR fallback so the
  // string is still useful for crawlers that don't execute JS.
  const [accessed, setAccessed] = useState<string>(() => {
    // SSR fallback · use lastUpdated's date as a sensible stand-in.
    if (lastUpdatedISO) {
      const d = new Date(lastUpdatedISO);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          timeZone: "UTC",
          month: "long",
          day: "numeric",
          year: "numeric",
        });
      }
    }
    return "";
  });
  useEffect(() => {
    setAccessed(todayLabel());
  }, []);

  const citation = `Galaxy Mind, "${dataLabel}," ${pageUrl}${accessed ? ", accessed " + accessed : ""}.`;

  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(citation);
      } else {
        // Fallback for very old browsers · use a hidden textarea +
        // execCommand. Deprecated but still universally supported and
        // doesn't require permissions prompt on http://localhost.
        const ta = document.createElement("textarea");
        ta.value = citation;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      track("citation_copied", { surface });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Silent fail · the citation is visible on screen for manual copy.
    }
  };

  return (
    <section
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4 sm:p-5"
      aria-labelledby={`citation-${surface}-heading`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3
          id={`citation-${surface}-heading`}
          className="font-mono t-xs uppercase tracking-[0.18em] sm:tracking-[0.25em] text-[var(--text-tertiary)]"
        >
          {/* Deliberate break segments · the single long string wrapped
              mid-word on 375px (2026-06-11). */}
          <span className="whitespace-nowrap">Data freshness</span>{" "}
          <span className="whitespace-nowrap">· cite this page</span>
        </h3>
        <span className="t-xs text-[var(--text-tertiary)]">
          Last updated{" "}
          <time
            dateTime={lastUpdatedISO ?? undefined}
            className="text-[var(--text-secondary)] tabular-nums normal-case tracking-normal"
          >
            {lastUpdated}
          </time>
        </span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        {/* The citation string · monospace + selectable text. Wrapped
            in a <blockquote> for semantic correctness · this IS a
            quotable citation. */}
        <blockquote
          className="flex-1 font-mono t-xs sm:text-xs text-[var(--text-secondary)] leading-relaxed select-all border-l-2 border-[var(--accent)]/40 pl-3"
          // Force LTR so URLs render correctly in RTL contexts.
          dir="ltr"
        >
          {citation}
        </blockquote>

        <button
          type="button"
          onClick={onCopy}
          className="micro-label self-start sm:self-stretch shrink-0 inline-flex items-baseline justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--accent)]/50 bg-[var(--bg-elevated-2)] text-[var(--text-primary)] hover:text-[var(--accent-ink)] hover:lit-active transition-all"
          aria-label="Copy citation to clipboard"
        >
          {copied ? "✓ Copied" : "Copy citation"}
        </button>
      </div>

      {/* See-also strip · routes definitional traffic to /glossary,
          methodology questions to /faq, brand context to /about. Adds
          internal-link weight to the supporting pages from every
          data-heavy page that includes a CitationBlock. Mostly an SEO
          + AI-discoverability lever; visually muted so it doesn't
          compete with the citation itself. */}
      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-baseline gap-x-4 gap-y-1 t-xs text-[var(--text-tertiary)]">
        <span>Related</span>
        <a
          href="/glossary"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          Glossary →
        </a>
        <a
          href="/faq"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          FAQ →
        </a>
        <a
          href="/about"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          About →
        </a>
      </div>
    </section>
  );
}
