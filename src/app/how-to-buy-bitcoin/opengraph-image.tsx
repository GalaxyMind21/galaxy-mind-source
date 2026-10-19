import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { BUY_GUIDE_OG_ALT } from "@/lib/buy-guide-copy";

export const runtime = "nodejs";
export const alt = BUY_GUIDE_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "For Beginners",
    title: "How to Buy Bitcoin",
    subtitle: "Start small, compare the total cost, move coins to your own wallet, and skip the scams.",
    footerTag: "Plus seven well-known bitcoin books →",
  });
}
