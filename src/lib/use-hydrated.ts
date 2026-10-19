// True only after hydration on the client; false during SSR and the
// hydration render, so client-only UI can be left out of the server HTML
// without a hydration mismatch. No effect, no extra render pass.
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
