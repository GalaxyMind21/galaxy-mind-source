import type { HashrateDesk } from "@/lib/hashrate";
import {
  DESK_STATUS_LIVE,
  DESK_STATUS_DEGRADED,
  DESK_STATUS_SWEEP_BROKE,
} from "@/lib/hashrate-copy";

/**
 * The desk-level honesty lamp · same idiom as the Supply Clock's
 * BASELINE/SYNCING/REFILLING/DRAINING states on /float.
 *
 * `desk.degraded` was computed on every request and shown to nobody:
 * the JSON twin and the MCP tool both carried it, the human reader did
 * not. Every failure mode this page has had reduces to "the page looks
 * complete when a feed is down", and a reader who cannot see which
 * feeds answered has no way to discount what they are looking at.
 *
 * 'ask-book-partial' is deliberately absent from FEEDS: it is not a
 * feed, it is a quality note about one. This strip surfaces it itself
 * via the sweepBroke branch below (the panel that used to carry it was
 * removed in the sales pivot).
 */
const FEEDS: [flag: string, label: string][] = [
  ["network-hashrate", "network hashrate"],
  ["block-fees", "block fees"],
  ["block-height", "block height"],
  ["our-rigs", "our rigs"],
  ["algo-stats", "algo stats"],
  ["ask-book", "ask book"],
  // btc-price was missing: with only CoinGecko down the strip announced
  // "feeds live" while the hero prize and the whole chooser rendered
  // SYNCING on the same page — the exact contradiction this strip
  // exists to prevent. A test now derives this list from the flags
  // lib/hashrate.ts actually pushes, so the next new feed cannot be
  // silently forgotten here.
  ["btc-price", "bitcoin price"],
  // Recent Solo CK catches (the aliveness-proof panel, 2026-08-04).
];

export default function DeskStatusStrip({ desk }: { desk: HashrateDesk }) {
  const down = FEEDS.filter(([flag]) => desk.degraded.includes(flag));
  // `ask-book-partial` is a real upstream failure (a sweep that died part-way)
  // but it is not one of the six FEEDS, so filtering on FEEDS alone left this
  // strip announcing "feeds live · 6/6" on the same page where the price book
  // was already saying the sweep stopped early. Two panels, one page,
  // contradicting each other about whether an upstream failed.
  const sweepBroke = desk.degraded.includes("ask-book-partial");
  const ok = down.length === 0 && !sweepBroke;

  return (
    <section
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p
          className={`micro-label ${
            ok ? "text-[var(--success)]" : "text-[var(--warning)]"
          }`}
        >
          {ok ? "● feeds live" : "● SYNCING"}
        </p>
        <p className="micro-label text-[var(--text-tertiary)]">
          {FEEDS.length - down.length}/{FEEDS.length} feeds
        </p>
      </div>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {ok
          ? DESK_STATUS_LIVE
          : down.length === 0
            ? // Sweep died part-way with every named feed answering. Saying
              // "0 of 6 feeds are unavailable" here would be its own small lie.
              DESK_STATUS_SWEEP_BROKE
            : DESK_STATUS_DEGRADED.replace("{COUNT}", String(down.length))
                .replace("{TOTAL}", String(FEEDS.length))
                .replace(
                  "{FEEDS}",
                  down.map(([, label]) => label).join(", "),
                ) + (sweepBroke ? ` ${DESK_STATUS_SWEEP_BROKE}` : "")}
      </p>
    </section>
  );
}
