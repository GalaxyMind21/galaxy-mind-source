/* =====================================================================
 * TwentyOneMillionGrid · "every square is 10,000 BTC" (2026-06-13)
 *
 * The no-metaphor companion to the Supply Clock hero: 2,100 squares,
 * one per 10,000 BTC of the 21M cap, colored by where those coins
 * actually are today. The first read is the whole point · the orange
 * region (still buyable) is startlingly small next to everything
 * that is already gone.
 *
 * Server component, pure SVG · crawlable, theme-aware via CSS vars
 * where the page surface shows through, fixed warm palette for the
 * cells themselves (the grid is a data graphic, not a themed panel ·
 * same fixed-light-on-dark logic as the instrument dials). Counts
 * derive from the live snapshot every render, so the grid and the
 * clock can never disagree.
 *
 * The 2,100 cells render as FOUR <path>s (one per cohort · same
 * batched-d-string technique as the /gauntlet glyphs), not 2,100
 * <rect>s: a server component's markup ships twice (HTML + RSC
 * flight), and per-element that was ~550 KB of the /float document
 * (payload audit 2026-07-12). Relative subpaths + integer grid units
 * keep each cell at ~13 bytes; rounded corners survive via the
 * stroke-linejoin trick (inset square + same-color stroke). The
 * per-cohort gm-cell-* classes are load-bearing · SupplyStory's
 * scrollytelling dims cohorts through them.
 *
 * Cell buckets (each square = 10,000 BTC, rounded to sum to 2,100):
 *   AVAILABLE  · snapshot.inPlay                       · orange
 *   TRACKED    · governments + ETFs + public companies · steel blue
 *   LOST+HELD  · everything else already mined         · dark warm
 *   UNMINED    · 21M − mined                           · near-void
 * ===================================================================== */

import type { FloatSnapshot } from "@/lib/float-snapshot";

const COLS = 60;
const ROWS = 35;
const TOTAL_CELLS = COLS * ROWS; // 2,100 · 10,000 BTC each
// Integer grid units (was CELL 5.4 / GAP 1.2 · same 0.222 gap ratio,
// scaled ×5/3) so the d-strings and viewBox carry no float64 noise.
const CELL = 9;
const GAP = 2;
const PAD = 3;
const STEP = CELL + GAP;
// Rounded corners without per-cell rx: each cell is an inset square
// whose same-color stroke (round joins) rebuilds the full 9-unit
// footprint with corner radius = INSET.
const INSET = 1.5;
const INNER = CELL - 2 * INSET;

const BUCKET_STYLE = {
  available: { fill: "#F7931A", opacity: 1 },
  tracked: { fill: "#4a5568", opacity: 0.95 },
  lostHeld: { fill: "#39302a", opacity: 0.95 },
  unmined: { fill: "#1a1a1f", opacity: 0.9 },
} as const;

type Bucket = keyof typeof BUCKET_STYLE;

/** Cohort totals behind the grid · exported so the SupplyStory
 *  captions on /float cite the SAME numbers the squares encode
 *  (B7 · 2026-07-07). Pure derivation from the snapshot. */
export function computeSupplyBuckets(snapshot: FloatSnapshot): {
  inPlay: number;
  tracked: number;
  lostHeld: number;
  unmined: number;
  /** False when any live cohort is withheld · do not quote `tracked` as 0. */
  trackedKnown: boolean;
} {
  const CAP = 21_000_000;
  const trackedKnown =
    snapshot.cohorts.governments != null &&
    snapshot.cohorts.etfs != null &&
    snapshot.cohorts.publicCompanies != null;
  const tracked =
    (snapshot.cohorts.governments ?? 0) +
    (snapshot.cohorts.etfs ?? 0) +
    (snapshot.cohorts.publicCompanies ?? 0);
  const unmined = Math.max(0, CAP - snapshot.minedSupply);
  const lostHeld = Math.max(0, CAP - unmined - tracked - snapshot.inPlay);
  return { inPlay: snapshot.inPlay, tracked, lostHeld, unmined, trackedKnown };
}

