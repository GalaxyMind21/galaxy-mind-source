"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_HOURS, PILOT_MAX_HOURS, daysLabel } from "@/lib/rental-limits";
import Link from "next/link";
import {
  blockOdds,
  rentalCostBtc,
  takeBookablePack,
  humanizeYears,
  nextPackStep,
  stepRentalWindow,
  oddsImprovement,
  formatImprovement,
  sortShotOffers,
  nextSort,
  type ShotSort,
  type ShotSortKey,
} from "@/lib/block-odds";
import { TrackedLink } from "@/components/TrackedLink";
import { checkoutHref } from "@/lib/mrr";
import { recoveryRatio } from "@/lib/hashprice";
import { track } from "@vercel/analytics";
import {
  ODDS_WINDOW_LABEL,
  ODDS_WINDOW_FOR,
  ODDS_AMOUNT_LABEL,
  ODDS_AMOUNT_ONE,
  ODDS_AMOUNT_ALL,
  ODDS_AMOUNT_N,
  ODDS_CADENCE,
  ODDS_SELECTED,
  ODDS_RENT_THESE,
  ODDS_OCCUPANCY,
  ODDS_OCCUPANCY_ALL_OPEN,
  ODDS_RENTED_NEXT,
  ODDS_BAY_OPEN,
  ODDS_BAY_RENTED,
  ODDS_NONE_OPEN,
  ODDS_PRIZE_LABEL,
  ODDS_COST_LABEL,
  ODDS_CHANCE_LABEL,
  ODDS_NUDGE_MORE,
  ODDS_NUDGE_LONGER,
  ODDS_NUDGE_BECOMES,
  ODDS_NUDGE_HEAD,
  ODDS_NUDGE_CADENCE,
  ODDS_VS_BASELINE,
  ODDS_POINT_TITLE,
  ODDS_PREMIUM_NOTE,
  ODDS_POINT_POOL,
  ODDS_POINT_SOLO,
  ODDS_POINT_NOTE,
  STICKY_LABEL,
  STICKY_SUMMARY,
  ODDS_DRAWS_TITLE,
  ODDS_DRAWS_NOTE,
  ODDS_STEPPER_DEC,
  ODDS_STEPPER_INC,
  ODDS_SORT_LABEL,
  ODDS_SORT_BAY,
  ODDS_SORT_PRICE,
  ODDS_SORT_POWER,
  ODDS_SORT_COST,
  ODDS_HOWTO_HINT,
  HOWTO_TITLE,
  HOWTO_GUIDE_LINK,
  HOWTO_STEPS,
  ODDS_PICTURE_SUMMARY,
  ODDS_SHOW_UNAVAILABLE,
  ODDS_HIDE_UNAVAILABLE,
  FLEET_NOTE,
  ODDS_RENT_CTA,
  ODDS_RENT_FIRST,
  ODDS_RENT_FIRST_NOTE,
  PACK_QUEUE_TITLE,
  PACK_QUEUE_NOTE,
  PACK_QUEUE_PROGRESS,
  PACK_QUEUE_STARTED,
  PACK_QUEUE_OPEN,
  PACK_QUEUE_DONE,
  ODDS_VIEW_CTA,
} from "@/lib/hashrate-copy";

const MIN_H = MIN_HOURS;
// Client component: it never reads RENTALS_PILOT (security audit 2026-10-18, L2). The server passes today's cap as
// the termCapHours prop (computed server-side in BlockShot); without it, stay inside the pilot cap, which every mode accepts.
const DEFAULT_MAX_H = PILOT_MAX_HOURS;
const HARD_MAX_H = 30 * 24;

export type ShotOffer = {
  key: string;
  /** Visitor-facing bay name, unique on the rack ("<Region> #14", "Avalon Q"). */
  label: string;
  /** Parsed from the listing name. Null on unnumbered house machines. */
  bay: number | null;
  hashLabel: string;
  kind: "available" | "rented" | "offline";
  status: string;
  rentable: boolean;
  ph: number;
  ask: number;
  href: string | null;
  links: { label: string; href: string }[];
  best: boolean;
  freesInH: number | null;
  hardware: string | null;
};

