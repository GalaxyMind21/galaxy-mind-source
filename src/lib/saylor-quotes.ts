// Single source of truth for the rotating Michael Saylor quotes used
// across the site (the /stack loading screen, the 21-click brand-mark
// easter egg, the <SaylorQuoteStrip> on /float, /treasuries, /fit,
// the FooterMaxim in the site footer, and now a footer line on
// every outbound email). Operator-compiled list, verbatim wording ·
// no invented quotes attributed to a real person. Pure data, no
// deps, so it is safe to import from server components
// (StackSkeleton, cron routes) and client components alike.
//
// Curated to punchy one/two-line entries that fit a single strip ·
// the operator's source list also had paragraph-length quotes (the
// cyber-hornets one, "Google is what happens…") that wrap badly in a
// one-line rotator and were intentionally left out.
export const SAYLOR_QUOTES: readonly string[] = [
  '"It\'s going up forever, Laura."',
  '"How many chairs are you sitting on right now?"',
  '"There is no second best."',
  '"There is no end to up. #Bitcoin"',
  '"The halls of eternity echo with the cries of those who sold their #bitcoin."',
  '"You may not be interested in #Bitcoin, but Bitcoin is interested in you."',
  '"#Bitcoin is the Meme-ing of Life."',
  '"There will never be more than 21 million #bitcoin."',
  '"Bitcoin is the hardest money on earth."',
  '"My formula for success is rise early, work late, and buy Bitcoin."',
  '"Fiat currency is a melting ice cube."',
  '"You do not sell your Bitcoin."',
  '"I will be buying at the top forever."',
  '"Bitcoin is an ark of encrypted energy to escape the currency flood."',
  '"Only invest what you can\'t afford to lose."',
];

/**
 * Day-of-year-indexed quote pick · all emails (or any other surface
 * calling this) sent on the same day get the same quote, giving the
 * channel a unified daily "voice" rather than random per-message
 * noise. Mirrors the FooterMaxim selection pattern. Pass a specific
 * `nowMs` for deterministic snapshots in tests.
 */
export function pickSaylorQuote(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const doy = Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  return SAYLOR_QUOTES[doy % SAYLOR_QUOTES.length];
}
