const SIGNALS = [
  {
    abbr: "MVRV",
    name: "Market Value to Realized Value",
    weight: 16,
    plain:
      "Market cap divided by realized cap. Below 1.0 means the average bitcoin holder is underwater · historically a strong accumulation zone. Above 3.0 is rare and tends to coincide with cycle tops.",
  },
  {
    abbr: "Mayer Multiple",
    name: "Price ÷ 200-day Moving Average",
    weight: 14,
    plain:
      "How far price has stretched from its long-run trend. Below 1.0 puts you in 'cheap relative to the cycle' territory; above 2.4 has historically marked frothy markets.",
  },
  {
    abbr: "Puell Multiple",
    name: "Miner Issuance vs 365-day Average",
    weight: 13,
    plain:
      "Today's daily issuance value (in USD) divided by its 365-day moving average. When this drops below 0.5, miners are earning far less than they have been on average · they capitulate, sell coins, and accumulators benefit. Every major bottom (Dec 2018, Mar 2020, Nov 2022) printed below 0.5; every major top printed above 4.0.",
  },
  {
    abbr: "Funding Rate",
    name: "Perpetual Futures Funding",
    weight: 12,
    plain:
      "How much long-side traders are paying short-side traders to hold a position open (or vice versa). Negative funding means shorts are paying longs · i.e., the market is positioned bearishly. That's contrarian-bullish for spot buyers.",
  },
  {
    abbr: "Fear & Greed",
    name: "Crowd Sentiment Index",
    weight: 10,
    plain:
      "A composite of social sentiment, volatility, and momentum. We invert it: extreme fear is a green light for accumulators, extreme greed is a yellow flag.",
  },
  {
    abbr: "Price vs 30d MA",
    name: "Short-term Mean Reversion",
    weight: 9,
    plain:
      "Where price sits relative to its 30-day moving average. Trading below the 30d MA tends to revert upward; trading well above tends to mean-revert downward.",
  },
  {
    abbr: "30d Realized Vol",
    name: "Recent Volatility",
    weight: 7,
    plain:
      "Annualized volatility from the last 30 days of returns. Quiet markets (vol < 40%) often precede moves; very high vol (> 100%) often brackets capitulation lows.",
  },
  {
    abbr: "Hour-of-Day",
    name: "Time-of-Day Pattern",
    weight: 7,
    plain:
      "Bitcoin trades 24/7, but it doesn't trade evenly. We look at the average hourly return over the last ~2 years for the current ET hour. Hours that have historically been weak become better entry windows.",
  },
  {
    abbr: "Day-of-Week",
    name: "Day-of-Week Pattern",
    weight: 6,
    plain:
      "Same idea as Hour-of-Day but for weekdays. Sunday afternoons and weekday Asian-session opens have historically shown different baselines than US trading hours.",
  },
  {
    abbr: "MSTR mNAV",
    name: "Treasury Premium (Smart Money Proxy)",
    weight: 6,
    plain:
      "Strategy's market cap divided by the value of its bitcoin holdings. When this premium compresses below 1.05×, treasury equity is trading near or below its underlying BTC value · historically correlated with BTC bottoms because the marginal sophisticated buyer prefers spot at those moments.",
  },
];

// The five verdict bands · rendered as a map so exactly ONE can carry
// the live highlight (operator report 2026-06-11: the old hardcoded
// markup accent-styled BOTH action tiers, which read as "we are in two
// tiers at once").
const TIER_BANDS = [
  { min: 0, max: 20, label: "HOLD", note: "crowd is euphoric" },
  { min: 21, max: 40, label: "STACK SMALL", note: "patience pays" },
  { min: 41, max: 60, label: "STACK", note: "DCA on schedule" },
  { min: 61, max: 80, label: "STACK NOW", note: "stack with conviction" },
  { min: 81, max: 100, label: "STACK HUGE", note: "blood in the streets" },
];

