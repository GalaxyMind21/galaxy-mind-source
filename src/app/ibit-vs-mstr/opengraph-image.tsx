import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "IBIT vs MSTR · which bitcoin exposure is better?";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Spot ETF vs Leveraged Equity",
    title: "IBIT vs MSTR",
    subtitle:
      "Pure spot ETF or Strategy's leveraged treasury equity? Live mNAV decides which wins.",
    footerTag: "Live mNAV · open methodology →",
  });
}
