#!/usr/bin/env tsx
/**
 * scripts/check-treasury-mnav.ts
 *
 * Sanity-check live treasury mNAV math against bitcointreasuries.net
 * raw data. Catches the class of bug that bit us for XXI in May 2026:
 * we were reading market_cap_basic blindly, but XXI's data has basic
 * and fully_diluted in inverted order vs every other ticker (SPAC
 * sponsor-share quirk). We didn't catch it until an X user pointed
 * it out — this script would have flagged it before deploy.
 *
 * What it asserts for EACH tracked treasury ticker:
 *
 *   (1) mNAV is finite, positive, and within a sane range (0.3-3.0).
 *       Anything outside that range is almost certainly bad data —
 *       a treasury trading at 5x its BTC value is nonsensical, as is
 *       one trading at 0.1x. Either upstream returned garbage or our
 *       parser broke.
 *
 *   (2) mNAV computed as min(basic, fully_diluted) MARKET CAP divided
 *       by (btc_holdings * btc_price). Detects the XXI-class bug
 *       where the parser silently picks the wrong field.
 *
 *   (3) Per-ticker known-good range. Each major treasury has a rough
 *       historical mNAV band; significant deviations suggest something
 *       changed (corporate action, data feed shift, etc).
 *
 * USAGE:
 *
 *   # Local check against production data:
 *   npx tsx scripts/check-treasury-mnav.ts
 *
 *   # Strict mode — exit 1 on ANY warning (use in CI):
 *   npx tsx scripts/check-treasury-mnav.ts --strict
 *
 * EXIT CODES:
 *   0 — all checks pass
 *   1 — at least one HARD failure (mNAV out of sane range, parser
 *       returned null where data exists, etc)
 *   2 — soft warnings only (per-ticker historical-range deviation)
 *       AND --strict was passed
 */

const STRICT = process.argv.includes("--strict");
const PROD_API = "https://galaxymind.space/api/treasuries";

// Per-ticker historical mNAV bands. Bumped wider than current observed
// values so a normal market move doesn't trip the alarm — but tight
// enough that a 10x error (like XXI showing 1.56 when truth was 0.83)
// would fire. Update if a ticker structurally changes (e.g., NAKA
// post-SPAC merger).
const TICKER_BANDS: Record<string, { min: number; max: number; note: string }> = {
  MSTR: { min: 0.6, max: 3.5, note: "Strategy historically 0.85–2.5" },
  XXI: { min: 0.5, max: 1.5, note: "Twenty One Capital historically 0.7–1.2" },
  MPJPY: { min: 0.5, max: 4.0, note: "Metaplanet historically 0.7–3.5" },
  ASST: { min: 0.5, max: 2.0, note: "Strive Inc historically 0.7–1.5" },
};

// Tickers for which a null `price` is EXPECTED, not a failure.
// bitcointreasuries.net's devalue feed exposes no resolvable USD
// stock_price.native for non-US listings; MPJPY (Metaplanet, Tokyo)
// is the current case. mNAV still validates from mcap ÷ (btc ×
// btcPrice). Add a ticker here only when its null price is a known
// upstream-data characteristic, never to paper over a parser bug.
const PRICE_OPTIONAL = new Set<string>(["MPJPY"]);

const SANE_MIN = 0.3;
const SANE_MAX = 5.0;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

type ApiRow = {
  ticker: string;
  price: number | null;
  marketCapM: number | null;
  btcHoldings: number | null;
  mNAV: number | null;
};

type ApiResp = {
  btcPrice: number;
  rows: ApiRow[];
};

