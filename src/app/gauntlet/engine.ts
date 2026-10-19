/* =====================================================================
 * Gauntlet engine · pure, deterministic, no React, no wall clock.
 *
 * v2 (2026-07-08) redesign · the operator's verdict on v1 was right:
 * a fixed tape with scripted dates is a quiz you can only fail to
 * memorize once. v2 is a blind-history roguelike:
 *
 *   · Each run drops the player at a SEEDED RANDOM point in the real
 *     daily-close series with the dates masked. The tape is always
 *     real history · the game hides WHEN you are, never WHAT
 *     happened. The reveal at the end unmasks the calendar.
 *   · The player actively trades against two bots given identical
 *     salary and bills: the DCA bot (invests every paycheck, never
 *     sells) and the no-coiner bot (all cash). Score = alpha vs DCA.
 *     The site's thesis proves itself through play · most runs lose
 *     to the bot that never thinks.
 *   · Daily mode: one shared window per UTC day (Wordle model), one
 *     scored attempt, streaks, spoiler-free share grid. Practice
 *     mode: unlimited random seeds.
 *
 * Everything here is pure so the whole game is testable headless
 * (scripts/test-gauntlet.ts) and a given seed replays identically.
 * The ONLY sources of nondeterminism allowed in are the seed and the
 * price series, both passed in by the caller.
 * ===================================================================== */

export type BtcPoint = { t: number; p: number };

// ── Tuning ───────────────────────────────────────────────────────────
export const RUN_DAYS = 240; // one run ≈ 8 masked months
export const CTX_DAYS = 90; // visible history behind day 1
export const START_CASH = 10_000;
export const SALARY = 1_000;
export const PAYDAY_EVERY = 30;
export const BILL_COUNT = 3;
export const MARGIN_TERM = 30; // days until a margin position closes
export const MARGIN_LIQ_FRACTION = 0.25; // equity floor → liquidated
export const SEGMENTS = 8; // share-grid resolution

// Day arithmetic lives in lib/gauntlet-day so SiteHeader / /today
// don't import this full engine module. Re-export for game code.
export { gauntletNumber, nextGauntletAt } from "@/lib/gauntlet-day";

// Mulberry32 · tiny, seedable, plenty for game jitter.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Run setup ────────────────────────────────────────────────────────
export type RunSetup = {
  seed: number;
  mode: "daily" | "practice";
  number: number | null; // daily gauntlet number, null in practice
  prices: number[]; // CTX_DAYS of context, then RUN_DAYS+1 closes
  times: number[]; // unix seconds, parallel to prices · UI hides
  // these until the reveal
  runMin: number; // min/max close across run days (badge checks)
  runMax: number;
};

// Fixed calendar range for seed → absolute window (unix seconds).
// Independent of series length: same seed always aims at the same
// calendar day; we clamp into whatever history is loaded.
// Band sits inside a typical multi-year Yahoo BTC series with room
// for CTX+RUN after the pick (not piled on index 0 via pre-series
// targets the way a 2014–2024 band would for a 2021-origin series).
const SEED_T_LO = Math.floor(Date.UTC(2018, 0, 1) / 1000);
const SEED_T_HI = Math.floor(Date.UTC(2024, 0, 1) / 1000);
const SEED_T_RANGE = SEED_T_HI - SEED_T_LO;

export function setupRun(
  points: BtcPoint[],
  seed: number,
  mode: "daily" | "practice",
  number: number | null,
  // Challenge links: with time-anchored seeds the absolute window is
  // already recovered from the seed alone (leading-day drops don't
  // change which calendar window is chosen). shiftDays is kept for
  // API compatibility and applied as an extra calendar rewind on the
  // target (clamped) so absurd shifts still degrade to a playable
  // start instead of throwing.
  shiftDays = 0,
): RunSetup {
  const need = CTX_DAYS + RUN_DAYS + 1;
  if (points.length < need + 30) {
    throw new Error(`series too short: ${points.length} < ${need + 30}`);
  }
  const rng = mulberry32(seed);
  const span = points.length - need;
  // Seed → absolute target time inside a FIXED calendar band (not a
  // fraction of current span). Length N vs N+1 keeps the same window.
  const targetT =
    SEED_T_LO +
    Math.floor(rng() * SEED_T_RANGE) -
    Math.max(0, shiftDays) * 86_400;
  // Largest index i ∈ [0, span] with points[i].t <= targetT.
  let lo = 0;
  let hi = span;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= targetT) lo = mid;
    else hi = mid - 1;
  }
  if (points[0]!.t > targetT) lo = 0;
  const start = Math.max(0, Math.min(span, lo));
  const slice = points.slice(start, start + need);
  const prices = slice.map((pt) => pt.p);
  const times = slice.map((pt) => pt.t);
  let runMin = Infinity;
  let runMax = -Infinity;
  for (let i = CTX_DAYS; i < prices.length; i++) {
    if (prices[i] < runMin) runMin = prices[i];
    if (prices[i] > runMax) runMax = prices[i];
  }
  return { seed, mode, number, prices, times, runMin, runMax };
}

