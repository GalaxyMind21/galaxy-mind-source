// CHOP · blockfacts.js — what was actually true about the block you just sealed.
//
// WHY THIS EXISTS
//   The clear card used to say one thing: "{POOL} mined all {n} of them."
//   True, but the same sentence every run, so by the third block it is
//   chrome rather than meaning. The operator's note was exact: the bitcoin
//   connection is real but a player experiences it as generic cube-slicing
//   with flavour text.
//
// THE DESIGN RULE THAT MAKES THIS WORK: GATES, NOT A DASHBOARD.
//   Every fact here is boring in its common case. "This block was 99% full"
//   is true of nearly every block ever mined, so printing it every run
//   teaches nothing — it is noise wearing a number's clothes. Each candidate
//   therefore carries a gate describing when it is UNUSUAL, and only gated-in
//   candidates compete. A block with nothing unusual falls through to the
//   scale facts, which are always legitimately interesting because the
//   quantities are enormous.
//
//   Consequence worth stating plainly: on a quiet chain most runs will show
//   "value moved" or "fees earned". That is correct behaviour. The rare
//   facts are rare BECAUSE they are gated, and that rarity is what makes
//   the whale/drought/graffiti cards feel like an event instead of a stat.
//
// EVERY FIELD IS FREE.
//   All of these ride the SAME mempool.space response /api/chop-block was
//   already paying for; they were simply never projected. No new upstream
//   call, no per-tx scan. Facts that WOULD need a per-transaction walk
//   (biggest single fee, whale transfer, OP_RETURN messages) are the
//   highest-screenshot ideas in the research and are deliberately NOT here:
//   they need a cached server-side per-height scan, which is a separate
//   decision with a real cost (design note kept in private docs).
//
// PURE MODULE. No DOM, no THREE, no fetch — so scripts/test-chop-facts.ts
// can drive it with synthetic blocks and assert the gates actually gate.

const SATS = 1e8;
const WEIGHT_LIMIT = 4e6;   // consensus block weight limit
const RETARGET = 2016;      // difficulty retarget interval, in blocks

/** Compact money so a 12-digit number reads at a glance. */
export function usd(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}

/** BTC with a sane number of decimals for the magnitude. */
export function btc(sats) {
  if (!Number.isFinite(sats) || sats <= 0) return null;
  const v = sats / SATS;
  if (v >= 1000) return Math.round(v).toLocaleString("en-US") + " BTC";
  if (v >= 1) return v.toFixed(2) + " BTC";
  return v.toFixed(4) + " BTC";
}

function mins(secs) {
  const m = Math.round(secs / 60);
  return m + (m === 1 ? " minute" : " minutes");
}

/**
 * Trim the extranonce crumbs off a coinbase tag.
 *
 * The route keeps the longest printable run out of the coinbase input, but
 * that run bleeds into whatever adjacent binary happened to be printable —
 * live samples came back as "/F2Pool/d", "ZkjSpiderPool/248/" and
 * "V/Foundry USA Pool #dropgold/b". If the run contains a /.../ delimited
 * section (the near-universal miner convention) prefer that; otherwise
 * shave leading/trailing junk down to the first and last real word.
 */
