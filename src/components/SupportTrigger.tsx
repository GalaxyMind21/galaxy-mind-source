"use client";

import { track } from "@vercel/analytics";

/**
 * Opens the support modal from anywhere, including server components.
 *
 * SiteFooter is server-rendered and SiteHeader owns the modal state, so
 * this dispatches the `gm:support` event the header listens for — the same
 * convention SiteHeader already uses to open CommandPalette via
 * `gm:palette`, rather than prop-drilling state through the layout.
 *
 * The footer previously had NO support entry at all, and the only way in
 * was a bare ⚡ glyph in the header that reads as decoration.
 */
export function SupportTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        track("support_open", { source: "footer" });
        window.dispatchEvent(new CustomEvent("gm:support"));
      }}
      className="text-left text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
    >
      {label}
    </button>
  );
}
