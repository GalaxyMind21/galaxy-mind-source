// Network half of the multi-shop ownership proof (pure half:
// lib/vendor-dedupe). Runs at intake ONLY for a submission whose
// identity already owns a live listing, after every validation gate, so
// junk never pays for it. Every request goes through safeFetch (the
// website is user-submitted) with a hard timeout and byte cap. A fetch
// failure is recorded as ok:false · fail-VISIBLE, the reviewer falls
// back to a DM.

import { readCappedJson, safeFetch } from "@/lib/safe-fetch";
import type { VendorPlatform } from "@/lib/vendors";
import {
  nostrJsonNamesPubkey,
  pageLinksToIdentity,
  type OwnershipCheck,
} from "@/lib/vendor-dedupe";

// Backlinks live in headers/footers; a TRUNCATED read is fine (unlike
// JSON, partial HTML is still searchable), so oversize pages are cut,
// not dropped.
const PAGE_MAX_BYTES = 1024 * 1024;

async function readHead(res: Response, maxBytes: number): Promise<string> {
  const stream = res.body;
  if (!stream) {
    try {
      return (await res.text()).slice(0, maxBytes);
    } catch {
      return "";
    }
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const take = value.subarray(0, Math.max(0, maxBytes - total));
      chunks.push(take);
      total += take.length;
    }
  } catch {
    /* keep what we have */
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}
const TIMEOUT_MS = 6_000;
const UA = "GalaxyMindBot/1.0 (+https://galaxymind.space/submit)";

export async function checkOwnership(opts: {
  website: string;
  handle: string;
  platform?: VendorPlatform;
  pubkeyHex?: string | null;
  now?: number;
}): Promise<OwnershipCheck> {
  const checkedAt = opts.now ?? Math.floor(Date.now() / 1000);
  const platform = opts.platform ?? "x";

  // nostr.json first for Nostr identities: a domain naming the pubkey is
  // the stronger proof and a tiny JSON read.
  if (platform === "nostr" && opts.pubkeyHex) {
    try {
      const origin = new URL(opts.website).origin;
      const res = await safeFetch(`${origin}/.well-known/nostr.json`, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": UA, accept: "application/json" },
      });
      if (res && res.ok) {
        const json = await readCappedJson(res);
        if (nostrJsonNamesPubkey(json, opts.pubkeyHex)) {
          return {
            checkedAt,
            ok: true,
            method: "nostr-json",
            detail: `${origin}/.well-known/nostr.json names the handle's pubkey`,
          };
        }
      }
    } catch {
      /* fall through to the backlink check */
    }
  }

  try {
    const res = await safeFetch(opts.website, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    if (!res) {
      return { checkedAt, ok: false, detail: "site could not be fetched · confirm by DM" };
    }
    const html = await readHead(res, PAGE_MAX_BYTES);
    if (
      pageLinksToIdentity(html, {
        handle: opts.handle,
        platform,
        pubkeyHex: opts.pubkeyHex,
      })
    ) {
      return {
        checkedAt,
        ok: true,
        method: "backlink",
        detail: "the site links back to the handle's profile",
      };
    }
    return {
      checkedAt,
      ok: false,
      detail: "no backlink to the handle's profile found on the site · confirm by DM",
    };
  } catch {
    return { checkedAt, ok: false, detail: "site check failed · confirm by DM" };
  }
}
