/**
 * vendor-probes · shared per-platform liveness/activity checks.
 *
 * Extracted from scripts/audit-vendors.ts (2026-07-11) so the
 * re-verification sweep tool (scripts/reverify-vendors.ts) can run the
 * SAME probes without a second copy. Lives under scripts/lib/ (not
 * src/lib/) on purpose: these are operator-CLI utilities that must stay
 * runnable via `npx tsx` without a built Next.js app.
 *
 * TODO(consolidate): the bech32 + relay-query utilities here are still
 * duplicated in src/lib/nostr-activity.ts (used by the
 * audit-vendor-activity cron). Future refactor: have this module import
 * from the lib once the lib has been battle-tested in production.
 *
 * What it checks per vendor:
 *
 *   X vendors:
 *     1. Profile URL (https://x.com/handle) returns 200 · catches
 *        suspended/deleted accounts.
 *     2. Activity is NOT automatable (no reliable public API) — X
 *        vendors always need a manual timeline spot-check.
 *
 *   Nostr vendors (npub / nprofile / NIP-05):
 *     1. NIP-05 lookup if applicable · confirms name@domain still
 *        resolves to the right pubkey.
 *     2. Query a small set of relays for the most recent kind:1 event
 *        from the vendor's pubkey · gives last-post timestamp.
 *
 *   Lightning vendors:
 *     1. LNURL-pay endpoint (/.well-known/lnurlp/name) returns a
 *        valid payRequest object · confirms address is alive.
 *
 * None of these functions ever modifies vendors.ts · they only report.
 * Set AUDIT_OFFLINE=1 to skip all network calls and just exercise the
 * calling script's plumbing.
 */
import { getPlatform, type Vendor } from "../../src/lib/vendors";
// Signature-verified kind:0 fetch + LN comparison for the lud16
// drift check (2026-07-23) · imported rather than re-implemented so
// the drift probe inherits the BIP-340 verify + the exact-match
// discipline the submit-time guard uses.
import { fetchNostrProfileMetadata } from "../../src/lib/nostr-activity";
import { lnAddressesMatch } from "../../src/lib/ln-guard";
import { readCappedJson, safeFetch } from "../../src/lib/safe-fetch";

export const STALE_ACTIVITY_DAYS = 90;
export const FETCH_TIMEOUT_MS = 5_000;
export const PARALLEL_BATCH_SIZE = 8;
const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];
const SECS_PER_DAY = 86_400;

export type AuditStatus = "alive" | "stale_active" | "unknown" | "gone";

export type AuditResult = {
  handle: string;
  name: string;
  platform: string;
  status: AuditStatus;
  liveness: { ok: boolean; detail: string };
  activity?: {
    lastActivityAt: number | null; // unix seconds
    daysSince: number | null;
    detail: string;
  };
  notes: string[];
};

export const offline =
  process.env.AUDIT_OFFLINE === "1" || process.env.AUDIT_OFFLINE === "true";

// ─────────────────────────────────────────────────────────────────
// Inline bech32 decoder (BIP-173 / NIP-19)
//
// Just enough of the spec to extract the pubkey from npub1... or
// nprofile1... handles. We don't need full encode capability; only
// the data-payload bytes. ~70 lines of pure JS · avoids pulling in
// @noble/secp256k1 or nostr-tools just for this.
//
// References:
//   https://github.com/sipa/bech32/blob/master/ref/javascript/bech32.js
//   https://github.com/nostr-protocol/nips/blob/master/19.md
// ─────────────────────────────────────────────────────────────────
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Decode(s: string): { hrp: string; data: number[] } | null {
  s = s.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) return null;
  const hrp = s.slice(0, sep);
  const dataChars = s.slice(sep + 1);
  const data: number[] = [];
  for (const c of dataChars) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return null;
    data.push(v);
  }
  // Skip checksum verification · we trust the source. The 6 trailing
  // 5-bit values are the checksum; drop them to get the payload.
  return { hrp, data: data.slice(0, -6) };
}

