"use client";

// Embed-snippet block with a one-click copy-to-clipboard button.
// Friction-reduction (Tier 3b): the embed page existed but a developer
// who liked the widget still had to triple-click + Cmd-C the <pre>
// block. The whole point of an embed page is "make this trivial to
// drop in" · a copy button was the missing yard on the funnel.

import { useState } from "react";

export function EmbedSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(snippet);
        setCopied(true);
        // Reset back to default copy after a couple seconds so
        // re-copying after edits feels responsive.
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* clipboard denied · keep silent, the user can still
         triple-click the pre block */
    }
  }

  return (
    <div className="relative">
      <pre className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 pr-20 overflow-x-auto text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)]">
        <code>{snippet}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-3 right-3 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] font-mono t-xs uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
        aria-label={copied ? "Copied to clipboard" : "Copy embed snippet"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
