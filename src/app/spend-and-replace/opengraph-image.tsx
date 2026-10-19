import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "Spend and replace: keep your bitcoin stack, grow the circular economy";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Circular Economy",
    title: "Spend and Replace",
    subtitle:
      "Spend bitcoin, then rebuy the same amount with fiat. Your stack stays the same · the economy grows.",
    footerTag: "Use bitcoin without shrinking your stack →",
  });
}