export function cleanTag(raw, pool) {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, " ").trim();
  const slashed = s.match(/\/[^/]{3,40}\//);
  if (slashed) s = slashed[0];
  // If the pool's own name appears, the tag really starts there — leading
  // extranonce crumbs are often letters ("dkj| MARA Made in USA") and no
  // generic rule can tell them from words, but the pool name can.
  const first = String(pool || "").split(/[^A-Za-z0-9]+/).find((t) => t.length >= 3);
  if (first) {
    const at = s.toLowerCase().indexOf(first.toLowerCase());
    if (at > 0) s = s.slice(at);
  }
  // strip anything before the first letter and after the last letter/digit
  s = s.replace(/^[^A-Za-z#]+/, "").replace(/[^A-Za-z0-9)\]}!?.]+$/, "");
  s = s.trim();
  return s.length >= 4 ? s.slice(0, 42) : null;
}

// Words that carry no information once you already know the pool name.
const TAG_FILLER = /\b(pool|mined|by|bitcoin|btc|xyz|com|net|org|the|and|for)\b/gi;

/**
 * Does this tag say anything the pool's name does not already say?
 * Subtract the pool's own tokens and the usual filler; what is left has to
 * be several letters of actual content to count as expression.
 */
export function tagIsExpressive(tag, pool) {
  if (!tag) return false;
  let rest = " " + tag + " ";
  for (const tok of String(pool || "").split(/[^A-Za-z0-9]+/)) {
    if (tok.length >= 2) rest = rest.replace(new RegExp(tok, "gi"), " ");
  }
  rest = rest.replace(TAG_FILLER, " ").replace(/[^A-Za-z ]+/g, " ");
  const letters = rest.replace(/\s+/g, "");
  return letters.length >= 5;
}

/**
 * Build the candidate list. Each entry:
 *   kind   · stable id, so primary and secondary never repeat a theme
 *   weight · interest score; higher wins. Event facts outrank scale facts.
 *   text   · the finished sentence
 * A candidate that cannot be computed (missing field) simply is not pushed,
 * which is why every accessor is guarded rather than defaulted — a fact
 * built from a fallback number is a lie with good manners.
 */
export function blockFactCandidates(tip, tail, opts) {
  const o = opts || {};
  const price = Number.isFinite(o.btcPrice) && o.btcPrice > 0 ? o.btcPrice : null;
  const out = [];
  if (!tip) return out;
  const push = (kind, weight, text) => { if (text) out.push({ kind, weight, text }); };
  const money = (sats) => (price ? usd((sats / SATS) * price) : null);

  // ── EVENT FACTS · gated hard, because their whole value is rarity ──

  // Interval drama. Time is the one unit every player already owns, so a
  // block that arrived in 90 seconds or after half an hour is legible
  // without any bitcoin literacy at all. The 6-14 minute middle is the
  // overwhelmingly common case and says nothing, hence the tight gate.
  //
  // THE 60-SECOND FLOOR IS NOT COSMETIC. Block timestamps are set by the
  // miner and only loosely constrained by consensus (they need not even
  // be monotonic), so tiny and negative gaps are clock skew, not fast
  // blocks. Live data had block 960265 arriving "1 second" after its
  // parent — printing that as drama would have been a confident false
  // claim about the chain, which is worse than saying nothing.
  const prev = Array.isArray(tail) && tail.length ? tail[0] : null;
  if (prev && Number.isFinite(tip.time) && Number.isFinite(prev.time)) {
    const gap = tip.time - prev.time;
    if (gap >= 60 && gap < 180) {
      push("interval", 90,
        `Mined ${Math.round(gap)} seconds after the last one. The chain aims for ten minutes.`);
    } else if (gap > 1500) {
      push("interval", 88,
        `This one took ${mins(gap)} to find. The chain aims for ten minutes.`);
    }
  }

  // Pool STREAK. Only a run the tail can actually see.
  //
  // The first version of this also claimed a "drought" when the tip's pool
  // was absent from the tail — and the test immediately caught it firing
  // on a deliberately unremarkable block. Of course it did: there are
  // dozens of pools and only six ancestors, so "did not mine any of the
  // last four" describes the majority of blocks, not a dry spell. Claiming
  // it as an event would have been the exact failure this module's gates
  // exist to prevent, dressed up in a number.
  //
  // A real drought needs mining-history endpoints we deliberately do not
  // call. A RUN, on the other hand, is fully observable in what we already
  // have — so we only say the thing we can actually see. Three in a row is
  // uncommon even for the largest pools; two is not, so two says nothing.
  if (tip.pool && Array.isArray(tail) && tail.length >= 2) {
    let run = 0;
    while (run < tail.length && tail[run] && tail[run].pool === tip.pool) run++;
    if (run >= 2) {
      push("pool", 76,
        `${tip.pool} mined this block and the ${run} before it — ${run + 1} in a row.`);
    }
  }

  // Coinbase graffiti — but ONLY when it says something beyond the pool's
  // own name.
  //
  // The first cut of this gated on "is there a printable tag", and against
  // eight consecutive live blocks it fired on all eight and won the
  // headline every time. Of course: every pool signs its blocks. "Mined by
  // AntPool" and "/F2Pool/" are branding, not graffiti, and a fact that
  // appears on 100% of blocks is the wallpaper this whole module is built
  // to avoid. What is actually rare and delightful is a miner writing
  // something EXTRA — "#dropgold", "Made in USA" — so the pool name and
  // the usual filler are subtracted first, and what remains has to be
  // real words before we call it a signature worth reading.
  if (tip.coinbaseTag) {
    const tag = cleanTag(String(tip.coinbaseTag), tip.pool);
    if (tag && tagIsExpressive(tag, tip.pool)) {
      push("graffiti", 80, `The miner wrote into this block: "${tag}"`);
    }
  }

  // Difficulty retarget proximity. The chain's metronome. Boring for most
  // of a two-week epoch, genuinely a countdown at the end of one.
  if (Number.isFinite(tip.height)) {
    const into = tip.height % RETARGET;
    const left = RETARGET - into;
    if (left <= 40) {
      push("retarget", 68,
        `${left} blocks until the network re-tunes its difficulty.`);
    } else if (into <= 3) {
      push("retarget", 66, "The network just re-tuned its mining difficulty.");
    }
  }

  // Fullness, but ONLY at the extremes. Blocks run ~99% full essentially
  // always (measured live: 3,997,742 of 4,000,000), so the interesting
  // reading is a block that is NOT full — that means nobody was competing
  // for the space.
  if (Number.isFinite(tip.weight) && tip.weight > 0) {
    const pct = (tip.weight / WEIGHT_LIMIT) * 100;
    if (pct < 80) {
      push("fullness", 74,
        `This block was only ${Math.round(pct)}% full. There was room to spare.`);
    }
  }

  // A quiet block. Same idea on the tx axis, measured against its own
  // neighbours rather than an invented constant.
  if (Number.isFinite(tip.txs) && Array.isArray(tail) && tail.length >= 3) {
    const counts = tail.map((b) => b && b.txs).filter(Number.isFinite);
    if (counts.length >= 3) {
      const med = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)];
      if (med > 0 && tip.txs < med * 0.55) {
        push("sparse", 71,
          `Only ${tip.txs.toLocaleString("en-US")} transactions. A quiet block.`);
      }
    }
  }

  // ── SCALE FACTS · always available, always genuinely large ──────────

  // Total value moved. The single most legible number in the whole block
  // for someone who does not know what a sat is. Reads in dollars when we
  // have an owned price, in BTC when we do not — never a guessed rate.
  if (Number.isFinite(tip.valueSats) && tip.valueSats > 0) {
    const m = money(tip.valueSats);
    push("value", 60, m
      ? `${m} moved through this block.`
      : `${btc(tip.valueSats)} moved through this block.`);
  }

  // What the miner actually won. The coinbase cube the player just sealed
  // IS this number, which closes a loop the run already walked.
  //
  // NEVER INTERPOLATE A FORMATTER INTO PROSE UNCHECKED (review r2, P1-3).
  // btc() returns null for zero/absent sats — by design, so a fact built
  // from a missing number cannot pretend to know it — and the template
  // happily printed it: "earned 3.15 BTC for this block: null new, null
  // in fees." feesSats is null whenever upstream omits totalFees, so the
  // one meaning sentence this feature exists for could read as a JS bug.
  // The breakdown clause only ships when BOTH halves format.
  if (Number.isFinite(tip.rewardSats) && tip.rewardSats > 0) {
    const fees = Number.isFinite(tip.feesSats) && tip.feesSats > 0 ? tip.feesSats : 0;
    const subsidy = Math.max(0, tip.rewardSats - fees);
    const m = money(tip.rewardSats);
    const subTxt = btc(subsidy), feeTxt = btc(fees);
    const breakdown = subTxt && feeTxt ? `: ${subTxt} new, ${feeTxt} in fees` : "";
    push("reward", 58,
      `${tip.pool || "The miner"} earned ${btc(tip.rewardSats)}${m ? " (" + m + ")" : ""}`
      + ` for this block${breakdown}.`);
  }

  // The blockspace auction, in plain words. The first gate here was
  // "spread >= 8x", which sounded selective and fired on eight of eight
  // live blocks — a 100x+ spread between the cheapest and dearest seat is
  // simply what a normal block looks like now. Raised to a spread that is
  // actually remarkable, AND an absolute top rate, so this means "the
  // auction was hot" rather than "an auction occurred".
  if (Array.isArray(tip.feeRange) && tip.feeRange.length >= 2) {
    const lo = tip.feeRange[0], hi = tip.feeRange[tip.feeRange.length - 1];
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= 150 && hi / lo >= 100) {
      push("auction", 55,
        `Cheapest seat in this block paid ${lo.toFixed(1)} sat/vB. The dearest paid ${Math.round(hi)}.`);
    }
  }

  // UTXO churn — coins being split apart or merged together. Mildly
  // technical, so it is weighted low and gated to a big move.
  if (Number.isFinite(tip.utxoDelta) && Number.isFinite(tip.inputs) && Number.isFinite(tip.outputs)) {
    if (Math.abs(tip.utxoDelta) >= 4000) {
      const dir = tip.utxoDelta > 0 ? "more" : "fewer";
      push("utxo", 52,
        `${tip.inputs.toLocaleString("en-US")} inputs became ${tip.outputs.toLocaleString("en-US")} outputs`
        + ` — ${Math.abs(tip.utxoDelta).toLocaleString("en-US")} ${dir} spendable coins than before.`);
    }
  }

  // Close the loop. The countdown the player just drained to zero WAS
  // this number. Lowest weight because it is the fact the card already
  // makes in its hero line, kept as the guaranteed floor so the card is
  // never empty.
  if (Number.isFinite(tip.txs) && tip.txs > 0) {
    push("count", 40,
      `Every one of those ${tip.txs.toLocaleString("en-US")} transactions was a real payment.`);
  }

  return out;
}

