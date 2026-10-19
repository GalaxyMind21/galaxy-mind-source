import type { MarketSnapshot } from "./market";
import {
  type StackVerdict,
  type BestWindow,
  hourOfDayScore,
  dayOfWeekScore,
} from "./stack";
import { etHourFromUtc, etDayOfWeekFromUtc } from "./datetime";

export type ForecastCell = {
  utcDate: string;     // YYYY-MM-DD in UTC
  etHour: number;      // 0-23 in America/New_York
  etDow: number;       // 0-6 in America/New_York (Sun=0)
  score: number;       // 0-100
  isCurrent: boolean;
};

export function computeForecast(
  snapshot: MarketSnapshot,
  verdict: StackVerdict,
  // Audit 2026-05-14 finding H-2 · the previous implementation called
  // Date.now() inline in scoring math, violating the README
  // "no Date.now() inside scoring math" determinism invariant. Two
  // concurrent invocations within the same minute could span a
  // clock-hour boundary and produce forecasts where `isCurrent`
  // points to different cells, violating the "exactly one isCurrent"
  // invariant when the results are compared. weekly-digest, which
  // calls computeStackVerdict + computeForecast sequentially, would
  // see hour-of-day signal and forecast "current" cell off by one
  // hour if a minute boundary fell between the two calls.
  //
  // Now `nowMs` is a parameter, defaulting to Date.now() at call
  // time. Callers that compute multiple things from the same instant
  // should capture Date.now() once and pass it through, ensuring all
  // derived state agrees on "now".
  nowMs: number = Date.now(),
): ForecastCell[] {
  const cells: ForecastCell[] = [];
  const closes = snapshot.hourlyCloses;
  const timestamps = snapshot.hourlyTimestamps;

  // Background score from current verdict, decayed linearly toward 50
  // over 7 days (forecast confidence drops with distance).
  const bg0 = verdict.score;
  const nowHour = Math.floor(nowMs / (3600 * 1000)) * 3600 * 1000;

  for (let h = 0; h < 168; h++) {
    const ts = nowHour + h * 3600 * 1000;
    const date = new Date(ts);
    const utcDate = date.toISOString().slice(0, 10);
    const etHour = etHourFromUtc(date);
    const etDow = etDayOfWeekFromUtc(date);

    const decay = h / 168;
    const bg = bg0 * (1 - decay) + 50 * decay;
    const hod = hourOfDayScore(closes, timestamps, etHour);
    const dws = dayOfWeekScore(closes, timestamps, etDow);

    // Blend: 40% background, 35% hour-of-day, 25% day-of-week.
    const blended = bg * 0.4 + hod * 0.35 + dws * 0.25;
    const score = Math.max(0, Math.min(100, Math.round(blended)));

    cells.push({
      utcDate,
      etHour,
      etDow,
      score,
      isCurrent: h === 0,
    });
  }

  return cells;
}

export function pickBestWindow(cells: ForecastCell[]): BestWindow | null {
  if (cells.length === 0) return null;
  // Find the highest-scoring future cell · same logic as before but
  // we track the index too so the client can render a countdown
  // ("in Xh Ym") without re-parsing the label string. Index in the
  // 168-cell forecast == hours from the cell at h=0 (the current
  // hour boundary).
  let bestIdx = -1;
  let bestCell: ForecastCell | null = null;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.isCurrent) continue;
    if (!bestCell || c.score > bestCell.score) {
      bestCell = c;
      bestIdx = i;
    }
  }
  if (!bestCell || bestIdx < 0) return null;
  const dow = bestCell.etDow;
  const startHour = bestCell.etHour;
  const endHour = (startHour + 2) % 24;
  const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow];
  const fmtH = (h: number) => {
    const ampm = h < 12 ? "am" : "pm";
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}${ampm}`;
  };
  return {
    dayOfWeek: dow,
    hourLocalET: startHour,
    label: `${dayName} ${fmtH(startHour)}–${fmtH(endHour)} ET`,
    hoursFromNow: bestIdx,
    score: bestCell.score,
  };
}
