// Web-push channel · server-side lib (2026-06-10).
//
// WHY: alerts previously lived or died by email deliverability, and
// the repo documents three separate recurrences of alert mail being
// silently buried before anyone saw it. Push is the email-independent channel ·
// a lock-screen "gauge crossed 80" the moment it happens, no inbox
// in the loop. ~71% of traffic is mobile where push is native
// behavior (iOS requires the installed PWA · manifest.ts already
// ships standalone mode).
//
// STORAGE: anonymous by design. A push subscription is a browser
// credential, not an identity · coupling it to the email prefs
// system would force collecting an address and defeat the channel's
// whole advantage. Records live at `push:sub:<sha256(endpoint)>`
// with a capped sorted-set index. Deleting a record also ZREMs its
// member. A TTL expiry cannot, so a broadcast sweeps members whose
// GET succeeded and came back empty. A failed GET is left in place:
// a blip must not drop a live subscriber out of the cap.
//
// HYGIENE: subscriptions die silently (user clears site data,
// browser rotates the endpoint). Two layers: a 180-day TTL on every
// record (re-subscribing refreshes it · the toggle re-POSTs on each
// /stack visit while enabled), and 404/410 push-service responses
// prune the record immediately during a broadcast.
//
// SECURITY: the subscribe endpoint accepts an attacker-supplied
// endpoint URL that this server will later POST to · an outbound-
// request primitive. validateOutboundUrl() (the house SSRF guard)
// rejects private ranges / localhost / non-443 ports before storage,
// and the payload is always the public broadcast alert · nothing
// per-user ever rides a push.
//
// Push-service allowlist (CodeQL review follow-up, 2026-10): web-push
// opens its own HTTPS connection with the system resolver, so a
// hostname that passes validateOutboundUrl but resolves to a private
// address was still reachable. Every real browser subscription points
// at a known push service, so the endpoint host must be one of them
// (isKnownPushEndpoint). New subscriptions on any other host are
// rejected when saved. Stored records on an unlisted host are SKIPPED at
// send time, not deleted, and only their host is logged (never the path
// or token), so the hosts in use are visible before anything is pruned.
// Sends also go through a DNS-pinned agent (createPinnedLookup from
// ./safe-fetch): every resolved address must pass isBlockedIp, and the
// socket connects only to an address that was checked.

import { createHash } from "node:crypto";
import { Agent } from "node:https";
import webpush from "web-push";
import {
  kvDel,
  kvGet,
  kvGetChecked,
  kvSet,
  kvZAddGt,
  kvZRem,
  kvZTop,
  kvZTrimTop,
} from "./kv";
import { validateOutboundUrl } from "./outbound-url";
import { createPinnedLookup } from "./safe-fetch";

const KEY_PREFIX = "push:sub:";
// Recency-ranked sorted set of subscription ids (2026-07-10 · H5). The
// old `push:subs:_index` was an append-only capped LIST: the toggle
// re-POSTs on every /stack visit while enabled, so one active device
// pushed hundreds of copies of its own id into the 500-slot cap and
// evicted every OTHER subscriber's id before a broadcast could read them
// (read-time dedupe couldn't help · the distinct ids were already gone).
// A sorted set keyed BY id is idempotent: a re-subscribe updates the
// member's recency score instead of taking a new slot, so the cap holds
// 500 DISTINCT subscribers. New key · the old one is list-typed (ZADD on
// a list is a WRONGTYPE error); active subs re-index here on their next
// visit, dead ones age out of the old key untouched.
const INDEX_KEY = "push:subs:v2";
const INDEX_CAP = 500;
const SUB_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days · refreshed on re-subscribe

/** Broadcast topics a subscription can opt into. "gauge" is the
 *  original 80/20 threshold alert; "wen" is the daily puzzle drop
 *  (2026-07-11). Legacy records with no `topics` field predate topics
 *  and are treated as GAUGE-ONLY · a daily game ping to people who
 *  opted into rare threshold alerts would be off-contract spam. */
export type PushTopic = "gauge" | "wen" | "tier";
// "tier" (2026-08-04): the gauge tier-flip channel. The "gauge" topic
// fires only at the >=80/<=20 extremes — approximately never — while
// tier flips happen roughly weekly. A SEPARATE opt-in keeps the
// existing gauge subscribers' rare-alerts contract intact.
export const PUSH_TOPICS: readonly PushTopic[] = ["gauge", "wen", "tier"];

export type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number; // unix seconds
  topics?: PushTopic[];
};

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PRIVATE_KEY &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_SUBJECT
  );
}

