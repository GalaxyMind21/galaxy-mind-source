/* =====================================================================
 * SECFilingsPanel · recent SEC filings per US-listed treasury
 *
 * Server component · reads filings:{ticker} from KV (no client fetch
 * round-trip, no JS bundle cost). The /api/cron/snapshot-filings cron
 * populates KV daily at 06:00 UTC; this component just consumes.
 *
 * Layout:
 *   - 1 column on mobile (stacked), 3 columns on lg+ (one per
 *     US-listed treasury · MSTR / XXI / ASST).
 *   - MPJPY (Metaplanet · JP-listed) is intentionally absent · its
 *     disclosures live on TDnet/JPX, not EDGAR. Future work could
 *     add a parallel TDnet ingest, but the CIK-null branch handles
 *     that gracefully today.
 *
 * Per-column content:
 *   - Header: ticker + treasury name + subtle "EDGAR" pill
 *   - Up to 3 latest filings:
 *       form badge (8-K / 10-Q / 10-K / S-3) + filing date
 *       chevron link to the primary document on sec.gov (target=_blank)
 *   - "All filings on SEC.gov →" footer link to the company's
 *     EDGAR page (the canonical "see everything" escape valve)
 *
 * Empty/error states (per-column, not whole-panel):
 *   - No KV entry yet → "Filings unavailable" + retry hint
 *   - KV entry but empty array → "No newsworthy filings in the
 *     last review window."
 * ===================================================================== */

import { kvGet, isKvConfigured } from "@/lib/kv";
import { TREASURY_META, COUNTRY_FLAG, type TreasuryMeta } from "@/lib/treasuries";
import type { Filing } from "@/lib/sec-edgar";

// SEC.gov URL for a filer's full EDGAR page · the "show me everything"
// link in each column footer. CIK is NOT zero-padded here (the
// browse-edgar UI accepts the bare numeric form).
function browseEdgarUrl(cik: number): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;
}

// Color-coded form badge · 8-K stands out (real news), 10-Q/10-K are
// quieter (scheduled), S-3 sits in between (capital-raise signal).
function formBadgeClass(form: string): string {
  switch (form) {
    case "8-K":
      // Most timely · accent-orange so it catches the eye.
      return "text-[var(--accent-ink)] border-[var(--accent)]/40 bg-[var(--accent)]/10";
    case "S-3":
      // ATM / shelf reg · noteworthy for mNAV math, slightly muted.
      return "text-[var(--text-primary)] border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60";
    default:
      // 10-Q, 10-K · scheduled cadence, quietest treatment.
      return "text-[var(--text-secondary)] border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40";
  }
}

// Human-readable form label · most filers/readers know "8-K" by name
// already, but a hover-title makes the panel friendlier to first-time
// visitors who don't speak SEC.
function formTitle(form: string): string {
  switch (form) {
    case "8-K":
      return "Current report · material events between scheduled filings";
    case "10-Q":
      return "Quarterly report · unaudited financial statements";
    case "10-K":
      return "Annual report · audited financial statements";
    case "S-3":
      return "Shelf registration · authorizes future capital raises (relevant to mNAV)";
    default:
      return form;
  }
}

// Format YYYY-MM-DD as "May 9" / "May 9, 2025" (year suppressed when
// it matches current year · saves space, common-case readability).
function formatFilingDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  const month = d.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const day = d.getUTCDate();
  return sameYear ? `${month} ${day}` : `${month} ${day}, ${d.getUTCFullYear()}`;
}

type FilingsByTicker = Partial<Record<string, Filing[]>>;

async function readFilingsFromKv(): Promise<FilingsByTicker> {
  if (!isKvConfigured()) return {};
  // Parallel KV reads · was serial in a for-of loop with await. For
  // 3 US tickers the wall-time drop is small (max-round-trip vs
  // sum-of-round-trips), but Promise.all is more idiomatic and
  // scales cleanly if a 4th US treasury (BMNR/BSTR/NAKA reconsidered)
  // ever gets added. Audit 2026-05-22.
  const tickers = Object.values(TREASURY_META)
    .filter((m) => m.cik != null)
    .map((m) => m.ticker);
  const results = await Promise.all(
    tickers.map((t) =>
      kvGet<Filing[]>(`filings:${t}`).then((list) => ({ ticker: t, list })),
    ),
  );
  const out: FilingsByTicker = {};
  for (const { ticker, list } of results) {
    if (Array.isArray(list)) out[ticker] = list;
  }
  return out;
}

