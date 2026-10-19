import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "MSTR vs Bitcoin · live mNAV comparison";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Treasury Comparison",
    title: "MSTR vs Bitcoin",
    subtitle:
      "What you actually pay for the bitcoin inside MicroStrategy · live mNAV premium, updated daily.",
    footerTag: "Live mNAV · open methodology →",
  });
}
