"use client";

// The smallest possible sitewide personality touch · one quiet
// Saylor maxim in the footer that changes daily (day-of-year indexed
// into the shared list · deterministic, no timer). Mount-gated so
// there is no SSR/client hydration mismatch at the UTC-midnight
// boundary · it simply fades in just under the footer nav. Theme-safe
// (renders on the page background, uses theme vars).

import { useEffect, useState } from "react";
import { SAYLOR_QUOTES } from "@/lib/saylor-quotes";

export function FooterMaxim() {
  const [quote, setQuote] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    const doy = Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), 0, 0)) /
        86_400_000,
    );
    setQuote(SAYLOR_QUOTES[doy % SAYLOR_QUOTES.length]);
  }, []);

  if (!quote) return null;

  return (
    <div className="mb-5 font-mono t-xs tracking-wide text-[var(--text-tertiary)] italic">
      {quote} <span className="not-italic">· Michael Saylor</span>
    </div>
  );
}
