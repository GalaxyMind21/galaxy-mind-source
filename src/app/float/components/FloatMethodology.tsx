import {
  LOST_BTC_LAST_REVIEWED,
  LOST_BTC_SOURCE,
  LTH_BTC_LAST_REVIEWED,
  LTH_BTC_SOURCE,
  EXCHANGE_BTC_LAST_REVIEWED,
  EXCHANGE_BTC_SOURCE,
} from "@/lib/float-snapshot";

export function FloatMethodology({ asOf }: { asOf: string }) {
  const sources = [
    { label: "Mined / circulating supply", source: "mempool.space (block height)", reviewed: "live" },
    { label: "Government holdings", source: "bitcointreasuries.net", reviewed: "daily snapshot" },
    { label: "Spot Bitcoin ETF AUM", source: "bitcointreasuries.net (aggregate)", reviewed: "daily snapshot" },
    { label: "Public-company treasuries", source: "bitcointreasuries.net (named holders we independently know, not every public-company row in the feed)", reviewed: "daily snapshot" },
    { label: "Provably lost (>7y dormant)", source: LOST_BTC_SOURCE, reviewed: LOST_BTC_LAST_REVIEWED },
    { label: "Long-term holder baseline", source: LTH_BTC_SOURCE, reviewed: LTH_BTC_LAST_REVIEWED },
    { label: "Exchange reserves", source: EXCHANGE_BTC_SOURCE, reviewed: EXCHANGE_BTC_LAST_REVIEWED },
  ];

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          Methodology &amp; Sources
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          Hero number = <code className="text-[var(--text-secondary)]">mined − lost − governments − ETFs − public-company treasuries − long-term-holder remainder</code>.
          The LTH cohort (Glassnode · coins not moved 155+ days) is overlap-adjusted before subtraction:
          we back out the lost / gov / ETF / treasury portions (which are themselves LTH-classified by definition) so MSTR&apos;s coins
          aren&apos;t double-counted. Public-company BTC counts named holders we independently know. The feed&apos;s public-company type still carries copied and impossible rows, so summing the survivors is not a cohort. Governments and ETFs withhold the whole type when an unfamiliar row is impossible. Rows already judged impossible are left out, and the rest of that cohort still publishes. The strictest &quot;buyable on an exchange right now&quot; framing (~exchange reserves) appears above the
          breakdown for context, not as the headline.
        </p>
      </header>

      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-tertiary)] tracking-[0.15em] uppercase t-xs">
            <th className="py-2">Metric</th>
            <th className="py-2">Source</th>
            <th className="py-2 text-right">Last reviewed</th>
          </tr>
        </thead>
        <tbody className="text-[var(--text-secondary)]">
          {sources.map((s) => (
            <tr key={s.label} className="border-b border-[var(--border-subtle)]/40">
              <td className="py-2 text-[var(--text-primary)]">{s.label}</td>
              <td className="py-2">{s.source}</td>
              <td className="py-2 text-right">{s.reviewed}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="t-xs text-[var(--text-tertiary)] mt-4">
        Last data refresh: {new Date(asOf).toUTCString()}.
        Slow-moving cohorts (lost, LTH baseline, exchange reserves) are reviewed quarterly and updated in <code>src/lib/float-snapshot.ts</code>.
      </p>
    </section>
  );
}
