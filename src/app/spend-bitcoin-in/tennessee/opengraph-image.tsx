import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { TN_OG_ALT } from "@/lib/state-guide-copy";

export const runtime = "nodejs";
export const alt = TN_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Local Guide",
    title: "Spend Bitcoin in Tennessee",
    subtitle: "Bitcoin ATMs are banned since July 1, 2026. Here are the places that still take bitcoin, walk-in and online.",
    footerTag: "Checked, with dates →",
  });
}
