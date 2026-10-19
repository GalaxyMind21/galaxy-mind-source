import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { S21XP_OG_ALT } from "@/lib/s21xp-copy";

export const runtime = "nodejs";
export const alt = S21XP_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Rent Hashrate",
    title: "Antminer S21 XP",
    subtitle: "Bitmain's specs, one unit's solo odds today, and how to rent one by the hour.",
    footerTag: "270 TH/s · 13.5 J/TH →",
  });
}
