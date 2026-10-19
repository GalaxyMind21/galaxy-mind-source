// Custom 404. Mirrors the brand aesthetic so a mistyped URL doesn't drop
// the user onto Next.js's generic placeholder. Two clear destinations:
// the directory and the engine — same as the rest of the site's nav.
import Link from "next/link";

export const metadata = {
  title: "404 · Galaxy Mind",
  description: "This page doesn't exist.",
};

export default function NotFound() {
  return (
    <main className="min-h-screen flex-1 flex items-center justify-center px-4 sm:px-6">
      <div className="max-w-md w-full text-center">
        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          Block orphaned
        </div>
        <h1 className="font-mono text-7xl sm:text-8xl font-bold text-[var(--accent-ink)] glow-text mb-4 tabular-nums">
          404
        </h1>
        <p className="text-[var(--text-secondary)] text-base sm:text-lg mb-3 leading-relaxed">
          This block was orphaned. Not your URL, not your coins.
        </p>
        <p className="text-[var(--text-tertiary)] text-sm mb-10 leading-relaxed">
          The page you wanted never made it into the chain. Zoom out
          and head back to one that did.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="micro-label inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
          >
            ← Vendor Directory
          </Link>
          <Link
            href="/fit"
            className="micro-label inline-flex items-center justify-center px-5 py-2.5 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Find your bitcoin fit. →
          </Link>
        </div>

        <div className="mt-12 t-xs font-medium text-[var(--text-tertiary)]">
          galaxymind.space
        </div>
      </div>
    </main>
  );
}
