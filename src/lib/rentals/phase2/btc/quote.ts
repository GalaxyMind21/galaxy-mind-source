/**
 * BTC on-chain pricing in native sats and the B6′ floor rule (PLAN v3.1 §3 + §18.1, vectors S, F, A, D).
 *
 *   F        = floor_btc_per_ph_day as integer sats/PH/day ("0.00051551" -> 51551)
 *   min_sat  = ceil(F x 27 x 103 x rigs x days / 10000)     // 0.27 PH/rig x 1.03
 *   ask_sat  = ceil(A x 27 x 985 x rigs x days / 100000)    // ask x 0.27 x 0.985
 *   amount   = max(ask_sat, min_sat)
 *   confs    = amount < 1,000,000 ? 1 : 2
 *
 * All BigInt; no float touches a sat amount. The floor rule is a straight port of the shared module the agent and the
 * poller use (N7), so the site never issues a quote the agent would refuse; the vectors run in CI (scripts/test-btc-rail.ts).
 */
import { RIG_TH } from "../../limits";
import { effectiveFloor, ASK_MAX_MULTIPLE, PRICING_MAX_AGE_MS, type DailyPricing } from "../pricing";

const B = (n: number | bigint | string) => BigInt(n);
const ceilDiv = (a: bigint, b: bigint) => (a + b - B(1)) / b;

export function minSat(F: number | bigint, rigs: number, days: number): bigint {
  return ceilDiv(B(F) * B(27) * B(103) * B(rigs) * B(days), B(10000));
}
export function askSat(A: number | bigint, rigs: number, days: number): bigint {
  return ceilDiv(B(A) * B(27) * B(985) * B(rigs) * B(days), B(100000));
}
export const requiredConfs = (amountSat: number | bigint) => (B(amountSat) < B(1_000_000) ? 1 : 2);

/** Exact "0.00051551" -> 51551n. Only 1-8 decimal places, no exponent, no sign. null on anything else. */
export function btcStrToSats(s: unknown): bigint | null {
  if (typeof s !== "string") return null;
  const m = /^(0|[1-9][0-9]{0,7})\.([0-9]{1,8})$/.exec(s);
  if (!m) return null;
  return B(m[1]) * B(100_000_000) + B(m[2].padEnd(8, "0"));
}
/** 51551n -> "0.00051551" (always 8 dp; the signed form). */
export function satsToBtcStr(sats: bigint | number): string {
  const v = B(sats);
  if (v < B(0)) throw new Error("negative");
  const w = v / B(100_000_000), f = v % B(100_000_000);
  return `${w}.${f.toString().padStart(8, "0")}`;
}

/** America/Chicago calendar date (the pricing row `day`, write_pricing_daily.mjs:42). */
export function ctDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

// ── B6′ floor rule ─────────────────────────────────────────────────────────────────────────────────────────────
export type FloorHistory = Record<string, { F: number; first_seen_at: string }[]>;
export type FloorRuleInput = {
  role: "agent" | "poller" | "site";
  quoteAt: number;          // ms
  floorDay: string;         // YYYY-MM-DD (CT)
  fSigned: number;          // integer sats/PH/day
  now: number;              // ms
  history: FloorHistory | "UNREADABLE" | null;
  amountSat?: bigint | number; // when present, step 6 runs
  rigs?: number; days?: number;
};
export type FloorRuleResult = { result: string; ntfy: string[] };
const MIN = 60_000;