/**
 * Pick what the clear card shows: one primary, one quieter secondary of a
 * DIFFERENT kind. Never a wall of stats — the research was explicit that a
 * one-block newspaper beats a dashboard, and the card already carries a
 * grade, a sats total, a best-combo line and a leaderboard.
 *
 * Deterministic: sorted by weight, and every kind currently carries a
 * UNIQUE weight, so the seed tie-break below is inert today (review r2,
 * P2-3 — an earlier comment claimed it "rotates" picks; it never ran).
 * It stays only so that if two kinds are ever given the same weight the
 * order is still total and seeded rather than engine-dependent. The
 * block height is the natural seed, so a given block always reads the same.
 */
export function pickBlockFacts(tip, tail, opts) {
  const cands = blockFactCandidates(tip, tail, opts);
  if (!cands.length) return { primary: null, secondary: null };
  const seed = Number.isFinite(opts && opts.seed) ? opts.seed : 0;
  // stable sort by weight, tie-broken by a seed rotation so repeats vary
  cands.sort((a, b) => (b.weight - a.weight) || (((a.kind.charCodeAt(0) + seed) % 7) - ((b.kind.charCodeAt(0) + seed) % 7)));
  const primary = cands[0];
  const secondary = cands.find((c) => c.kind !== primary.kind
    && c.weight <= primary.weight && c.kind !== "count") || null;
  return { primary, secondary };
}
