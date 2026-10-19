// Upstash Redis REST client — minimal hand-rolled wrapper.
//
// Why not @upstash/redis or @vercel/kv:
// Both add 20-30KB of dependencies for what amounts to a few REST
// commands. Upstash's REST surface is documented at
// https://upstash.com/docs/redis/features/restapi and follows a
// uniform shape: GET/POST `${url}/${cmd}/${arg}/${arg}` returns
// `{result: ...}` or `{error: "..."}`. Trivial to wrap.
//
// Required env vars (either naming convention works — Upstash's
// default naming OR Vercel's older "@vercel/kv" naming):
//
//   UPSTASH_REDIS_REST_URL  /  KV_REST_API_URL    — Redis REST URL
//   UPSTASH_REDIS_REST_TOKEN /  KV_REST_API_TOKEN  — REST token
//
// Both pairs are checked at module-load time; whichever is set wins.
// Vercel's KV product was retired into Marketplace integrations in
// 2024, and Upstash's `UPSTASH_REDIS_REST_*` is now the long-term
// standard naming Upstash auto-injects when you connect a database
// via the Vercel Marketplace.
//
// Without either env var pair set, every read returns null/empty
// and every write resolves to {ok:false}. This is intentional:
// features built on top of KV (stack history, treasuries history,
// subscribe rate limit, double-opt-in tokens) degrade gracefully
// rather than crash. Same "configured?" pattern as lib/email.ts.
//
// Failure semantics:
//   - Network or 5xx → returns the no-op shape (logs to console.error)
//   - Missing env vars → returns the no-op shape (logs once on cold start)
//   - 4xx from Upstash (bad command) → throws; this is a programmer error

// Accept either naming. Upstash's name takes precedence because that's
// the one the Vercel Marketplace auto-injects today.
const URL =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const CONFIGURED = Boolean(URL && TOKEN);

let warnedOnce = false;
function warnIfNotConfigured(): boolean {
  if (CONFIGURED) return true;
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn(
      "[kv] KV_REST_API_URL or KV_REST_API_TOKEN not set · operating in no-op mode",
    );
  }
  return false;
}

// Hard timeout so a slow Upstash hop doesn't peg the function. 3s is
// generous; Upstash's p99 from us-east-1 is well under 100ms.
const KV_FETCH_TIMEOUT_MS = 3_000;

/**
 * Like `command` but reports WHETHER THE READ HAPPENED. For GET the two
 * cases are otherwise indistinguishable: Upstash answers an absent key
 * with a null result, and every failure path here also returns null. A
 * caller deciding something on a default-ON value must be able to tell
 * "no record, so use the default" from "we could not ask" — see
 * getSubscriberPrefsChecked.
 */
async function commandChecked<T>(
  args: (string | number)[],
): Promise<{ ok: boolean; result: T | null }> {
  if (!warnIfNotConfigured()) return { ok: false, result: null };
  // Upstash REST: POST /pipeline | GET /${cmd}/${arg}/...
  // We always use POST with JSON body so values can contain `/` etc.
  // safely without URL-encoding edge cases.
  try {
    const r = await fetch(URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(KV_FETCH_TIMEOUT_MS),
      // No Next caching — KV reads must always hit the live store.
      cache: "no-store",
    });
    if (!r.ok) {
      console.error(`[kv] HTTP ${r.status}`, await r.text().catch(() => ""));
      return { ok: false, result: null };
    }
    const body = (await r.json()) as { result?: T; error?: string };
    if (body.error) {
      console.error("[kv] error:", body.error);
      return { ok: false, result: null };
    }
    return { ok: true, result: (body.result ?? null) as T | null };
  } catch (e) {
    console.error("[kv] fetch failed:", e instanceof Error ? e.message : e);
    return { ok: false, result: null };
  }
}

/** Unchanged contract: null on absent OR failed. Most callers want this. */
async function command<T>(args: (string | number)[]): Promise<T | null> {
  return (await commandChecked<T>(args)).result;
}

// ----- High-level helpers ------------------------------------------

/**
 * GET key. Returns null on miss, error, or unconfigured.
 *
 * Polymorphic decode: tries JSON.parse, falls back to the raw string on
 * throw. This is REQUIRED, not incidental — callers that store bare
 * numbers via `kvSet(key, nowMs)` (e.g. new-vendor-digest LAST_SENT,
 * list-pending-submissions DIGEST_HWM) read them back with
 * `kvGet<number>` and depend on `JSON.parse("12345") === 12345`.
 *
 * CAVEAT (do not "fix" by gating the parse on `{`/`[`): a value stored
 * as a plain STRING that happens to be a bare JSON scalar — all digits
 * ("12345"), "true"/"false", or "null" — will be coerced to that scalar
 * on read, not returned as the string. No current caller hits this (the
 * string values stored are emails, tier names, and hex tokens, none of
 * which parse as a JSON scalar). If you ever need to store a string that
 * could look like a bare scalar, JSON.stringify it at the call site so
 * it round-trips as a quoted string.
 */