/** Close for a run day (0 = the day the run starts). */
export function priceAt(setup: RunSetup, day: number): number {
  return setup.prices[CTX_DAYS + Math.max(0, Math.min(RUN_DAYS, day))];
}

// ── Events ───────────────────────────────────────────────────────────
export type Tone = "fear" | "euphoria" | "bill" | "margin" | "info";

export type EventCard = {
  id: string;
  tone: Tone;
  title: string;
  body: string;
  billAmount?: number;
  billForcedSale?: number; // BTC sold to cover, 0 if fiat covered it
  marginOffer?: number; // suggested collateral
};

// Headlines are real-vibe but era-agnostic · the reveal pins the
// actual named events by their true dates. Each fires at most once
// per run.
const FEAR_POOL: { id: string; title: string; body: string }[] = [
  {
    id: "f-exchange",
    title: "A top-five exchange halts withdrawals",
    body: "Insolvency rumors everywhere. The timeline says zero. Your coins are fine · your nerve is the question.",
  },
  {
    id: "f-stable",
    title: "A 'stablecoin' is printing zeros",
    body: "Tens of billions vaporizing by the hour. Contagion names funds you have actually heard of.",
  },
  {
    id: "f-ban",
    title: "Another country announces a ban",
    body: "The seventeenth ban so far, but the red candle does not know that. Everyone is quoting the same chart with an arrow pointing down.",
  },
  {
    id: "f-banks",
    title: "Banks are wobbling",
    body: "A regional bank just froze withdrawals and the FDIC is working weekends. Nobody is sure where the dominoes stop.",
  },
  {
    id: "f-fund",
    title: "A famous fund is force-selling",
    body: "Margin calls cascade. Every liquidation prints a lower price and triggers the next one.",
  },
];

const EUPHORIA_POOL: { id: string; title: string; body: string }[] = [
  {
    id: "e-ath",
    title: "Price discovery · no resistance above",
    body: "Your coins have never been worth more. The group chat is naming yachts. Someone said supercycle unironically.",
  },
  {
    id: "e-suits",
    title: "The suits are buying",
    body: "An institution you have definitely heard of just disclosed a position. CNBC cannot decide if it is priced in.",
  },
  {
    id: "e-barber",
    title: "Your barber asks about leverage",
    body: "Everyone is a genius right now. The last people in are the most confident.",
  },
  {
    id: "e-etf",
    title: "ETF chatter is everywhere",
    body: "Approval odds are a meme format now. Analysts who called it a scam are writing price targets.",
  },
];

const BILL_THINGS = [
  ["the transmission", 900],
  ["a root canal", 1400],
  ["the vet bill", 600],
  ["a burst pipe", 1100],
  ["new brakes", 500],
  ["the tax bill", 1500],
] as const;

// ── Game state ───────────────────────────────────────────────────────
export type Trade = {
  day: number;
  kind: "buy" | "sell" | "forced" | "margin-open" | "margin-close" | "liq";
  usd: number;
  btc: number;
  price: number;
};

export type MarginPos = {
  collateral: number;
  entry: number;
  openedDay: number;
};

export type GameState = {
  day: number; // last PROCESSED day boundary
  fiat: number;
  btc: number;
  margin: MarginPos | null;
  liquidated: boolean;
  trades: Trade[];
  dcaFiat: number;
  dcaBtc: number;
  cashFiat: number;
  youSeries: number[]; // net worth at each processed day
  dcaSeries: number[];
  pendingCard: EventCard | null;
  bills: { day: number; amount: number; thing: string }[];
  usedFear: string[];
  usedEuphoria: string[];
  marginOffers: number;
  cooldownUntil: number;
  runHigh: number; // running max of run-day closes
  drawdownFlagged: boolean;
};