let vapidApplied = false;
function applyVapid(): void {
  if (vapidApplied) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidApplied = true;
}

export function subscriptionId(endpoint: string): string {
  // Full sha256 is overkill for a KV key suffix · 32 hex chars (128
  // bits) keeps keys short with no realistic collision surface.
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

/**
 * Push services a browser subscription can legitimately point at.
 * Exact hosts match as-is; suffixes match only on a dot boundary, so
 * "evilpush.apple.com" or "push.apple.com.evil.example" never match.
 *   - Chrome, Edge (Chromium), Opera, Brave: Firebase Cloud Messaging
 *     (plus jmt17.google.com, used by older Chrome subscriptions)
 *   - Firefox: Mozilla autopush
 *   - Safari (macOS, iOS / iPadOS home-screen apps): Apple Push
 *   - Legacy Edge / Windows: Windows Push Notification Services
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  // Older Chrome subscriptions still in the wild point here.
  "jmt17.google.com",
];
export const PUSH_SERVICE_SUFFIXES: readonly string[] = [
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];

/**
 * True when `endpoint` is an HTTPS URL on port 443 whose host is a
 * known push service, with no userinfo. Also runs the house SSRF
 * guard, so the allowlist can only ever narrow it.
 */
export function isKnownPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1024) return false;
  if (!validateOutboundUrl(endpoint).ok) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (PUSH_SERVICE_HOSTS.includes(host)) return true;
  return PUSH_SERVICE_SUFFIXES.some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length,
  );
}

/** Split stored subscriptions into ones we may send to and ones on an
 *  unlisted host (skipped: kept in storage, never contacted). */
export function partitionSendable<T extends { endpoint: string }>(
  subs: readonly T[],
): { sendable: T[]; skipped: T[] } {
  const sendable: T[] = [];
  const skipped: T[] = [];
  for (const s of subs) (isKnownPushEndpoint(s.endpoint) ? sendable : skipped).push(s);
  return { sendable, skipped };
}

/**
 * Count skipped records by HOST only. The endpoint path and query carry
 * the subscription token, so they never reach a log line or a result.
 */
export function skippedHostCounts(subs: readonly { endpoint: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of subs) {
    let host = "(unparseable)";
    try {
      host = new URL(s.endpoint).hostname.toLowerCase() || "(empty)";
    } catch {
      /* keep the placeholder; never echo the raw value */
    }
    counts[host] = (counts[host] ?? 0) + 1;
  }
  return counts;
}

/** DNS-pinned agent for web-push. Every resolved address must pass
 *  isBlockedIp, and the socket connects only to a checked address. */
export const pushAgent = new Agent({ lookup: createPinnedLookup() });

/** Validate an incoming subscription's shape + endpoint safety.
 *  Returns an error string (for a 400 body) or null when valid. */
export function validateSubscription(s: unknown): string | null {
  if (!s || typeof s !== "object") return "subscription must be an object";
  const sub = s as Record<string, unknown>;
  const endpoint = sub.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0)
    return "endpoint required";
  if (endpoint.length > 1024) return "endpoint too long";
  const safe = validateOutboundUrl(endpoint);
  if (!safe.ok) return `endpoint rejected: ${safe.reason}`;
  if (!isKnownPushEndpoint(endpoint)) return "endpoint rejected: not a known push service";
  const keys = sub.keys as Record<string, unknown> | undefined;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string")
    return "keys.p256dh and keys.auth required";
  if (p256dh.length > 256 || auth.length > 64) return "keys malformed";
  // base64url charset · the only alphabet push services emit.
  const B64URL = /^[A-Za-z0-9_-]+$/;
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return "keys malformed";
  return null;
}

