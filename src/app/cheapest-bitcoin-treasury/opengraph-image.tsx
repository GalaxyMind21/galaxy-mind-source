import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Cheapest bitcoin treasury stock right now";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Treasury Ranking",
    title: "Cheapest Bitcoin Treasury Right Now",
    subtitle:
      "Public bitcoin treasuries ranked by mNAV · the lowest is the biggest discount to the BTC it holds.",
    footerTag: "Live ranking · updated daily →",
  });
}