function usd(n: number): string {
  return n >= 1000
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toFixed(2)}`;
}

function oneIn(n: number): string {
  return `1 in ${Math.round(n).toLocaleString("en-US")}`;
}

function windowLabel(hours: number): string {
  return daysLabel(hours);
}

function amountLabel(n: number, open: number): string {
  if (n <= 1) return ODDS_AMOUNT_ONE;
  if (n >= open) return ODDS_AMOUNT_ALL;
  return ODDS_AMOUNT_N.replace("{N}", String(n));
}

function packPhOf(pack: { ph: number }[]): number {
  return pack.reduce((s, o) => s + o.ph, 0);
}

function freesCompact(hours: number): string {
  if (hours >= 48) return `~${Math.round(hours / 24)}d`;
  return `~${hours}h`;
}

function OfferStep({
  price,
  title,
  detail,
  extra,
  onClick,
}: {
  price: string | null;
  title: string;
  detail: string;
  extra: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-left"
    >
      {price != null && (
        <span className="block font-mono text-xl tabular-nums text-[var(--text-primary)]">
          {price}
        </span>
      )}
      <span className="mt-1 block text-sm font-medium text-[var(--text-primary)]">
        {title}
      </span>
      <span className="mt-1 block text-sm text-[var(--text-secondary)]">
        {detail}
      </span>
      {extra != null && (
        <span className="mt-1 block text-sm text-[var(--text-secondary)]">
          {extra}
        </span>
      )}
    </button>
  );
}

function usdPerThDay(ask: number, btcUsd: number): string {
  const n = (ask * btcUsd) / 1000;
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1) return usd(n);
  return `$${n.toFixed(3)}`;
}

function packCostUsd(
  pack: ShotOffer[],
  hours: number,
  btcUsd: number,
): number | null {
  let sum = 0;
  for (const o of pack) {
    const c = rentalCostBtc({
      ph: o.ph,
      hours,
      askBtcPerPhDay: o.ask,
    });
    if (c == null) return null;
    sum += c;
  }
  return sum * btcUsd;
}

function OddsDrum({ n }: { n: number }) {
  const label = oneIn(n);
  return (
    <div aria-label={label}>
      <p className="micro-label text-[var(--text-tertiary)]">
        {ODDS_CHANCE_LABEL}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-[2px]">
        <span className="micro-label mr-2 text-[var(--text-tertiary)]">1 in</span>
        {Math.round(n)
          .toLocaleString("en-US")
          .split("")
          .map((ch, i) =>
            /\d/.test(ch) ? (
              <span
                key={`${i}-${ch}`}
                className="sc-digit sc-cell inline-block min-w-[1.05rem] rounded px-0.5 py-0.5 text-center font-mono text-xl tabular-nums sm:min-w-[1.3rem] sm:text-2xl"
              >
                {ch}
              </span>
            ) : (
              <span
                key={`${i}-${ch}`}
                className="font-mono text-lg text-[var(--text-tertiary)] sm:text-xl"
              >
                {ch}
              </span>
            ),
          )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  unit,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  label: string;
  value: string;
  unit: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
}) {
  const btn =
    "instr-knob flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-mono text-xl leading-none disabled:opacity-25";
  return (
    <div>
      <p className="micro-label text-[var(--text-tertiary)]">{label}</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          aria-label={ODDS_STEPPER_DEC}
          disabled={decDisabled}
          onClick={onDec}
          className={`${btn} text-[var(--text-secondary)]`}
        >
          −
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="font-mono text-5xl tabular-nums leading-none text-[var(--accent-ink)] [text-shadow:0_0_24px_var(--instr-glow)]">
            {value}
          </p>
          <p className="micro-label mt-2 text-[var(--text-tertiary)]">
            {unit}
          </p>
        </div>
        <button
          type="button"
          aria-label={ODDS_STEPPER_INC}
          disabled={incDisabled}
          onClick={onInc}
          className={`${btn} text-[var(--accent-ink)]`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function BlockShotGrid({
  offers,
  networkPhs,
  btcUsd,
  prizeUsd,
  hashprice,
  termCapHours,
}: {
  /** Today's rental cap in hours, computed on the server. Defaults to the pilot cap. */
  termCapHours?: number;
  offers: ShotOffer[];
  networkPhs: number;
  btcUsd: number;
  prizeUsd: number;
  /** BTC per PH per day the network currently pays. Null when that feed
   *  is down, which hides the pool line rather than guessing at it. */
  hashprice: number | null;
}) {
  // RAW state. The value the rest of this component reads is `hours`,
  // derived below and clamped to what the chosen pack can actually be
  // sold for. Renamed deliberately: every downstream reader then inherits
  // the clamp instead of each one having to remember to apply it.
  // The hero sells one full-size machine for one day. Opening the
  // chooser on a three-machine, twelve-hour pack quoted a different
  // rental than the price the visitor just read.
  const [hoursRaw, setHours] = useState(MIN_H);
  const [sort, setSort] = useState<ShotSort>({ key: "bay", dir: "asc" });
  const ordered = sortShotOffers(offers, sort.key, sort.dir);
  const available = ordered.filter((o) => o.rentable);
  const rented = offers.filter((o) => o.kind === "rented");
  const open = available.length;
  const [want, setWant] = useState(1);

  // THE STICKY BOOKING BAR. The chooser watches ITSELF: once its own
  // controls leave the viewport the bar takes over, and it stands down
  // the moment they are back on screen, so the page never shows two live
  // rent controls at once. No state lifting — the config already lives
  // here, which is the whole reason the observer sits in this component.
  // Did this visitor actually USE the chooser, or just read it? Recorded
  // once per mount and sent with every rent click, so converters and
  // non-converters can be compared on the one behaviour this instrument
  // is built to produce. No timers, no scroll tracking — a single boolean.
  const [dialsTouched, setDialsTouched] = useState(false);
  const noteTouch = () => {
    if (!dialsTouched) {
      setDialsTouched(true);
      track("hashrate_dials_used");
    }
  };

  const dialsRef = useRef<HTMLDivElement | null>(null);
  const [dialsHidden, setDialsHidden] = useState(false);
  useEffect(() => {
    // Rect on scroll, NOT IntersectionObserver. IO only fires when the
    // intersection STATUS changes, and jumping from below the chooser to
    // above it — scroll restoration, or this page's own scroll-to-top
    // button — goes false → false without a callback, leaving the bar up
    // at the top of the page offering to book a configuration the visitor
    // has not made. Scrolling by hand passes through the element and
    // self-corrects, which is why that survives casual testing.
    //
    // rAF-coalesced and passive, so this costs one rect read per painted
    // frame while scrolling and nothing at rest.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = dialsRef.current;
      if (el == null) return;
      // Fully above the fold = scrolled past. Bottom, not top, so the bar
      // waits until the offer card has gone rather than covering the
      // priced next rental and the rent button still on screen.
      setDialsHidden(el.getBoundingClientRect().bottom < 0);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const count = open === 0 ? 0 : Math.min(Math.max(1, want), open);
  // One machine, bay order still the default: quote the same full-size
  // listing the hero priced (largest hashrate, cheaper ask on a tie).
  const flagship = available.reduce<ShotOffer | null>((best, o) => {
    if (best == null || o.ph > best.ph || (o.ph === best.ph && o.ask < best.ask)) {
      return o;
    }
    return best;
  }, null);
  const pack =
    count === 1 &&
    sort.key === "bay" &&
    sort.dir === "asc" &&
    flagship != null
      ? [flagship]
      : takeBookablePack(ordered, count);

  // THE WINDOW A PACK CAN ACTUALLY BE SOLD.
  // MIN_H/MAX_H are our own rental term (1 to 7 days during the pilot, up to 30 later; rental-limits).
  // We sell the term directly, so no per-listing window narrows it.
  const MAX_H =
    typeof termCapHours === "number" && Number.isFinite(termCapHours) && termCapHours >= MIN_H
      ? Math.min(Math.floor(termCapHours), HARD_MAX_H)
      : DEFAULT_MAX_H;
  const packMaxH = MAX_H;
  const packMinH = MIN_H;
  const hours = Math.min(Math.max(hoursRaw, packMinH), packMaxH);

  const packPh = packPhOf(pack);
  const odds = blockOdds({ ph: packPh, hours, networkPhs });
  const costUsd = packCostUsd(pack, hours, btcUsd);
  const cadence =
    odds != null ? humanizeYears((odds.oneInN * hours) / 8760) : null;

  const baselinePack = takeBookablePack(ordered, 1);
  const baselineOdds = blockOdds({
    ph: packPhOf(baselinePack),
    hours: 3,
    networkPhs,
  });
  const vsBase =
    odds != null && baselineOdds != null
      ? formatImprovement(oddsImprovement(baselineOdds.oneInN, odds.oneInN) ?? 0)
      : null;

  const moreTo = nextPackStep(count, open);
  const morePack =
    moreTo != null ? takeBookablePack(ordered, moreTo) : [];
  const moreOdds =
    moreTo != null
      ? blockOdds({ ph: packPhOf(morePack), hours, networkPhs })
      : null;

  // The longer-window upsell may only offer a window this pack can be
  // sold for.
  const longerTo = hours < packMaxH ? stepRentalWindow(hours, 1) : null;
  const longerHours =
    longerTo != null && longerTo > hours && longerTo <= packMaxH
      ? longerTo
      : null;
  const longerOdds =
    longerHours != null
      ? blockOdds({ ph: packPh, hours: longerHours, networkPhs })
      : null;
  // The figure on the step is the rental that click selects, the same
  // packCostUsd the card will show afterwards. A longer window stays on
  // this pack. More machines follows the bay-order pack the click applies.
  const moreCost =
    moreTo != null && morePack.length > 0
      ? packCostUsd(morePack, hours, btcUsd)
      : null;
  const longerCost =
    longerHours != null ? packCostUsd(pack, longerHours, btcUsd) : null;
  const moreCadence =
    moreOdds != null ? humanizeYears((moreOdds.oneInN * hours) / 8760) : null;
  const moreCadenceLine =
    moreCadence != null &&
    moreCadence !== "—" &&
    cadence != null &&
    moreCadence !== cadence
      ? ODDS_NUDGE_CADENCE.replace("{CADENCE}", moreCadence)
      : null;

  const nextFree = rented.reduce<number | null>((m, o) => {
    if (o.freesInH == null) return m;
    return m == null || o.freesInH < m ? o.freesInH : m;
  }, null);

  const thLabel = Math.round(packPh * 1000).toLocaleString("en-US");
  const dayCount = Math.max(1, Math.round(hours / 24));
  const timeDisplay = String(dayCount);
  const timeUnit = dayCount === 1 ? "day" : "days";
  const atBest = moreTo == null && longerHours == null;

  // THE DRAW STRIP · blocks the network finds during the chosen window.
  // Six per hour is the protocol's target rate, which is what makes this
  // a countable thing rather than an estimate. Capped for rendering only;
  // the number in the sentence is always the real one.
  // PACK RECOVERY · hashprice ÷ the pack's ph-weighted ask. Weighted, not
  // averaged: a pack of one 270 TH machine and one 12 TH machine is not
  // half-priced by the small one. Null when hashprice is down, which
  // hides the pool line rather than guessing at it.
  const packAsk =
    packPh > 0 ? pack.reduce((t, o) => t + o.ask * o.ph, 0) / packPh : 0;
  const packRecovery =
    hashprice != null && packAsk > 0
      ? recoveryRatio(packAsk, hashprice)
      : null;

  // The bar books the first machine of the current pack, carrying the
  // chosen window. Multi-machine packs still need one checkout each, so
  // this deliberately starts the first rather than implying one click
  // books them all.
  // Same-tab link to /hashrate/rent with the pack size and window preselected.
  const packHref =
    pack.length > 0 && pack[0].rentable ? checkoutHref(pack.filter((o) => o.rentable).length, hours) : null;
  // A one-machine pick and this button are the same rental. A pack's
  // price is every machine, and the button still opens only the first.
  const rentCta = count > 1 ? ODDS_RENT_FIRST : ODDS_RENT_CTA;

  // THE PACK QUEUE (2026-08-27). Which listings this visitor has already
  // opened, so a multi-machine order has somewhere to keep its place.
  // Session state on purpose, not localStorage: "opened" means opened in
  // THIS sitting. Persisting it would show a stale "3 of 5 started" to
  // someone returning days later with no rentals to show for it, which
  // is worse than no memory at all.
  const [opened, setOpened] = useState<Record<string, true>>({});
  const [showRest, setShowRest] = useState(false);
  const packRentable = pack.filter((o) => o.rentable);
  const openedCount = packRentable.filter((o) => opened[o.key]).length;

  const drawBlocks = Math.max(1, Math.round(hours * 6));
  const drawTicks = Math.min(drawBlocks, 84);

  return (
    <>
      {/* Steppers and the offer share one sentinel, so the sticky bar
          cannot cover the priced next rental. */}
      <div ref={dialsRef}>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {open > 0 && (
          <div className="instr-face rounded-2xl p-5">
            <Stepper
              label={ODDS_AMOUNT_LABEL}
              value={String(count)}
              unit={amountLabel(count, open)}
              onDec={() => { noteTouch(); setWant((n) => Math.max(1, n - 1)); }}
              onInc={() => { noteTouch(); setWant((n) => Math.min(open, n + 1)); }}
              decDisabled={count <= 1}
              incDisabled={count >= open}
            />
            {open > 1 && (
              <>
                <label className="mt-4 flex items-center gap-3">
                  <span className="sr-only">{ODDS_AMOUNT_LABEL}</span>
                  <input
                    type="range"
                    min={1}
                    max={open}
                    step={1}
                    value={count}
                    onChange={(e) => { noteTouch(); setWant(Number(e.target.value)); }}
                    className="h-2 w-full accent-[var(--accent)]"
                  />
                </label>
                <div
                  className="mt-3 flex h-10 gap-1 rounded-md bg-[var(--bg-elevated-2)] p-1"
                  aria-hidden="true"
                >
                  {available.map((o, index) => {
                    const on = index < count;
                    return (
                      <div
                        key={o.key}
                        role="presentation"
                        style={{ flexGrow: o.ph }}
                        onClick={() => { noteTouch(); setWant(index + 1); }}
                        className={`min-w-[3px] cursor-pointer rounded-sm ${
                          on
                            ? "bg-[var(--accent)]"
                            : "bg-[var(--bg-base)]"
                        }`}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <div className="instr-face rounded-2xl p-5">
          <Stepper
            label={ODDS_WINDOW_LABEL}
            value={timeDisplay}
            unit={timeUnit}
            onDec={() => { noteTouch(); setHours((h) => stepRentalWindow(h, -1)); }}
            onInc={() => { noteTouch(); setHours((h) => stepRentalWindow(h, 1)); }}
            decDisabled={hours <= packMinH}
            incDisabled={hours >= packMaxH}
          />
          <label className="mt-4 flex items-center gap-3">
            <span className="sr-only">{ODDS_WINDOW_LABEL}</span>
            <input
              type="range"
              min={packMinH}
              max={packMaxH}
              step={1}
              value={hours}
              onChange={(e) => { noteTouch(); setHours(Number(e.target.value)); }}
              className="h-2 w-full accent-[var(--accent)]"
            />
          </label>
        </div>
      </div>

      <div
        className="instr-warm mt-8 rounded-2xl p-5 sm:p-7"
        aria-live="polite"
      >
        {open === 0 || odds == null ? (
          <p className="text-sm text-[var(--text-secondary)]">
            {ODDS_NONE_OPEN}
          </p>
        ) : (
          <>
            {/* HIERARCHY, deliberately in this order (operator, 2026-08-19:
                "this is a SALES page"). The prize and the price are what
                the visitor is buying; the 1-in-N is a fact about it. The
                drum used to be the largest element on the page, which
                merchandised the disappointment rather than the purchase.
                The odds stay fully visible and exact — this audience
                computes them anyway and punishes anyone who hides them —
                but visible is not the same as loudest. */}
            {/* The drum only comes up alongside the figures at `lg`.
                It used to at `sm`, which is the same breakpoint the
                figures grew to text-5xl — the container shrank and the
                type grew on the SAME query, so a 6-figure prize sat on
                top of the rental price from 320px all the way to
                1024px (measured: overflow at 9 of 12 tested widths,
                worst +126px at 640). `overflow-x: clip` on <html> hid
                it from every scrollWidth check, so it read as overlap
                rather than a sideways scroll. */}
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:min-w-0 lg:flex-1">
                <div className="@container min-w-0">
                  <dt className="micro-label text-[var(--text-tertiary)]">
                    {ODDS_PRIZE_LABEL}
                  </dt>
                  <dd className="readout-figure text-[var(--accent-ink)] [text-shadow:0_0_28px_var(--instr-glow)]">
                    {usd(prizeUsd)}
                  </dd>
                </div>
                <div className="@container min-w-0">
                  <dt className="micro-label text-[var(--text-tertiary)]">
                    {ODDS_COST_LABEL}
                  </dt>
                  <dd className="readout-figure text-[var(--text-primary)]">
                    {costUsd == null ? "—" : usd(costUsd)}
                  </dd>
                </div>
              </dl>
              <OddsDrum n={odds.oneInN} />
            </div>
            <p className="mt-4 font-mono text-sm tabular-nums text-[var(--text-secondary)]">
              {ODDS_SELECTED.replace("{TH}", thLabel)
                .replace("{AMOUNT}", amountLabel(pack.length, open))
                .replace("{WINDOW}", windowLabel(hours))}
              <span className="sr-only">
                {" "}
                {ODDS_WINDOW_FOR.replace("{WINDOW}", windowLabel(hours))}
              </span>
            </p>
            {vsBase != null && (
              <p className="mt-2 font-mono text-sm text-[var(--accent-ink)]">
                {ODDS_VS_BASELINE.replace("{N}", vsBase)}
              </p>
            )}
            {cadence != null && cadence !== "—" && (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {ODDS_CADENCE.replace("{CADENCE}", cadence)}
              </p>
            )}
            {/* The cadence above is the fact for this hashrate. The next
                rental, with its own price, sits in the same block. */}
            {!atBest && (
              <div className="mt-4">
                <p className="micro-label text-[var(--text-tertiary)]">
                  {ODDS_NUDGE_HEAD}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {longerHours != null && longerOdds != null && (
                    <OfferStep
                      price={
                        longerCost != null && longerCost > 0
                          ? usd(longerCost)
                          : null
                      }
                      title={ODDS_NUDGE_LONGER.replace(
                        "{WINDOW}",
                        windowLabel(longerHours),
                      )}
                      detail={ODDS_NUDGE_BECOMES.replace(
                        "{ODDS}",
                        oneIn(longerOdds.oneInN),
                      )}
                      extra={null}
                      onClick={() => {
                        noteTouch();
                        setHours(longerHours);
                      }}
                    />
                  )}
                  {moreTo != null && moreOdds != null && (
                    <OfferStep
                      price={
                        moreCost != null && moreCost > 0 ? usd(moreCost) : null
                      }
                      title={ODDS_NUDGE_MORE.replace(
                        "{N}",
                        String(moreTo - count),
                      )}
                      detail={ODDS_NUDGE_BECOMES.replace(
                        "{ODDS}",
                        oneIn(moreOdds.oneInN),
                      )}
                      extra={moreCadenceLine}
                      onClick={() => {
                        noteTouch();
                        setWant(moreTo);
                      }}
                    />
                  )}
                </div>
              </div>
            )}
            {packHref != null && (
              <TrackedLink
                event="hashrate_rent_click"
                data={{
                  rig: pack[0].key,
                  state: "available",
                  hours,
                  source: "offer",
                  machines: count,
                  packTh: Math.round(packPh * 1000),
                  costUsd:
                    costUsd != null ? Math.round(costUsd * 100) / 100 : -1,
                  oddsOneIn: odds != null ? Math.round(odds.oneInN) : -1,
                  dialsTouched,
                }}
                href={packHref}
                className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black"
              >
                {rentCta}
              </TrackedLink>
            )}
            {count > 1 && packHref != null && (
              <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
                {ODDS_RENT_FIRST_NOTE}
              </p>
            )}
            {/* First-time guide · sits with the rent click.
                PR #50 moved a one-line hint here; Vercel 7d (2026-10-01)
                still shows /hashrate ~118 visitors vs how-to-rent ~4.
                HOWTO_STEPS already lived in hashrate-copy unused —
                surface the four-step summary so first renters see the
                MRR handoff before they leave, with the full guide one
                click away. */}
            <div className="mt-5 max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 p-4">
              <p className="micro-label text-[var(--text-tertiary)]">
                {HOWTO_TITLE}
              </p>
              <ul className="mt-3 space-y-2">
                {HOWTO_STEPS.map((step) => (
                  <li
                    key={step}
                    className="flex gap-2 text-sm text-[var(--text-secondary)]"
                  >
                    <span aria-hidden="true" className="text-[var(--accent)]">
                      ·
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-[var(--text-tertiary)]">
                {ODDS_HOWTO_HINT}{" "}
                <Link
                  href="/hashrate/how-to-rent"
                  onClick={() =>
                    track("hashrate_howto_cta", { source: "chooser" })
                  }
                  className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  {HOWTO_GUIDE_LINK}
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
      </div>

      {/* WHERE YOU POINT IT · the same machine sold two ways. The pool
          line only renders when hashprice is live, and it always carries
          its condition — the percentage is a pool-average figure and is
          NOT what a solo rental gets. Stating it without "at a normal
          pool" attached would be the page's first dishonest sentence. */}
      {open > 0 && (
        <div className="mt-4 rounded-2xl p-5 instr-face">
          <p className="micro-label text-[var(--text-tertiary)]">
            {ODDS_POINT_TITLE}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {packRecovery != null && (
              <p className="text-sm text-[var(--text-secondary)]">
                {ODDS_POINT_POOL.replace(
                  "{PCT}",
                  String(Math.round(packRecovery * 100)),
                )}
              </p>
            )}
            <p className="text-sm text-[var(--text-secondary)]">
              {ODDS_POINT_SOLO}
            </p>
          </div>
          <p className="mt-3 text-sm text-[var(--text-tertiary)]">
            {ODDS_POINT_NOTE}
          </p>
          {/* The recovery percentage above states the gap; this states
              what the gap buys. Sits with the number it explains rather
              than in a FAQ the objecting reader never reaches. */}
          {packRecovery != null && (
            <p className="mt-2 text-sm text-[var(--text-tertiary)]">
              {ODDS_PREMIUM_NOTE}
            </p>
          )}
        </div>
      )}

      {/* THE DRAW STRIP · what the window actually contains. Closed by
          default so it sits behind the rent buttons. The old log-scale
          rail with overlapping nowrap labels is gone: those upsells are
          the two buttons on the offer card. */}
      {open > 0 && odds != null && (
        <details className="instr-cool mt-4 rounded-2xl p-5">
          <summary className="micro-label cursor-pointer text-[var(--instr-cool-ink)]">
            {ODDS_PICTURE_SUMMARY}
          </summary>
          <div className="mt-4">
          <p className="micro-label text-[var(--instr-cool-ink)]">{ODDS_DRAWS_TITLE}</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {ODDS_DRAWS_NOTE.replace(
              "{N}",
              drawBlocks.toLocaleString("en-US"),
            )}
          </p>
          {/* Grid with minmax(0,1fr) columns, not flex with a min-width.
              The sentence above counts the blocks, so the strip has to show
              all of them: at `min-w-[2px] flex-1 gap-[3px]` the 84-tick
              maximum needed 417px against a 269px panel, and overflow-hidden
              quietly clipped a third of the comb — the strip disagreed with
              the number it illustrates. 1fr columns divide whatever width
              exists, so the ticks thin out instead of going missing. */}
          <div
            className="mt-3 grid h-10 items-stretch gap-px sm:gap-[3px]"
            style={{
              gridTemplateColumns: `repeat(${drawTicks}, minmax(0, 1fr))`,
            }}
            aria-hidden="true"
          >
            {Array.from({ length: drawTicks }, (_, i) => (
              <span
                key={i}
                className="rounded-sm bg-gradient-to-b from-[#4EC5D9] to-[#4EC5D9]/10 opacity-40"
              />
            ))}
          </div>
          </div>
        </details>
      )}

      {/* The bar itself. Sits BELOW the mobile tab bar's z-40 and clears
          height plus the safe-area inset, because both are fixed to the
          bottom edge and would otherwise overlap on every phone. It also
          clears the scroll-to-top button, which is fixed bottom-LEFT at
          the same clearance + 3.5rem and was sitting directly on top of
          the "Your pick" label. Same --mobile-nav-clearance variable that
          button uses, so the two stack instead of being tuned apart. The
          env() calc stays at the use site — Lightning CSS drops env()
          when it is buried in a :root custom property. */}
      {dialsHidden && open > 0 && odds != null && packHref != null && (
        <div className="fixed inset-x-0 bottom-[calc(var(--mobile-nav-clearance)+6.75rem+env(safe-area-inset-bottom,0px))] z-30 px-4 lg:bottom-6">
          <div className="instr mx-auto flex max-w-2xl items-center gap-4 rounded-2xl px-4 py-3 nb-seated">
            <div className="min-w-0 flex-1">
              <p className="micro-label text-[var(--text-tertiary)]">
                {STICKY_LABEL}
              </p>
              <p className="mt-1 flex min-w-0 items-baseline font-mono text-sm tabular-nums text-[var(--text-primary)]">
                <span className="min-w-0 truncate">
                  {STICKY_SUMMARY.replace("{TH}", thLabel).replace(
                    "{WINDOW}",
                    windowLabel(hours),
                  )}
                </span>
                {costUsd != null && (
                  <span className="shrink-0 text-[var(--accent-ink)]">
                    {" · "}
                    {usd(costUsd)}
                  </span>
                )}
              </p>
            </div>
            <TrackedLink
              event="hashrate_rent_click"
              data={{
                rig: pack[0].key,
                state: "available",
                hours,
                source: "sticky",
                machines: count,
                packTh: Math.round(packPh * 1000),
                costUsd:
                  costUsd != null ? Math.round(costUsd * 100) / 100 : -1,
                oddsOneIn: odds != null ? Math.round(odds.oneInN) : -1,
                dialsTouched,
              }}
              href={packHref}
              className="micro-label inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-5 text-black"
            >
              {rentCta}
            </TrackedLink>
          </div>
        </div>
      )}

      {offers.length > 0 && (
        <div className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="micro-label text-[var(--text-tertiary)]">
                {ODDS_RENT_THESE}
              </p>
              <p className="mt-2 font-mono text-2xl tabular-nums text-[var(--text-primary)] sm:text-3xl">
                {rented.length > 0
                  ? ODDS_OCCUPANCY.replace("{OPEN}", String(open)).replace(
                      "{N}",
                      String(rented.length),
                    )
                  : ODDS_OCCUPANCY_ALL_OPEN.replace("{OPEN}", String(open))}
              </p>
              {rented.length > 0 && nextFree != null && (
                <p className="mt-1 font-mono text-sm tabular-nums text-[var(--accent-ink)]">
                  {ODDS_RENTED_NEXT.replace("{H}", String(nextFree))}
                </p>
              )}
              <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                {FLEET_NOTE}
              </p>
            </div>
            <div>
              <p className="micro-label mb-2 text-[var(--text-tertiary)]">
                {ODDS_SORT_LABEL}
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["bay", ODDS_SORT_BAY],
                    ["price-th", ODDS_SORT_PRICE],
                    ["power", ODDS_SORT_POWER],
                    ["cost", ODDS_SORT_COST],
                  ] as const satisfies readonly [ShotSortKey, string][]
                ).map(([key, label]) => {
                  const on = sort.key === key;
                  const arrow = on ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      aria-sort={
                        on
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      onClick={() => setSort((s) => nextSort(s, key))}
                      className={`micro-label min-h-[44px] rounded-full px-3 ${
                        on
                          ? "bg-[var(--accent)] text-black"
                          : "border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {label}
                      {arrow}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="mt-4 flex h-8 gap-1 rounded-md bg-[var(--bg-elevated-2)] p-1"
            aria-hidden="true"
          >
            {ordered.map((o) => {
              const availI = available.findIndex((a) => a.key === o.key);
              const inPack = availI >= 0 && availI < count;
              return (
                <div
                  key={o.key}
                  role="presentation"
                  title={o.label}
                  style={{ flexGrow: o.ph }}
                  onClick={() => {
                    if (availI >= 0) setWant(availI + 1);
                  }}
                  className={`min-w-[3px] rounded-sm ${
                    o.kind === "rented"
                      ? "bg-[var(--accent)]"
                      : o.kind === "offline"
                        ? "border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                        : inPack
                          ? "cursor-pointer bg-[var(--success)]"
                          : "cursor-pointer bg-[var(--success)]/35"
                  }`}
                />
              );
            })}
          </div>

          {/* THE PACK QUEUE · only when more than one machine is selected.
              At count 1 the per-machine row below is already the whole
              job, and a "queue" of one is furniture. */}
          {packRentable.length > 1 && (
            <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="micro-label text-[var(--text-secondary)]">
                  {PACK_QUEUE_TITLE.replace("{N}", String(packRentable.length))}
                </p>
                <p className="font-mono text-xs tabular-nums text-[var(--text-tertiary)]">
                  {PACK_QUEUE_PROGRESS.replace(
                    "{DONE}",
                    String(openedCount),
                  ).replace("{TOTAL}", String(packRentable.length))}
                </p>
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {PACK_QUEUE_NOTE}
              </p>
              <ol className="mt-3 flex flex-col gap-1">
                {packRentable.map((o, n) => {
                  const rowCost = rentalCostBtc({
                    ph: o.ph,
                    hours,
                    askBtcPerPhDay: o.ask,
                  });
                  const done = !!opened[o.key];
                  return (
                    <li
                      key={o.key}
                      className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] px-2 py-1.5"
                    >
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono t-xs tabular-nums ${
                          done
                            ? "bg-[var(--success)] text-black"
                            : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                        }`}
                      >
                        {done ? "\u2713" : n + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                        {o.label}
                      </span>
                      <span className="hidden shrink-0 font-mono t-xs tabular-nums text-[var(--text-tertiary)] sm:inline">
                        {Math.round(o.ph * 1000).toLocaleString("en-US")} TH
                      </span>
                      <TrackedLink
                        event="hashrate_rent_click"
                        data={{
                          rig: o.key,
                          state: "available",
                          hours,
                          source: "pack_queue",
                          machines: packRentable.length,
                          position: n + 1,
                          // -1 sentinel matches the sticky bar's costUsd
                          // convention · analytics fields cannot be null.
                          costBtc: rowCost ?? -1,
                          dialsTouched,
                        }}
                        href={checkoutHref(packRentable.length, hours)}
                        onClick={() =>
                          setOpened((prev) => ({ ...prev, [o.key]: true }))
                        }
                        /* 44px, not 36. Measured 2026-09-05: every one of the 32 paths to
                           MRR on this page was under the tap floor on a 390px
                           phone (31 at 36px, 1 at 40). This is the click the
                           page exists for, so it gets a full-size target. */
                        className={`micro-label inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3 t-xs ${
                          done
                            ? "border border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                            : "bg-[var(--accent)] text-black"
                        }`}
                      >
                        {done ? PACK_QUEUE_STARTED : PACK_QUEUE_OPEN}
                      </TrackedLink>
                    </li>
                  );
                })}
              </ol>
              {openedCount === packRentable.length && (
                <p className="mt-2 text-xs text-[var(--accent-ink)]">
                  {PACK_QUEUE_DONE}
                </p>
              )}
            </div>
          )}

          <ul className="mt-2">
            {(showRest ? ordered : ordered.filter((o) => o.rentable)).map((o) => {
              const availI = available.findIndex((a) => a.key === o.key);
              const inPack = availI >= 0 && availI < count;
              const href = checkoutHref(1, hours);
              const rowCost = o.rentable
                ? rentalCostBtc({
                    ph: o.ph,
                    hours,
                    askBtcPerPhDay: o.ask,
                  })
                : null;
              const th = Math.round(o.ph * 1000).toLocaleString("en-US");
              return (
                <li
                  key={o.key}
                  className={`border-t border-[var(--border-subtle)] ${
                    o.rentable ? "cursor-pointer" : ""
                  } ${inPack ? "bg-[var(--accent)]/5" : ""}`}
                  onClick={() => {
                    if (availI >= 0) setWant(availI + 1);
                  }}
                >
                  <div className="flex min-w-0 items-start gap-3 py-3">
                    <span
                      className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${
                        o.kind === "rented"
                          ? "bg-[var(--accent)]"
                          : o.kind === "offline"
                            ? "border border-dashed border-[var(--border-subtle)]"
                            : inPack
                              ? "bg-[var(--success)]"
                              : "bg-[var(--success)]/35"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[15px] font-medium ${
                          o.kind === "rented"
                            ? "text-[var(--text-secondary)]"
                            : "text-[var(--text-primary)]"
                        }`}
                      >
                        {o.label}
                      </p>
                      <p className="mt-0.5 font-mono t-xs tabular-nums text-[var(--text-tertiary)]">
                        {o.hardware && o.hardware !== o.label
                          ? `${o.hardware} · ${th} TH`
                          : `${th} TH`}
                        {o.rentable && (
                          <>
                            {" · "}
                            {usdPerThDay(o.ask, btcUsd)}/TH·day
                          </>
                        )}
                      </p>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                        {o.kind === "rented" ? (
                          <p className="micro-label text-[var(--accent-ink)]">
                            {ODDS_BAY_RENTED}
                            {o.freesInH != null &&
                              ` · ${freesCompact(o.freesInH)}`}
                          </p>
                        ) : o.kind === "offline" ? (
                          <p className="micro-label text-[var(--text-tertiary)]">
                            {o.status}
                          </p>
                        ) : (
                          <p className="micro-label text-[var(--success)]">
                            {ODDS_BAY_OPEN}
                            {rowCost != null && ` · ${usd(rowCost * btcUsd)}`}
                          </p>
                        )}
                        {href && (
                          <TrackedLink
                            event="hashrate_rent_click"
                            data={{
                              rig: o.key,
                              state: o.rentable ? "available" : "busy",
                              hours,
                              // The CONFIGURATION at click time. Without
                              // these the funnel could only say a rent
                              // link was clicked, never whether people who
                              // move the dials convert differently from
                              // people who never touch them — which is the
                              // one question the chooser exists to answer.
                              source: "bay",
                              machines: count,
                              packTh: Math.round(packPh * 1000),
                              costUsd:
                                costUsd != null
                                  ? Math.round(costUsd * 100) / 100
                                  : -1,
                              oddsOneIn:
                                odds != null ? Math.round(odds.oneInN) : -1,
                              dialsTouched,
                            }}
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            className={`micro-label inline-flex min-h-[44px] max-w-full shrink-0 items-center justify-center rounded-full px-3 ${
                              o.rentable
                                ? inPack
                                  ? "bg-[var(--accent)] text-black"
                                  : "border border-[var(--accent)]/45 text-[var(--accent-ink)]"
                                : "border border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                            }`}
                          >
                            {o.rentable ? ODDS_RENT_CTA : ODDS_VIEW_CTA}
                          </TrackedLink>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {ordered.some((o) => !o.rentable) && (
            <p className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setShowRest((v) => !v)}
                className="text-sm text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                {showRest
                  ? ODDS_HIDE_UNAVAILABLE
                  : ODDS_SHOW_UNAVAILABLE.replace(
                      "{N}",
                      String(ordered.filter((o) => !o.rentable).length),
                    )}
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