export async function storeSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  topics: PushTopic[] = ["gauge"],
  remove: PushTopic[] = [],
): Promise<boolean> {
  const id = subscriptionId(sub.endpoint);
  // Topics MERGE with the existing record (union, then minus `remove`) ·
  // the gauge toggle on /stack and the WEN toggle on /wen each re-POST
  // their own topic, and an overwrite would silently drop whichever the
  // user enabled first. A topic-off must NOT nuke the whole record
  // (turning off the daily WEN ping must never kill gauge alerts).
  const prev = await kvGet<StoredPushSubscription>(KEY_PREFIX + id);
  const merged = [
    ...new Set([...(prev?.topics ?? (prev ? ["gauge" as const] : [])), ...topics]),
  ]
    .filter((t): t is PushTopic => (PUSH_TOPICS as readonly string[]).includes(t))
    .filter((t) => !remove.includes(t));
  if (merged.length === 0) {
    // Nothing left subscribed. Drop the record AND its index member.
    // Leaving the member in the capped ZSET kept a dead id ahead of
    // older live subscriptions until 500 newer writes existed.
    await kvDel(KEY_PREFIX + id);
    await kvZRem(INDEX_KEY, id);
    return true;
  }
  const record: StoredPushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    createdAt: Math.floor(Date.now() / 1000),
    topics: merged,
  };
  const ok = await kvSet(KEY_PREFIX + id, record, SUB_TTL_SECONDS);
  if (ok) {
    // Idempotent index write · ZADD keyed by id means a re-subscribe
    // (the toggle re-POSTs each /stack visit) just refreshes this id's
    // recency score, never consuming a second slot. Score = createdAt so
    // the cap keeps the 500 most-recently-active DISTINCT subscribers.
    // Stale ids (deleted/expired records) still resolve to null at read
    // time and are filtered.
    await kvZAddGt(INDEX_KEY, record.createdAt, id);
    await kvZTrimTop(INDEX_KEY, INDEX_CAP);
  }
  return ok;
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const id = subscriptionId(endpoint);
  await kvDel(KEY_PREFIX + id);
  await kvZRem(INDEX_KEY, id);
}

async function listSubscriptions(): Promise<StoredPushSubscription[]> {
  // Sorted-set members are already distinct (ZADD dedupes by id), most-
  // recent first. A record that expired on its TTL leaves a member
  // behind; drop those, and only those. A failed GET is not proof the
  // record is gone.
  const top = await kvZTop(INDEX_KEY, INDEX_CAP);
  if (top.length === 0) return [];
  const fetched = await Promise.all(
    top.map((t) => kvGetChecked<StoredPushSubscription>(KEY_PREFIX + t.member)),
  );
  const live: StoredPushSubscription[] = [];
  const dead: string[] = [];
  for (let i = 0; i < fetched.length; i++) {
    const row = fetched[i];
    if (!row.ok) continue;
    if (row.value) live.push(row.value);
    else dead.push(top[i].member);
  }
  if (dead.length > 0) await kvZRem(INDEX_KEY, ...dead);
  return live;
}

export type PushBroadcastResult = {
  attempted: number;
  delivered: number;
  pruned: number;
  /** Stored records on a host outside the push-service allowlist: skipped (kept, never contacted). */
  skipped?: number;
  firstError?: string;
};

/** Send one payload to every stored subscription. 404/410 responses
 *  prune the dead record. Never throws · cron callers treat push as
 *  best-effort alongside the load-bearing email path. */
export async function broadcastPush(
  payload: {
    title: string;
    body: string;
    url: string;
    tag?: string;
  },
  opts?: { topic?: PushTopic },
): Promise<PushBroadcastResult> {
  if (!isPushConfigured()) {
    return { attempted: 0, delivered: 0, pruned: 0, firstError: "push not configured" };
  }
  applyVapid();
  const topic = opts?.topic ?? "gauge";
  // Legacy records (no topics field) predate topics and mean gauge-only.
  const topical = (await listSubscriptions()).filter((s) =>
    (s.topics ?? ["gauge"]).includes(topic),
  );
  // Re-check every endpoint right before sending. Records on an unlisted
  // host (saved before the allowlist existed) are skipped, NOT deleted, and
  // only their hosts are logged, so we can see which services exist before
  // deciding on any pruning.
  const { sendable: subs, skipped } = partitionSendable(topical);
  if (skipped.length > 0) {
    console.warn(
      `[push] skipped ${skipped.length} subscription(s) on unlisted hosts · ${JSON.stringify(skippedHostCounts(skipped))}`,
    );
  }
  const skippedField = skipped.length ? { skipped: skipped.length } : {};
  if (subs.length === 0) {
    return { attempted: 0, delivered: 0, pruned: 0, ...skippedField };
  }

  const json = JSON.stringify(payload);
  let delivered = 0;
  let pruned = 0;
  let firstError: string | undefined;

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        json,
        // 4h TTL · a stale buying-signal push delivered tomorrow is
        // worse than no push. Urgency high = wake the radio on mobile.
        { TTL: 4 * 3600, urgency: "high", agent: pushAgent },
      ),
    ),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      delivered++;
      continue;
    }
    const status = (r.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      // Subscription is dead at the push service · prune.
      await deleteSubscription(subs[i].endpoint);
      pruned++;
    } else if (firstError === undefined) {
      firstError =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }
  return {
    attempted: subs.length,
    delivered,
    pruned,
    ...skippedField,
    firstError,
  };
}
