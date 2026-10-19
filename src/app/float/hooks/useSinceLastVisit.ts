"use client";

import { useEffect, useRef, useState } from "react";
import {
  computeSinceLastVisit,
  readLastView,
  writeLastView,
} from "@/lib/float-urgency";

/**
 * Mechanic A. On mount, compares the persisted last-view snapshot to
 * the current float and returns { deltaBTC } when the spec thresholds
 * are met (≥6h, ≥1 BTC), else null. Writes a fresh baseline ~4s after
 * mount so a same-session refresh doesn't reset the baseline before
 * the visitor has seen the callout. localStorage only · no server.
 */
export function useSinceLastVisit(
  currentInPlayBTC: number,
): { deltaBTC: number } | null {
  const [result, setResult] = useState<{ deltaBTC: number } | null>(null);
  const wrote = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    const storage = window.localStorage;
    const prev = readLastView(storage);
    setResult(computeSinceLastVisit(prev, currentInPlayBTC, Date.now()));

    const id = window.setTimeout(() => {
      if (wrote.current) return;
      wrote.current = true;
      writeLastView(storage, { ts: Date.now(), inPlayBTC: currentInPlayBTC });
    }, 4_000);

    return () => window.clearTimeout(id);
  }, [currentInPlayBTC]);

  return result;
}
