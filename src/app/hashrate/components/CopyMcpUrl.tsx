"use client";

import { useState } from "react";

export function CopyMcpUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60 p-2">
      <code className="min-w-0 flex-1 truncate px-2 font-mono text-sm text-[var(--text-primary)]">
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
        className="inline-flex min-h-[40px] items-center rounded-full border border-[var(--accent)]/60 px-4 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent)]/10"
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
    </div>
  );
}
