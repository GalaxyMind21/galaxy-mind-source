// Shared America/New_York date helpers used by /stack engine + forecast.
//
// Why a shared module:
// Previously stack.ts and forecast.ts each had their own
// `etHourFromUtcMs` / `etDayOfWeekFromUtcMs` (or `etHourFromUtc`)
// helpers, both implemented as a fixed `-5h` shift. Two problems:
//
//  1. The fixed -5h offset is wrong during US DST (roughly mid-March
//     to early November), which is more than half the year. America
//     /New_York is UTC-4 then. The hour-of-day signal silently drifted
//     by an hour for ~8 months out of every 12.
//
//  2. With two parallel implementations a future fix could land in
//     one and not the other — the verdict and forecast would then
//     disagree about "what hour is it" forever after.
//
// Intl.DateTimeFormat with timeZone:"America/New_York" handles DST
// correctly via the system's IANA tzdata. We cache the Formatter
// instances because their constructor is non-trivially expensive
// (ICU lookup, options parsing) and these helpers are called on every
// /api/stack request.

const ET_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});

// `weekday: "short"` returns "Sun" / "Mon" / ... — fastest path to a
// 0-6 index without parsing the full date. Mapping table avoids a
// switch/regex per call.
const ET_DOW_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});

const DOW_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** ET hour 0-23 from a UNIX-millisecond timestamp. DST-correct. */
export function etHourFromUtcMs(ms: number): number {
  // formatToParts is cheaper than format() because it avoids the
  // string-concatenation step and gives us the raw hour part.
  const parts = ET_HOUR_FMT.formatToParts(new Date(ms));
  for (const p of parts) {
    if (p.type === "hour") {
      // hour12:false sometimes returns "24" at midnight (browser quirk
      // — the spec is ambiguous). Normalize to 0.
      const n = Number(p.value);
      return n === 24 ? 0 : n;
    }
  }
  return 0; // unreachable barring Intl bug; safe default
}

/** ET day-of-week 0-6 (Sun=0) from a UNIX-millisecond timestamp. */
export function etDayOfWeekFromUtcMs(ms: number): number {
  const parts = ET_DOW_FMT.formatToParts(new Date(ms));
  for (const p of parts) {
    if (p.type === "weekday") {
      return DOW_INDEX[p.value] ?? 0;
    }
  }
  return 0;
}

/** Convenience overload taking a Date instead of milliseconds. */
export function etHourFromUtc(d: Date): number {
  return etHourFromUtcMs(d.getTime());
}

/** Convenience overload taking a Date instead of milliseconds. */
export function etDayOfWeekFromUtc(d: Date): number {
  return etDayOfWeekFromUtcMs(d.getTime());
}