// Convert 5-bit groups (bech32 native) to 8-bit bytes.
function from5to8(data: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const v of data) {
    if (v < 0 || v >> 5 !== 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) {
    // Not strictly valid · NIP-19 forms should always pad cleanly.
    // We accept the leading bytes anyway; only the first 32 matter
    // for pubkey extraction.
  }
  return new Uint8Array(out);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Extract a hex pubkey from an npub1... or nprofile1... handle.
 *
 * - npub1: payload IS the 32-byte pubkey · take it directly.
 * - nprofile1: TLV-encoded (type, length, value)+. Type 0 = pubkey
 *   (always present, always first per spec). We grab the first
 *   type-0 record's value.
 *
 * Returns null on any decode failure (corrupt handle, wrong hrp,
 * unexpected TLV layout).
 */
function decodeNostrBech32ToPubkey(handle: string): string | null {
  const decoded = bech32Decode(handle);
  if (!decoded) return null;
  const bytes = from5to8(decoded.data);
  if (!bytes) return null;

  if (decoded.hrp === "npub") {
    if (bytes.length < 32) return null;
    return bytesToHex(bytes.slice(0, 32));
  }
  if (decoded.hrp === "nprofile") {
    // Walk TLVs · format is repeating (1-byte type, 1-byte length,
    // length bytes of value). Type 0 = pubkey (32 bytes).
    let i = 0;
    while (i + 2 <= bytes.length) {
      const type = bytes[i];
      const len = bytes[i + 1];
      const valStart = i + 2;
      if (valStart + len > bytes.length) return null;
      if (type === 0 && len === 32) {
        return bytesToHex(bytes.slice(valStart, valStart + len));
      }
      i = valStart + len;
    }
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Per-platform check implementations
// ─────────────────────────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (offline) return null;
  try {
    // safeFetch re-checks every redirect. A listed NIP-05 or Lightning
    // domain that 302s to loopback or the metadata IP must not be
    // requested from the operator's machine. x.com and unavatar ride
    // the same helper; both are https on 443.
    return await safeFetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "GalaxyMindAuditBot/1.0",
        ...init?.headers,
      },
    });
  } catch {
    return null;
  }
}

// unavatar.io free tier allows ~25 req/IP/day (shared with
// scripts/snapshot-avatars.ts) · once a probe 429s, stop burning the
// window on the rest of the sweep. Best-effort under the parallel
// batches — a few in-flight probes may still fire after the flag
// flips, which only costs already-spent quota.
let unavatarQuotaExhausted = false;

