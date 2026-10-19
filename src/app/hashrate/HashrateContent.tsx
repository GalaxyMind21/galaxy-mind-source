import { getHashrateDesk } from "@/lib/hashrate";
import { getHashrateHistory } from "@/lib/hashrate-history";
import DeskStatusStrip from "./components/DeskStatusStrip";
import { HashrateHistoryChart } from "./components/HashrateHistoryChart";
import { RentWithAiBot, HERO_RENT_HREF } from "./components/RentWithAiBot";
import { RentBuilder } from "./components/RentBuilder";
import { BayBoard } from "./components/BayBoard";
import { StickyRentBar } from "./components/StickyRentBar";
import { SupportLine } from "./components/SupportLine";
import { MarketplaceListingCard } from "./components/MarketplaceListingCard";
import { MARKETPLACE_FAQ } from "@/lib/marketplace-listing";
import { humanCheckoutLinkable } from "@/lib/rentals/phase2/human";
import { rentOffer } from "@/lib/rentals/direct";
import { RIG_TH, MAX_RIGS, PILOT_MAX_DAYS } from "@/lib/rentals/limits";
import { supportInfo } from "@/lib/support";
import { payRailsLabel } from "@/lib/rentals/rails";
import { CitationBlock } from "@/components/CitationBlock";
import { TrackedLink } from "@/components/TrackedLink";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import {
  RENT_HERO_KICKER,
  RENT_HERO_TITLE,
  RENT_HERO_SUB,
  RENT_PRICE_UNIT,
  RENT_PRICE_PER_TH,
  RENT_PRICE_FOOT,
  RENT_PRICE_UNAVAILABLE,
  RENT_CTA,
  RENT_BUILDER_TITLE,
  RENT_BUILDER_ODDS_LABEL,
  RENT_BUILDER_ODDS_NOTE,
  BAY_BOARD_TITLE,
  BAY_OPEN,
  BAY_RENTED, BAY_UNAVAILABLE,
  RENT_FLOW_TITLE,
  RENT_FLOW_STEPS,
  PAUSED_KICKER,
  PAUSED_TITLE,
  PAUSED_BODY,
  FAQ_TITLE,
  FAQ_ITEMS,
  TRUST_TITLE,
  TRUST_POINTS,
  XSELL_AGENTS_LEAD,
  XSELL_AGENTS_LINK,
  WAITLIST_HEADLINE,
  HISTORY_TITLE,
} from "@/lib/hashrate-copy";

const SITE_URL = "https://galaxymind.space";


