/**
 * never-reveal · a keyed denylist for words that must never appear in customer copy (or, via the repo guard, in this repo).
 *
 * This file holds NO terms, NO digests and NO categories. It is a generic matcher. The list lives outside the repo:
 *   - NEVER_REVEAL_KEY      64 hex chars (32 random bytes), the HMAC-SHA256 key.
 *   - NEVER_REVEAL_DIGESTS  JSON: {"v":1,"output":[…],"copy":[…],"guard":[…],"sub":{"<len>":[…]},"allow":[{"files":"<regex>","d":[…]}]}
 *                           Each entry is the first 24 hex chars of HMAC-SHA256(key, normalizeTerm(term)).
 *                           "output" screens customer-facing rental output, "copy" is the same minus words that
 *                           collide with ordinary code tokens (for scanning source text), "guard" is what the repo guard rejects,
 *                           "sub" are terms that also match inside a longer token, "allow" are per-file exceptions
 *                           (each "files" pattern must compile on its own and be anchored ^…$, or the whole config is
 *                           invalid), "w" (optional, 2 to 8, default 3) is how many adjacent tokens are joined.
 * Both are server-only (Vercel Sensitive / GitHub Actions secrets), never NEXT_PUBLIC. Without the key a digest can't be
 * tested against a dictionary, so the list can't be recovered from the repo or from a leaked digest set alone.
 * The private terms file and scripts/never-reveal-gen.ts produce both values.
 *
 * When they are absent the matcher matches nothing; callers decide what that means (src/lib/rentals/index.ts fails
 * closed on a deployment, scripts/check-never-reveal.ts skips with a notice). Tests register synthetic configs with
 * their own random key through registerExtraNeverReveal.
 *
 * Pure JS (@noble/hashes), so it bundles anywhere, but only server code should ever see the env values.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export type Env = Record<string, string | undefined>;
export type NeverRevealScope = "output" | "copy" | "guard";
export type NeverRevealConfig = {
  key: Uint8Array;
  output: ReadonlySet<string>;
  copy: ReadonlySet<string>;
  guard: ReadonlySet<string>;
  sub: ReadonlyMap<number, ReadonlySet<string>>;
  allow: readonly { files: RegExp; d: ReadonlySet<string> }[];
  /** Longest run of adjacent tokens joined and tested (2 to 8). Covers 3+ word phrases and dotted names. */
  words: number;
};
export type NeverRevealStatus = "configured" | "unconfigured" | "invalid";

const DIGEST = /^[0-9a-f]{24}$/;
/** Allow-rule path patterns must start with ^ and end with an unescaped $. */
const ANCHORED = /^\^[\s\S]*[^\\]\$$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Joined-window default when the digest JSON has no "w" (security audit 2026-10-18, M1a: 3-word phrases). */
export const DEFAULT_WORDS = 3;
export const MAX_WORDS = 8;

/** Lowercase, keep letters, digits and dots (dots so an IPv4 stays one token), drop everything else. */
export function normalizeTerm(term: string): string {
  return term.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, "");
}

/** 24 hex (96 bits) of HMAC-SHA256(key, normalized term). */
export function digestTerm(key: Uint8Array, term: string): string {
  return bytesToHex(hmac(sha256, key, utf8ToBytes(normalizeTerm(term)))).slice(0, 24);
}

/** Tokens: an IPv4 address, or a run of letters/digits/underscores (underscores dropped, so snake_case stays one token). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /\d{1,3}(?:\.\d{1,3}){3}|[\p{L}\p{N}_]+/gu;
  for (const m of text.normalize("NFKC").toLowerCase().matchAll(re)) {
    const t = m[0].replace(/_/g, "");
    if (t) out.push(t);
  }
  return out;
}

/** Tokens with their start offset in the NFKC-lowercased text (line numbers are counted on that same string). */
export function tokenSpans(text: string): { norm: string; spans: { t: string; start: number }[] } {
  const norm = text.normalize("NFKC").toLowerCase();
  const spans: { t: string; start: number }[] = [];
  const re = /\d{1,3}(?:\.\d{1,3}){3}|[\p{L}\p{N}_]+/gu;
  for (const m of norm.matchAll(re)) {
    const t = m[0].replace(/_/g, "");
    if (t) spans.push({ t, start: m.index ?? 0 });
  }
  return { norm, spans };
}

