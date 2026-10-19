import {
  renderCatalystOg,
  OG_SIZE,
  OG_CONTENT_TYPE,
} from "@/lib/og-catalyst";
import { ALL_TERMS } from "@/lib/glossary";

export const runtime = "nodejs";
export const alt = "Bitcoin glossary definition · Galaxy Mind";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600; // literal · segment config must be statically analyzable

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const term = ALL_TERMS.find((t) => t.slug === slug);
  const title = term ? term.term : "Bitcoin Glossary";
  const subtitle = term
    ? term.definition.length > 140
      ? term.definition.slice(0, 137).trimEnd() + "..."
      : term.definition
    : "Plain-language definitions for every metric on Galaxy Mind.";
  return renderCatalystOg({
    eyebrow: "Glossary",
    title,
    subtitle,
    footerTag: "Citable definition · open methodology →",
  });
}