export function HowItWorks({ score }: { score?: number }) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8">
      <h2 className="micro-label text-[var(--text-tertiary)]">
        How this works
      </h2>

      <div className="mt-6 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
        <p>
          The{" "}
          <span className="text-[var(--accent-ink)]">Bitcoin Buying Gauge</span>{" "}
          answers one question for accumulators:{" "}
          <em className="text-[var(--text-primary)] not-italic">is now a better-than-average time to deploy capital?</em>
        </p>
        <p>
          It is a{" "}
          <strong className="text-[var(--text-primary)] font-normal">
            contrarian
          </strong>{" "}
          answer by design. The gauge lights up brightest when Fear &amp; Greed is screaming
          sell, when shorts are paying longs, when the average bitcoin holder is
          underwater on cost basis, and when the most public bitcoin treasury
          stops trading at a premium to its coins. Every one of those is a
          moment when buying feels worst.
        </p>
        <p>
          The framing matters. The page assumes you&apos;re going to buy bitcoin
          eventually · maybe today, maybe across this week, maybe with a paycheck
          arriving Friday. There is no &quot;bad&quot; time to stack on a long enough
          horizon. There are{" "}
          <em className="text-[var(--text-primary)] not-italic">better</em>{" "}
          times,
          though, and the difference between a good entry and a poor one
          compounds in sats.
        </p>
        <p>
          So the verdict is a single number from <span className="font-mono text-[var(--text-primary)]">0</span> to{" "}
          <span className="font-mono text-[var(--text-primary)]">100</span>, with a tier word for at-a-glance
          reading:
        </p>
      </div>

      <div className="micro-label mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {TIER_BANDS.map((band) => {
          const active =
            typeof score === "number" &&
            score >= band.min &&
            score <= band.max;
          return (
            <div
              key={band.label}
              className={
                active
                  ? "rounded border border-[var(--accent)] bg-[rgba(247,147,26,0.08)] px-3 py-2 text-center text-[var(--accent-ink)] lit-active"
                  : "rounded border border-[var(--border-subtle)] px-3 py-2 text-center text-[var(--text-tertiary)]"
              }
            >
              {band.min}–{band.max}
              <br />
              {band.label}
              <div className="mt-1 normal-case tracking-normal t-xs opacity-70">
                {band.note}
              </div>
              {active && (
                <div className="mt-1.5 inline-flex items-center gap-1 t-xs tracking-[0.2em]">
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] live-pulse"
                  />
                  TODAY
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
        <p>
          The score blends ten signals. Each signal contributes a weighted vote;
          when a data source is temporarily unavailable, its weight redistributes
          proportionally across the survivors. Signals are organized into four
          rough buckets: <strong className="text-[var(--text-primary)] font-normal">on-chain valuation</strong>{" "}
          (MVRV, Mayer Multiple, Puell Multiple), <strong className="text-[var(--text-primary)] font-normal">positioning</strong>{" "}
          (funding rate), <strong className="text-[var(--text-primary)] font-normal">sentiment & momentum</strong>{" "}
          (Fear &amp; Greed, price-vs-30d, realized vol, time-of-day, day-of-week),
          and <strong className="text-[var(--text-primary)] font-normal">smart-money proxy</strong>{" "}
          (MSTR mNAV).
        </p>
      </div>

      {/* Per-signal deep-dive · collapsed by default to keep the page
          scannable. The summary line stays visible at all times so the
          information IS discoverable; users who want the rationale tap
          to expand. Native <details> · no JS, accessible, keyboard-
          navigable. (Audit 2026-05-14 design-review change.) */}
      <details className="mt-6 group">
        <summary className="cursor-pointer list-none flex items-baseline justify-between gap-3 border-t border-[var(--border-subtle)] pt-4 select-none">
          <span className="micro-label text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
            10 signals · per-signal rationale
          </span>
          <span className="font-mono t-xs tabular-nums text-[var(--text-tertiary)] whitespace-nowrap">
            tap to expand <span className="ml-1 inline-block transition-transform group-open:rotate-90">▸</span>
          </span>
        </summary>
        <div className="mt-4 space-y-4">
          {SIGNALS.map((s) => (
            <div key={s.abbr} className="border-t border-[var(--border-subtle)] pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="micro-label text-[var(--text-primary)]">
                  {s.abbr} <span className="text-[var(--text-tertiary)] normal-case tracking-normal t-xs">· {s.name}</span>
                </h3>
                <span className="font-mono t-xs tabular-nums text-[var(--text-tertiary)] whitespace-nowrap">
                  weight {s.weight}%
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
                {s.plain}
              </p>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-8 border-t border-[var(--border-subtle)] pt-6 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
        <h3 className="micro-label text-[var(--text-tertiary)]">
          The 7-day forecast
        </h3>
        <p>
          The heatmap above the cockpit shows 168 cells (7 days × 24 hours) of
          predicted entry attractiveness. Each cell blends three things: today&apos;s
          score (decayed linearly toward neutral as the forecast extends out),
          the historical pattern for that hour-of-day in ET, and the historical
          pattern for that day-of-week. The brightest cells are your best
          windows. The current cell pulses.
        </p>
        <p>
          This is not a price prediction. It&apos;s a relative-attractiveness
          forecast: which hours look like better-than-average accumulation windows
          given everything we know right now.
        </p>
      </div>

      <div className="mt-8 border-t border-[var(--border-subtle)] pt-6 space-y-3 text-xs text-[var(--text-tertiary)] leading-relaxed">
        <h3 className="micro-label text-[var(--text-tertiary)]">
          Honest caveats
        </h3>
        <p>
          This is a thinking tool, not advice. Past patterns don&apos;t guarantee
          future ones. Time-of-day and day-of-week effects exist but are small;
          on a horizon of years, they&apos;re a rounding error compared to just
          showing up consistently.
        </p>
        <p>
          The data is fetched on every page load and cached briefly. Some signals
          (block height, funding rate) refresh quickly; others (200-day MA, MVRV)
          are slow-moving by design. If a signal shows as{" "}
          <em>unavailable</em>, the upstream temporarily isn&apos;t responding,
          the score still works,
          it just routes around the missing input.
        </p>
        <p>
          Built by <a href="https://x.com/GalaxyMind" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">@GalaxyMind</a>.
          Open to suggestions. DMs are open. All views are wrong; some are useful.
        </p>
      </div>
    </section>
  );
}
