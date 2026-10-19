"use client";

import type { AnchorHTMLAttributes } from "react";
import { track } from "@vercel/analytics";

/**
 * Plain anchor that fires one analytics event on click, for server-rendered
 * pages whose CTAs would otherwise be unmeasurable. Built for the /hashrate
 * rent buttons — the revenue funnel's last on-site step had zero
 * instrumentation while SupportModal's rent link was already tracked.
 */
export function TrackedLink({
  event,
  data,
  children,
  ...props
}: {
  event: string;
  data?: Record<string, string | number | boolean>;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      onClick={(e) => {
        track(event, data);
        props.onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