export async function SECFilingsPanel({ ticker }: { ticker?: string } = {}) {
  const filingsByTicker = await readFilingsFromKv();

  // Only render columns for US-listed treasuries (cik != null). Order
  // matches TREASURY_META iteration order (declaration order). When a
  // `ticker` is passed (per-treasury page /treasuries/[ticker]), scope
  // to just that company · audit 2026-05-29 found /MSTR was rendering
  // XXI + ASST filings too. On the main /treasuries dashboard the prop
  // is omitted, so the full 3-up panel renders as before. A JP-listed
  // ticker (MPJPY, cik null) filters to empty → the caller's `cik` gate
  // already skips the section, but the filter is correct regardless.
  const usTreasuries = Object.values(TREASURY_META).filter(
    (m): m is TreasuryMeta & { cik: number } =>
      m.cik != null && (!ticker || m.ticker === ticker),
  );

  return (
    <section
      aria-labelledby="sec-filings-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2
          id="sec-filings-heading"
          className="text-lg font-semibold tracking-tight text-[var(--text-primary)]"
        >
          Recent SEC Filings
        </h2>
        <a
          href="https://www.sec.gov/edgar/search-and-access"
          target="_blank"
          rel="noopener noreferrer"
          className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          Source · EDGAR ↗
        </a>
      </header>
      <p className="text-xs text-[var(--text-tertiary)] mb-5">
        {ticker
          ? "Most recent 8-K, 10-Q, 10-K, and S-3 filings. Updated daily from EDGAR."
          : "Most recent 8-K, 10-Q, 10-K, and S-3 filings per US-listed treasury. Updated daily. Metaplanet (JP-listed) discloses on TDnet, not EDGAR."}
      </p>

      <div
        className={`grid gap-4 ${
          usTreasuries.length === 1
            ? "grid-cols-1 max-w-md"
            : "grid-cols-1 lg:grid-cols-3"
        }`}
      >
        {usTreasuries.map((meta) => {
          const filings = filingsByTicker[meta.ticker] ?? null;
          return (
            <FilingsColumn key={meta.ticker} meta={meta} filings={filings} />
          );
        })}
      </div>
    </section>
  );
}

function FilingsColumn({
  meta,
  filings,
}: {
  meta: TreasuryMeta & { cik: number };
  filings: Filing[] | null;
}) {
  const flag = COUNTRY_FLAG[meta.country];
  // Top-3 visible · the cron stores up to 10 so future "expand" UX
  // can pull more without changing the cron.
  const visible = filings?.slice(0, 3) ?? [];

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
            {meta.ticker}
          </span>
          <span className="text-xs text-[var(--text-tertiary)] truncate">
            {meta.name}
          </span>
        </div>
        <span className="text-xs leading-none" aria-label={`Listed in ${meta.country}`}>
          {flag}
        </span>
      </div>

      {filings == null ? (
        <div className="text-xs text-[var(--text-tertiary)] italic py-3">
          Filings cache missing · refresh later.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-[var(--text-tertiary)] italic py-3">
          No newsworthy filings in the recent window.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((f) => (
            <li key={f.accessionNumber}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 px-2 py-1.5 -mx-2 rounded-md hover:bg-[var(--accent)]/5 transition-colors group"
                title={formTitle(f.form)}
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`font-mono t-xs uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded border shrink-0 ${formBadgeClass(f.form)}`}
                  >
                    {f.form}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums truncate">
                    {formatFilingDate(f.filingDate)}
                  </span>
                </span>
                <span
                  className="text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] group-hover:translate-x-0.5 transition-all shrink-0"
                  aria-hidden
                >
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <a
        href={browseEdgarUrl(meta.cik)}
        target="_blank"
        rel="noopener noreferrer"
        className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors mt-auto pt-2 border-t border-[var(--border-subtle)]/60"
      >
        All filings on SEC.gov →
      </a>
    </div>
  );
}
