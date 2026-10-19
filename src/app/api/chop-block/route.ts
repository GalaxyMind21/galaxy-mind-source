// GET /api/chop-block · the chop cabinet's live-world feed.
//
// One upstream call (mempool.space latest-15-blocks, ~30KB) projected
// to a tiny payload: the tip block's REAL aggregates (height, hash,
// miner pool, tx count, fee percentiles, reward) + a short tail of
// ancestors for stage-clear context. The game synthesizes its
// sliceable tx swarm CLIENT-SIDE from these real aggregates, seeded by
// the block hash — every object represents the block's real fee
// distribution without needing thousands of per-tx fetches.
//
// Same posture as /api/heartbeat: CDN-cached (short s-maxage + SWR),
// CORS-open, zero KV. The game's static CSP stays connect-src 'self' —
// the cabinet never talks to mempool.space directly.

import { NextResponse } from "next/server";
import { upstreamFetchJson } from "@/lib/upstream";

export const runtime = "nodejs";
export const revalidate = 20;

type MempoolBlock = {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  difficulty?: number;
  extras?: {
    pool?: { name?: string };
    medianFee?: number;
    feeRange?: number[];
    reward?: number;
    totalFees?: number;
    avgTxSize?: number;
    // THE MEANING FIELDS. All of these already ride the SAME upstream
    // response we were already paying for — they were simply not being
    // projected, so the clear card had nothing true to say beyond the
    // pool name and the tx count. Adding them costs zero extra requests.
    totalOutputAmt?: number;
    totalInputs?: number;
    totalOutputs?: number;
    utxoSetChange?: number;
    avgFee?: number;
    avgFeeRate?: number;
    coinbaseSignatureAscii?: string;
    segwitTotalTxs?: number;
    matchRate?: number;
  };
};

/**
 * Miners stuff arbitrary bytes into the coinbase input, and mempool.space
 * hands the whole thing over as latin-1-ish text — mostly binary (height
 * push, extranonce, merkle junk) with a human tag somewhere inside it.
 * A raw render is mojibake, so pull the printable RUNS and keep the
 * longest plausible one ("/F2Pool/", "/Foundry USA Pool #dropgold/").
 *
 * Returns null rather than a shrug when nothing readable is in there —
 * the clear card must be able to fall through to a different fact
 * instead of printing an empty quote.
 */
function coinbaseTag(ascii: string | undefined): string | null {
  if (!ascii) return null;
  const runs = ascii.match(/[\x20-\x7E]{4,}/g);
  if (!runs) return null;
  // Prefer a run that looks like a signature (slashes/words) over a
  // random printable stretch of an extranonce.
  const scored = runs
    .map((r) => r.trim())
    .filter((r) => r.length >= 4 && /[A-Za-z]{3,}/.test(r))
    .sort((a, b) => b.length - a.length);
  if (!scored.length) return null;
  const tag = scored[0].slice(0, 48);
  // A tag that is all punctuation-and-one-word is noise, not graffiti.
  return /[A-Za-z]{3,}/.test(tag) ? tag : null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=15, s-maxage=20, stale-while-revalidate=120",
};

export async function GET() {
  try {
    return await buildBlockResponse();
  } catch (e) {
    // Same honest shape the null branch below already returns · the
    // CHOP client falls back to an offline world and SAYS so. A 500
    // is the one response it has no handler for.
    console.error("[api/chop-block] unexpected failure", e);
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS });
  }
}

async function buildBlockResponse() {
  const res = await upstreamFetchJson<MempoolBlock[]>(
    "https://mempool.space/api/v1/blocks",
    { revalidate: 20, label: "chop-blocks", retry: true },
  );
  const blocks = res.ok ? res.data : null;
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    // Honest degraded shape · the client falls back to an offline world
    // and says so, it never fakes a live block.
    return NextResponse.json(
      { ok: false },
      { status: 200, headers: CORS },
    );
  }
  const project = (b: MempoolBlock) => ({
    height: b.height,
    hash: b.id,
    time: b.timestamp,
    txs: b.tx_count,
    sizeMB: Math.round((b.size / 1e6) * 100) / 100,
    pool: b.extras?.pool?.name ?? "UNKNOWN",
    medianFee: b.extras?.medianFee ?? null,
    feeRange: b.extras?.feeRange ?? null,
    rewardSats: b.extras?.reward ?? null,
    feesSats: b.extras?.totalFees ?? null,
    avgTxSize: b.extras?.avgTxSize ?? null,
    // ── meaning layer · all free, same upstream response ──────────────
    // The clear card picks ONE gated fact from these. They are projected
    // even when boring because the gating (is this block unusual?) is a
    // client-side decision that needs the number to make the comparison.
    weight: b.weight ?? null,          // /4e6 = how full the block was
    valueSats: b.extras?.totalOutputAmt ?? null,  // total value moved
    inputs: b.extras?.totalInputs ?? null,
    outputs: b.extras?.totalOutputs ?? null,
    utxoDelta: b.extras?.utxoSetChange ?? null,
    avgFeeSats: b.extras?.avgFee ?? null,
    segwitTxs: b.extras?.segwitTotalTxs ?? null,
    matchRate: b.extras?.matchRate ?? null,
    difficulty: b.difficulty ?? null,
    coinbaseTag: coinbaseTag(b.extras?.coinbaseSignatureAscii),
  });
  return NextResponse.json(
    { ok: true, tip: project(blocks[0]), tail: blocks.slice(1, 7).map(project) },
    { headers: CORS },
  );
}
