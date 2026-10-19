// SEC EDGAR client · fetches recent filings for a single CIK.
//
// Why hand-rolled (no SDK):
// EDGAR's submissions endpoint is one URL with one well-defined JSON
// shape. The whole thing is ~80 lines of fetch + array transposition.
// Pulling in `edgar-rest`, `node-edgar`, etc. would add a 100KB+
// dependency for what amounts to one HTTP call and a parallel-array
// flatten. Same minimalism principle as lib/kv.ts.
//
// Endpoint:
//   GET https://data.sec.gov/submissions/CIK{0..0+CIK}.json
// where the CIK is zero-padded to exactly 10 digits. EDGAR redirects
// or 404s if the padding is wrong, so we always pad.
//
// EDGAR fair-use rules (https://www.sec.gov/os/accessing-edgar-data):
//   - Identify yourself in the User-Agent header. We send
//     "Galaxy Mind ops@galaxymind.space" · EDGAR has no auth/key
//     system, the UA string is the contact channel for abuse.
//   - 10 requests/second cap. We make 3 requests per day total
//     (one per US-listed treasury via the daily cron) · ~6 orders
//     of magnitude under the limit.
//
// Response shape (only the fields we use):
//   {
//     "cik": "1050446",
//     "name": "Strategy Inc",
//     "tickers": ["MSTR"],
//     "filings": {
//       "recent": {
//         "accessionNumber": ["0001628280-26-001234", ...],
//         "filingDate":      ["2026-05-09", ...],
//         "form":            ["8-K", "10-Q", ...],
//         "primaryDocument": ["mstr-20260509.htm", ...],
//         // (other parallel arrays we don't use: reportDate, items,
//         //  size, isXBRL, isInlineXBRL, primaryDocDescription)
//       },
//       "files": [...]  // historical pages · we ignore (only "recent" is needed)
//     }
//   }
//
// Note the parallel-array structure · EDGAR's old "transpose later"
// schema. We zip them into a normal array of {form, date, ...} objects
// at parse time.
//
// Form filter: we only surface 8-K (current report · the
// "newsworthy" one), 10-Q (quarterly), 10-K (annual), and S-3 (shelf
// registration · catches ATM updates relevant to mNAV math). Excluded:
//   - Form 4 / 4/A: insider stock transactions · too noisy for the
//     "what's new with this treasury" framing
//   - SC 13G / 13D: institutional ownership · same noise problem
//   - DEF 14A: proxy statements · annual ritual, not news
//   - FWP, 424B*, 425, etc.: prospectus addenda · too granular
// If the page ever wants a "show all forms" toggle, drop the filter.

import { validateOutboundUrl } from "./outbound-url";

// Forms that count as "newsworthy" for the /treasuries panel.
// Order matters for tie-breaking in the rare event of two filings on
// the same date · 8-K is most timely so it wins.
const SURFACED_FORMS = new Set(["8-K", "10-Q", "10-K", "S-3"]);

// EDGAR fair-use User-Agent · the contact email is the abuse channel.
// Don't change without updating the contact destination.
const USER_AGENT = "Galaxy Mind ops@galaxymind.space";

// Hard timeout · EDGAR's p99 is sub-500ms but defense in depth.
const FETCH_TIMEOUT_MS = 5_000;

export type Filing = {
  form: string;            // "8-K", "10-Q", etc.
  filingDate: string;      // "YYYY-MM-DD" · the date EDGAR received the filing
  accessionNumber: string; // "0001628280-26-001234" · unique filing ID
  primaryDocument: string; // "mstr-20260509.htm" · the actual filing document name
  url: string;             // Pre-built sec.gov URL pointing at the primary document
};

/**
 * Build the human-readable URL for a filing's primary document.
 * EDGAR's archive URL layout:
 *   /Archives/edgar/data/{cik}/{accession-no-dashes}/{primaryDocument}
 *
 * The accession number must have its dashes stripped (EDGAR stores
 * the document directories using the no-dash form). The CIK is NOT
 * zero-padded in archive URLs (that's only for the submissions API).
 */
function buildFilingUrl(
  cik: number,
  accessionNumber: string,
  primaryDocument: string,
): string {
  const accNoDash = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${primaryDocument}`;
}

/**
 * Fetch the most recent filings for a single CIK and return up to
 * `cap` newsworthy ones (form ∈ SURFACED_FORMS), sorted by filing
 * date descending.
 *
 * Returns:
 *   - Filing[] on success (may be empty if the filer has no recent
 *     newsworthy filings · entirely valid for thinly-active filers)
 *   - null on network failure, 5xx, or unparseable response · caller
 *     should treat as "data unavailable, retry tomorrow"
 *
 * Does NOT throw on 4xx · those indicate either a wrong CIK (caller
 * config bug · log + null) or EDGAR rate-limiting (very unlikely
 * given our 3-call/day budget · log + null and try tomorrow).
 */
export async function fetchRecentFilings(
  cik: number,
  cap = 10,
): Promise<Filing[] | null> {
  const padded = String(cik).padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;

  // Defense in depth · the URL is constructed from a trusted
  // numeric CIK + a hardcoded host so this should always pass, but
  // routing all outbound user-related fetches through the same
  // validator means no surprises if the file ever drifts.
  const validation = validateOutboundUrl(url);
  if (!validation.ok) {
    console.error(`[sec-edgar] URL validation failed: ${validation.reason}`);
    return null;
  }

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!r.ok) {
      console.error(
        `[sec-edgar] CIK ${padded} HTTP ${r.status}`,
        await r.text().catch(() => ""),
      );
      return null;
    }
    const body = (await r.json()) as {
      filings?: {
        recent?: {
          accessionNumber?: string[];
          filingDate?: string[];
          form?: string[];
          primaryDocument?: string[];
        };
      };
    };
    const recent = body?.filings?.recent;
    if (
      !recent ||
      !Array.isArray(recent.form) ||
      !Array.isArray(recent.filingDate) ||
      !Array.isArray(recent.accessionNumber) ||
      !Array.isArray(recent.primaryDocument)
    ) {
      console.error(`[sec-edgar] CIK ${padded} unexpected response shape`);
      return null;
    }

    // Transpose parallel arrays → array of filing objects. Length
    // mismatches between arrays would indicate a malformed response;
    // we use the form array's length as the canonical row count and
    // skip rows where any field is missing.
    const out: Filing[] = [];
    const n = recent.form.length;
    for (let i = 0; i < n; i++) {
      const form = recent.form[i];
      const filingDate = recent.filingDate[i];
      const accessionNumber = recent.accessionNumber[i];
      const primaryDocument = recent.primaryDocument[i];
      if (!form || !filingDate || !accessionNumber || !primaryDocument) {
        continue;
      }
      if (!SURFACED_FORMS.has(form)) continue;
      out.push({
        form,
        filingDate,
        accessionNumber,
        primaryDocument,
        url: buildFilingUrl(cik, accessionNumber, primaryDocument),
      });
    }

    // EDGAR returns recent.recent in reverse chronological order
    // already, but defensive sort in case that contract ever
    // changes. Most-recent first.
    out.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));

    return out.slice(0, cap);
  } catch (e) {
    console.error(
      `[sec-edgar] CIK ${padded} fetch failed:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
