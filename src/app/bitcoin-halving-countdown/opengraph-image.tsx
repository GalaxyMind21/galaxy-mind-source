import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Bitcoin halving countdown · live days and blocks remaining";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Live Countdown",
    title: "Bitcoin Halving Countdown",
    subtitle:
      "Days, blocks, and estimated date until issuance halves again · plus what it does to the supply you can still buy.",
    footerTag: "Live block height · supply math →",
  });
}
