/**
 * KV sent-state for the badge-DM drip. Kept off badge-outreach.ts so
 * the shop embed (imported by a client modal) never pulls the Redis
 * client into the browser bundle.
 */
import { kvGet, kvHSetMany, kvHMGetChecked, kvSet } from "./kv";
import {
  BADGE_OUTREACH_KEY,
  type BadgeOutreachRecord,
} from "./badge-outreach";

/** First-shown timestamp for the one public launch post. */
export const BADGE_LAUNCH_KEY = "gm:badge-launch:v1";
const BADGE_LAUNCH_WINDOW_SEC = 7 * 24 * 60 * 60;
const BADGE_LAUNCH_TTL_SEC = 30 * 24 * 60 * 60;

type BadgeLaunchRecord = { firstAt: number };

/** True while the launch post should still ride in the daily drafts. */
export async function shouldShowBadgeLaunch(): Promise<boolean> {
  const rec = await kvGet<BadgeLaunchRecord>(BADGE_LAUNCH_KEY);
  if (!rec || typeof rec.firstAt !== "number") return true;
  const age = Math.floor(Date.now() / 1000) - rec.firstAt;
  return age < BADGE_LAUNCH_WINDOW_SEC;
}

/** Pin the 7-day window on the first successful drafts email. */
export async function markBadgeLaunchShown(): Promise<boolean> {
  const rec = await kvGet<BadgeLaunchRecord>(BADGE_LAUNCH_KEY);
  if (rec && typeof rec.firstAt === "number") return true;
  return kvSet(
    BADGE_LAUNCH_KEY,
    { firstAt: Math.floor(Date.now() / 1000) },
    BADGE_LAUNCH_TTL_SEC,
  );
}

export async function loadBadgeOutreachSent(
  handles: string[],
): Promise<{ ok: boolean; sent: Set<string> }> {
  if (handles.length === 0) return { ok: true, sent: new Set() };
  const read = await kvHMGetChecked<BadgeOutreachRecord | string>(
    BADGE_OUTREACH_KEY,
    handles,
  );
  if (!read.ok) return { ok: false, sent: new Set() };
  const sent = new Set<string>();
  for (let i = 0; i < handles.length; i++) {
    if (read.values[i] != null) sent.add(handles[i]!);
  }
  return { ok: true, sent };
}

export async function markBadgeOutreachSent(
  handles: string[],
): Promise<boolean> {
  if (handles.length === 0) return true;
  const now = Math.floor(Date.now() / 1000);
  const entries: Record<string, BadgeOutreachRecord> = {};
  for (const h of handles) entries[h] = { sentAt: now };
  return kvHSetMany(BADGE_OUTREACH_KEY, entries);
}
