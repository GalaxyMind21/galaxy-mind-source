// Centralized share-text templates · the canonical home for the
// pre-filled copy that powers every "share this" surface (streak,
// gauge verdict, float, fit). Keeping the strings here means the voice
// stays consistent and a future refactor can point the existing
// ShareVerdictButton / ShareFloatButton at the same source.
//
// Voice rules (per the README): plain human voice, no em dashes (the
// middot · is fine), nothing cringe. Each template is a complete,
// quotable post on its own.

const SITE_URL = "https://galaxymind.space";

/** Build an X (Twitter) compose-intent URL for arbitrary pre-filled text. */
export function xIntentUrl(text: string): string {
  return "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
}

/**
 * Append the @GalaxyMind attribution line to an X share text. Audit
 * 2026-07-12: only 2 of ~12 X share surfaces mentioned the account, so
 * shares never pinged its notifications or built the mention graph ·
 * X's search-for-mentions discovery loop missed them entirely. Apply
 * to the X variant only (Nostr identity is the nprofile, not a
 * handle); keep it as the final line so the post still reads as the
 * player's own words. Costs 16 chars of the 280 budget.
 */
export function withAttribution(text: string): string {
  return `${text}\nvia @GalaxyMind`;
}

/**
 * Nostr flavor of a share text: same body, hashtag discovery instead
 * of @-attribution (hashtags are how notes surface in Nostr clients;
 * an X handle means nothing there). Pair with a "Copy for Nostr"
 * button · there is no cross-client compose-intent URL standard, so
 * clipboard + the user's own client is the reliable hand-off (same
 * pattern as the submit-success screen).
 */
export function nostrShareVariant(text: string): string {
  return `${text}\n\n#bitcoin`;
}

/**
 * Share copy for a daily-gauge-check streak. The number is the flex;
 * the link drives the recipient to the live gauge (which carries its
 * own OG card at scrape time).
 */
export function streakShareText(count: number): string {
  const dayWord = count === 1 ? "day" : "days";
  return [
    `My Bitcoin Buying Gauge streak: ${count} ${dayWord} 🔥`,
    "",
    "I check whether it's a good time to stack before I buy. See today's reading:",
    `${SITE_URL}/stack`,
  ].join("\n");
}

/**
 * Share copy for "today's cheapest Bitcoin treasury." The ticker + mNAV
 * carry the actual signal · the link drives traffic to the head-to-head
 * dashboard (which carries its own OG card via the page's generateMetadata).
 * Used by the CheapestCallout hero on /treasuries.
 */
export function cheapestTreasuryShareText(
  ticker: string,
  mNAV: number,
  name?: string,
): string {
  const label = name && name !== ticker ? `${ticker} (${name})` : ticker;
  const headline =
    mNAV < 1
      ? `Cheapest public Bitcoin treasury right now: ${label} at ${mNAV.toFixed(2)}× mNAV`
      : `Cheapest public Bitcoin treasury right now: ${label} · ${mNAV.toFixed(2)}× mNAV`;
  return [
    headline,
    "",
    "Live head-to-head of MSTR, MPJPY, XXI, ASST · spread vs spot BTC:",
    `${SITE_URL}/treasuries`,
  ].join("\n");
}
