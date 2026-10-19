// /submit share card (competitor teardown lesson A7, 2026-10-18). Sellers
// get their own card instead of the shopper-facing directory card.
import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { SUBMIT_OG_ALT } from "@/lib/og";

export const runtime = "nodejs";
export const alt = SUBMIT_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "For Shops",
    title: "List your shop free",
    subtitle: "Get found by people who want to spend bitcoin. No listing fees, no paid placement, no affiliate cut.",
    footerTag: "A person reviews every shop →",
  });
}
