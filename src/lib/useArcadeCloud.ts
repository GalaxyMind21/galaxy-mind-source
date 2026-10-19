"use client";

/**
 * Cross-device cloud save for one React cabinet (X-linked players only ·
 * 2026-07-18). The React analog of Bitcoin Kart's cloudSyncNow/queueCloudPush.
 *
 *   const pushCloud = useArcadeCloud("wen", readLocal, adoptMerged);
 *
 * `readLocal()` returns the game's current DURABLE save (records/unlocks/
 * stats only — never date-specific day-state or board outboxes). On mount,
 * if the viewer's X account is linked, the hook boot-pulls the cloud save
 * and hands it to `adoptMerged`, which writes it back into localStorage +
 * React state via a per-key best-of (never a wholesale replace, so progress
 * earned during the round-trip can't be clobbered). Call the returned
 * `pushCloud()` after a run to upload+re-adopt (debounced 1.5s).
 *
 * Everything degrades to a silent no-op for anonymous / X-unconfigured /
 * offline players — byte-identical to the pre-cloud local-only behaviour.
 * The server also fail-closes on the gm_xs session, so the client link
 * check is just an optimization that avoids a pointless POST.
 */

import { useCallback, useEffect, useRef } from "react";
import { fetchIdentity, cloudSync } from "./arcade";

export function useArcadeCloud<T>(
  game: string,
  readLocal: () => T,
  adoptMerged: (merged: T) => void,
): () => void {
  // keep the latest closures without re-running the mount effect
  const readRef = useRef(readLocal);
  const adoptRef = useRef(adoptMerged);
  readRef.current = readLocal;
  adoptRef.current = adoptMerged;

  const linkedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const sync = useCallback(() => {
    void cloudSync(game, readRef.current()).then((merged) => {
      if (aliveRef.current && merged) adoptRef.current(merged as T);
    });
  }, [game]);

  useEffect(() => {
    aliveRef.current = true;
    void fetchIdentity().then((id) => {
      if (!aliveRef.current || !id.linked) return;
      linkedRef.current = true;
      sync(); // boot pull: download the cloud save onto this device
    });
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sync]);

  // debounced push · call after a run persists new progress
  return useCallback(() => {
    if (!linkedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      sync();
    }, 1500);
  }, [sync]);
}
