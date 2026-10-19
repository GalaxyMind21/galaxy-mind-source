"use client";
// Renders its children everywhere except under the given path prefixes. Used by the server-rendered SiteFooter to
// keep the rent button off pages where it does not belong (the /spend-bitcoin-in guides, security review 2026-10-18).
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function HideOnPaths({ prefixes, children }: { prefixes: readonly string[]; children: ReactNode }) {
  const path = usePathname() ?? "";
  if (prefixes.some((p) => path === p || path.startsWith(p + "/"))) return null;
  return <>{children}</>;
}