/**
 * Every string to test at token i (security audit 2026-10-18, M1a): the token itself, then runs of 2..words adjacent
 * tokens joined plainly ("two words" → "twowords", a 3-word phrase → its normalized form) and with dots
 * ("host.example.com" split by the tokenizer → "host.example.com" again, matching a dotted term as normalized).
 */
export function windowsAt(toks: readonly string[], i: number, words: number): string[] {
  const out = [toks[i]];
  let plain = toks[i], dotted = toks[i];
  for (let k = 1; k < words && i + k < toks.length; k++) {
    plain += toks[i + k];
    dotted += "." + toks[i + k];
    out.push(plain, dotted);
  }
  return out;
}

type DigestJson = { v?: number; output?: unknown; copy?: unknown; guard?: unknown; sub?: unknown; allow?: unknown; w?: unknown };
const digestList = (x: unknown): string[] | null =>
  Array.isArray(x) && x.every((d) => typeof d === "string" && DIGEST.test(d)) ? (x as string[]) : null;

/** Parse a key + digest JSON pair. Null when either is malformed (never throws, never echoes the input). */
export function parseNeverReveal(keyHex: string | undefined, digestsJson: string | undefined): NeverRevealConfig | null {
  const k = (keyHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(k)) return null;
  let j: DigestJson;
  try { j = JSON.parse(digestsJson ?? ""); } catch { return null; }
  if (!j || typeof j !== "object" || j.v !== 1) return null;
  const output = digestList(j.output ?? []), copy = digestList(j.copy ?? []), guard = digestList(j.guard ?? []);
  if (!output || !copy || !guard) return null;
  const sub = new Map<number, ReadonlySet<string>>();
  if (j.sub !== undefined) {
    if (!j.sub || typeof j.sub !== "object") return null;
    for (const [len, ds] of Object.entries(j.sub as Record<string, unknown>)) {
      const n = Number(len), l = digestList(ds);
      if (!Number.isInteger(n) || n < 2 || !l) return null; // no upper cap: long terms can be sub terms too
      sub.set(n, new Set(l));
    }
  }
  const allow: { files: RegExp; d: ReadonlySet<string> }[] = [];
  if (j.allow !== undefined) {
    if (!Array.isArray(j.allow)) return null;
    for (const a of j.allow as { files?: unknown; d?: unknown }[]) {
      const l = digestList(a?.d);
      if (typeof a?.files !== "string" || !l) return null;
      // F3a: the pattern must compile ON ITS OWN first. Wrapped in ^(?:…)$ a broken pattern like "^a)|(b$" would
      // compile into something that matches far more than intended, so a pattern that throws alone is refused.
      try { new RegExp(a.files); } catch { return null; }
      // F3: anchored ^…$, then compiled inside ^(?:…)$ so a top-level alternation ("^a|b$") can't escape the anchors.
      if (!ANCHORED.test(a.files)) return null;
      try { allow.push({ files: new RegExp(`^(?:${a.files})$`), d: new Set(l) }); } catch { return null; }
    }
  }
  let words = DEFAULT_WORDS;
  if (j.w !== undefined) {
    if (typeof j.w !== "number" || !Number.isInteger(j.w) || j.w < 2 || j.w > MAX_WORDS) return null;
    words = j.w;
  }
  return { key: hexToBytes(k), output: new Set(output), copy: new Set(copy), guard: new Set(guard), sub, allow, words };
}

let cacheKey: string | null = null;
let cacheVal: NeverRevealConfig | null = null;
/** The production config from NEVER_REVEAL_KEY + NEVER_REVEAL_DIGESTS, or null when unset or malformed. */
export function neverRevealFromEnv(env: Env = typeof process !== "undefined" ? process.env : {}): NeverRevealConfig | null {
  const ck = `${env.NEVER_REVEAL_KEY ?? ""}\u0000${env.NEVER_REVEAL_DIGESTS ?? ""}`;
  if (ck !== cacheKey) { cacheKey = ck; cacheVal = parseNeverReveal(env.NEVER_REVEAL_KEY, env.NEVER_REVEAL_DIGESTS); }
  return cacheVal;
}
export function neverRevealStatus(env: Env = typeof process !== "undefined" ? process.env : {}): NeverRevealStatus {
  if (!env.NEVER_REVEAL_KEY && !env.NEVER_REVEAL_DIGESTS) return "unconfigured";
  return neverRevealFromEnv(env) ? "configured" : "invalid";
}

