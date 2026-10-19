import type { SignalReading } from "@/lib/stack";
import { SignalDial } from "./SignalDial";

// Per-signal historical normalized values keyed by signal name.
// Server passes this in pre-computed from the daily snapshot KV
// stream so each dial can render its own 30-day sparkline.
export type SignalHistoryMap = Record<string, number[]>;

export function SignalCockpit({
  signals,
  history,
}: {
  signals: SignalReading[];
  history?: SignalHistoryMap;
}) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="micro-label text-[var(--text-tertiary)]">
          Signal Cockpit
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
          The ten inputs voting on the verdict above. Each gauge fills
          proportional to its reading ·{" "}
          <span className="text-[var(--accent-ink)]">orange fill</span> = buy
          signal, <span style={{ color: "var(--cool-ink)" }}>icy blue fill</span> =
          wait. The fuller a gauge glows, the harder that signal is pushing
          the verdict. Peak-pegged gauges throw lava sparks; floor-pegged
          gauges throw ice shards.{" "}
          <span className="text-[var(--text-tertiary)]">
            Tap the{" "}
            <span className="font-mono inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--text-tertiary)] t-xs mx-0.5">
              i
            </span>{" "}
            on any card to learn what that signal measures.
          </span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {signals.map((s) => (
          <SignalDial
            key={s.name}
            s={s}
            history={history?.[s.name] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
