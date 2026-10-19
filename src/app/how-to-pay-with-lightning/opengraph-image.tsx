import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { PAY_GUIDE_OG_ALT } from "@/lib/pay-guide-copy";

export const runtime = "nodejs";
export const alt = PAY_GUIDE_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "For Shoppers",
    title: "No bitcoin yet? You can still pay.",
    subtitle: "Choose Lightning at checkout, scan the QR code with your money app, and confirm.",
    footerTag: "Check your app for availability and fees →",
  });
}
