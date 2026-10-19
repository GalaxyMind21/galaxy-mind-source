import type { HashrateDesk } from "@/lib/hashrate";
import { composeFleetCapacity, type SlotState } from "@/lib/hashrate";
import {
  FLEET_GAUGE_TITLE,
  FLEET_GAUGE_AVAILABLE,
  FLEET_GAUGE_MACHINES,
  FLEET_GAUGE_NOTE,
  FLEET_MEASURED_NOTE,
  RIG_SYNCING_NOTE,
  ODDS_STATUS_COMING,
  SELLER_LINK_LABEL,
  SELLER_LINK_LABEL_MARKET,
  REFERRAL_NOTICE,
} from "@/lib/hashrate-copy";
import { sellerProofUrl, MRR_REFERRAL_ID } from "@/lib/mrr";

/**
 * Total Galaxy Mind hashpower as a capacity bar: one block per machine,
 * each sized to its own real advertised hashrate, so the TOTAL is exact
 * (see composeFleetCapacity).
 *
 * PENDING_SLOT_DISPLAY / EXTRA_SLOT_DISPLAY in lib/hashrate.ts remain an
 * OPERATOR DECISION for PHANTOM slots only (2026-08-02, raised and
 * reaffirmed). Live listings always present at their real MRR status —
 * do not reintroduce a force-rented override for the Avalon/TITAN, which
 * understated availableTh against the chooser (fixed 2026-08-12).
 */
// "coming-online" / "offline" are presentation leftovers. Live MRR
// never emits them (operator 2026-09-14: every box is live; MRR
// checkout is the offline gate). Styles stay so a phantom slot or a
// fixture can still paint.
// `outline` rides with `bg` so the bar and its legend swatch can never
// drift apart — the swatch is the only key to the bar, and a state whose
// fill alone is invisible needs the same stroke in both places.
/* WARM IS WHAT YOU CAN TAKE (2026-09-05, operator ask).
 *
 * This was inverted: `available` painted --success green and `rented`
 * painted --accent orange. So the site's action colour marked the
 * machines a visitor CANNOT have, and a status colour marked the ones
 * they can — on the page whose entire job is the rent click, in the
 * block directly above the chooser.
 *
 * Two house rules said so independently. Night Bench: "--accent is live
 * state and the primary verb only", and "status green survives as a 6px
 * dot, never a sentence" — twenty-six full-height green bars is a
 * sentence, and on a 390px phone they read as a barcode. The .instr
 * palette contract says the same thing in the other direction: WARM is
 * the thing the visitor can act on, COOL is the world they are up
 * against, which is what lets these readouts work with no legend.
 *
 * A rented machine is precisely "the world you are up against" — real,
 * relevant, and not yours this hour. So it takes the cool. Available
 * takes the accent, because it is the offer.
 *
 * Nothing about the claim changes; only which state wears which colour. */
const SLOT_STYLE: Record<
  SlotState,
  { bg: string; outline: string; label: string }
> = {
  available: { bg: "bg-[var(--accent)]", outline: "", label: "available" },
  rented: {
    bg: "bg-[var(--fleet-cool)]",
    outline: "",
    label: "rented",
  },
  offline: {
    bg: "bg-[var(--bg-elevated-2)]",
    outline: "border border-dashed border-[var(--border-subtle)]",
    label: "offline",
  },
  // Dim accent rather than the offline grey — these are OUR machines
  // warming up, and at ~4.9 PH of the ~5.5 PH total they are most of the
  // bar, so rendering them like a fault would read as a broken fleet.
  //
  // The dashed accent STROKE is load-bearing, not decoration: the 20%
  // fill composites to rgb(253,233,209) on the light card, 1.18:1, which
  // is invisible. Outlined, it clears 2.3:1 on white and 8:1 on dark.
  // (Same failure as the /hashrate prize clock — a fill authored against
  // the dark scene only.)
  "coming-online": {
    bg: "bg-[var(--accent)]/20",
    outline: "border border-dashed border-[var(--accent)]",
    label: ODDS_STATUS_COMING,
  },
};

function th(n: number): string {
  const p = formatTh(n);
  return `${p.value} ${p.unit}`;
}

function formatTh(n: number): { value: string; unit: "PH/s" | "TH/s" } {
  return n >= 1000
    ? { value: (n / 1000).toFixed(2), unit: "PH/s" }
    : { value: String(n), unit: "TH/s" };
}

