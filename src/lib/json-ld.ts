// Defensive JSON-LD serializer. Used by every layout that emits a
// schema.org <script type="application/ld+json"> tag.
//
// Why this exists:
// JSON.stringify can produce sequences that are unsafe inside a
// <script>:
//   - `</script>` (or any `</`) would terminate the script tag early
//   - U+2028 (Line Separator) and U+2029 (Paragraph Separator) are
//     valid inside JSON strings but are line terminators in JS source,
//     and would either break parsers or be silently re-rendered as
//     literal newlines
//
// safeJsonLd() escapes both classes defensively. Inputs are expected
// to be static, server-controlled objects (no user input ever flows
// in to per-page schema), but this is defense in depth · if a future
// caller wires user-controlled content into a schema field, the
// escaping prevents script-tag breakout regardless.
//
// Inline JSON-LD via inline <script> is mandatory: search engines
// (Google, Bing, Perplexity, Claude search, ChatGPT search) and AI
// agents do NOT fetch external JSON-LD documents · they parse the
// inline tags in the HTML response. This is why every layout that
// wants structured data has to inject the JSON inline.

export function safeJsonLd(obj: unknown): string {
  // Build the regexes via RegExp() so the literal U+2028 / U+2029
  // characters don't appear in source (where some editors / linters
  // get confused by them).
  const LINE_SEP = String.fromCharCode(0x2028);
  const PARA_SEP = String.fromCharCode(0x2029);
  // Escape <, >, and & defensively (security audit 2026-05-30, LOW /
  // defense-in-depth). Escaping `<` alone already prevents a
  // </script> breakout in the script-tag context, but unicode-escaping
  // all three of <, >, & means the same primitive stays safe if a
  // future caller ever interpolates a value into an HTML attribute or
  // text context instead of a <script>. `&` is escaped first so the
  // \u00XX replacements (which contain no &) can't interact. These are
  // valid JSON string escapes · every JSON-LD parser decodes them.
  return JSON.stringify(obj)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(new RegExp(LINE_SEP, "g"), "\\u2028")
    .replace(new RegExp(PARA_SEP, "g"), "\\u2029");
}

/**
 * BreadcrumbList builder (2026-07-29).
 *
 * The pattern was hand-inlined on /online-stores-that-accept-bitcoin
 * and nowhere else, so most deep pages emitted no trail at all. Pass an
 * ordered trail from the site root to the current page; positions are
 * assigned automatically so a caller can never number them wrong.
 *
 * What this buys: Google renders the trail in place of the raw URL in
 * the SERP line. It does NOT create a rich snippet on its own, so it is
 * a presentation/consistency win, not a traffic lever — worth doing
 * cheaply and worth not overselling.
 *
 * Google's guidance is that markup should reflect a real navigational
 * hierarchy. Every call site here mirrors a path the user can actually
 * walk, and on /treasuries/[ticker] it mirrors a breadcrumb that is
 * also visible on the page.
 */
export function buildBreadcrumb(
  trail: { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: step.url,
    })),
  };
}

/**
 * HowTo builder (2026-08-31).
 *
 * Same spirit as buildBreadcrumb: returns a bare node so the caller
 * adds @context (or splices into a @graph). Built for
 * /hashrate/how-to-rent, mirroring the HowTo already live on
 * /how-to-accept-bitcoin, from copy the page already renders.
 *
 * Google can surface HowTo rich results from this. Markup must
 * reflect the visible steps — callers pass the same GUIDE_STEPS
 * the page maps into the <ol>, not a parallel sales version.
 */
export function buildHowTo(input: {
  name: string;
  description: string;
  url: string;
  totalTime: string;
  steps: { name: string; text: string }[];
  supply?: { name: string }[];
  tool?: { name: string }[];
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    url: input.url,
    totalTime: input.totalTime,
    step: input.steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  };
  if (input.supply && input.supply.length > 0) {
    node.supply = input.supply.map((item) => ({
      "@type": "HowToSupply",
      name: item.name,
    }));
  }
  if (input.tool && input.tool.length > 0) {
    node.tool = input.tool.map((item) => ({
      "@type": "HowToTool",
      name: item.name,
    }));
  }
  return node;
}