export function createState(setup: RunSetup): GameState {
  const rng = mulberry32(setup.seed ^ 0x9e3779b9);
  // Pre-roll bills · min 25-day gaps, none in the first 15 or last 10.
  const bills: GameState["bills"] = [];
  let guard = 0;
  while (bills.length < BILL_COUNT && guard++ < 200) {
    const day = 15 + Math.floor(rng() * (RUN_DAYS - 25));
    if (bills.some((b) => Math.abs(b.day - day) < 25)) continue;
    const [thing, amount] = BILL_THINGS[Math.floor(rng() * BILL_THINGS.length)];
    bills.push({ day, amount, thing });
  }
  bills.sort((a, b) => a.day - b.day);
  const p0 = priceAt(setup, 0);
  return {
    day: 0,
    fiat: START_CASH,
    btc: 0,
    margin: null,
    liquidated: false,
    trades: [],
    dcaFiat: 0,
    dcaBtc: START_CASH / p0, // DCA bot deploys day 0, then every payday
    cashFiat: START_CASH,
    youSeries: [START_CASH],
    dcaSeries: [START_CASH],
    pendingCard: null,
    bills,
    usedFear: [],
    usedEuphoria: [],
    marginOffers: 0,
    cooldownUntil: 8, // let the player breathe before the first card
    runHigh: p0,
    drawdownFlagged: false,
  };
}

export function marginEquity(m: MarginPos, price: number): number {
  return m.collateral + 2 * m.collateral * (price / m.entry - 1);
}

export function netWorth(s: GameState, price: number): number {
  return (
    s.fiat +
    s.btc * price +
    (s.margin ? Math.max(0, marginEquity(s.margin, price)) : 0)
  );
}

// ── Player actions ───────────────────────────────────────────────────
export function buy(s: GameState, setup: RunSetup, usd: number): void {
  const p = priceAt(setup, s.day);
  const amt = Math.min(usd, s.fiat);
  if (amt < 1) return;
  s.fiat -= amt;
  s.btc += amt / p;
  s.trades.push({ day: s.day, kind: "buy", usd: amt, btc: amt / p, price: p });
}

export function sell(s: GameState, setup: RunSetup, fraction: number): void {
  const p = priceAt(setup, s.day);
  const btcOut = s.btc * Math.max(0, Math.min(1, fraction));
  if (btcOut * p < 1) return;
  s.btc -= btcOut;
  s.fiat += btcOut * p;
  s.trades.push({
    day: s.day,
    kind: "sell",
    usd: btcOut * p,
    btc: btcOut,
    price: p,
  });
}

export function openMargin(s: GameState, setup: RunSetup, usd: number): void {
  if (s.margin) return;
  const p = priceAt(setup, s.day);
  const amt = Math.min(usd, s.fiat);
  if (amt < 100) return;
  s.fiat -= amt;
  s.margin = { collateral: amt, entry: p, openedDay: s.day };
  s.marginOffers += 1;
  s.trades.push({
    day: s.day,
    kind: "margin-open",
    usd: amt,
    btc: 0,
    price: p,
  });
}

// ── Simulation step · one day boundary ──────────────────────────────
/** Advance to `day`, processing salary, bills, margin, bots, events.
 *  Returns a card to surface (tape should pause) or null. */