export function floorRule(i: FloorRuleInput): FloorRuleResult {
  const ntfy: string[] = [];
  // 1) future day FIRST (F8, F8b): CT date of quote_at+5m and of now.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.floorDay) || i.floorDay > ctDate(i.quoteAt + 5 * MIN) || i.floorDay > ctDate(i.now)) {
    return { result: "reject:floor_day_invalid", ntfy };
  }
  // 2) agent only: own-clock skew (A1/A2). The poller bounds quote_at with N3 instead; the site sets quote_at itself.
  if (i.role === "agent" && Math.abs(i.now - i.quoteAt) > 5 * MIN) return { result: "refuse:quote_at_skew", ntfy };
  // 3) history visible at `now` (rows with first_seen_at <= now).
  const unavailable = i.role === "poller" ? "defer:floor_history_unavailable" : "refuse:floor_history_unavailable";
  if (!i.history || i.history === "UNREADABLE" || typeof i.history !== "object") return { result: unavailable, ntfy };
  const visible: Record<string, { F: number; t: number }[]> = {};
  for (const [day, rows] of Object.entries(i.history)) {
    if (!Array.isArray(rows)) return { result: unavailable, ntfy };
    const v = rows.map((r) => ({ F: r.F, t: Date.parse(r.first_seen_at) })).filter((r) => Number.isFinite(r.t) && r.t <= i.now && Number.isSafeInteger(r.F) && r.F > 0);
    if (v.length) visible[day] = v;
  }
  const dayRows = visible[i.floorDay];
  if (!dayRows) return { result: unavailable, ntfy };
  if (!dayRows.some((r) => r.F === i.fSigned)) ntfy.push("floor_mismatch");
  // 4) in effect at quote_at within -30/+5 (§18.1).
  const earliest = Object.entries(visible).map(([day, rows]) => ({ day, t: Math.min(...rows.map((r) => r.t)) }));
  const effective = (t: number) => earliest.filter((e) => e.t <= t).map((e) => e.day).sort().pop() ?? null;
  const inEffect = new Set([effective(i.quoteAt - 30 * MIN), effective(i.quoteAt + 5 * MIN)]);
  if (!inEffect.has(i.floorDay)) return { result: "reject:floor_day_not_in_effect", ntfy };
  // 5) value >= the day's lowest recorded value.
  if (i.fSigned < Math.min(...dayRows.map((r) => r.F))) return { result: "reject:floor_below_history", ntfy };
  // 6) amount >= min_sat(F_signed).
  if (i.amountSat !== undefined) {
    if (!i.rigs || !i.days) return { result: "reject:payment_below_floor", ntfy };
    if (B(i.amountSat) < minSat(i.fSigned, i.rigs, i.days)) return { result: "reject:payment_below_floor", ntfy };
  }
  return { result: "accept", ntfy };
}

/** P6 per-rail deadline (poller branch; reference for D1–D3): min(signed start, first-seen job iat) + 2 h, earlier-only. */
export function btcDeadline(signedStartMs: number, firstSeenIatMs: number, previousMs?: number | null): number {
  const d = Math.min(signedStartMs, firstSeenIatMs) + 2 * 3600_000;
  return previousMs != null && previousMs < d ? previousMs : d;
}

// ── site quote ─────────────────────────────────────────────────────────────────────────────────────────────────
export type BtcPricingRow = DailyPricing & { day: string; floorStr: string; askStr: string };
/** Quote window the site signs (quote_expires_at = quote_at + 15 min; the agent signs exp = quote_expires_at). */
export const BTC_QUOTE_TTL_MS = 15 * MIN;
/**
 * A pricing row this new is not used yet: the node's floor history records it within one 15-minute refresh (§18.1),
 * and an attestation before then is refused (F16/F17). Until then the previous row (still in effect for 30 min under
 * the -30 window) prices the quote; that's exactly F9.
 */
export const BTC_ROW_SETTLE_MS = 20 * MIN;

export type BtcQuote = {
  rigs: number; days: number;
  floorStr: string; floorSat: bigint; floorDay: string;
  amountSat: bigint; requiredConfs: 1 | 2;
  quoteAt: number; quoteExpiresAt: number;
};
export type BtcQuoteError = "pricing_unavailable" | "ask_out_of_band" | "btc_whole_rigs_only";

/**
 * rows: newest first (day desc). The signed floor is the pricing row's floor_btc_ph_day EXACTLY (the value the node
 * records, refresh-gm-floor.mjs:45), so the agent never sees a floor_mismatch from us. The amount is never below the
 * x402 basis: amount = max(ask_sat(A), min_sat(F_signed), min_sat(effective floor of the newest row)).
 */