export function TwentyOneMillionGrid({ snapshot }: { snapshot: FloatSnapshot }) {
  const CAP = 21_000_000;
  const PER_CELL = CAP / TOTAL_CELLS; // 10,000 BTC

  // Everything mined is either in play, tracked, or lost/held ·
  // lostHeld is the residual of the mined side, unmined the rest.
  // Shared with the SupplyStory captions via computeSupplyBuckets.
  const {
    tracked,
    lostHeld: lostHeldBtc,
    unmined: unminedBtc,
    trackedKnown,
  } = computeSupplyBuckets(snapshot);

  // Integer cell counts that always sum to TOTAL_CELLS · largest-
  // remainder rounding so no bucket gains or loses a 10,000 BTC
  // square to float error.
  const raw: [Bucket, number][] = [
    ["available", snapshot.inPlay / PER_CELL],
    ["tracked", tracked / PER_CELL],
    ["lostHeld", lostHeldBtc / PER_CELL],
    ["unmined", unminedBtc / PER_CELL],
  ];
  const floors = raw.map(([b, v]) => [b, Math.floor(v)] as [Bucket, number]);
  let used = floors.reduce((a, [, v]) => a + v, 0);
  const remainders = raw
    .map(([b, v], i) => ({ b, i, rem: v - Math.floor(v) }))
    .sort((a, z) => z.rem - a.rem);
  for (const r of remainders) {
    if (used >= TOTAL_CELLS) break;
    floors[r.i][1] += 1;
    used += 1;
  }

  // Paint order tells the story bottom-up: the available orange sits
  // at the TOP of the grid (read first), then tracked, then the dark
  // mass, unmined last.
  const order: Bucket[] = ["available", "tracked", "lostHeld", "unmined"];
  const cells: Bucket[] = [];
  for (const bucket of order) {
    const n = floors.find(([b]) => b === bucket)?.[1] ?? 0;
    for (let i = 0; i < n; i++) cells.push(bucket);
  }
  while (cells.length < TOTAL_CELLS) cells.push("unmined");

  // One compact d-string per cohort. First cell of a cohort is an
  // absolute M; every later cell a relative m from the previous
  // cell's origin (after z the current point returns to the subpath
  // start), so intra-row deltas are just "m11 0".
  const box = `h${INNER}v${INNER}h${-INNER}z`;
  const dByBucket: Record<Bucket, string> = {
    available: "",
    tracked: "",
    lostHeld: "",
    unmined: "",
  };
  const lastOrigin: Partial<Record<Bucket, { x: number; y: number }>> = {};
  cells.forEach((bucket, i) => {
    const x = PAD + (i % COLS) * STEP + INSET;
    const y = PAD + Math.floor(i / COLS) * STEP + INSET;
    const prev = lastOrigin[bucket];
    dByBucket[bucket] += prev
      ? `m${x - prev.x} ${y - prev.y}${box}`
      : `M${x} ${y}${box}`;
    lastOrigin[bucket] = { x, y };
  });

  const W = PAD * 2 + COLS * STEP - GAP;
  const H = PAD * 2 + ROWS * STEP - GAP;
  const availableCells = floors.find(([b]) => b === "available")?.[1] ?? 0;
  const fmtM = (n: number) => `${(n / 1e6).toFixed(1)}M`;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <h2 className="font-mono t-xs uppercase tracking-[0.18em] sm:tracking-[0.25em] text-[var(--text-tertiary)]">
        <span className="whitespace-nowrap">Every square</span>{" "}
        <span className="whitespace-nowrap">· 10,000 BTC</span>
      </h2>
      <p className="mt-2 mb-4 t-xs text-[var(--text-secondary)] font-sans leading-relaxed max-w-2xl">
        All 21 million bitcoin that will ever exist, as {TOTAL_CELLS.toLocaleString("en-US")} squares.
        The orange ones are still realistically buyable · {availableCells} squares.
        Everything else is already spoken for.
      </p>

      {/* Fixed dark backing · the grid is a data graphic, identical in
          both themes (fixed-light-on-dark, like the instrument dials). */}
      <div className="rounded-lg bg-[#12110F] p-3 sm:p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={
            trackedKnown
              ? `The 21 million bitcoin cap as ${TOTAL_CELLS} squares of 10,000 BTC each. ${availableCells} squares (${fmtM(snapshot.inPlay)} BTC) are still realistically buyable. The rest: ${fmtM(tracked)} in ETFs, treasuries and government hands, ${fmtM(lostHeldBtc)} lost or held long-term, ${fmtM(unminedBtc)} not yet mined.`
              : `The 21 million bitcoin cap as ${TOTAL_CELLS} squares of 10,000 BTC each. ${availableCells} squares (${fmtM(snapshot.inPlay)} BTC) are still realistically buyable. ETF, government and public company holdings are syncing and are not shown as zero. Lost or held: ${fmtM(lostHeldBtc)}. Unmined: ${fmtM(unminedBtc)}.`
          }
        >
          {(Object.keys(BUCKET_STYLE) as Bucket[]).map((bucket) => {
            const d = dByBucket[bucket];
            if (!d) return null;
            const st = BUCKET_STYLE[bucket];
            return (
              <path
                key={bucket}
                className={`gm-cell-${bucket}`}
                d={d}
                fill={st.fill}
                stroke={st.fill}
                strokeWidth={INSET * 2}
                strokeLinejoin="round"
                opacity={st.opacity}
              />
            );
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono t-xs text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: BUCKET_STYLE.available.fill }} />
          <span className="text-[var(--text-secondary)]">IN PLAY {fmtM(snapshot.inPlay)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: BUCKET_STYLE.tracked.fill }} />
          ETF+GOV+CO {trackedKnown ? fmtM(tracked) : "syncing"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: BUCKET_STYLE.lostHeld.fill }} />
          LOST+HELD {fmtM(lostHeldBtc)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px] border border-[#333]" style={{ background: BUCKET_STYLE.unmined.fill }} />
          UNMINED {fmtM(unminedBtc)}
        </span>
      </div>
    </section>
  );
}
