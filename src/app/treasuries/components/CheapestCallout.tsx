/**
 * Hero card highlighting the single cheapest treasury (lowest mNAV) right
 * now. Bold, screenshot-friendly — this is the line of copy that gets
 * shared on X when someone discovers the page.
 */
import { COUNTRY_FLAG, TREASURY_META, mNavInterpretation } from "@/lib/treasuries";
import type { Quote } from "@/lib/market";
import { ShareCheapestButton } from "./ShareCheapestButton";

export function CheapestCallout({ rows }: { rows: Quote[] }) {
  // Find the lowest non-null mNAV.
  const cheapest = rows
    .filter((r) => r.mNAV != null)
    .sort((a, b) => (a.mNAV ?? Infinity) - (b.mNAV ?? Infinity))[0];

  if (!cheapest || cheapest.mNAV == null) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
        <div className="micro-label text-[var(--text-tertiary)]">
          Live Cheapest Treasury
        </div>
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">
          Live data not reporting. Try again in a moment.
        </p>
      </div>
    );
  }

  const meta = TREASURY_META[cheapest.ticker];
  const interp = mNavInterpretation(cheapest.mNAV);
  const flag = meta?.country ? COUNTRY_FLAG[meta.country] : "";
  const isCheap = cheapest.mNAV < 1.0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-[#7ec0ff]/40 bg-[var(--bg-elevated)] p-6 sm:p-8 elevate">
      {/* Cool icy backdrop, tying visual into the /stack 'frozen' vocabulary */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 0% 0%, rgba(126,192,255,0.10), transparent 70%), radial-gradient(ellipse 50% 60% at 100% 100%, rgba(126,192,255,0.06), transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="micro-label text-[var(--cool-ink)]">
          ★ Cheapest Right Now
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-3xl sm:text-4xl font-semibold text-[var(--text-primary)] tracking-wide">
            {cheapest.ticker}
          </span>
          <span className="text-base sm:text-lg text-[var(--text-secondary)]">
            {meta?.name ?? cheapest.ticker}
          </span>
          {flag && <span className="text-xl leading-none">{flag}</span>}
        </div>

        <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div
              className="font-mono tabular-nums text-5xl sm:text-6xl"
              style={{
                color: isCheap ? "var(--cool-ink)" : "var(--accent)",
                textShadow: isCheap
                  ? "0 0 20px rgba(126,192,255,0.5), 0 0 40px rgba(126,192,255,0.3)"
                  : "0 0 20px rgba(247,147,26,0.5)",
              }}
            >
              {cheapest.mNAV.toFixed(2)}×
            </div>
            <div className="micro-label mt-1 text-[var(--text-tertiary)]">
              mNAV
            </div>
          </div>

          <div className="flex-1 min-w-[200px]">
            <div className="micro-label text-[var(--text-tertiary)]">
              {interp.label}
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
              {interp.detail}
            </p>
          </div>
        </div>

        <ShareCheapestButton
          ticker={cheapest.ticker}
          mNAV={cheapest.mNAV}
          name={meta?.name}
        />
      </div>
    </div>
  );
}