function money(usdc: string): string {
  return Number(usdc).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function HashrateContent() {
  // One kill switch: humanCheckoutLinkable (env) + rentOffer (rentals_enabled in the DB). Closed = paused state.
  const [desk, history, offer] = await Promise.all([
    getHashrateDesk(),
    getHashrateHistory(90),
    rentOffer({ open: humanCheckoutLinkable() }),
  ]);
  const support = supportInfo();
  const rails = payRailsLabel();
  const withRails = (s: string) => s.replaceAll("{RAILS}", rails);
  const open = offer.open;
  const price = offer.price ? `$${money(offer.price.perRigDayUsdc)}` : null;
  // Display only: the same live per-rig-day price, restated per TH/s the way
  // every top rental page quotes it. Pricing logic is untouched.
  const perTh = offer.price && RIG_TH > 0 ? `$${(Number(offer.price.perRigDayUsdc) / RIG_TH).toFixed(3)}` : null;
  const priceUnit = RENT_PRICE_UNIT.replace("{TH}", RIG_TH.toLocaleString("en-US"));
  const board = offer.board;
  const rentable = open && (board == null || board.available > 0);
  const heroHref = open ? HERO_RENT_HREF : "#waitlist";
  const maxRigs = Math.min(MAX_RIGS, board ? Math.max(1, board.available) : MAX_RIGS);

  return (
    <div className="mt-8 space-y-10 pb-24 sm:pb-0">
      {open ? (
        <section id="rent-hero" aria-labelledby="rent-hero-h" className="flow-field">
          <div className="hero-glass rounded-3xl p-6 sm:p-9">
            <p className="micro-label text-[var(--accent-ink)]">
              <span aria-hidden className="bay-dot-open mr-2 inline-block h-2 w-2 rounded-full align-middle" />
              {RENT_HERO_KICKER}
            </p>
            <h2 id="rent-hero-h" className="mt-3 max-w-xl text-2xl font-semibold leading-tight text-[var(--text-primary)] sm:text-3xl">
              {RENT_HERO_TITLE}
            </h2>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-[var(--text-secondary)]">{withRails(RENT_HERO_SUB)}</p>
            <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div data-hero-price>
                {price ? (
                  <p className="font-mono tabular-nums text-[var(--text-primary)]">
                    <span className="text-5xl sm:text-6xl [text-shadow:0_0_28px_var(--accent-glow)]">{price}</span>
                    <span className="ml-2 inline-block whitespace-nowrap text-[15px] text-[var(--text-tertiary)]">{priceUnit}</span>
                  </p>
                ) : (
                  <p className="text-xl text-[var(--text-secondary)]">{RENT_PRICE_UNAVAILABLE}</p>
                )}
                {price && perTh && (
                  <p className="mt-2 font-mono text-[14px] tabular-nums text-[var(--text-secondary)]" data-hero-per-th>
                    {RENT_PRICE_PER_TH.replace("{PER_TH}", perTh)}
                  </p>
                )}
                <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">{withRails(RENT_PRICE_FOOT)}</p>
              </div>
              <TrackedLink
                event="hashrate_hero_cta"
                href={heroHref}
                className="lit-primary inline-flex min-h-[52px] items-center justify-center rounded-full bg-[var(--accent)] px-8 text-[17px] font-semibold text-black"
              >
                {RENT_CTA} →
              </TrackedLink>
            </div>
            {board && board.available === 0 && (
              <p className="mt-4 text-[14px] text-[var(--text-secondary)]">
                All our hashrate is rented right now. More frees up as rentals end; the checkout shows when the next block opens.
              </p>
            )}
          </div>
        </section>
      ) : (
        <section id="rent-hero" aria-labelledby="paused-h" className="flow-field" data-rentals-paused>
          <div className="hero-glass rounded-3xl p-6 sm:p-9">
            <p className="micro-label text-[var(--text-tertiary)]">{PAUSED_KICKER}</p>
            <h2 id="paused-h" className="mt-3 max-w-xl text-2xl font-semibold leading-tight text-[var(--text-primary)] sm:text-3xl">{PAUSED_TITLE}</h2>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-[var(--text-secondary)]">{PAUSED_BODY}</p>
            <div id="waitlist" className="mt-6 scroll-mt-24">
              <InlineSubscribePrompt source="hashrate" headline={WAITLIST_HEADLINE} subhead="US-based hashrate · availability pings only · not a newsletter" />
            </div>
          </div>
        </section>
      )}

      {open && (
        <RentBuilder
          perRigDayUsdc={offer.price?.perRigDayUsdc ?? null}
          maxRigs={maxRigs}
          maxDays={PILOT_MAX_DAYS}
          rigTh={RIG_TH}
          networkPhs={desk.networkPhs}
          title={RENT_BUILDER_TITLE}
          oddsTitle={RENT_BUILDER_ODDS_LABEL}
          oddsNote={RENT_BUILDER_ODDS_NOTE}
          cta={RENT_CTA}
        />
      )}

      {board && <BayBoard board={board} title={BAY_BOARD_TITLE} openLabel={BAY_OPEN} rentedLabel={BAY_RENTED} unavailableLabel={BAY_UNAVAILABLE} />}

      {/* Secondary marketplace mention, directly below the direct-rent section (operator 2026-10-17). Shows open or paused. */}
      <MarketplaceListingCard />

      <section aria-labelledby="how-to-rent-h">
        <h2 id="how-to-rent-h" className="micro-label mb-3 text-[var(--text-tertiary)]">{RENT_FLOW_TITLE}</h2>
        <ol className="grid gap-3 sm:grid-cols-4">
          {RENT_FLOW_STEPS.map((s, i) => (
            <li key={s.title} className="glass-rest rounded-2xl p-4">
              <p className="font-mono text-[13px] text-[var(--accent-ink)]">0{i + 1}</p>
              <p className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">{withRails(s.body)}</p>
            </li>
          ))}
        </ol>
      </section>

      <RentWithAiBot quiet />

      <section className="glass-rest rounded-2xl p-5 sm:p-6">
        <p className="micro-label text-[var(--text-tertiary)]">{TRUST_TITLE}</p>
        <ul className="mt-3 space-y-2">
          {TRUST_POINTS.map((p) => (
            <li key={p} className="flex gap-2 text-sm text-[var(--text-secondary)]">
              <span aria-hidden="true" className="text-[var(--accent)]">·</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq-h">
        <h2 id="faq-h" className="micro-label text-[var(--text-tertiary)]">{FAQ_TITLE}</h2>
        <div className="mt-3 divide-y divide-[var(--border-subtle)]">
          {[...FAQ_ITEMS, MARKETPLACE_FAQ].map((item) => (
            <details key={item.q} className="group py-3">
              <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--text-primary)] marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-4">
                  <span>{item.q}</span>
                  <span aria-hidden className="font-mono text-[var(--text-tertiary)] transition-transform group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <DeskStatusStrip desk={desk} />

      <details className="glass-rest rounded-2xl p-5">
        <summary className="micro-label cursor-pointer text-[var(--text-tertiary)]">{HISTORY_TITLE}</summary>
        <HashrateHistoryChart rows={history} bare />
      </details>

      <p className="max-w-2xl t-xs text-[var(--text-tertiary)]">
        {XSELL_AGENTS_LEAD}{" "}
        <a href="/hashrate/agents" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          {XSELL_AGENTS_LINK}
        </a>
        .
      </p>

      <SupportLine support={support} />

      <CitationBlock pageUrl={`${SITE_URL}/hashrate`} dataLabel="Galaxy Mind hashrate rental" lastUpdatedISO={desk.asOf} surface="hashrate" />

      {rentable && price && <StickyRentBar price={price} unit={priceUnit} cta={RENT_CTA} href={heroHref} watchId="rent-hero" />}
    </div>
  );
}
