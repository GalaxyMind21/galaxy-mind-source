"use client";

// App Router error boundary. Without this, an unhandled exception in
// any client component below the root layout would render Next's blank
// "Application error: a client-side exception has occurred" screen,
// with no telemetry and nothing for the user to do.
//
// This boundary:
//   • Logs the error to Vercel Analytics so we can see prod crashes
//     (anonymous, no PII — just digest + path).
//   • Renders a recoverable fallback that matches the site design.
//   • Provides a "Try again" button that calls Next's `reset` to
//     re-mount the segment. Catches transient hydration / fetch fails.
//
// Note: this only catches errors below the root layout; for layout
// crashes use `global-error.tsx`. We don't ship one because the layout
// is minimal (fonts + analytics) and unlikely to throw — the cost of
// a second "use client" entry point + duplicated chrome wasn't worth
// it for an unlikely failure mode.
import { useEffect } from "react";
import { track } from "@vercel/analytics";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the crash so we know it happened. `digest` is Next's
    // hashed identifier we can correlate with server logs.
    track("client_error", {
      digest: error.digest ?? "no-digest",
      message: error.message.slice(0, 200),
    });
    // Also dump to console for dev / locally.
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <main className="min-h-screen flex-1 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-4">
          Something broke
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)] mb-4">
          We hit an unexpected error.
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-8 leading-relaxed">
          The page failed to render. The crash has been logged. You can
          try reloading this view, or head back to the home page.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={reset}
            className="micro-label font-semibold px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
          >
            Try again
          </button>
          <a
            href="/"
            className="micro-label px-5 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-colors"
          >
            ← Home
          </a>
        </div>
        {error.digest && (
          <div className="micro-label mt-8 text-[var(--text-tertiary)]">
            ref · {error.digest}
          </div>
        )}
      </div>
    </main>
  );
}