export function advanceDay(
  s: GameState,
  setup: RunSetup,
  rng: () => number,
): EventCard | null {
  s.day += 1;
  const day = s.day;
  const p = priceAt(setup, day);
  let card: EventCard | null = null;

  // Salary · everyone gets it, the DCA bot deploys instantly.
  if (day % PAYDAY_EVERY === 0 && day < RUN_DAYS) {
    s.fiat += SALARY;
    s.cashFiat += SALARY;
    s.dcaFiat += SALARY;
    s.dcaBtc += s.dcaFiat / p;
    s.dcaFiat = 0;
  }

  // Bills · identical drain for player and both bots. Short fiat →
  // forced BTC sale at market, the liquidity lesson.
  const bill = s.bills.find((b) => b.day === day);
  if (bill) {
    let forced = 0;
    if (s.fiat >= bill.amount) {
      s.fiat -= bill.amount;
    } else {
      const shortfall = bill.amount - s.fiat;
      s.fiat = 0;
      forced = Math.min(s.btc, shortfall / p);
      s.btc -= forced;
      const covered = forced * p;
      if (covered < shortfall - 0.01) s.fiat -= shortfall - covered; // debt
      if (forced > 0) {
        s.trades.push({
          day,
          kind: "forced",
          usd: covered,
          btc: forced,
          price: p,
        });
      }
    }
    // DCA bot pays the same bill (it keeps no cash → always forced).
    if (s.dcaFiat >= bill.amount) s.dcaFiat -= bill.amount;
    else {
      const short = bill.amount - s.dcaFiat;
      s.dcaFiat = 0;
      const sold = Math.min(s.dcaBtc, short / p);
      s.dcaBtc -= sold;
      if (sold * p < short - 0.01) s.dcaFiat -= short - sold * p;
    }
    s.cashFiat -= bill.amount;
    card = {
      id: `bill-${day}`,
      tone: "bill",
      title: `Life happens · ${bill.thing}`,
      body:
        forced > 0
          ? `$${bill.amount.toLocaleString("en-US")} due and your fiat pocket was short. The market sold ${forced.toFixed(5)} BTC for you, at its price, not yours.`
          : `$${bill.amount.toLocaleString("en-US")} due, paid in cash. Everyday life does not care where the chart is.`,
      billAmount: bill.amount,
      billForcedSale: forced,
    };
  }

  // Margin position · check liquidation, then expiry.
  if (s.margin) {
    const eq = marginEquity(s.margin, p);
    if (eq <= s.margin.collateral * MARGIN_LIQ_FRACTION) {
      s.trades.push({
        day,
        kind: "liq",
        usd: s.margin.collateral,
        btc: 0,
        price: p,
      });
      s.margin = null;
      s.liquidated = true;
      card = {
        id: `liq-${day}`,
        tone: "fear",
        title: "LIQUIDATED",
        body: "The margin desk does not negotiate. Your collateral is gone. This is the lesson leverage teaches, and it only teaches it this way.",
      };
    } else if (day - s.margin.openedDay >= MARGIN_TERM) {
      s.fiat += eq;
      s.trades.push({
        day,
        kind: "margin-close",
        usd: eq,
        btc: 0,
        price: p,
      });
      const won = eq > s.margin.collateral;
      s.margin = null;
      if (!card) {
        card = {
          id: `mclose-${day}`,
          tone: won ? "euphoria" : "info",
          title: won ? "Margin position closed · green" : "Margin position closed",
          body: won
            ? `The position paid $${Math.round(eq).toLocaleString("en-US")} back. The house let you win one. That is how they get you.`
            : `Position closed for $${Math.round(eq).toLocaleString("en-US")}. Leverage cuts both ways · you kept most of your fingers.`,
        };
      }
    }
  }

  // Record the day's marks BEFORE any new headline · series index = day.
  s.youSeries[day] = netWorth(s, p);
  s.dcaSeries[day] = s.dcaFiat + s.dcaBtc * p;

  // Headline triggers · price-action based, so every window produces
  // its own sequence. One card at a time, cooldown between.
  if (!card && day >= s.cooldownUntil) {
    const prev = priceAt(setup, day - 1);
    if (p > s.runHigh) s.runHigh = p;
    const drawdown = p / s.runHigh - 1;
    const week = priceAt(setup, Math.max(0, day - 7));
    const dayMove = p / prev - 1;
    const weekMove = p / week - 1;

    const fearHit =
      dayMove <= -0.09 ||
      weekMove <= -0.2 ||
      (drawdown <= -0.25 && !s.drawdownFlagged);
    const euphoriaHit = weekMove >= 0.22 || (day >= 30 && p === s.runHigh && dayMove >= 0.04);

    if (drawdown <= -0.25) s.drawdownFlagged = true;
    if (drawdown > -0.15) s.drawdownFlagged = false;

    if (fearHit) {
      const pool = FEAR_POOL.filter((f) => !s.usedFear.includes(f.id));
      if (pool.length > 0) {
        const pick = pool[Math.floor(rng() * pool.length)];
        s.usedFear.push(pick.id);
        card = { ...pick, tone: "fear" };
      }
    } else if (euphoriaHit) {
      // Euphoria sometimes arrives as a margin offer · the temptation
      // mechanic. Caps: two offers per run, one open position.
      const offerMargin =
        s.marginOffers < 2 && !s.margin && s.fiat >= 500 && rng() < 0.45;
      const pool = EUPHORIA_POOL.filter((e) => !s.usedEuphoria.includes(e.id));
      if (offerMargin) {
        card = {
          id: `margin-${day}`,
          tone: "margin",
          title: "Your broker offers 2x leverage",
          body: "Everything is going up. The margin desk would like to double your conviction · for a price. Liquidation sits 37.5% below here.",
          marginOffer: Math.min(2500, Math.floor(s.fiat / 100) * 100),
        };
      } else if (pool.length > 0) {
        const pick = pool[Math.floor(rng() * pool.length)];
        s.usedEuphoria.push(pick.id);
        card = { ...pick, tone: "euphoria" };
      }
    }
    if (card) s.cooldownUntil = day + 12 + Math.floor(rng() * 8);
  }

  s.pendingCard = card;
  return card;
}

