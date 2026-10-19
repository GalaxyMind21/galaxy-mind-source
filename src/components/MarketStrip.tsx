"use client";

import { MarketSnapshot } from "@/app/api/market/route";

// "Fully degraded" = response object exists but every metric we'd render
// is null. The previous version showed "Live · coingecko · …" in this
// state, which was a lie — the page was offline-with-extra-steps. Now
// we explicitly call it "Degraded" so users understand the dashes are
// real, not placeholder.
function isFullyDegraded(data: MarketSnapshot): boolean {
  const mstr = data.treasuries.find((t) => t.ticker === "MSTR");
  return (
    data.btcPrice == null &&
    data.fearGreed == null &&
    data.btcVol30d == null &&
    (mstr == null || (mstr.price == null && mstr.mNAV == null))
  );
}

export function MarketStrip({
  data,
  loading,
}: {
  data: MarketSnapshot | null;
  loading: boolean;
}) {
  const mstr = data?.treasuries.find((t) => t.ticker === "MSTR");
  const degraded = data ? isFullyDegraded(data) : false;
  return (
    <div className="border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-elevated)] px-4 py-3">
      {/* Mobile: 2-col grid for legibility. sm+: single flex row. */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-5 gap-y-2 items-baseline text-xs">
        <Item label="BTC" value={data?.btcPrice ? formatUSD(data.btcPrice) : null} loading={loading} />
        <FearGreed value={data?.fearGreed ?? null} label={data?.fearGreedLabel ?? null} loading={loading} />
        <Item label="MSTR" value={mstr?.price ? formatUSD(mstr.price) : null} loading={loading} />
        <Item
          label="MSTR mNAV"
          value={mstr?.mNAV != null ? `${mstr.mNAV.toFixed(2)}x` : null}
          loading={loading}
          highlight={mNAVHighlight(mstr?.mNAV ?? null)}
        />
        <Item
          label="30d vol"
          value={data?.btcVol30d != null ? `${data.btcVol30d.toFixed(0)}%` : null}
          loading={loading}
          highlight={volHighlight(data?.btcVol30d)}
        />
        <div
          className="micro-label col-span-2 sm:ml-auto"
          style={{
            color: degraded ? "var(--warning)" : "var(--text-tertiary)",
          }}
        >
          {loading
            ? "Fetching live data…"
            : !data
              ? "Offline"
              : degraded
                ? "Degraded · upstreams unavailable"
                : `Live · ${data.source}`}
        </div>
      </div>
    </div>
  );
}

type Highlight = "good" | "warn" | "bad" | "neutral" | undefined;

function Item({
  label,
  value,
  loading,
  highlight,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  highlight?: Highlight;
}) {
  const color = highlightColor(highlight);
  return (
    <div className="flex items-baseline gap-2">
      <span className="micro-label text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="font-mono font-semibold" style={{ color, textShadow: highlight && highlight !== "neutral" ? `0 0 10px ${color}66` : undefined }}>
        {loading ? "…" : (value ?? "·")}
      </span>
    </div>
  );
}

function FearGreed({
  value,
  label,
  loading,
}: {
  value: number | null;
  label: string | null;
  loading: boolean;
}) {
  const color = fgColor(value);
  return (
    <div className="flex items-baseline gap-2">
      <span className="micro-label text-[var(--text-tertiary)]">
        F&amp;G
      </span>
      <span className="font-mono font-semibold" style={{ color, textShadow: value != null ? `0 0 10px ${color}66` : undefined }}>
        {loading ? "…" : value != null ? value : "·"}
      </span>
      {label && !loading && (
        <span className="font-mono t-xs text-[var(--text-tertiary)] uppercase">
          {label}
        </span>
      )}
    </div>
  );
}

function highlightColor(h: Highlight): string {
  switch (h) {
    case "good":
      return "var(--success)";
    case "warn":
      return "var(--warning)";
    case "bad":
      return "var(--danger)";
    case "neutral":
    default:
      return "var(--text-primary)";
  }
}

function mNAVHighlight(m: number | null): Highlight {
  if (m == null) return undefined;
  if (m >= 1.9) return "bad";
  if (m >= 1.6) return "warn";
  if (m >= 1.05) return "neutral";
  if (m >= 0.85) return "good"; // compressed = cheap accretion
  return "warn"; // sub-NAV = dilutive
}

function volHighlight(v: number | null | undefined): Highlight {
  if (v == null) return undefined;
  if (v >= 90) return "bad";
  if (v >= 70) return "warn";
  return "neutral";
}

function fgColor(v: number | null): string {
  if (v == null) return "var(--text-primary)";
  if (v >= 80) return "var(--danger)";
  if (v >= 65) return "var(--warning)";
  if (v <= 20) return "var(--success)";
  if (v <= 35) return "var(--cool-ink)";
  return "var(--text-primary)";
}

function formatUSD(n: number): string {
  if (n >= 1000)
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}
