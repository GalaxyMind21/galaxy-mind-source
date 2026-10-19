/**
 * Invariants for CHOP's post-round block facts (public/chop/js/blockfacts.js).
 *
 * WHAT IS ACTUALLY AT RISK HERE
 *   The facts are all TRUE by construction — they are arithmetic over
 *   fields mempool.space hands us. What can rot is the GATING, and the
 *   gating is the entire design. Every fact in that module is boring in
 *   its common case: blocks are ~99% full essentially always, most
 *   intervals sit in a dull 6-14 minute band, and the fee spread is
 *   usually flat. A gate that silently stops gating turns the clear card
 *   back into a stat dump that says the same thing every run, which is
 *   exactly the "true but meaningless" state this feature existed to fix.
 *
 *   So these tests mostly assert what must NOT appear on an ordinary
 *   block. A green run means the rare facts are still rare.
 */
import { pickBlockFacts, blockFactCandidates, usd, btc, cleanTag } from "../public/chop/js/blockfacts.js";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; return; }
  fails.push(`${name}${detail ? " — " + detail : ""}`);
}
const kinds = (tip: unknown, tail: unknown, opts?: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockFactCandidates(tip as any, tail as any, opts as any).map((c: { kind: string }) => c.kind);

// A wholly unremarkable block: full, average interval, flat fees, big
// pool, no graffiti, mid-epoch. This is the overwhelmingly common case.
const DULL = {
  height: 900_000,               // 900000 % 2016 = 1440 · mid-epoch
  pool: "Foundry USA",
  time: 1_760_000_600,
  txs: 3400,
  weight: 3_997_000,             // 99.9% full
  valueSats: 500_000_000_000,
  rewardSats: 314_000_000,
  feesSats: 1_900_000,
  feeRange: [1.02, 1.1, 1.3, 1.6, 2.0],  // hi/lo = 1.96 · not an auction
  inputs: 7700, outputs: 8000, utxoDelta: 300,
  coinbaseTag: null,
};
const DULL_TAIL = [
  { pool: "AntPool", time: 1_760_000_000, txs: 3300 },  // 600s gap
  { pool: "F2Pool", time: 1_759_999_400, txs: 3350 },
  { pool: "MARA", time: 1_759_998_800, txs: 3380 },
  { pool: "ViaBTC", time: 1_759_998_200, txs: 3390 },
];

{
  const k = kinds(DULL, DULL_TAIL);
  // The event facts must ALL stay silent on a dull block. If any of these
  // start firing here, that fact has become wallpaper.
  for (const gated of ["interval", "fullness", "sparse", "auction", "utxo", "retarget", "graffiti"]) {
    ok(`dull block gates out "${gated}"`, !k.includes(gated), `got ${JSON.stringify(k)}`);
  }
  // ...but the card must never be empty. Scale facts are the floor.
  ok("dull block still yields a fact", k.length > 0);
  const { primary } = pickBlockFacts(DULL, DULL_TAIL, { seed: 1 });
  ok("dull block primary is a scale fact",
    !!primary && ["value", "reward", "count"].includes(primary.kind),
    primary ? primary.kind : "none");
}

// ── each gate opens on the condition it claims to detect ──────────────
{
  const fast = { ...DULL, time: DULL_TAIL[0].time + 90 };
  ok("90s interval opens the interval gate", kinds(fast, DULL_TAIL).includes("interval"));
  const slow = { ...DULL, time: DULL_TAIL[0].time + 2400 };
  ok("40min interval opens the interval gate", kinds(slow, DULL_TAIL).includes("interval"));
  const mid = { ...DULL, time: DULL_TAIL[0].time + 600 };
  ok("10min interval stays shut", !kinds(mid, DULL_TAIL).includes("interval"));
}
{
  const roomy = { ...DULL, weight: 2_000_000 };  // 50% full
  ok("half-empty block opens the fullness gate", kinds(roomy, DULL_TAIL).includes("fullness"));
  ok("99.9% full block does not", !kinds(DULL, DULL_TAIL).includes("fullness"));
}
{
  const wild = { ...DULL, feeRange: [1.0, 4, 20, 90, 240] }; // 240x spread
  ok("wide fee spread opens the auction gate", kinds(wild, DULL_TAIL).includes("auction"));
}
{
  const quiet = { ...DULL, txs: 600 };   // vs tail median ~3380
  ok("sparse block opens the sparse gate", kinds(quiet, DULL_TAIL).includes("sparse"));
}
{
  const nearRetarget = { ...DULL, height: 2016 * 500 - 12 };
  ok("12 blocks from retarget opens the gate", kinds(nearRetarget, DULL_TAIL).includes("retarget"));
  const justAfter = { ...DULL, height: 2016 * 500 + 1 };
  ok("just after retarget opens the gate", kinds(justAfter, DULL_TAIL).includes("retarget"));
}
{
  // GRAFFITI IS ABOUT EXPRESSION, NOT PRESENCE.
  // Every pool signs every block, so "there is a printable tag" fired on
  // 8 of 8 live blocks and won the headline every time — the wallpaper
  // failure again. Only a tag saying something BEYOND the pool's own name
  // counts. These cases are taken verbatim from real coinbase inputs.
  const expressive = [
    ["Foundry USA", "/Foundry USA Pool #dropgold/"],   // "#dropgold" is extra
    ["MARA Pool", "dkj| MARA Made in USA"],            // "Made in USA" is extra
  ];
  for (const [pool, tag] of expressive) {
    ok(`expressive tag opens the gate: ${tag}`,
      kinds({ ...DULL, pool, coinbaseTag: tag }, DULL_TAIL).includes("graffiti"));
  }
  const branding = [
    ["F2Pool", "/F2Pool/d"],
    ["AntPool", "Mined by AntPool"],
    ["OCEAN", "< OCEAN.XYZ >"],
    ["SpiderPool", "ZkjSpiderPool/248/"],
  ];
  for (const [pool, tag] of branding) {
    ok(`pure branding stays shut: ${tag}`,
      !kinds({ ...DULL, pool, coinbaseTag: tag }, DULL_TAIL).includes("graffiti"),
      JSON.stringify(kinds({ ...DULL, pool, coinbaseTag: tag }, DULL_TAIL)));
  }
  // And the displayed tag must not carry extranonce crumbs.
  ok("tag display strips leading crumbs",
    cleanTag("dkj| MARA Made in USA", "MARA Pool") === "MARA Made in USA",
    String(cleanTag("dkj| MARA Made in USA", "MARA Pool")));
  ok("tag display strips trailing crumbs",
    cleanTag("V/Foundry USA Pool #dropgold/b", "Foundry USA") === "Foundry USA Pool #dropgold",
    String(cleanTag("V/Foundry USA Pool #dropgold/b", "Foundry USA")));
}
{
  // BLOCK TIMESTAMPS ARE MINER-SET AND NOT MONOTONIC. A sub-minute gap is
  // clock skew, not a fast block; live block 960265 reported a 1-second
  // interval. Printing that as drama is a confident false claim.
  const skew = { ...DULL, time: DULL_TAIL[0].time + 1 };
  ok("a 1-second gap is skew, not an event",
    !kinds(skew, DULL_TAIL).includes("interval"));
  const backwards = { ...DULL, time: DULL_TAIL[0].time - 30 };
  ok("a negative gap never claims anything",
    !kinds(backwards, DULL_TAIL).includes("interval"));
  const genuinelyFast = { ...DULL, time: DULL_TAIL[0].time + 95 };
  ok("95 seconds is a real fast block", kinds(genuinelyFast, DULL_TAIL).includes("interval"));
}
{
  // A pool merely being absent from the short tail is the COMMON case —
  // dozens of pools, six ancestors — so it must never read as an event.
  // This assertion is the one that caught the original drought fact
  // firing on the deliberately dull block above.
  const absent = { ...DULL, pool: "SpiderPool" };
  ok("pool absent from the tail is NOT an event",
    !kinds(absent, DULL_TAIL).includes("pool"), JSON.stringify(kinds(absent, DULL_TAIL)));
  // Two in a row is also unremarkable for a large pool.
  const b2b = { ...DULL, pool: "AntPool" };  // AntPool is tail[0] only
  ok("two in a row is not yet a streak", !kinds(b2b, DULL_TAIL).includes("pool"));
  // Three in a row is genuinely uncommon and fully visible in the tail.
  const streak = {
    ...DULL, pool: "AntPool",
  };
  const streakTail = [
    { pool: "AntPool", time: 1_760_000_000, txs: 3300 },
    { pool: "AntPool", time: 1_759_999_400, txs: 3350 },
    { pool: "F2Pool", time: 1_759_998_800, txs: 3380 },
    { pool: "ViaBTC", time: 1_759_998_200, txs: 3390 },
  ];
  ok("three in a row IS a streak", kinds(streak, streakTail).includes("pool"));
}

// ── never invent a number we do not have ──────────────────────────────
{
  const bare = { height: 900_000, pool: "Foundry USA", txs: 2000 };
  const k = kinds(bare, []);
  ok("missing fields never fabricate a value fact", !k.includes("value"));
  ok("missing fields never fabricate a reward fact", !k.includes("reward"));
  ok("a bare block still closes the loop", k.includes("count"));
  ok("empty tip yields nothing, does not throw",
    blockFactCandidates(null as never, [], {}).length === 0);
  ok("undefined tail does not throw",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blockFactCandidates(DULL as any, undefined as any, {}).length > 0);
}

// ── price is optional, and its absence changes denomination not truth ──
{
  const withP = pickBlockFacts(DULL, DULL_TAIL, { btcPrice: 110_000, seed: 3 });
  const noP = pickBlockFacts(DULL, DULL_TAIL, { seed: 3 });
  ok("with a price the value fact reads in dollars",
    !!withP.primary && /\$/.test(withP.primary.text), withP.primary?.text);
  ok("without a price it reads in BTC, never a guessed rate",
    !!noP.primary && !/\$/.test(noP.primary.text), noP.primary?.text);
}

// ── composition ───────────────────────────────────────────────────────
{
  const rich = {
    ...DULL,
    time: DULL_TAIL[0].time + 60,        // interval fires
    weight: 1_800_000,                    // fullness fires
    coinbaseTag: "/MARA Made in USA/",   // graffiti fires
    feeRange: [1, 10, 60, 180, 400],     // auction fires
  };
  const { primary, secondary } = pickBlockFacts(rich, DULL_TAIL, { seed: 5 });
  ok("a loud block still shows exactly one primary", !!primary);
  ok("secondary is a different kind from primary",
    !secondary || secondary.kind !== primary!.kind);
  ok("secondary is never the filler count line",
    !secondary || secondary.kind !== "count");
  ok("primary outranks secondary",
    !secondary || secondary.weight <= primary!.weight);
  // Determinism: the same block must always read the same way, or a
  // player who re-reads their share card sees a different 'fact'.
  const again = pickBlockFacts(rich, DULL_TAIL, { seed: 5 });
  ok("fact selection is deterministic for a block",
    again.primary?.text === primary?.text);
}

// ── prose never leaks a formatter miss (review r2, P1-3) ─────────────
{
  // btc(0) returns null BY DESIGN; the reward template interpolated it
  // straight into prose: "3.15 BTC for this block: null new, null in
  // fees." feesSats is null whenever upstream omits totalFees, so this
  // was a live path, not a hypothetical. Sweep degenerate tips and ban
  // the leak words from every candidate of every shape.
  const degenerates = [
    { ...DULL, feesSats: null },
    { ...DULL, feesSats: 0 },
    { ...DULL, feesSats: NaN },
    { ...DULL, feesSats: DULL.rewardSats + 1 },   // fees > reward → subsidy clamps to 0
    { ...DULL, valueSats: null, feesSats: null, rewardSats: null },
    { ...DULL, pool: null, coinbaseTag: null },
    { height: 900_000, txs: 2000 },               // nearly-bare tip
  ];
  for (const tip of degenerates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cands = blockFactCandidates(tip as any, DULL_TAIL, { btcPrice: 110_000 });
    for (const c of cands) {
      ok(`no leak words in "${c.kind}" for degenerate tip`,
        !/\b(null|NaN|undefined)\b/.test(c.text), c.text);
    }
  }
  // and the fees-null reward line specifically drops its breakdown clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noFees = blockFactCandidates({ ...DULL, feesSats: null } as any, DULL_TAIL, {})
    .find((c) => c.kind === "reward");
  ok("reward without fees omits the breakdown, keeps the earnings",
    !!noFees && /earned/.test(noFees.text) && !/new,/.test(noFees.text), noFees?.text);
}

// ── formatters ────────────────────────────────────────────────────────
{
  ok("usd compacts billions", usd(1.24e9) === "$1.2B", String(usd(1.24e9)));
  ok("usd compacts millions", usd(7.4e8) === "$740M", String(usd(7.4e8)));
  ok("usd rejects nonsense", usd(0) === null && usd(NaN) === null);
  ok("btc formats large amounts without decimals", btc(669_944_476_792) === "6,699 BTC",
    String(btc(669_944_476_792)));
  ok("btc keeps precision on small amounts", btc(1_920_877) === "0.0192 BTC",
    String(btc(1_920_877)));
}

if (fails.length) {
  console.error(`\n✗ chop block facts: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`✓ chop block facts · ${pass} invariants (gates, honesty, composition)`);