export async function kvGet<T = string>(key: string): Promise<T | null> {
  const raw = await command<string>(["GET", key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/**
 * Like kvGet but distinguishes a READ FAILURE from a genuinely-absent key.
 * `ok:false` means we could not ask the store (transport error / timeout /
 * non-2xx / unconfigured), so `value:null` is NOT authoritative. A caller
 * that would otherwise fall back to a default-ON value must fail CLOSED
 * instead — same rule kvHMGetChecked exists for on the write path.
 */
export async function kvGetChecked<T = string>(
  key: string,
): Promise<{ ok: boolean; value: T | null }> {
  const { ok, result } = await commandChecked<string>(["GET", key]);
  if (!ok) return { ok: false, value: null };
  if (result == null) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(result) as T };
  } catch {
    return { ok: true, value: result as unknown as T };
  }
}

/**
 * SET key value. JSON-stringifies the value. Optional TTL in seconds
 * for self-expiring keys (rate limits, opt-in tokens).
 */
export async function kvSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<boolean> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  const args: (string | number)[] = ["SET", key, payload];
  if (ttlSeconds != null && ttlSeconds > 0) {
    args.push("EX", ttlSeconds);
  }
  const r = await command<string>(args);
  return r === "OK";
}

/** DEL key. Returns true if the key existed and was deleted. */
export async function kvDel(key: string): Promise<boolean> {
  const r = await command<number>(["DEL", key]);
  return (r ?? 0) > 0;
}

/**
 * INCR key with TTL — used by sliding-window rate limiters.
 *
 * ATOMICITY (audit 2026-05-21 · HIGH):
 *
 * Previously: SET key 0 EX ttl NX, then INCR. Two separate HTTP
 * round-trips to Upstash. If the first SET succeeded but the second
 * INCR's response was lost mid-flight (or vice-versa: SET dropped,
 * INCR landed and created the key with no TTL), the rate-limit key
 * could persist forever with no TTL. That IP / hashed-email would
 * be PERMANENTLY locked out as soon as normal traffic incremented
 * past the threshold. An attacker who could observe HTTP outages
 * during their burst could even WEAPONIZE this against specific
 * email addresses (per-email cooldown key is sha256(email)) to
 * permanently block someone from confirming a subscription.
 *
 * Bulletproof fix: single Lua EVAL. The script runs server-side
 * inside Redis, so either both the INCR and the EXPIRE land
 * atomically or neither does. A single HTTP round-trip means no
 * mid-flight partial-state.
 *
 * Script: INCR; if the new count is 1 (key was just created),
 * EXPIRE it to set the TTL. Otherwise the key already has its
 * TTL from a prior call — don't touch it (avoids resetting the
 * window on every hit, which would defeat the sliding window).
 *
 * Returns the new count, or null if KV unconfigured (caller should
 * treat as "rate limit disabled, allow the request").
 */
