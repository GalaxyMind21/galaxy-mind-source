/**
 * One quiet sentence anchoring today's gauge reading in its recent
 * history. "77" is a number; "77, highest since March 12" is a story
 * worth sharing (review 2026-06-12).
 *
 * Extracted from StackContent so the production crash (live score
 * tied with the window max/min → hist[-1].date) can be pinned by
 * scripts/test-stack.ts. Returns null below 30 days of history — a
 * percentile against a tiny window is noise, not signal.
 *
 * Every stored row is dated UTC-yesterday (snapshot-stack finalizes
 * the prior day), so none of them is today's live reading. The live
 * `score` is compared against the full finalized history.
 */
export function buildRarityLine(
  score: number,
  scoreHistory: { date: string; score: number }[],
): string | null {
  const hist = scoreHistory;
  if (hist.length < 30) return null;
  const days = hist.length;
  const scores = hist.map((h) => h.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  // Inclusive on both sides: a live score TIED with the window max
  // used to fall through, set lastHigherIdx = -1, then read
  // hist[-1].date and throw (production TypeError on /stack,
  // 2026-08-13..20). A tie is a highest/lowest reading of the window.
  if (score >= max) return `Highest reading of the last ${days} days`;
  if (score <= min) return `Lowest reading of the last ${days} days`;
  // Last day the gauge printed a higher / lower number · only worth
  // saying when it was a while ago.
  let lastHigherIdx = -1;
  let lastLowerIdx = -1;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (lastHigherIdx < 0 && hist[i].score > score) lastHigherIdx = i;
    if (lastLowerIdx < 0 && hist[i].score < score) lastLowerIdx = i;
    if (lastHigherIdx >= 0 && lastLowerIdx >= 0) break;
  }
  const daysSinceHigher =
    lastHigherIdx >= 0 ? hist.length - lastHigherIdx : days;
  const daysSinceLower =
    lastLowerIdx >= 0 ? hist.length - lastLowerIdx : days;
  if (lastHigherIdx >= 0 && daysSinceHigher >= 21) {
    return `Highest since ${hist[lastHigherIdx].date}`;
  }
  if (lastLowerIdx >= 0 && daysSinceLower >= 21) {
    return `Lowest since ${hist[lastLowerIdx].date}`;
  }
  const pct = Math.round(
    (100 * scores.filter((s) => s <= score).length) / scores.length,
  );
  return `Sits in the ${pct}th percentile of the last ${days} days`;
}
