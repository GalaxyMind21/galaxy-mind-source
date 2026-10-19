// Page frame for /hashrate/rent: the Night Bench lamp wash the frosted
// checkout panels sit on, plus the breadcrumb kicker. Shared by both states
// (checkout open / opening soon) so they read as one destination.
import Link from "next/link";
import type { ReactNode } from "react";

export function RentShell({ children }: { children: ReactNode }) {
  return (
    <main className="nb-bench mx-auto w-full min-w-0 max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="relative">
        <p className="night-bench-kicker">
          <Link
            href="/hashrate"
            className="text-[var(--text-secondary)] underline underline-offset-2 decoration-[var(--text-tertiary)]/50 hover:text-[var(--text-primary)]"
          >
            Rent hashrate
          </Link>{" "}
          <span aria-hidden>/</span> Checkout
        </p>
        {children}
      </div>
    </main>
  );
}
