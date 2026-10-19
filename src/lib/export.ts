// Tiny client-side data-export helpers · turn an array of plain rows (or
// any JSON value) into a downloaded file with NO server roundtrip — the
// data is already in the page. Browser-only: uses Blob +
// URL.createObjectURL + a synthetic <a download>. Call only from client
// components (the ExportButtons component is the intended caller).

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a tick to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// RFC 4180 cell escaping · quote when the value contains a comma, quote,
// CR, or LF; escape embedded quotes by doubling. Null/undefined → empty
// cell (spreadsheets read that as a blank, which is what a missing
// upstream value should look like).
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Download `rows` as a CSV. Columns default to the keys of the first row;
 * pass `headers` to fix the column order / subset.
 */
export function downloadCSV(
  filename: string,
  rows: Record<string, unknown>[],
  headers?: string[],
): void {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [
    cols.map(csvCell).join(","),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
  ];
  triggerDownload(
    new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }),
    filename,
  );
}

/** Download any JSON-serializable value as a pretty-printed .json file. */
export function downloadJSON(filename: string, data: unknown): void {
  triggerDownload(
    new Blob([JSON.stringify(data, null, 2) + "\n"], {
      type: "application/json",
    }),
    filename,
  );
}