async function checkXVendor(v: Vendor): Promise<AuditResult> {
  const result: AuditResult = {
    handle: v.handle,
    name: v.name,
    platform: "X",
    status: "unknown",
    liveness: { ok: false, detail: "not checked" },
    notes: [],
  };

  // Liveness · HTTP 200 from the profile URL means the account
  // exists and isn't suspended. X returns 404 for deleted/suspended.
  const profileUrl = `https://x.com/${v.handle}`;
  const r = await fetchWithTimeout(profileUrl, { method: "HEAD" });
  if (r === null) {
    result.liveness = { ok: false, detail: "fetch failed (timeout/network)" };
    result.notes.push("manual check needed");
  } else if (r.status === 200) {
    result.liveness = { ok: true, detail: "profile responds 200" };
  } else if (r.status === 404 || r.status === 410) {
    result.liveness = { ok: false, detail: `profile ${r.status} · likely removed` };
    result.status = "gone";
    return result;
  } else if (r.status === 403) {
    // X often returns 403 for protected/locked accounts · the
    // account exists but isn't publicly viewable. Treat as alive.
    result.liveness = {
      ok: true,
      detail: "profile 403 · likely protected/locked, still exists",
    };
    result.notes.push("account is protected, can't verify activity");
  } else {
    result.liveness = { ok: false, detail: `profile ${r.status}` };
    result.notes.push("unusual status code · manual check");
  }

  // Avatar-resolvability probe · unavatar.io/x/<handle>?fallback=false
  // 404s when X has no such account (dead / suspended / renamed) — a
  // cheap secondary liveness heuristic that keeps working when x.com
  // bot-walls the HEAD above. It can't upgrade a vendor to "gone" on
  // its own (an avatar-less-but-live account is conceivable), so a
  // 404 lands as a loud note for the operator's spot-check instead.
  // This is also the ONLY remaining unavatar dependency once
  // scripts/snapshot-avatars.ts has localized the render path.
  if (!unavatarQuotaExhausted) {
    const a = await fetchWithTimeout(
      `https://unavatar.io/x/${encodeURIComponent(v.handle)}?fallback=false`,
    );
    if (a === null) {
      // offline mode or network failure · no signal either way
    } else if (
      a.status === 429 ||
      // Observed live: unavatar 403s (not only 429s) once the free-
      // tier window is spent · the remaining header disambiguates
      // from a genuine forbidden.
      (a.status === 403 && a.headers.get("x-rate-limit-remaining") === "0")
    ) {
      unavatarQuotaExhausted = true;
      result.notes.push("unavatar quota exhausted · avatar probe skipped");
    } else if (a.status === 404) {
      result.notes.push(
        "⚠ unavatar 404 · avatar unresolvable · handle may be dead/renamed",
      );
      if (!result.liveness.ok) {
        result.liveness.detail += " · unavatar 404 corroborates";
      }
    } else if (a.ok) {
      // Avatar resolves · the account exists even if x.com wouldn't
      // tell us above.
      if (!result.liveness.ok) {
        result.liveness = {
          ok: true,
          detail: `${result.liveness.detail} · but avatar resolves via unavatar`,
        };
      }
    }
  } else {
    result.notes.push("unavatar quota exhausted · avatar probe skipped");
  }

  // Activity · for X we can confirm liveness but NOT activity
  // reliably. The X API costs money; the various unofficial
  // syndication endpoints have been shut down or break weekly. So
  // the honest answer is: profile alive = good signal, no
  // automated activity claim. The script flags X vendors that
  // pass liveness as "alive (manual activity check)" so the
  // operator knows to spot-check the timeline.
  result.activity = {
    lastActivityAt: null,
    daysSince: null,
    detail: "X activity check requires manual review (no reliable public API)",
  };
  if (result.liveness.ok) {
    result.status = "alive";
    result.notes.push(`spot-check: https://x.com/${v.handle}`);
  }
  return result;
}

