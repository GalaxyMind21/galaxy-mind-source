"use client";

// Share-this-vendor button on /v/[slug]. Drives the vendor flywheel:
// visitor finds a vendor → tweets about them → vendor sees their
// mention → RTs to their audience → those visitors hit Galaxy Mind.
//
// Tweet template per platform:
//   - X vendor: "@handle accepts Bitcoin · [vendor.description]
//      🇺🇸 galaxymind.space/v/slug"  (auto-mentions the vendor's
//      handle so they see it)
//   - Nostr / Lightning: vendor name in the tweet, no @ mention.
//
// Always uses the per-vendor URL so the OG card renders the right
// preview (not the homepage's directory card).

import { track } from "@vercel/analytics";
import {
  COUNTRIES,
  getPlatform,
  vendorSlug,
  type Vendor,
} from "@/lib/vendors";

const SITE_URL = "https://galaxymind.space";

export function ShareVendorButton({ vendor }: { vendor: Vendor }) {
  const platform = getPlatform(vendor);
  const flag = vendor.country ? COUNTRIES[vendor.country]?.flag ?? "" : "";
  const vendorUrl = `${SITE_URL}/v/${vendorSlug(vendor)}`;

  // Mention the vendor by X handle when applicable so the vendor
  // sees the tweet in their notifications. Nostr/Lightning vendors
  // get a name reference instead.
  const subject =
    platform === "x" ? `@${vendor.handle}` : vendor.name;

  // Cap description length so the full tweet fits comfortably under
  // the 280-char ceiling with all the framing.
  const desc =
    vendor.description.length > 130
      ? vendor.description.slice(0, 127) + "…"
      : vendor.description;

  const text = [
    `${subject} accepts Bitcoin${flag ? " " + flag : ""}`,
    "",
    desc,
    "",
    vendorUrl,
  ].join("\n");

  const composeUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text);

  return (
    <a
      href={composeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        track("vendor_share", {
          handle: vendor.handle,
          platform,
          surface: "vendor_page",
          category: vendor.category,
        })
      }
      className="micro-label inline-flex items-baseline gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] hover:lit-active transition-all"
    >
      ↗ Share this vendor
    </a>
  );
}
