"use client";

import { Asset } from "@/lib/assets";
import { motion } from "framer-motion";

export function AssetCard({
  asset,
  highlighted,
  onClick,
}: {
  asset: Asset;
  highlighted?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`text-left rounded-lg border p-4 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-2)] transition-colors w-full ${
        highlighted
          ? "pulse-border border-[var(--accent)]"
          : "border-[var(--border-subtle)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-mono text-base font-semibold text-[var(--text-primary)]">
          {asset.ticker}
        </span>
        <VolBadge score={asset.volatilityScore} />
      </div>
      <div className="text-xs text-[var(--text-secondary)] mb-2 line-clamp-1">
        {asset.name}
      </div>
      <p className="text-xs text-[var(--text-tertiary)] leading-snug line-clamp-2 mb-3">
        {asset.oneLiner}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {asset.rocEligible && <Tag>ROC-eligible</Tag>}
        <Tag muted>{categoryLabel(asset.category)}</Tag>
        {asset.yieldRange && (
          <Tag muted>
            {asset.yieldRange[0] === asset.yieldRange[1]
              ? `${asset.yieldRange[0]}%`
              : `${asset.yieldRange[0]}–${asset.yieldRange[1]}%`}
          </Tag>
        )}
      </div>
    </motion.button>
  );
}

function categoryLabel(c: Asset["category"]): string {
  switch (c) {
    case "spot":
      return "Spot";
    case "spot-etf":
      return "Spot ETF";
    case "equity":
      return "Equity";
    case "preferred":
      return "Preferred";
    case "income-etf":
      return "Income ETF";
    case "leveraged-etf":
      return "Leveraged ETF";
  }
}

export function Tag({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`t-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
        muted
          ? "bg-[var(--bg-elevated-2)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]"
          : "bg-[var(--accent)]/10 text-[var(--accent-ink)] border border-[var(--accent)]/30"
      }`}
    >
      {children}
    </span>
  );
}

export function VolBadge({ score }: { score: number }) {
  return (
    <span className="micro-label text-[var(--text-tertiary)]">
      vol{" "}
      <span className="text-[var(--text-secondary)]">{score.toFixed(0)}/10</span>
    </span>
  );
}
