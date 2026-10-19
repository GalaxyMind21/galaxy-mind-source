// Bay grid (B3): one tile per configured bay, from bayBoard(). n is data, never a constant.
import type { BayBoard as Board } from "@/lib/rentals/phase2/service";

/** B7: "Back in ~N h" for a bay rented elsewhere, from its reported end time (a time only, never who rents it). */
export function backInLabel(backAt: string | undefined, now: number = Date.now()): string | null {
  const t = backAt ? Date.parse(backAt) : NaN;
  if (!Number.isFinite(t) || t <= now) return null;
  const h = (t - now) / 3_600_000;
  return h < 1 ? "Back in under 1 h" : `Back in ~${Math.round(h)} h`;
}

export function BayBoard({ board, title, openLabel, rentedLabel, unavailableLabel = "Unavailable" }: { board: Board; title: string; openLabel: string; rentedLabel: string; unavailableLabel?: string }) {
  return (
    <section aria-labelledby="bays-h" className="glass-rest rounded-2xl p-5 sm:p-6" data-bay-board>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bays-h" className="micro-label text-[var(--text-tertiary)]">{title}</h2>
        <p className="font-mono text-[13px] tabular-nums text-[var(--text-secondary)]">
          {board.available} of {board.total} open
        </p>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {board.bays.map((b) => (
          <li
            key={b.bay}
            data-bay-state={b.state}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${b.state === "open" ? "border-emerald-400/30 bg-emerald-400/5" : "border-[var(--nb-hair-2)] bg-[var(--bg-base)]/30"}`}
          >
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${b.state === "open" ? "bay-dot-open" : "bg-[var(--text-tertiary)]/50"}`} />
            <span className="min-w-0">
              <span className="block font-mono text-[13px] text-[var(--text-tertiary)]">Rig {b.bay}</span>
              <span className={`block text-[15px] font-semibold ${b.state === "open" ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>
                {b.state === "open" ? openLabel : b.state === "unavailable" ? unavailableLabel : rentedLabel}
              </span>
              {b.state === "rented" && backInLabel(b.backAt) ? (
                <span className="block font-mono text-[12px] text-[var(--text-tertiary)]" data-bay-back>{backInLabel(b.backAt)}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
