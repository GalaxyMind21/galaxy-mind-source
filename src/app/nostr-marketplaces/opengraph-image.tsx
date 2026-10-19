import { renderCatalystOg, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-catalyst";
import { NM_OG_ALT } from "@/lib/nostr-marketplaces-copy";

export const runtime = "nodejs";
export const alt = NM_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default function Image() {
  return renderCatalystOg({
    eyebrow: "Explainer",
    title: "What is a Nostr marketplace?",
    subtitle: "How Conduit, Shopstr and Plebeian Market work, and how they differ from a free, human-verified directory.",
    footerTag: "How it differs from a directory →",
  });
}