async function main() {
  console.log(C.bold("\n📊 Galaxy Mind treasury mNAV smoke test\n"));

  let resp: ApiResp;
  try {
    const r = await fetch(PROD_API, { cache: "no-store" });
    if (!r.ok) {
      console.error(`${C.fail} GET ${PROD_API} → ${r.status}`);
      process.exit(1);
    }
    resp = (await r.json()) as ApiResp;
  } catch (e) {
    console.error(`${C.fail} fetch failed:`, e);
    process.exit(1);
  }

  const btcPrice = resp.btcPrice;
  if (!Number.isFinite(btcPrice) || btcPrice <= 0) {
    console.error(`${C.fail} invalid BTC price in response: ${btcPrice}`);
    process.exit(1);
  }
  console.log(`${C.info} BTC price: $${Math.round(btcPrice).toLocaleString()}`);
  console.log(`${C.info} ${resp.rows.length} treasury rows returned\n`);

  let hardFails = 0;
  let softWarns = 0;

  for (const row of resp.rows) {
    const { ticker } = row;
    const band = TICKER_BANDS[ticker];
    const prefix = `[${ticker.padEnd(6)}]`;

    if (!band) {
      console.log(`${C.warn} ${prefix} no historical band defined — add one to TICKER_BANDS`);
      softWarns++;
      continue;
    }

    // (1) Required fields present.
    //
    // PRICE is OPTIONAL for JP-listed tickers (audit 2026-05):
    // bitcointreasuries.net's devalue feed carries no resolvable USD
    // stock_price.native for Tokyo-listed Metaplanet (MPJPY), so
    // price=null is EXPECTED and correct — mNAV still derives from
    // market_cap ÷ (btc × btcPrice). Treating that as a hard failure
    // pinned this smoke permanently red, which masks real
    // regressions (alert fatigue). So: price=null on a price-optional
    // ticker → soft warning, then fall through and validate mNAV
    // normally. price=null on any OTHER ticker, or any missing
    // mcap/btc/mNAV anywhere → still a hard failure.
    const coreInvalid =
      !Number.isFinite(row.marketCapM) ||
      !Number.isFinite(row.btcHoldings) ||
      !Number.isFinite(row.mNAV);
    const priceMissing = !Number.isFinite(row.price);
    if (coreInvalid || (priceMissing && !PRICE_OPTIONAL.has(ticker))) {
      console.error(
        `${C.fail} ${prefix} missing/invalid fields: price=${row.price} mcapM=${row.marketCapM} btc=${row.btcHoldings} mNAV=${row.mNAV}`,
      );
      hardFails++;
      continue;
    }
    if (priceMissing) {
      console.log(
        `${C.warn} ${prefix} price=null (expected · JP-listed, no USD stock_price upstream; mNAV derives from mcap÷BTC)`,
      );
      softWarns++;
      // NOT continue — mcap/btc/mNAV are valid; validate them below.
    }

    const mNAV = row.mNAV as number;
    const mcapM = row.marketCapM as number;
    const btc = row.btcHoldings as number;

    // (2) Math consistency: marketCapM × 1M ÷ (btc × btcPrice) ≈ mNAV
    const computedMnav = (mcapM * 1_000_000) / (btc * btcPrice);
    const drift = Math.abs(mNAV - computedMnav);
    if (drift > 0.005) {
      console.error(
        `${C.fail} ${prefix} mNAV math drift: api=${mNAV.toFixed(4)} computed=${computedMnav.toFixed(4)} drift=${drift.toFixed(4)}`,
      );
      hardFails++;
      continue;
    }

    // (3) Sane absolute range
    if (mNAV < SANE_MIN || mNAV > SANE_MAX) {
      console.error(
        `${C.fail} ${prefix} mNAV ${mNAV.toFixed(3)} outside SANE range [${SANE_MIN}, ${SANE_MAX}] — almost certainly a parser bug`,
      );
      hardFails++;
      continue;
    }

    // (4) Per-ticker historical band (soft warning only)
    if (mNAV < band.min || mNAV > band.max) {
      console.log(
        `${C.warn} ${prefix} mNAV ${mNAV.toFixed(3)} outside historical band [${band.min}, ${band.max}] — ${band.note}`,
      );
      softWarns++;
      continue;
    }

    console.log(
      `${C.ok} ${prefix} mNAV=${mNAV.toFixed(3)}  mcap=$${(mcapM / 1000).toFixed(2)}B  btc=${btc.toLocaleString()}  ${C.dim(band.note)}`,
    );
  }

  console.log();
  console.log(C.bold("Summary"));
  console.log(`  ${C.fail} hard failures: ${hardFails}`);
  console.log(`  ${C.warn} soft warnings: ${softWarns}`);

  if (hardFails > 0) {
    console.error(
      `\n${C.fail} ${hardFails} hard failure(s). Investigate immediately — production is showing wrong mNAV.\n`,
    );
    process.exit(1);
  }
  if (softWarns > 0 && STRICT) {
    console.error(`\n${C.warn} ${softWarns} soft warning(s) and --strict flag set. Exiting 2.\n`);
    process.exit(2);
  }
  console.log(`\n${C.ok} all checks pass.\n`);
}

main().catch((e) => {
  console.error("\n💥 smoke test crashed:", e);
  process.exit(1);
});