// Returns {count, ttlSec}. On first hit EXPIRE is set; thereafter
// PTTL reports remaining window for accurate Retry-After headers.
const INCR_WITH_TTL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return {n, tonumber(ARGV[1])}
end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return {n, tonumber(ARGV[1])}
end
return {n, math.ceil(t / 1000)}`;

export type IncrWithTtlResult = { count: number; ttlSec: number };

export async function kvIncrWithTtl(
  key: string,
  ttlSeconds: number,
): Promise<number | null> {
  // Backward-compatible: most callers only need the count.
  const full = await kvIncrWithTtlFull(key, ttlSeconds);
  return full?.count ?? null;
}

/** INCR + remaining TTL in one atomic EVAL. */
export async function kvIncrWithTtlFull(
  key: string,
  ttlSeconds: number,
): Promise<IncrWithTtlResult | null> {
  const r = await command<unknown>([
    "EVAL",
    INCR_WITH_TTL_SCRIPT,
    "1", // numKeys
    key,
    String(ttlSeconds),
  ]);
  if (r == null) return null;
  // Upstash may return number[] or nested array depending on client.
  if (Array.isArray(r) && r.length >= 2) {
    const count = Number(r[0]);
    const ttlSec = Number(r[1]);
    if (!Number.isFinite(count)) return null;
    return {
      count,
      ttlSec: Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : ttlSeconds,
    };
  }
  // Fallback if Redis returns a bare number (old script residual).
  if (typeof r === "number") return { count: r, ttlSec: ttlSeconds };
  return null;
}

/**
 * LPUSH a JSON value onto a list, then LTRIM to keep only the most
 * recent `cap` entries. Used for daily snapshot history (stack scores,
 * treasury mNAVs).
 */
export async function kvPushCapped(
  listKey: string,
  value: unknown,
  cap: number,
): Promise<boolean> {
  // Always JSON.stringify · kvList always JSON.parses on read, so
  // round-trip needs symmetric encoding both directions. Earlier
  // version had `typeof value === "string" ? value : JSON.stringify`
  // which broke when callers passed plain string values (the
  // unwrapped string couldn't be JSON-parsed back). All current
  // callers pass objects so this change is no-op for them, but it
  // makes future plain-string callers work correctly.
  const json = JSON.stringify(value);
  const len = await command<number>(["LPUSH", listKey, json]);
  if (len == null) return false;
  // LTRIM is idempotent and cheap; running it on every push keeps the
  // list bounded without a separate "cleanup" cron.
  //
  // Audit 2026-05-14 finding H-2 (silent-failure-hunter): the LTRIM
  // result was previously discarded silently. If LPUSH lands but LTRIM
  // fails (network blip between the two HTTP calls), the list grows
  // past `cap` over time. Now we log loudly when LTRIM fails so the
  // operator can correlate "stack:history showing 400 entries" to a
  // KV instability event. The function still returns true (the LPUSH
  // succeeded and the data is stored) · the cap violation is a
  // monitoring concern, not a write failure.
  const trimmed = await command<string>(["LTRIM", listKey, 0, cap - 1]);
  if (trimmed == null) {
    console.warn(
      `[kv:pushCapped] LTRIM failed for ${listKey} · list may grow past cap=${cap}`,
    );
  }
  return true;
}

/**
 * LREM key 0 <json> · remove EVERY occurrence of an exact value from a
 * list, in ONE atomic command.
 *
 * The alternative — read the list, filter, DEL, re-push each survivor —
 * has a window in which the key is empty or half-rebuilt. A function
 * timeout, a mid-loop write failure or a concurrent reader inside that
 * window loses entries permanently, and nothing re-adds them (a
 * dormancy mark, for instance, early-returns on the per-handle key and
 * never re-pushes its index row). Encoding is symmetric with
 * kvPushCapped's JSON.stringify, so the value matches byte-for-byte.
 * Returns the number of elements removed (0 when absent OR on failure).
 */
/**
 * LSET key index value. Replaces one list entry in place.
 * A same-day float correction uses this so the broken row does not
 * become "yesterday" underneath a second copy of today.
 * Returns false on a KV error. An out-of-range index errors too.
 */
export async function kvListSet(
  listKey: string,
  index: number,
  value: unknown,
): Promise<boolean> {
  const r = await command<string>([
    "LSET",
    listKey,
    index,
    JSON.stringify(value),
  ]);
  return r === "OK";
}

export async function kvListRemove(
  listKey: string,
  value: unknown,
): Promise<number> {
  const removed = await command<number>([
    "LREM",
    listKey,
    0,
    JSON.stringify(value),
  ]);
  return typeof removed === "number" ? removed : 0;
}

/**
 * LRANGE 0 (n-1). Returns the most recent `n` entries as parsed
 * JSON, oldest last (because LPUSH puts newest first). Empty array
 * on miss / unconfigured.
 */
export async function kvList<T>(listKey: string, n: number): Promise<T[]> {
  const raw = await command<string[]>(["LRANGE", listKey, 0, n - 1]);
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const s of raw) {
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      // Skip malformed entries. Shouldn't happen but defensive.
    }
  }
  return out;
}

// ----- Sorted sets (arcade leaderboards, 2026-07-09) ----------------

/**
 * ZADD key GT CH score member · adds the member or raises its score,
 * NEVER lowers it (GT). Perfect leaderboard semantics: a player's
 * best always stands, repeat submissions of worse runs are no-ops.
 * Returns true when the board changed (new member or improved score).
 */
export async function kvZAddGt(
  key: string,
  score: number,
  member: string,
): Promise<boolean> {
  const r = await command<number>(["ZADD", key, "GT", "CH", score, member]);
  return (r ?? 0) > 0;
}

/** Top n members, best-first, with scores. Empty on miss/unconfigured. */
export async function kvZTop(
  key: string,
  n: number,
): Promise<{ member: string; score: number }[]> {
  const raw = await command<(string | number)[]>([
    "ZRANGE",
    key,
    0,
    n - 1,
    "REV",
    "WITHSCORES",
  ]);
  if (!Array.isArray(raw)) return [];
  const out: { member: string; score: number }[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const score = Number(raw[i + 1]);
    if (Number.isFinite(score)) out.push({ member: String(raw[i]), score });
  }
  return out;
}

/**
 * 0-based rank from the top, or null when absent/unconfigured.
 * ZREVRANK, not `ZRANK ... REV` · the REV option needs Redis 7.2 and
 * Upstash rejected it in production (live smoke 2026-07-09).
 */
export async function kvZRevRank(
  key: string,
  member: string,
): Promise<number | null> {
  const r = await command<number | null>(["ZREVRANK", key, member]);
  return typeof r === "number" ? r : null;
}

/** Board size. 0 on miss/unconfigured. */
export async function kvZCard(key: string): Promise<number> {
  const r = await command<number>(["ZCARD", key]);
  return r ?? 0;
}

/**
 * ZREM key member [member...]. Drops index entries whose records are
 * gone. A missing key is a no-op. Empty member list issues no command.
 */
export async function kvZRem(key: string, ...members: string[]): Promise<void> {
  if (members.length === 0) return;
  await command<number>(["ZREM", key, ...members]);
}

/** Best-effort EXPIRE for self-cleaning boards (daily gauntlet keys). */
export async function kvExpire(
  key: string,
  ttlSeconds: number,
): Promise<void> {
  await command<number>(["EXPIRE", key, ttlSeconds]);
}

/**
 * Trim a sorted set to its top `keep` members by score (removes the
 * lowest-scoring entries). Bounds board size so a flood can't grow the
 * key without limit · ZREMRANGEBYRANK 0 -(keep+1) deletes everything
 * except the highest `keep`. Best-effort.
 */
export async function kvZTrimTop(key: string, keep: number): Promise<void> {
  await command<number>(["ZREMRANGEBYRANK", key, 0, -(keep + 1)]);
}

// ----- Hash helpers (arcade X-identity profile map) ----------------
// One hash holds every linked player's display metadata keyed by the
// immutable X user id, so board enrichment is ONE HMGET per read
// instead of N GETs (KV free tier discipline).

/** HSET key field value. Value is JSON-stringified unless a string. */
export async function kvHSet(
  key: string,
  field: string,
  value: unknown,
): Promise<boolean> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  const r = await command<number>(["HSET", key, field, payload]);
  return r != null;
}

/**
 * HSET key f1 v1 f2 v2 … · ONE Redis command regardless of how many
 * fields. The per-field kvHSet in a loop turns a 130-vendor write into
 * 130 metered Upstash commands; this keeps it at one, which is the whole
 * reason the vendor baseline is a hash rather than a key per vendor.
 */
export async function kvHSetMany(
  key: string,
  entries: Record<string, unknown>,
): Promise<boolean> {
  const pairs = Object.entries(entries).flatMap(([field, value]) => [
    field,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
  if (pairs.length === 0) return true;
  const r = await command<number>(["HSET", key, ...pairs]);
  return r != null;
}

/**
 * HMGET key fields… · one round-trip for many fields. Missing fields
 * come back null; values JSON-parse with a raw-string fallback (same
 * polymorphic decode contract as kvGet).
 */
export async function kvHMGet<T = string>(
  key: string,
  fields: string[],
): Promise<(T | null)[]> {
  if (fields.length === 0) return [];
  const raw = await command<(string | null)[]>(["HMGET", key, ...fields]);
  if (!raw) return fields.map(() => null);
  return raw.map((v) => {
    if (v == null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  });
}

/**
 * Like kvHMGet but distinguishes a READ FAILURE from genuinely-absent fields.
 * `ok:false` means the underlying command failed (transport error / timeout /
 * non-2xx / unconfigured), so the null values are NOT authoritative — a caller
 * that merges-then-overwrites must skip the write, or a transient blip clobbers
 * live data (cloud-save clobber · review 2026-07-18). `ok:true` means the read
 * succeeded; absent fields are still null. (A missing hash returns all-null
 * with ok:true — that's a genuine "no data yet", safe to seed.)
 */
export async function kvHMGetChecked<T = string>(
  key: string,
  fields: string[],
): Promise<{ ok: boolean; values: (T | null)[] }> {
  if (fields.length === 0) return { ok: true, values: [] };
  const raw = await command<(string | null)[]>(["HMGET", key, ...fields]);
  if (!raw) return { ok: false, values: fields.map(() => null) };
  return {
    ok: true,
    values: raw.map((v) => {
      if (v == null) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    }),
  };
}

/** HDEL key field · the unlink/delete path for stored X profiles. */
export async function kvHDel(key: string, field: string): Promise<boolean> {
  const r = await command<number>(["HDEL", key, field]);
  return (r ?? 0) > 0;
}

/** True iff KV env vars are configured. Use to gate UI placeholders. */
export function isKvConfigured(): boolean {
  return CONFIGURED;
}