export function quoteBtc(rows: BtcPricingRow[], th: number, days: number, now: number): { ok: true; q: BtcQuote } | { ok: false; error: BtcQuoteError } {
  if (!Number.isInteger(th) || th <= 0 || th % RIG_TH !== 0) return { ok: false, error: "btc_whole_rigs_only" };
  if (!Number.isInteger(days) || days < 1) return { ok: false, error: "pricing_unavailable" };
  const rigs = th / RIG_TH;
  const [newest, prev] = rows;
  if (!newest) return { ok: false, error: "pricing_unavailable" };
  const fresh = (r: BtcPricingRow) => now - r.writtenAt <= PRICING_MAX_AGE_MS && r.writtenAt <= now + 5 * MIN;
  let signed: BtcPricingRow | undefined = newest;
  if (now - newest.writtenAt < BTC_ROW_SETTLE_MS) signed = prev && fresh(prev) && prev.day < newest.day ? prev : undefined;
  if (!signed || !fresh(newest) || !fresh(signed)) return { ok: false, error: "pricing_unavailable" };
  if (signed.day > ctDate(now + 5 * MIN)) return { ok: false, error: "pricing_unavailable" };
  const floorSat = btcStrToSats(signed.floorStr);
  const askSatPh = btcStrToSats(newest.askStr);
  const effRaw = effectiveFloor(newest);
  if (floorSat == null || floorSat <= B(0) || askSatPh == null || askSatPh <= B(0) || effRaw == null) return { ok: false, error: "pricing_unavailable" };
  // SF10: ceil to whole sats; the 1e-9 slack only absorbs float noise (~1e-11 at these magnitudes), never a real fraction.
  const effSat = B(Math.ceil(effRaw * 1e8 - 1e-9));
  if (askSatPh > effSat * B(ASK_MAX_MULTIPLE)) return { ok: false, error: "ask_out_of_band" };
  let amount = askSat(askSatPh, rigs, days);
  for (const m of [minSat(floorSat, rigs, days), minSat(effSat, rigs, days)]) if (m > amount) amount = m;
  return { ok: true, q: { rigs, days, floorStr: satsToBtcStr(floorSat), floorSat, floorDay: signed.day, amountSat: amount, requiredConfs: requiredConfs(amount) as 1 | 2, quoteAt: now, quoteExpiresAt: now + BTC_QUOTE_TTL_MS } };
}

/** Read-only: the two newest pricing_daily rows WITH `day` (never writes; never touches anything else). Null = fail closed. */
export async function loadBtcPricingRows(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<BtcPricingRow[] | null> {
  // Lazy: pricing-read-key is server-only, and this module also exports constants that tests and other code import.
  const { pricingReadCreds } = await import("../pricing-read-key");
  const creds = pricingReadCreds(env); // narrow reader / server-only key first; anon only until the L4 revoke lands
  if (!creds) return null;
  const { url, key } = creds;
  try {
    const r = await fetchImpl(`${url}/rest/v1/pricing_daily?select=day,mrr_ask_btc_ph_day,floor_btc_ph_day,hashprice_sats_th_day,written_at&order=day.desc&limit=2`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!r.ok) return null;
    const rows = (await r.json()) as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const out: BtcPricingRow[] = [];
    for (const row of rows) {
      const p = parseBtcPricingRow(row);
      if (!p) return null;
      out.push(p);
    }
    return out;
  } catch { return null; }
}

/** PostgREST numeric comes back as a JSON number; render it to exactly 8 dp without float drift. */
export function num8(v: unknown): string | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= 0.01) return null;
  return satsToBtcStr(B(Math.round(n * 1e8)));
}
export function parseBtcPricingRow(row: Record<string, unknown>): BtcPricingRow | null {
  const day = typeof row.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day) ? row.day : null;
  const floorStr = num8(row.floor_btc_ph_day), askStr = num8(row.mrr_ask_btc_ph_day);
  const hp = Number(row.hashprice_sats_th_day), writtenAt = Date.parse(String(row.written_at));
  if (!day || !floorStr || !askStr || !(hp > 0) || !Number.isFinite(writtenAt)) return null;
  return { day, floorStr, askStr, floorBtcPhDay: Number(floorStr), marketAskBtcPhDay: Number(askStr), hashpriceSatsThDay: hp, writtenAt };
}
