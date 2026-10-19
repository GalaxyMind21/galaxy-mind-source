// Arcade easter eggs · small, honest winks for people who look closely
// (games polish 2026-07-09). Pure + deterministic so they are trivially
// testable and can render the same on server and client.
//
// House rule: nothing here ever keys off, references, or singles out the
// number 88. The seasonal dates below are real bitcoin-history dates.

export type SeasonalEgg = {
  emoji: string;
  title: string;
  note: string;
};

/**
 * A seasonal banner for a handful of real bitcoin-history anniversaries.
 * Keyed on the viewer's local month/day so it lands on the right day in
 * any timezone. Returns null on every ordinary day.
 */
export function seasonalEgg(now: Date): SeasonalEgg | null {
  const m = now.getMonth() + 1; // 1..12
  const d = now.getDate();

  // 3 Jan 2009 · the genesis block was mined, carrying a newspaper
  // headline as a timestamp and a protest.
  if (m === 1 && d === 3) {
    return {
      emoji: "🧱",
      title: "Genesis Block Day",
      note: 'The first block was mined on 3 January 2009, stamped with the day\'s headline: "Chancellor on brink of second bailout for banks."',
    };
  }

  // 11 Jan · a tribute to Hal Finney, among the very first to run the
  // software in January 2009 ("Running bitcoin.").
  if (m === 1 && d === 11) {
    return {
      emoji: "🖥️",
      title: "Running bitcoin.",
      note: "A tribute to Hal Finney, one of the first people to run the software back in January 2009.",
    };
  }

  // 22 May 2010 · Bitcoin Pizza Day.
  if (m === 5 && d === 22) {
    return {
      emoji: "🍕",
      title: "Bitcoin Pizza Day",
      note: "On 22 May 2010, 10,000 BTC bought two pizzas · still the most expensive lunch in history.",
    };
  }

  return null;
}

// A wink for the board: a few culture-heavy handles glow. Purely
// cosmetic · this never changes what is stored or validated, and it
// never keys off any number.
const LEGENDARY_MARKERS = ["Saylor", "Genesis-Block", "Timechain Monk"];

export function isLegendaryHandle(name: string): boolean {
  return LEGENDARY_MARKERS.some((marker) => name.includes(marker));
}
