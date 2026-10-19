/**
 * Public tip height (P5): server-side, tip endpoint ONLY (never an address, txid or scripthash), 3 s timeout,
 * 60 s cache. Used ONLY to pause: hide BTC for new picks, or refuse a FIRST display, when the agent's tip is more
 * than 2 blocks BEHIND the public tip. Agent ahead of public is fine. Never used for crediting, confirmations or paid.
 * Both sources down -> null: new picks are hidden; first display is not blocked by it.
 */
export const TIP_TIMEOUT_MS = 3000;
export const TIP_CACHE_MS = 60_000;
export const MAX_BEHIND_BLOCKS = 2;

let cache: { key: string; at: number; h: number | null } | null = null;
export function resetTipCache() { cache = null; }

export async function publicTip(urls: readonly string[], now: number = Date.now(), f: typeof fetch = fetch): Promise<number | null> {
  const key = urls.join("|");
  if (cache && cache.key === key && now - cache.at < TIP_CACHE_MS) return cache.h;
  let h: number | null = null;
  for (const u of urls) {
    try {
      const r = await f(u, { signal: AbortSignal.timeout(TIP_TIMEOUT_MS), cache: "no-store", headers: { accept: "text/plain" } } as RequestInit);
      if (!r.ok) continue;
      const t = (await r.text()).trim();
      if (/^[0-9]{1,8}$/.test(t)) { h = Number(t); break; }
    } catch { /* next source */ }
  }
  cache = { key, at: now, h };
  return h;
}
/** true = the agent tip is more than 2 blocks behind the public tip (pause). Unknown public tip = not behind. */
export const agentBehind = (agentTip: number, publicTipH: number | null) => publicTipH != null && publicTipH - agentTip > MAX_BEHIND_BLOCKS;
