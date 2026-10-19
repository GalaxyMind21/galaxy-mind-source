"use client";

import { useState } from "react";

/** Small copy-to-clipboard button. Says "Copied" for 2 s, announced politely. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      aria-live="polite"
      className={`inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-full border border-[var(--accent)]/60 px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent)]/10 ${className}`}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
