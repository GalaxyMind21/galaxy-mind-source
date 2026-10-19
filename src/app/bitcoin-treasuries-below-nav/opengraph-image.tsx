import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Bitcoin treasuries trading below NAV (mNAV under 1)";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "mNAV Under 1.0",
    title: "Bitcoin Treasuries Below NAV",
    subtitle:
      "Which treasuries trade under the value of their bitcoin · gross vs net of senior debt.",
    footerTag: "Live · the spiral-of-doom story →",
  });
}
