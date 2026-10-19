import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";

export const runtime = "nodejs";
export const alt = "How to help grow bitcoin: concrete ways to support adoption";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Ways to Help",
    title: "How to Help Grow Bitcoin",
    subtitle:
      "Spend and replace, onboard a merchant, self-custody, run a node, use Lightning, teach it.",
    footerTag: "No selling your stack required →",
  });
}
