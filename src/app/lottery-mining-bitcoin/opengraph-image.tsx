import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { LOTTERY_OG_ALT } from "@/lib/lottery-mining-copy";

export const runtime = "nodejs";
export const alt = LOTTERY_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Solo Mining",
    title: "Lottery mining bitcoin",
    subtitle: "The honest odds of finding a block, renting vs owning, and how to try it.",
    footerTag: "Odds worked out from the live network →",
  });
}
