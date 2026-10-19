"use client";

/* =====================================================================
 * DomMutationGuard · installs lib/dom-mutation-guard on Node.prototype.
 *
 * The install runs at MODULE EVALUATION, not inside a hook: client
 * modules are evaluated before React hydrates the tree that imports
 * them, so the guard is in place before the first re-render a
 * translated page could crash. Renders nothing.
 *
 * In development a recovered call logs a warning, so a genuine bug in
 * our own DOM handling stays visible locally instead of being quietly
 * absorbed. Production stays silent: the page keeps working, and
 * client_error going quiet for the removeChild / insertBefore messages
 * is the measurement.
 * ===================================================================== */

import { installDomMutationGuard } from "@/lib/dom-mutation-guard";

if (typeof window !== "undefined" && typeof Node === "function") {
  installDomMutationGuard(
    Node.prototype,
    process.env.NODE_ENV === "production"
      ? undefined
      : (op) => console.warn(`[dom-mutation-guard] recovered a foreign ${op}`),
  );
}

export function DomMutationGuard() {
  return null;
}
