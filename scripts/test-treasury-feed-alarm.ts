/**
 * TREASURY FEED ALARM · the check that did not exist while the feed was
 * dead for a month.
 *
 * The parser break found on 2026-09-10 (SvelteKit moved the entity rows
 * from `nodes[1]` to `nodes[2]`, so every guard downstream matched zero
 * rows) went unnoticed because `snapshot-treasuries` reported `ok: true`
 * through all of it. The per-ticker refusal existed and worked — no
 * phantom rows were written — but `refusedAllNull` fed neither `ok` nor
 * the HTTP status, so "every ticker came back null" and "a normal day"
 * were indistinguishable from outside.
 *
 * This pins the distinction, and the wiring that turns it into a 503.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTreasuryFeedDown, isTreasuryBoardEmpty } from "../src/lib/treasuries";
import {
  PER_ENTITY_BTC_SANITY_CEILING,
  PUBLIC_COMPANY_BTC_TICKERS,
  sumBtcByType,
} from "../src/lib/market";

let failures = 0;
const check = (label: string, cond: boolean) => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};

console.log("\ntreasury feed alarm\n");

// ── the predicate ───────────────────────────────────────────────────
check(
  "every tracked ticker null · the feed is down",
  isTreasuryFeedDown({ tracked: 4, refused: 4 }) === true,
);
check(
  "one ticker null of four · an ordinary per-name outage, stays quiet",
  isTreasuryFeedDown({ tracked: 4, refused: 1 }) === false,
);
check(
  "three of four null · still not the whole feed",
  isTreasuryFeedDown({ tracked: 4, refused: 3 }) === false,
);
check(
  "nothing refused · quiet",
  isTreasuryFeedDown({ tracked: 4, refused: 0 }) === false,
);
// A same-day re-run puts every ticker in `skipped`, never in
// `refusedAllNull`, so refused is 0 and this must not fire. The empty
// roster case is the same shape: nothing tracked is not a failure, and an
// alarm that fires on it would be muted before it ever caught anything.
check(
  "empty roster · quiet, not a division-by-zero alarm",
  isTreasuryFeedDown({ tracked: 0, refused: 0 }) === false,
);

check(
  "live board empty when every mNAV is null",
  isTreasuryBoardEmpty([
    { mNAV: null },
    { mNAV: null },
    { mNAV: null },
    { mNAV: null },
  ]) === true,
);
check(
  "live board not empty when one ticker reports",
  isTreasuryBoardEmpty([{ mNAV: null }, { mNAV: 1.1 }]) === false,
);
check(
  "live board empty roster is quiet",
  isTreasuryBoardEmpty([]) === false,
);
check(
  "per-ticker sanity ceiling is 1.5M BTC",
  PER_ENTITY_BTC_SANITY_CEILING === 1_500_000,
);

// ── the wiring ──────────────────────────────────────────────────────
// The predicate is worthless if the route does not escalate on it. These
// are source assertions because the route itself needs live upstreams and
// KV, neither of which verify has.
{
  const src = readFileSync(
    join(process.cwd(), "src/app/api/cron/snapshot-treasuries/route.ts"),
    "utf8",
  );
  check(
    "route consults the predicate",
    src.includes("isTreasuryFeedDown({"),
  );
  check(
    "a dead feed returns 503, not 200",
    src.includes("allRefused ? 503 : 200"),
  );
  check(
    "a dead feed is not reported as ok",
    src.includes("ok: failed.length === 0 && !allRefused"),
  );
  check(
    "a dead feed logs loudly enough to find in the runtime errors",
    src.includes("EVERY TICKER NULL"),
  );
}
{
  const market = readFileSync(
    join(process.cwd(), "src/lib/market.ts"),
    "utf8",
  );
  check(
    "per-ticker holdings walk uses the sanity ceiling",
    market.includes("btcBal > PER_ENTITY_BTC_SANITY_CEILING"),
  );
  check(
    "fetchTreasuries uses the shared btcBalanceOf reader",
    market.includes("const btcBal = btcBalanceOf(arr, o)"),
  );
  check(
    "public-company float sum is allowlisted, not the whole PUBLIC_COMPANY type",
    market.includes("PUBLIC_COMPANY_BTC_TICKER_SET"),
  );
}

{
  for (const t of ["MSTR", "MARA", "MPJPY", "XXI", "ASST"] as const) {
    check(
      `allowlist includes ${t}`,
      (PUBLIC_COMPANY_BTC_TICKERS as readonly string[]).includes(t),
    );
  }
}

{
  const fixture = [
    {
      type: "PUBLIC_COMPANY",
      ticker: { symbol: "MSTR" },
      holdings: [{ asset: "BTC", balance: 845_000 }],
    },
    {
      type: "PUBLIC_COMPANY",
      ticker: { symbol: "HAMA" },
      holdings: [{ asset: "BTC", balance: 63_730_000_000 }],
    },
    {
      type: "PUBLIC_COMPANY",
      ticker: { symbol: "ATAI" },
      holdings: [{ asset: "BTC", balance: 771_640 }],
    },
    {
      type: "PUBLIC_COMPANY",
      ticker: { symbol: "MARA" },
      holdings: [{ asset: "BTC", balance: 35_000 }],
    },
    {
      type: "FUND",
      ticker: { symbol: "IBIT" },
      holdings: [{ asset: "BTC", balance: 771_640 }],
    },
    {
      type: "FUND",
      ticker: { symbol: "BTCW" },
      holdings: [{ asset: "BTC", balance: 63_140_503_552 }],
    },
  ];
  const allow = new Set(["MSTR", "MARA"]);
  check(
    "allowlist sums named holders and ignores off-list poison",
    sumBtcByType(fixture, "PUBLIC_COMPANY", allow) === 880_000,
  );
  check(
    "allowlist ignores a sane-looking off-list duplicate (ATAI copying IBIT)",
    sumBtcByType(fixture, "PUBLIC_COMPANY", allow) !== 880_000 + 771_640,
  );
  {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let withheld: number | null = null;
    try {
      withheld = sumBtcByType(fixture, "FUND");
    } finally {
      console.error = orig;
    }
    check(
      "unfiltered FUND still withholds the whole type when one row is impossible",
      withheld === null,
    );
    check(
      "the withhold log names the impossible row",
      lines.some((l) => l.includes("BTCW") && l.includes("63140503552")),
    );
  }
  check(
    "Osprey Bitcoin Trust over the ceiling is skipped and the other funds publish",
    sumBtcByType(
      [
        {
          type: "FUND",
          ticker: { symbol: "IBIT" },
          holdings: [{ asset: "BTC", balance: 771_640 }],
        },
        {
          type: "FUND",
          name: "Osprey Bitcoin Trust",
          ticker: { symbol: "OBTC" },
          holdings: [{ asset: "BTC", balance: 715_081_479 }],
        },
      ],
      "FUND",
    ) === 771_640,
  );
  check(
    "Monochrome Bitcoin ETF over the ceiling is skipped and the other funds publish",
    sumBtcByType(
      [
        {
          type: "FUND",
          ticker: { symbol: "IBIT" },
          holdings: [{ asset: "BTC", balance: 771_640 }],
        },
        {
          type: "FUND",
          name: "Monochrome Bitcoin ETF",
          ticker: { symbol: "IBTC.XA" },
          holdings: [{ asset: "BTC", balance: 342_363_070 }],
        },
      ],
      "FUND",
    ) === 771_640,
  );
  check(
    "a known-impossible fund is skipped and the other funds still publish",
    sumBtcByType(
      [
        {
          type: "FUND",
          ticker: { symbol: "IBIT" },
          holdings: [{ asset: "BTC", balance: 771_640 }],
        },
        {
          type: "FUND",
          name: "Incrementum Digital & Physical Gold Fund",
          ticker: { symbol: "0P0001DZL0" },
          holdings: [{ asset: "BTC", balance: 5_596_000_000 }],
        },
      ],
      "FUND",
    ) === 771_640,
  );
  check(
    "a known-impossible government row is skipped and the others publish",
    sumBtcByType(
      [
        {
          type: "GOVERNMENT",
          name: "United States",
          holdings: [{ asset: "BTC", balance: 328_372 }],
        },
        {
          type: "GOVERNMENT",
          name: "United Arab Emirates",
          holdings: [{ asset: "BTC", balance: 11_011_197 }],
        },
      ],
      "GOVERNMENT",
    ) === 328_372,
  );
  check(
    "the same government under the ceiling counts again",
    sumBtcByType(
      [
        {
          type: "GOVERNMENT",
          name: "United States",
          holdings: [{ asset: "BTC", balance: 328_372 }],
        },
        {
          type: "GOVERNMENT",
          name: "United Arab Emirates",
          holdings: [{ asset: "BTC", balance: 1_000 }],
        },
      ],
      "GOVERNMENT",
    ) === 329_372,
  );
  check(
    "an unfamiliar impossible row still withholds, even beside a known one",
    sumBtcByType(
      [
        {
          type: "FUND",
          ticker: { symbol: "IBIT" },
          holdings: [{ asset: "BTC", balance: 771_640 }],
        },
        {
          type: "FUND",
          name: "Incrementum Digital & Physical Gold Fund",
          holdings: [{ asset: "BTC", balance: 5_596_000_000 }],
        },
        {
          type: "FUND",
          name: "WisdomTree Bitcoin Fund",
          holdings: [{ asset: "BTC", balance: 63_140_503_552 }],
        },
      ],
      "FUND",
    ) === null,
  );
  check(
    "unfiltered FUND without poison publishes",
    sumBtcByType(
      [
        {
          type: "FUND",
          ticker: { symbol: "IBIT" },
          holdings: [{ asset: "BTC", balance: 771_640 }],
        },
      ],
      "FUND",
    ) === 771_640,
  );
  check(
    "allowlisted name over the ceiling is skipped, the rest still publish",
    sumBtcByType(
      [
        {
          type: "PUBLIC_COMPANY",
          ticker: { symbol: "MSTR" },
          holdings: [{ asset: "BTC", balance: PER_ENTITY_BTC_SANITY_CEILING + 1 }],
        },
        {
          type: "PUBLIC_COMPANY",
          ticker: { symbol: "MARA" },
          holdings: [{ asset: "BTC", balance: 35_000 }],
        },
      ],
      "PUBLIC_COMPANY",
      allow,
    ) === 35_000,
  );
}

{
  const status = readFileSync(
    join(process.cwd(), "src/app/api/status/route.ts"),
    "utf8",
  );
  check(
    "/api/status ORs the empty treasury board into degraded",
    status.includes("isTreasuryBoardEmpty(snapshot.treasuries)"),
  );
  const treasuriesApi = readFileSync(
    join(process.cwd(), "src/app/api/treasuries/route.ts"),
    "utf8",
  );
  check(
    "/api/treasuries ORs the empty treasury board into degraded",
    treasuriesApi.includes("isTreasuryBoardEmpty(snapshot.treasuries)"),
  );
  const mcp = readFileSync(
    join(process.cwd(), "src/app/api/mcp/[transport]/route.ts"),
    "utf8",
  );
  check(
    "MCP get_treasuries ORs the empty treasury board into degraded",
    mcp.includes("isTreasuryBoardEmpty(snapshot.treasuries)"),
  );
  const marketApi = readFileSync(
    join(process.cwd(), "src/app/api/market/route.ts"),
    "utf8",
  );
  check(
    "/api/market degraded stays the 4/8 gauge (does not fold the treasury board)",
    !marketApi.includes("isTreasuryBoardEmpty"),
  );
}

console.log(
  `\n${failures === 0 ? "✓" : "✗"} ${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
