import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Should I buy bitcoin today? Live verdict";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Live Verdict",
    title: "Should I Buy Bitcoin Today?",
    subtitle:
      "A 0-100 reading of 10 market signals · not a guess, not generic prose. Updated daily.",
    footerTag: "Live 10-signal gauge →",
  });
}