async function checkNostrVendor(v: Vendor): Promise<AuditResult> {
  const result: AuditResult = {
    handle: v.handle,
    name: v.name,
    platform: "Nostr",
    status: "unknown",
    liveness: { ok: true, detail: "Nostr accounts don't 'go away'" },
    notes: [],
  };

  // Resolve to a hex pubkey · NIP-05, npub1..., or nprofile1...
  let pubkeyHex: string | null = null;
  if (v.handle.includes("@")) {
    // NIP-05 form · fetch /.well-known/nostr.json?name=NAME from the
    // domain. Confirms the address still resolves AND gives us the
    // current hex pubkey.
    const [name, domain] = v.handle.split("@");
    const r = await fetchWithTimeout(
      `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
    );
    if (r && r.ok) {
      try {
        const data = (await readCappedJson(r)) as {
          names?: Record<string, string>;
        } | null;
        if (!data) {
          result.liveness = { ok: false, detail: "NIP-05 JSON parse failed" };
          return result;
        }
        pubkeyHex = data.names?.[name] ?? null;
        if (pubkeyHex) {
          result.notes.push(`NIP-05 resolves to pubkey ${pubkeyHex.slice(0, 12)}…`);
        } else {
          result.liveness = {
            ok: false,
            detail: `NIP-05 endpoint live but no entry for "${name}"`,
          };
          result.status = "gone";
          return result;
        }
      } catch {
        result.liveness = { ok: false, detail: "NIP-05 JSON parse failed" };
        return result;
      }
    } else {
      result.liveness = {
        ok: false,
        detail: `NIP-05 endpoint at ${domain} unreachable`,
      };
      result.notes.push("manual check needed");
      return result;
    }
  } else if (v.handle.startsWith("npub1") || v.handle.startsWith("nprofile1")) {
    // Decode bech32 inline · npub1 contains the raw pubkey (32 bytes),
    // nprofile1 is TLV-wrapped with a leading type=0 tag (32-byte
    // pubkey) followed by optional relay hints we don't need.
    pubkeyHex = decodeNostrBech32ToPubkey(v.handle);
    if (pubkeyHex) {
      result.notes.push(`bech32 decoded to pubkey ${pubkeyHex.slice(0, 12)}…`);
    } else {
      result.notes.push("bech32 decode failed · check handle format");
      return result;
    }
  }

  if (!pubkeyHex || offline) return result;

  // Activity · query relays for the most recent kind:1 event from
  // this pubkey. We use a brief-lived WebSocket per relay, request
  // limit=1 sorted by created_at descending. First relay to respond
  // wins; we close all sockets after MAX_WAIT_MS.
  const lastEventAt = await fetchLastNostrEvent(pubkeyHex);
  if (lastEventAt !== null) {
    const days = Math.floor((Date.now() / 1000 - lastEventAt) / SECS_PER_DAY);
    result.activity = {
      lastActivityAt: lastEventAt,
      daysSince: days,
      detail: `last note ${days}d ago`,
    };
    result.status = days <= STALE_ACTIVITY_DAYS ? "alive" : "stale_active";
  } else {
    result.activity = {
      lastActivityAt: null,
      daysSince: null,
      detail: "no kind:1 events found across queried relays",
    };
    result.status = "unknown";
  }

  // lud16 drift check (2026-07-23 · lib/ln-guard). The listed
  // lightningAddress was reconciled against the signed kind:0 at
  // ADD time, but kind:0 is mutable — a later divergence means the
  // vendor rotated wallets (needs a re-confirm + vendors.ts bump)
  // or the key/listing is compromised (the fund-diversion attack,
  // post-listing edition). Report-only, like every probe here:
  // drift is a HUMAN decision, auto-updating would turn a key
  // compromise into an auto-divert.
  if (v.lightningAddress) {
    const profile = await fetchNostrProfileMetadata(pubkeyHex).catch(
      () => null,
    );
    const lud16 = profile?.lud16?.trim() ?? "";
    if (!profile) {
      result.notes.push(
        "lud16 drift check SKIPPED · profile fetch failed (fail-visible, re-run)",
      );
    } else if (!lud16) {
      result.notes.push(
        `listed LN ${v.lightningAddress} · signed profile carries no lud16 (unanchored, as at add time)`,
      );
    } else if (!lnAddressesMatch(v.lightningAddress, lud16)) {
      result.notes.push(
        `⚠ lud16 DRIFT · listed ${v.lightningAddress} but signed profile now says ${lud16} · confirm with the key holder (wallet rotation vs compromise) before touching vendors.ts`,
      );
    } else {
      result.notes.push("lud16 matches signed profile ✓");
    }
  }
  return result;
}

async function fetchLastNostrEvent(pubkeyHex: string): Promise<number | null> {
  if (offline) return null;
  // Query each relay in parallel; first valid response wins.
  // Each relay socket has a 5s budget · the racing pattern means
  // the slowest relay doesn't gate us.
  const promises = NOSTR_RELAYS.map((url) =>
    queryRelayForLastEvent(url, pubkeyHex),
  );
  const settled = await Promise.allSettled(promises);
  let latest: number | null = null;
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value !== null) {
      if (latest === null || s.value > latest) latest = s.value;
    }
  }
  return latest;
}

function queryRelayForLastEvent(
  url: string,
  pubkeyHex: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v: number | null) => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(v);
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(null);
      return;
    }
    const subId = "audit-" + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => done(null), FETCH_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      // REQ <subId> <filter>  · NIP-01 standard wire format
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          { authors: [pubkeyHex], kinds: [1], limit: 1 },
        ]),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
          const ev = data[2] as { created_at?: number };
          if (typeof ev?.created_at === "number") {
            clearTimeout(timeout);
            done(ev.created_at);
            return;
          }
        }
        if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timeout);
          done(null);
        }
      } catch {
        // Not JSON or not what we expected · keep waiting until timeout.
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      done(null);
    });
  });
}

async function checkLightningVendor(v: Vendor): Promise<AuditResult> {
  const result: AuditResult = {
    handle: v.handle,
    name: v.name,
    platform: "Lightning",
    status: "unknown",
    liveness: { ok: false, detail: "not checked" },
    notes: [],
  };

  const [name, domain] = v.handle.split("@");
  if (!name || !domain) {
    result.liveness = { ok: false, detail: "handle isn't a valid LN address" };
    result.status = "gone";
    return result;
  }

  // LNURL-pay endpoint · returns a JSON object with tag:"payRequest"
  // when the address is wired up. 404 means the wallet/service has
  // dropped it. Other status codes get manual-check flag.
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  const r = await fetchWithTimeout(url);
  if (r === null) {
    result.liveness = { ok: false, detail: "LNURL-pay endpoint unreachable" };
    result.notes.push("manual check needed");
    return result;
  }
  if (r.status === 404) {
    result.liveness = {
      ok: false,
      detail: "LNURL-pay 404 · address has been removed",
    };
    result.status = "gone";
    return result;
  }
  if (!r.ok) {
    result.liveness = { ok: false, detail: `LNURL-pay ${r.status}` };
    result.notes.push("manual check needed");
    return result;
  }
  try {
    const data = (await readCappedJson(r)) as {
      tag?: string;
      callback?: string;
      maxSendable?: number;
      minSendable?: number;
      metadata?: string;
    } | null;
    if (!data) {
      result.liveness = { ok: false, detail: "LNURL-pay JSON parse failed" };
      return result;
    }
    if (data.tag === "payRequest") {
      result.liveness = { ok: true, detail: "LNURL-pay returns valid payRequest" };
      result.status = "alive"; // Lightning addresses don't have "activity"
      // Optional enrichment · pull the description out of the metadata
      // tuple if it's there. Format: [["text/plain", "description"], ...].
      try {
        const md = data.metadata ? JSON.parse(data.metadata) : null;
        if (Array.isArray(md)) {
          const desc = md.find(
            (e): e is [string, string] =>
              Array.isArray(e) && e[0] === "text/plain",
          );
          if (desc) {
            result.notes.push(`LN description: "${desc[1].slice(0, 80)}"`);
          }
        }
      } catch {
        // Metadata parse failed · skip the enrichment, keep liveness.
      }
    } else {
      result.liveness = {
        ok: false,
        detail: `LNURL-pay returned tag="${data?.tag}" (expected payRequest)`,
      };
      result.notes.push("endpoint live but not a pay address");
    }
  } catch {
    result.liveness = { ok: false, detail: "LNURL-pay JSON parse failed" };
  }
  return result;
}

/** Route a vendor to its platform-specific probe. */
export async function auditOne(v: Vendor): Promise<AuditResult> {
  const platform = getPlatform(v);
  if (platform === "x") return checkXVendor(v);
  if (platform === "nostr") return checkNostrVendor(v);
  if (platform === "lightning") return checkLightningVendor(v);
  return {
    handle: v.handle,
    name: v.name,
    platform: "unknown",
    status: "unknown",
    liveness: { ok: false, detail: "unknown platform" },
    notes: [],
  };
}
