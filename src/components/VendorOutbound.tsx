"use client";

/**
 * Primary shop outbound on /v/[slug].
 *
 * Merchant https only · new tab for third-party shops · same-origin
 * house shop (https://galaxymind.space/hashrate) stays in this tab so
 * the listing does not open a second copy of our own page.
 *
 * Third-party shops keep `noopener noreferrer` (no referrer leaks)
 * but get a plain `utm_source=galaxymind.space` tag, so listed shops
 * can actually see directory traffic in their own analytics. No tracking IDs, no affiliate params; an existing
 * utm_source on the listed URL is left alone.
 *
 * `dest` says which control carried the visitor out: "website" for the
 * Visit shop button, "shelf" for the shop's own storefront picture on
 * /v/[slug]. Same event either way, so the listing → shop count stays one
 * number and the split shows which control earns the click.
 */
import type { ReactNode } from "react";
import { track } from "@vercel/analytics";
import { isSafeHttpsHref } from "@/lib/outbound-url";

const SITE = "https://galaxymind.space";

function withSource(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has("utm_source")) {
      url.searchParams.set("utm_source", "galaxymind.space");
    }
    return url.toString();
  } catch {
    return href;
  }
}

export function VendorOutbound({
  href,
  slug,
  className,
  dest = "website",
  surface,
  children = "Visit shop",
}: {
  href: string;
  slug: string;
  className?: string;
  dest?: "website" | "shelf";
  /** Where the control lives, e.g. "vendor_modal". Omitted on /v so the
   *  existing event shape there is unchanged. */
  surface?: string;
  children?: ReactNode;
}) {
  if (!isSafeHttpsHref(href)) return null;
  const sameOrigin =
    href === `${SITE}/hashrate` || href.startsWith(`${SITE}/`);
  return (
    <a
      href={sameOrigin ? href : withSource(href)}
      target={sameOrigin ? undefined : "_blank"}
      rel={sameOrigin ? undefined : "noopener noreferrer"}
      onClick={() => track("vendor_outbound", { slug, dest, ...(surface ? { surface } : {}) })}
      className={className}
    >
      {children}
    </a>
  );
}