const extras: NeverRevealConfig[] = [];
/** Add a config alongside the env one (tests use this with a synthetic list and their own random key). */
export function registerExtraNeverReveal(cfg: NeverRevealConfig): void {
  if (!extras.includes(cfg)) extras.push(cfg);
}
export function clearExtraNeverReveal(): void { extras.length = 0; }

/** Every active config: the env one (if valid) plus registered extras. */
export function activeNeverReveal(env?: Env): NeverRevealConfig[] {
  const e = neverRevealFromEnv(env);
  return e ? [e, ...extras] : [...extras];
}

/**
 * Build a digest JSON for a key from plain term groups. Used by the private generator and by tests with synthetic
 * terms. It never ships terms anywhere: the caller decides where the output goes.
 */
export function buildNeverRevealDigests(key: Uint8Array, groups: {
  output?: string[]; copy?: string[]; guard?: string[]; sub?: string[]; allow?: { files: string; terms: string[] }[];
}): string {
  // A dotted non-IPv4 term (a domain, an email, a hostname) also gets its dot-free form, so it matches however the
  // text punctuates it (security audit 2026-10-18, M1a). IPv4 stays dotted: the tokenizer keeps it whole.
  const variants = (t: string) => {
    const n = normalizeTerm(t);
    return n.includes(".") && !IPV4.test(n) ? [t, n.replace(/\./g, "")] : [t];
  };
  const d = (ts: string[] = []) => [...new Set(ts.flatMap(variants).map((t) => digestTerm(key, t)))].sort();
  const all = [...(groups.output ?? []), ...(groups.copy ?? []), ...(groups.guard ?? []), ...(groups.allow ?? []).flatMap((a) => a.terms)];
  const w = Math.min(MAX_WORDS, Math.max(2, DEFAULT_WORDS, ...all.map((t) => tokenize(t).length)));
  const sub: Record<string, string[]> = {};
  for (const t of groups.sub ?? []) {
    const n = normalizeTerm(t).length;
    (sub[n] ??= []).push(digestTerm(key, t));
  }
  for (const n of Object.keys(sub)) sub[n] = [...new Set(sub[n])].sort();
  return JSON.stringify({ v: 1, output: d(groups.output), copy: d(groups.copy), guard: d(groups.guard), sub, allow: (groups.allow ?? []).map((a) => ({ files: a.files, d: d(a.terms) })), w });
}

export type NeverRevealHit = { index: number };

function hitIn(toks: string[], cfg: NeverRevealConfig, scopes: readonly NeverRevealScope[]): number {
  const sets = scopes.map((s) => cfg[s]);
  const has = (h: string) => sets.some((s) => s.has(h));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    for (const w of windowsAt(toks, i, cfg.words)) if (has(digestTerm(cfg.key, w))) return i;
    for (const [len, ds] of cfg.sub) {
      if (t.length <= len) continue;
      for (let j = 0; j + len <= t.length; j++) {
        const h = digestTerm(cfg.key, t.slice(j, j + len));
        if (ds.has(h) && has(h)) return i;
      }
    }
  }
  return -1;
}

/**
 * First never-reveal term in `text` for the given scope(s), or null. Checks every token, every run of up to
 * cfg.words adjacent tokens joined plainly and with dots (so "two words" written apart, 3-word phrases and dotted
 * names still match), and each "sub" window inside a longer token. Returns only the token
 * index, never the text or the digest.
 */
export function findNeverReveal(
  text: string, scopes: NeverRevealScope | readonly NeverRevealScope[] = "output", configs: readonly NeverRevealConfig[] = activeNeverReveal(),
): NeverRevealHit | null {
  if (!configs.length) return null;
  const sc = typeof scopes === "string" ? [scopes] : scopes;
  const toks = tokenize(text);
  for (const cfg of configs) {
    const i = hitIn(toks, cfg, sc);
    if (i >= 0) return { index: i };
  }
  return null;
}

export function containsNeverReveal(text: string, scopes?: NeverRevealScope | readonly NeverRevealScope[], configs?: readonly NeverRevealConfig[]): boolean {
  return findNeverReveal(text, scopes, configs) !== null;
}
