// KV keys for the submitter's one-shot outcome email (PII, 90-day TTL).
//
// Since 2026-10 the address is stored PER LISTING:
//   vendor-notify:<handle>:<slug>
// because one handle may submit several shops, and a second pending
// shop must not overwrite the first one's outcome address. Records
// written before the move live under the legacy per-handle key
//   vendor-notify:<handle>
// and every reader falls back to it, so in-flight submissions keep
// their outcome mail. A legacy record is only read when the new key is
// absent, and only the key that was actually read is deleted on send.

import { kvDel, kvGet } from "@/lib/kv";
import { vendorSlug } from "@/lib/vendors";

export const NOTIFY_TTL_SECONDS = 90 * 24 * 60 * 60;

export function vendorNotifyKey(handle: string, name: string): string {
  return `vendor-notify:${handle}:${vendorSlug({ name })}`;
}

export function legacyVendorNotifyKey(handle: string): string {
  return `vendor-notify:${handle}`;
}

export type NotifyAddress = { email: string; key: string };

/**
 * Read the outcome address for one listing: per-listing key first,
 * then the legacy per-handle key. Throws only if KV itself throws
 * (callers already handle that); null when neither key holds a string.
 */
export async function readVendorNotify(
  handle: string,
  name: string,
): Promise<NotifyAddress | null> {
  const key = vendorNotifyKey(handle, name);
  const email = await kvGet<string>(key);
  if (typeof email === "string" && email) return { email, key };
  const legacy = legacyVendorNotifyKey(handle);
  const old = await kvGet<string>(legacy);
  if (typeof old === "string" && old) return { email: old, key: legacy };
  return null;
}

/** Delete exactly the key a read returned (one-shot send). */
export async function clearVendorNotify(addr: NotifyAddress): Promise<void> {
  await kvDel(addr.key);
}
