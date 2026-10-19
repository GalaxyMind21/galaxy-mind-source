/**
 * Educational section explaining mNAV. Mirrors the HowItWorks pattern from
 * /stack — long-form prose that doubles as SEO surface for queries like
 * "what is mNAV", "MicroStrategy premium", "treasury company NAV".
 *
 * Cross-links to /stack at the end so /treasuries visitors discover the
 * verdict tool that uses MSTR mNAV as one of its 10 inputs.
 */
export function HowMNavWorks() {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8">
      <h2 className="micro-label text-[var(--text-tertiary)]">
        How to read this scoreboard
      </h2>

      <div className="mt-6 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
        <h3 className="micro-label text-[var(--text-primary)]">
          What is mNAV?
        </h3>
        <p>
          <span className="font-mono text-[var(--accent-ink)]">mNAV</span>{" "}
          stands
          for &ldquo;multiple of net asset value.&rdquo; For a bitcoin treasury
          company, it&apos;s the simplest possible question:
        </p>
        <p className="text-[var(--text-primary)] italic">
          &ldquo;Is the company&apos;s market cap larger or smaller than the
          value of the bitcoin it holds?&rdquo;
        </p>
        <p>
          It&apos;s computed by dividing the company&apos;s market cap by its
          BTC holdings × current BTC price. Three readings to know:
        </p>

        <ul className="space-y-3 ml-1 mt-4">
          <li className="flex items-baseline gap-3">
            <span className="font-mono text-xs w-24 shrink-0 text-[var(--cool-ink)]">
              &lt; 1.00×
            </span>
            <span>
              <strong className="text-[var(--text-primary)] font-normal">
                Below NAV.
              </strong>{" "}
              The market cap is less than the value of the bitcoin the company
              holds. Historically rare, and historically a strong accumulation
              signal, because the marginal buyer can pay less for treasury equity than
              they would for the underlying coins.
            </span>
          </li>
          <li className="flex items-baseline gap-3">
            <span className="font-mono text-xs w-24 shrink-0 text-[var(--text-primary)]">
              ≈ 1.00×
            </span>
            <span>
              <strong className="text-[var(--text-primary)] font-normal">
                At NAV.
              </strong>{" "}
              Market cap roughly equal to the bitcoin held. No premium, no
              discount. Boring is good.
            </span>
          </li>
          <li className="flex items-baseline gap-3">
            <span className="font-mono text-xs w-24 shrink-0 text-[var(--accent-ink)]">
              &gt; 1.05×
            </span>
            <span>
              <strong className="text-[var(--text-primary)] font-normal">
                Premium.
              </strong>{" "}
              Investors are paying more than the bitcoin is worth. The premium
              compensates for management quality, leverage capacity (the
              ability to issue debt and stock to acquire more BTC), or growth
              expectations. Premiums above ~1.6× have historically been rich.
            </span>
          </li>
        </ul>

        <h3 className="micro-label text-[var(--text-primary)] mt-8">
          Exactly how we calculate it
        </h3>
        <p>
          Our mNAV is the{" "}
          <strong className="text-[var(--text-primary)] font-normal">
            gross
          </strong>{" "}
          version, kept deliberately simple so it stays comparable across every
          company on the board:
        </p>
        <p className="font-mono text-xs text-[var(--accent-ink)] bg-[var(--bg-elevated-2)] rounded-md px-3 py-2.5">
          mNAV = market cap ÷ (BTC held × spot BTC price)
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2 mt-2">
          <li>
            <strong className="text-[var(--text-primary)] font-normal">
              Market cap
            </strong>{" "}
            is the market value of the company&apos;s shares. We use the smaller
            of the basic and fully-diluted figures from bitcointreasuries.net.
            For most tickers that is the basic count; for SPAC-structured names
            like XXI (whose basic count still includes locked-up sponsor shares
            not yet circulating) it resolves to fully-diluted.
          </li>
          <li>
            <strong className="text-[var(--text-primary)] font-normal">
              BTC value
            </strong>{" "}
            is only the coins on the balance sheet times spot. Nothing else.
          </li>
        </ul>
        <p>
          Plainly: this is a gross figure, not a net one. Despite the
          &ldquo;net asset value&rdquo; in the name, the treasury-company
          convention (and ours) divides by the gross value of the bitcoin, not a
          balance-sheet net asset value. We do{" "}
          <strong className="text-[var(--text-primary)] font-normal">not</strong>{" "}
          net out cash, and we do{" "}
          <strong className="text-[var(--text-primary)] font-normal">not</strong>{" "}
          add convertible notes, other debt, or the preferred stack as claims on
          the bitcoin. An enterprise-value or &ldquo;net&rdquo; mNAV that folded
          those in would read higher · a smaller discount, or a larger premium.
          We publish the gross number because it is the cleanest
          apples-to-apples line across companies, and we would rather state the
          method than bury it.
        </p>

        <h3 className="micro-label text-[var(--text-primary)] mt-8">
          Effective BTC price
        </h3>
        <p>
          The companion number in the table. It is the price per bitcoin you are
          effectively paying for BTC exposure when you buy the stock:
        </p>
        <p className="font-mono text-xs text-[var(--accent-ink)] bg-[var(--bg-elevated-2)] rounded-md px-3 py-2.5">
          effective BTC price = spot BTC price × mNAV
        </p>
        <p>
          Below spot, you are getting bitcoin cheaper through the wrapper than
          buying it outright. Above spot, you are paying a premium for the
          structure. For example, at a 0.80× mNAV the effective price is 80% of
          spot · the same coins, roughly 20% cheaper per BTC, if you accept the
          gross mNAV math above.
        </p>
        <p>
          The table shows the same idea in sats:{" "}
          <span className="font-mono text-[var(--accent-ink)]">Sats / $1</span>{" "}
          is how many sats of bitcoin each dollar of the stock effectively buys
          (bitcoin held × 1e8 ÷ market cap). It is the effective-price lens
          inverted, in the unit a bitcoiner actually thinks in. When a stock
          trades below NAV you stack MORE sats per dollar than buying bitcoin at
          spot, so a Sats / $1 above the spot figure shown beside it is the
          discount, counted in sats.
        </p>

        <h3 className="micro-label text-[var(--text-primary)] mt-8">
          CEBE · the net-of-claims view
        </h3>
        <p>
          The mNAV above is gross. <strong className="text-[var(--text-primary)] font-normal">CEBE</strong>{" "}
          (Common Equity Bitcoin Exposure) is the net version · the bitcoin
          backing each common share after the debt and preferred stock that
          get paid before common holders. Each row shows it as a net mNAV
          plus a senior-claims percentage:
        </p>
        <p className="font-mono text-xs text-[var(--accent-ink)] bg-[var(--bg-elevated-2)] rounded-md px-3 py-2.5">
          net mNAV = market cap ÷ (BTC value − debt − preferred + cash)
        </p>
        <p>
          The more leverage a company carries, the wider the gap between its
          gross and net mNAV. Strategy is the clearest case: a gross mNAV
          under 1.0× (looks like a discount) can flip to a net mNAV above
          1.0× once its multi-billion-dollar convertible notes and preferred
          stack are subtracted · the leverage quietly erases the headline
          discount. Michael Saylor frames the same split as growth (gross
          bitcoin-per-share) versus risk (CEBE); we publish both so you can
          rank on either. Net figures use balance-sheet data as of the dates
          shown on each row, reviewed quarterly · framework:{" "}
          <a
            href="https://www.cebetracker.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            cebetracker.io
          </a>
          . Where a company&apos;s senior-claims figures aren&apos;t reliably
          sourced yet, CEBE shows &ldquo;pending&rdquo; rather than a guess.
        </p>

        <h3 className="micro-label text-[var(--text-primary)] mt-8">
          BPS, CEBE BPS, and Amplification
        </h3>
        <p>
          Michael Saylor frames the same gross-versus-net split as two paired
          per-share metrics.{" "}
          <span className="font-mono text-[var(--accent-ink)]">BPS</span>{" "}
          (bitcoin per share) is the bitcoin behind each common share before
          senior claims · the growth metric.{" "}
          <span className="font-mono text-[var(--accent-ink)]">CEBE BPS</span>{" "}
          is the same figure after debt and preferred are paid · the
          conservative risk metric. Each row shows both as sats per $100 of
          stock, and the per-ticker pages show the pair side by side.
        </p>
        <p className="font-mono text-xs text-[var(--accent-ink)] bg-[var(--bg-elevated-2)] rounded-md px-3 py-2.5">
          Amplification = BPS ÷ CEBE BPS = BTC held ÷ (BTC held − senior claims in BTC)
        </p>
        <p>
          The difference between BPS and CEBE BPS is{" "}
          <strong className="text-[var(--text-primary)] font-normal">
            Amplification
          </strong>
          . With no debt or preferred, BPS equals CEBE BPS, Amplification is
          1.0×, and the company should track bitcoin like an ETF. As
          liabilities grow the two diverge and Amplification rises above 1.0×,
          the leverage that creates the potential to outperform bitcoin.
        </p>
        <p>
          Not all liabilities are equal. Short-duration, high-cost liabilities
          turn Amplification into risk and underperformance · they can come due
          before the thesis plays out. Long-duration, low-cost liabilities turn
          it into common-equity upside. The rule of thumb: if a
          company&apos;s bitcoin annualized return (BTC ARR) clears its cost of
          capital, a well-capitalized treasury should outperform bitcoin. The
          shorter the liability duration, the more CEBE BPS (risk) matters; the
          longer the duration, the more BPS (growth) matters. BTC Yield
          measures how well management executes that BPS growth over time.
        </p>

        <h3 className="micro-label text-[var(--text-primary)] mt-8">
          Why this matters
        </h3>
        <p>
          When a treasury company&apos;s mNAV compresses below 1.0×, the
          marginal sophisticated buyer prefers spot bitcoin to leveraged
          treasury equity. That&apos;s the moment in the cycle when the smart
          money loses interest in paying for the wrapper · historically
          correlated with bitcoin price bottoms.
        </p>
        <p>
          MSTR mNAV is one of the ten signals feeding the{" "}
          <a
            href="/stack"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Bitcoin Buying Gauge
          </a>
          . When this scoreboard turns blue, the gauge over there starts
          glowing.
        </p>

        {/* Caveats collapsed by default · they're important context but
            not load-bearing for the "what is mNAV" understanding. Same
            <details> pattern as /stack HowItWorks (audit 2026-05-14). */}
        <details className="mt-8 group">
          <summary className="cursor-pointer list-none flex items-baseline justify-between gap-3 select-none">
            <span className="micro-label text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
              Honest caveats · 6 risks to consider
            </span>
            <span className="font-mono t-xs tabular-nums text-[var(--text-tertiary)] whitespace-nowrap">
              tap <span className="ml-1 inline-block transition-transform group-open:rotate-90">▸</span>
            </span>
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[var(--text-tertiary)]">
              Treasury equity is not the same as spot bitcoin.
            </p>
            <ul className="list-disc list-inside text-xs text-[var(--text-tertiary)] space-y-1 ml-2">
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Gross, not net.
                </strong>{" "}
                Our headline mNAV divides equity market cap by the raw value of
                the bitcoin held · it does not net cash or count convertible
                notes, debt, or the preferred stack. A company with a large
                convert or preferred layer looks cheaper on this gross basis
                than on a net basis · the CEBE / net-mNAV figure on each row
                shows the after-claims view for the tickers we have sourced.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Leverage exposure.
                </strong>{" "}
                Most of these companies fund BTC purchases with debt and stock
                issuance. Drawdowns hit harder than spot.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Dilution risk.
                </strong>{" "}
                Aggressive equity issuance can erode per-share BTC over time, even
                as total BTC grows.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Tax treatment.
                </strong>{" "}
                Equity is taxed differently than spot bitcoin; check your
                jurisdiction.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Counterparty risk.
                </strong>{" "}
                Custody, execution, governance. All of it sits with the company,
                not in your own wallet.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)] font-normal">
                  Live data lag.
                </strong>{" "}
                BTC holdings are reported by{" "}
                <a
                  href="https://bitcointreasuries.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  bitcointreasuries.net
                </a>{" "}
                and update slower than market caps. mNAV here may be stale by hours
                after large purchases or sales.
              </li>
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
