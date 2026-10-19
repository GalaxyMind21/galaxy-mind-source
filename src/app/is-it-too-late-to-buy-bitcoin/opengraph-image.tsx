import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Is it too late to buy bitcoin? Live answer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Live Answer",
    title: "Is It Too Late to Buy Bitcoin?",
    subtitle:
      "Supply scarcity plus a 10-signal buying gauge answer it with data, not opinion. Updated daily.",
    footerTag: "Live supply + gauge →",
  });
}
