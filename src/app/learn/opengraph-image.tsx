import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { LEARN_OG_ALT } from "@/lib/learn-hub-copy";

export const runtime = "nodejs";
export const alt = LEARN_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Learn",
    title: "Learn bitcoin, one guide at a time",
    subtitle: "Buy it safely, pay with Lightning, spend it at verified shops, accept it and mine it.",
    footerTag: "Every guide in one place →",
  });
}