export default function FleetGauge({ desk }: { desk: HashrateDesk }) {
  const f = composeFleetCapacity(desk.ourRigs);
  // Prefer a bookable Galaxy Mind listing: the skeptic who clicks to
  // verify lands on our own machine with a Rent button, rather than on
  // the market page where none of our rigs appear above the fold.
  const proof = sellerProofUrl(desk.ourRigs);
  const syncing = desk.degraded.includes("our-rigs");

  // Only show states that actually have capacity in them — a permanent
  // "coming online 0 TH/s" row is noise, and reads as a broken readout.
  const legend = (
    [
      ["available", f.availableTh],
      ["rented", f.rentedTh],
      ["coming-online", f.comingTh],
    ] as [SlotState, number][]
  ).filter(([, amount]) => amount > 0);

  const total = formatTh(f.totalTh);

  // MEASURED vs LISTED. MRR publishes a live 5-minute average per rig and
  // the desk already carries it; nothing rendered it. Summed only over
  // rigs that actually report, and compared against the SAME rigs' listed
  // figure — totalling measured over reporters while dividing by the
  // whole fleet's listed hashrate would invent a shortfall out of a rig
  // that simply has no reading yet.
  const reporting = desk.ourRigs.filter(
    (r) => r.measuredPh != null && r.measuredPh > 0 && r.advertisedPh != null,
  );
  const measuredTh = reporting.reduce((t, r) => t + r.measuredPh! * 1000, 0);
  const listedOfReportingTh = reporting.reduce(
    (t, r) => t + r.advertisedPh! * 1000,
    0,
  );
  // Needs most of the fleet reporting before the sentence means anything.
  const measuredShown =
    !syncing &&
    measuredTh > 0 &&
    reporting.length >= Math.ceil(desk.ourRigs.length * 0.6);

  return (
    <section className="bezel-metal w-full min-w-0 max-w-[calc(100vw-2rem)] rounded-2xl p-[1.5px] nb-seated">
      <div className="rounded-2xl bg-[var(--bg-elevated)] p-5 sm:p-8">
        <p className="micro-label text-[var(--text-tertiary)]">
        {FLEET_GAUGE_TITLE}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        {/* -ink, not --accent: this is the fleet total as WORDS, and the
            bezel here is a light card in light theme, where pure brand
            orange measures 2.13:1 against it — under even the 3:1 large-
            text floor. Identical to --accent in dark, so the instrument
            look is unchanged; the glow keeps the pure orange. */}
        <p className="font-mono text-[var(--accent-ink)] [text-shadow:0_0_28px_var(--accent-glow)]">
          <span className="text-[clamp(2.25rem,12vw,6rem)] tabular-nums leading-none">
            {total.value}
          </span>
          <span className="ml-2 text-lg tabular-nums sm:text-2xl md:text-3xl">
            {" "}
            {total.unit}
          </span>
        </p>
        <p className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-2xl tabular-nums text-[var(--text-primary)] sm:text-3xl">
            {syncing ? "—" : f.slots}
          </span>
          <span className="micro-label text-[var(--text-tertiary)]">
            {FLEET_GAUGE_MACHINES}
          </span>
        </p>
      </div>

      {/* The total is the scale pitch; THIS is the number a visitor can act
          on. Labelling the total itself "available to rent" overstated it,
          since most of the fleet is not available at any given moment. */}
      {/* Number and label split: at 375px the combined string ran to two
          lines of large mono and read as a sentence rather than a figure. */}
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
        {/* Accent, matching the bars it describes. --accent-ink rather than
            --accent because this is TEXT: the raw brand orange is 2.17:1
            on paper and can never carry a word there. */}
        <span className="font-mono text-2xl tabular-nums text-[var(--accent-ink)] sm:text-3xl">
          {syncing ? "SYNCING" : th(f.availableTh)}
        </span>
        {!syncing && (
          <span className="micro-label text-[var(--accent-ink)]">
            {FLEET_GAUGE_AVAILABLE}
          </span>
        )}
      </p>

      {/* One chunk per machine. Capacity, not chart. Width is proportional
          to real hashrate, so a 54 TH machine reads as the fifth of a slot
          it actually is rather than sitting next to a 270 TH one at equal
          width. The track is tall on purpose: twenty-plus thin slices only
          read as a fleet when they have height. */}
      <div
        className="rack-track mt-6 rounded-md bg-[var(--bg-elevated-2)] p-1.5"
        aria-hidden="true"
      >
        <div className="flex h-16 gap-1 sm:h-24">
          {f.fleet.map((slot, i) => (
            <div
              key={i}
              style={{ flexGrow: slot.th }}
              className={`rack-slot min-w-[3px] rounded-sm ${SLOT_STYLE[slot.state].bg} ${SLOT_STYLE[slot.state].outline}`}
            />
          ))}
        </div>
      </div>

      <p className="sr-only">
        {syncing
          ? RIG_SYNCING_NOTE
          : `${th(f.availableTh)} of ${th(f.totalTh)} available to rent now, across ${f.slots} machines.`}
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {legend.map(([state, amount]) => (
          <div key={state} className="flex items-baseline gap-2">
            <span
              className={`rack-slot inline-block h-2.5 w-2.5 rounded-sm ${SLOT_STYLE[state].bg} ${SLOT_STYLE[state].outline}`}
              aria-hidden="true"
            />
            <dt className="micro-label text-[var(--text-tertiary)]">
              {SLOT_STYLE[state].label}
            </dt>
            <dd className="font-mono text-sm tabular-nums">
              {syncing ? "SYNCING" : th(amount)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        {syncing ? RIG_SYNCING_NOTE : FLEET_GAUGE_NOTE}
      </p>

      {/* Rendered whatever it says, including the days it sits under the
          listed figure — a machine reconnecting to a new pool ramps for
          10–30 minutes, which the FAQ already explains. Showing it only
          when flattering would make the good days worth nothing. */}
      {measuredShown && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {FLEET_MEASURED_NOTE.replace(
            "{LISTED}",
            `${Math.round(listedOfReportingTh).toLocaleString("en-US")} TH`,
          )
            .replace(
              "{MEASURED}",
              `${Math.round(measuredTh).toLocaleString("en-US")} TH`,
            )
            .replace("{N}", String(reporting.length))}
        </p>
      )}

      {/* The claim above is "each block is a real machine" — this is where
          a reader goes to check it. The referral notice sits with the link
          it describes, not in a footer nobody reads. */}
      <p className="mt-3 text-sm">
        <a
          href={proof.href}
          className="inline-flex min-h-[44px] items-center text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          {proof.isOurListing ? SELLER_LINK_LABEL : SELLER_LINK_LABEL_MARKET} →
        </a>
      </p>
      {MRR_REFERRAL_ID != null && (
        <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
          {REFERRAL_NOTICE}
        </p>
      )}
      </div>
    </section>
  );
}
