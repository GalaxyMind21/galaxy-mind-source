"use client";

// A pair of small "CSV / JSON" download pills for data-heavy surfaces
// (/treasuries live table, /float allocation). The page builds the export
// payload from data it already has and passes it here; the download is
// pure client-side (see lib/export.ts), so there's no new network request.
// Style matches the directory filter pills + CitationBlock.

import { track } from "@vercel/analytics";
import { downloadCSV, downloadJSON } from "@/lib/export";

const PILL =
  "font-mono t-xs uppercase tracking-widest px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors";

export function ExportButtons({
  surface,
  filename,
  rows,
  csvHeaders,
  json,
}: {
  /** Analytics tag identifying the page. */
  surface: string;
  /** Base filename with no extension, e.g. "galaxymind-treasuries-2026-06-26". */
  filename: string;
  /** Flat rows for the CSV. */
  rows: Record<string, unknown>[];
  /** Optional explicit column order for the CSV. */
  csvHeaders?: string[];
  /** The full JSON payload (typically rows + a `_meta` block). */
  json: unknown;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        Export
      </span>
      <button
        type="button"
        onClick={() => {
          downloadCSV(`${filename}.csv`, rows, csvHeaders);
          track("data_export", { surface, format: "csv" });
        }}
        className={PILL}
      >
        CSV
      </button>
      <button
        type="button"
        onClick={() => {
          downloadJSON(`${filename}.json`, json);
          track("data_export", { surface, format: "json" });
        }}
        className={PILL}
      >
        JSON
      </button>
    </div>
  );
}
