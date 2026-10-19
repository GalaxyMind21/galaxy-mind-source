import { bayIdFor } from "@/lib/rental-quote";
import type { HashrateDesk, DeskRig } from "@/lib/hashrate";
import { hardwareLabel } from "@/lib/hashrate";
import { blockOdds, rentalCostBtc, stakeReturn } from "@/lib/block-odds";
import {
  ODDS_TITLE,
  ODDS_SUB,
  REFERRAL_NOTICE,
  QUOTE_SINGLE_RENTAL_NOTE,
  ODDS_STATUS_AVAILABLE,
  ODDS_STATUS_RENTED,
  ODDS_STATUS_OFFLINE,
  ODDS_STATUS_COMING,
  ODDS_COMING_ONLINE_NOTE,
  RIG_SYNCING_NOTE,
  ODDS_EMPTY_TITLE,
  ODDS_EMPTY_COMING,
  ODDS_EMPTY_RENTED,
} from "@/lib/hashrate-copy";
import { MRR_REFERRAL_ID } from "@/lib/mrr";
import { BlockShotGrid, type ShotOffer } from "./BlockShotGrid";
import { maxDaysNow } from "@/lib/rental-limits";

/**
 * The product, as a chooser rather than a spreadsheet.
 *
 * Cards at every breakpoint: a table forced the two rental windows into
 * columns barely wide enough for a price on a phone, and this audience is
 * overwhelmingly mobile. Each card is one buyable thing with its own CTA.
 */
export default function BlockShot({ desk }: { desk: HashrateDesk }) {
  const { networkPhs, btcUsd, blockRewardBtc } = desk;
  if (networkPhs == null || btcUsd == null || blockRewardBtc == null) {
    return (
      <section
        id="your-shot"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
      >
        <p className="micro-label text-[var(--text-tertiary)]">
          {ODDS_TITLE} · SYNCING
        </p>
      </section>
    );
  }

  const prize = blockRewardBtc * btcUsd;
  const rigs = desk.ourRigs.filter(
    (r) =>
      r.advertisedPh != null &&
      r.advertisedPh > 0 &&
      r.askBtcPerPhDay != null &&
      r.askBtcPerPhDay > 0,
  );
  // The fleet card quotes only what a visitor can actually book right now.
  // Summing rented machines into it made the headline offer un-fulfillable —
  // an honesty bug on a page whose whole posture is honest odds.
  const rentableRigs = rigs.filter((r) => r.status === "available");
  const fleetPh = rentableRigs.reduce((s, r) => s + r.advertisedPh!, 0);
  const fleetAsk =
    fleetPh > 0
      ? rentableRigs.reduce(
          (s, r) => s + r.askBtcPerPhDay! * r.advertisedPh!,
          0,
        ) / fleetPh
      : 0;

  // Named bay for every listed machine, including ones still being
  // brought online. Coming-online rows stay unbookable (offline kind +
  // ODDS_STATUS_COMING); the summary note below still tallies them.
  const comingOnline = rigs.filter((r) => r.status === "coming-online");
  const comingTh = Math.round(
    comingOnline.reduce((s, r) => s + r.advertisedPh!, 0) * 1000,
  );

  const offers: ShotOffer[] = rigs.map((r: DeskRig, i: number) => {
    const hardware = hardwareLabel(r.id, r.name);
    // Public alias only: never the upstream rig id or listing name.
    const bayKey = bayIdFor(r.id) ?? `bay-x${i + 1}`;
    const bayNo = Number(bayKey.replace(/^bay-x?/, ""));
    return {
      key: bayKey,
      label: `Bay ${bayNo}`,
      bay: bayNo,
      hashLabel: `${Math.round(r.advertisedPh! * 1000)} TH/s`,
      kind:
        r.status === "rented"
          ? "rented"
          : r.status === "offline" || r.status === "coming-online"
            ? "offline"
            : "available",
      status:
        r.status === "rented"
          ? ODDS_STATUS_RENTED
          : r.status === "offline"
            ? ODDS_STATUS_OFFLINE
            : r.status === "coming-online"
              ? ODDS_STATUS_COMING
              : ODDS_STATUS_AVAILABLE,
      rentable: r.status === "available",
      ph: r.advertisedPh!,
      ask: r.askBtcPerPhDay!,
      href: r.rentUrl,
      links: [],
      best: false,
      freesInH:
        r.status === "rented" && r.hoursLeft != null && r.hoursLeft > 0
          ? Math.ceil(r.hoursLeft)
          : null,
      hardware,
    };
  });
  if (offers.length === 0) {
    const feedUp = desk.ourRigs.length > 0;
    return (
      <section
        id="your-shot"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
      >
        <p className="micro-label text-[var(--text-tertiary)]">
          {feedUp ? ODDS_EMPTY_TITLE : `${ODDS_TITLE} · SYNCING`}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {feedUp
            ? comingOnline.length > 0
              ? ODDS_EMPTY_COMING
              : ODDS_EMPTY_RENTED
            : RIG_SYNCING_NOTE}
        </p>
      </section>
    );
  }

  const bestOdds =
    fleetPh > 0
      ? blockOdds({ ph: fleetPh, hours: 168, networkPhs })
      : null;
  const bestCostBtc =
    fleetPh > 0
      ? rentalCostBtc({
          ph: fleetPh,
          hours: 168,
          askBtcPerPhDay: fleetAsk,
        })
      : null;
  const ret =
    bestOdds != null && bestCostBtc != null
      ? stakeReturn({
          pAtLeastOne: bestOdds.pAtLeastOne,
          prize,
          cost: bestCostBtc * btcUsd,
        })
      : null;

  return (
    <section
      id="your-shot"
      className="instr scroll-mt-24 rounded-3xl"
    >
      <div className="rounded-3xl px-5 py-7 sm:p-9">
      <p className="micro-label text-[var(--text-tertiary)]">{ODDS_TITLE}</p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
        {ODDS_SUB}
      </p>

      <BlockShotGrid
        offers={offers}
        hashprice={desk.hashprice}
        networkPhs={networkPhs}
        btcUsd={btcUsd}
        prizeUsd={prize}
        termCapHours={maxDaysNow() * 24}
      />

      {comingOnline.length > 0 && comingTh > 0 && (
        <p className="mt-5 text-sm text-[var(--text-secondary)]">
          {ODDS_COMING_ONLINE_NOTE.replace(
            "{N}",
            String(comingOnline.length),
          ).replace("{TH}", comingTh.toLocaleString("en-US"))}
        </p>
      )}
      {ret != null && (
        <p className="mt-5 text-sm text-[var(--text-secondary)]">
          {QUOTE_SINGLE_RENTAL_NOTE}
        </p>
      )}
      {/* Every rent CTA above is a referral link WHEN one is configured, so
          the disclosure belongs in this block rather than only beside the
          fleet gauge. Gated on the id itself: with MRR_REFERRAL_ID null the
          CTAs are plain MRR URLs, and a notice claiming otherwise would be
          the same false statement in the opposite direction. */}
      {MRR_REFERRAL_ID != null && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          {REFERRAL_NOTICE}
        </p>
      )}
      </div>
    </section>
  );
}