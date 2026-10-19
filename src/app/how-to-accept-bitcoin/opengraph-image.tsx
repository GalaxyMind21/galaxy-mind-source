import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "How to accept bitcoin payments as a business";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "For Merchants",
    title: "How to Accept Bitcoin Payments",
    subtitle:
      "Turn it on at checkout, settle in dollars or keep BTC, pay near-zero Lightning fees, and get found.",
    footerTag: "Most shops can start in minutes →",
  });
}