// ── Scoring · the reveal ─────────────────────────────────────────────
export type EraMarker = { iso: string; label: string; runDay: number };

// The named history the reveal pins when the window contains it.
// Exported for the Runner too · its death screen names the week that
// killed you and its background watermarks the eras scrolling past.
/**
 * Runner daily-course anchor (2026-07-11 · fairness debt fix).
 *
 * The old TapeRunner picked startIdx as a fraction of the LOADED series
 * length · two clients whose histories differed by even one point (a
 * Yahoo hiccup, a load straddling the UTC close) rerolled the ENTIRE
 * course on a "same tape for everyone" day, and the reachable day count
 * (the score cap) shifted with it. The anchor is now a DATE derived
 * from the day number alone, exactly the WEN pattern: same puzzle day →
 * same start date, always. Locating that date in whatever series a
 * client loaded shrinks any residual variance to the true data
 * difference (≤1 day of runway) instead of a full different course.
 *
 * Back-days band [400, 1700]: ≥400 days of runway to the present keeps
 * the run meaningful, ≤1700 keeps the start inside the API's sliding
 * 1825-day window with margin for the 90-day normalization lookback.
 */
export function runnerStartBackDays(dayNumber: number): number {
  const seed = (0x2b0b ^ Math.imul(dayNumber, 2654435761)) >>> 0;
  const rng = mulberry32(seed);
  return 400 + Math.floor(rng() * 1300);
}

/**
 * Index of the first point at-or-after the anchor date. `times` are the
 * series timestamps in unix SECONDS (the /api/history unit). Clamped so
 * a degenerate series can never produce an unplayable course.
 */
export function locateRunnerStart(
  times: number[],
  anchorSec: number,
): number {
  let idx = times.length - 1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= anchorSec) {
      idx = i;
      break;
    }
  }
  return Math.max(1, Math.min(idx, Math.max(1, times.length - 100)));
}

export const NAMED_ERAS: { iso: string; label: string }[] = [
  { iso: "2021-11-09", label: "The 2021 top" },
  { iso: "2022-05-11", label: "Luna collapses" },
  { iso: "2022-06-18", label: "Capitulation low" },
  { iso: "2022-11-08", label: "FTX halts withdrawals" },
  { iso: "2023-03-11", label: "SVB weekend" },
  { iso: "2024-01-10", label: "Spot ETFs approved" },
  { iso: "2024-04-19", label: "The fourth halving" },
  { iso: "2024-11-05", label: "Election night" },
  { iso: "2025-01-20", label: "Six figures holds" },
];

