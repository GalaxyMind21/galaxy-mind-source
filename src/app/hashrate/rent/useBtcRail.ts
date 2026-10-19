"use client";
// Rail picker state for the Pay step (USDC | Bitcoin). Self-contained so the checkout only needs a few lines.
// Bitcoin shows only when the server offers it (CheckoutView.btc, flag + healthy payment agent), or when this
// device already committed this order to Bitcoin (an address was shown: from then on the order is Bitcoin-only).
import { useCallback, useEffect, useState } from "react";

const KEY = (rid: string) => `gm-btc:${rid}`;
export function btcMarked(rid: string | null | undefined): boolean {
  if (!rid) return false;
  try { return localStorage.getItem(KEY(rid)) === "1"; } catch { return false; }
}
export function markBtc(rid: string) { try { localStorage.setItem(KEY(rid), "1"); } catch { /* ignore */ } }
export function clearBtc(rid: string) { try { localStorage.removeItem(KEY(rid)); } catch { /* ignore */ } }

export type Rail = "usdc" | "btc";
export function useBtcRail(order: { rentalId: string; creatorSecret: string } | null, offered: boolean) {
  const rid = order?.rentalId ?? null;
  const [rail, setRailState] = useState<Rail>("usdc");
  const [committed, setCommitted] = useState(false);
  useEffect(() => {
    if (!rid) { setRailState("usdc"); setCommitted(false); return; }
    if (btcMarked(rid)) { setRailState("btc"); setCommitted(true); return; }
    setRailState("usdc"); setCommitted(false);
    if (!offered || !order) return;
    // A binding made earlier for this order (e.g. the tab was closed mid-checkout): pick it back up.
    let live = true;
    void fetch("/api/rentals/btc/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rental_id: rid, creator_secret: order.creatorSecret }) })
      .then(async (r) => (r.ok ? ((await r.json().catch(() => null)) as { state?: string } | null) : null))
      .then((b) => { if (live && b?.state && b.state !== "unavailable" && b.state !== "attesting") { markBtc(rid); setRailState("btc"); setCommitted(true); } })
      .catch(() => { /* ignore */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, offered]);
  const setRail = useCallback((r: Rail) => { if (!committed) setRailState(r); }, [committed]);
  const commit = useCallback(() => { if (rid) markBtc(rid); setCommitted(true); setRailState("btc"); }, [rid]);
  return { rail, setRail, committed, commit, showPicker: offered && !committed, active: rail === "btc" && (offered || committed) };
}