export function eraMarkers(setup: RunSetup): EraMarker[] {
  const out: EraMarker[] = [];
  const first = setup.times[CTX_DAYS];
  const last = setup.times[setup.times.length - 1];
  for (const era of NAMED_ERAS) {
    const t = Math.floor(new Date(era.iso + "T00:00:00Z").getTime() / 1000);
    if (t >= first && t <= last) {
      // nearest run day
      let best = 0;
      let bestDist = Infinity;
      for (let d = 0; d <= RUN_DAYS; d++) {
        const dist = Math.abs(setup.times[CTX_DAYS + d] - t);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      out.push({ iso: era.iso, label: era.label, runDay: best });
    }
  }
  return out;
}

export type Badge = { id: string; label: string; hint: string };

export type FinalReport = {
  youFinal: number;
  dcaFinal: number;
  cashFinal: number;
  alpha: number; // percentage points vs the DCA bot
  tier: string;
  tierTone: string;
  badges: Badge[];
  eras: EraMarker[];
  grid: string; // SEGMENTS emoji squares
  windowStartIso: string;
  windowEndIso: string;
};

export function tierFor(alpha: number, liquidated: boolean): {
  tier: string;
  tone: string;
} {
  if (liquidated && alpha < 0) return { tier: "REKT", tone: "#ff3a4f" };
  if (alpha >= 5) return { tier: "ORACLE", tone: "#31C48D" };
  if (alpha > 0) return { tier: "BOT SLAYER", tone: "var(--success)" };
  if (alpha >= -5) return { tier: "STEADY HANDS", tone: "var(--accent)" };
  if (alpha >= -15) return { tier: "SHAKEN", tone: "#FB923C" };
  return { tier: "OUTTRADED", tone: "#7ec0ff" };
}

export function finish(s: GameState, setup: RunSetup): FinalReport {
  const pEnd = priceAt(setup, RUN_DAYS);
  const youFinal = netWorth(s, pEnd);
  const dcaFinal = s.dcaFiat + s.dcaBtc * pEnd;
  const cashFinal = s.cashFiat;
  // Guard the divide · a deep-bear window can drive the DCA bot's
  // ending value to zero (forced bill sales). Match the live HUD's
  // guard so the reveal never shows "Infinity% vs the bot" and the
  // persisted result can't serialize a non-finite alpha (review
  // 2026-07-09 · would crash the ready screen on the next load).
  const alpha = dcaFinal > 0 ? (youFinal / dcaFinal - 1) * 100 : 0;
  const { tier, tone } = tierFor(alpha, s.liquidated);

  const badges: Badge[] = [];
  const add = (id: string, label: string, hint: string) =>
    badges.push({ id, label, hint });
  if (alpha > 0) add("bot-slayer", "BOT SLAYER", "Beat the DCA bot");
  if (alpha >= 5) add("oracle", "ORACLE", "Beat the bot by 5+ points");
  if (
    !s.liquidated &&
    !s.trades.some((t) => t.kind === "sell" || t.kind === "margin-open")
  ) {
    add("diamond-cast", "DIAMOND CAST", "Never sold, never levered");
  }
  if (
    s.trades.some(
      (t) => t.kind === "buy" && t.price <= setup.runMin * 1.03,
    )
  ) {
    add("knife-catcher", "KNIFE CATCHER", "Bought within 3% of the low");
  }
  if (
    s.trades.some(
      (t) => t.kind === "sell" && t.price >= setup.runMax * 0.97,
    )
  ) {
    add("top-seller", "TOP SELLER", "Sold within 3% of the high");
  }
  if (s.liquidated) add("rekt", "REKT", "Liquidated on margin");
  if (
    s.trades.some(
      (t) => t.kind === "margin-close" && t.usd > 0,
    ) &&
    !s.liquidated
  ) {
    add("tightrope", "TIGHTROPE", "Walked leverage and lived");
  }
  const eras = eraMarkers(setup);
  for (const era of eras) {
    if (era.label === "FTX halts withdrawals") {
      add("survived-ftx", "SURVIVED FTX", "Your window held the collapse");
    }
    if (era.label === "Spot ETFs approved") {
      add("suit-season", "SUIT SEASON", "Your window held the ETF day");
    }
    if (era.label === "The fourth halving") {
      add("halving-witness", "HALVING WITNESS", "Block 840,000 in window");
    }
  }

  // Spoiler-free share grid · at each segment boundary, ahead of the
  // bot or not. Liquidation paints its segment black.
  let grid = "";
  const liqDay = s.trades.find((t) => t.kind === "liq")?.day ?? -1;
  for (let g = 1; g <= SEGMENTS; g++) {
    const d = Math.min(RUN_DAYS, Math.round((g * RUN_DAYS) / SEGMENTS));
    const seg0 = Math.round(((g - 1) * RUN_DAYS) / SEGMENTS);
    if (liqDay >= seg0 && liqDay <= d) {
      grid += "⬛";
    } else {
      grid += (s.youSeries[d] ?? 0) >= (s.dcaSeries[d] ?? 0) ? "🟩" : "🟧";
    }
  }

  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  return {
    youFinal,
    dcaFinal,
    cashFinal,
    alpha,
    tier,
    tierTone: tone,
    badges,
    eras,
    grid,
    windowStartIso: iso(setup.times[CTX_DAYS]),
    windowEndIso: iso(setup.times[setup.times.length - 1]),
  };
}

/**
 * A single personalized post-run lesson · names the player's most
 * costly decision so a loss teaches instead of just stinging (games
 * audit 2026-07-09 · "the bot beat you" never says HOW to do better).
 * Pure · all inputs live in the finished GameState + report.
 */
export function coachLine(
  s: GameState,
  setup: RunSetup,
  report: FinalReport,
): string {
  const pEnd = priceAt(setup, RUN_DAYS);

  // Liquidation is the loudest lesson · lead with it.
  if (s.liquidated) {
    const liq = s.trades.find((t) => t.kind === "liq");
    return liq
      ? `Your 2x margin liquidated on day ${liq.day}. Leverage cuts both ways, and the bot never touched it.`
      : "Your leveraged position liquidated. The bot never used margin, and it still beat you.";
  }

  // The most costly panic-sell · a sell the tape later reclaimed.
  const sells = s.trades.filter(
    (t) => (t.kind === "sell" || t.kind === "forced") && t.btc < 0 && t.price > 0,
  );
  let worst: { t: Trade; regretPct: number; regretUsd: number } | null = null;
  for (const t of sells) {
    const upside = (pEnd - t.price) / t.price;
    const regretUsd = Math.abs(t.btc) * (pEnd - t.price);
    if (upside > 0 && (!worst || regretUsd > worst.regretUsd)) {
      worst = { t, regretPct: upside * 100, regretUsd };
    }
  }
  if (worst && worst.regretPct >= 8) {
    const forced = worst.t.kind === "forced";
    return `You ${forced ? "were forced to sell" : "sold"} ${Math.abs(worst.t.btc).toFixed(3)} BTC on day ${worst.t.day}. Holding to the reveal was +${worst.regretPct.toFixed(0)}%. Euphoria feels the same at every top; fear feels like prudence at every bottom.`;
  }

  const buys = s.trades.filter((t) => t.kind === "buy");
  if (buys.length === 0) {
    return "You never bought a dip. The DCA bot bought every payday and let time do the work. Boring wins more often than clever.";
  }
  if (report.alpha > 0) {
    return `You beat the bot that never thinks by ${report.alpha.toFixed(1)} points. Rare air. Most runs lose to boring.`;
  }
  return `You mostly watched while the bot bought every payday. It won by ${Math.abs(report.alpha).toFixed(1)} points. The only thing that reliably beats it is stacking on schedule, and spending and replacing.`;
}

export function shareText(
  report: FinalReport,
  number: number | null,
  streak: number,
  // Optional player identity · the assigned arcade handle and today's
  // board rank, appended when provided (operator request 2026-07-09).
  // Callers that omit it (and the test) get the exact original text.
  opts?: { handle?: string; rank?: number | null },
): string {
  const a = `${report.alpha >= 0 ? "+" : ""}${report.alpha.toFixed(1)}%`;
  const head =
    number != null
      ? `THE BITCOIN GAUNTLET #${number}`
      : "THE BITCOIN GAUNTLET · practice run";
  const streakLine = number != null && streak > 1 ? ` · streak ${streak}` : "";
  const idLine = opts?.handle
    ? `\nplayed as ${opts.handle}${opts.rank != null ? ` · #${opts.rank} today` : ""}`
    : "";
  return `${head}\n${a} vs the DCA bot · ${report.tier}\n${report.grid}${streakLine}${idLine}\n\nEight months of actual bitcoin history, dates hidden. Can you beat the bot that never thinks?\ngalaxymind.space/gauntlet`;
}
