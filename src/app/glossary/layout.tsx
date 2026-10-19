import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";
import { ALL_TERMS, GLOSSARY } from "@/lib/glossary";

const SITE_URL = "https://galaxymind.space";
const URL = `${SITE_URL}/glossary`;

// JSON-LD for the glossary. Three schemas:
//   1. DefinedTermSet · the glossary as a whole, with hasDefinedTerm[]
//      enumerating every term. This is the canonical schema for
//      "vocabulary" pages and is what AI agents (Perplexity, ChatGPT,
//      Claude search, Google AI Overviews) recognize as a citable
//      definition source.
//   2. DefinedTerm · one node per glossary entry, with `name`,
//      `description`, and `inDefinedTermSet` back-reference. Each
//      gets a stable @id matching the page anchor (e.g. #mnav) so
//      agents can deep-link directly to the term they're quoting.
//   3. WebPage · brand-graph rollup back to the site Organization.
//
// The visible page (page.tsx) and this schema both read from
// src/lib/glossary.ts, so adding a term in one place keeps both
// in sync automatically.
//
// SECURITY: Static, server-controlled object literal generated from
// src/lib/glossary.ts · no user input ever flows in. safeJsonLd()
// escapes `<` and U+2028/U+2029 for defense in depth. Inline <script>
// is required because search engines and AI agents do not fetch
// external JSON-LD documents · they parse <script type="application/
// ld+json"> tags in the HTML response. Same already-shipped pattern
// as /stack, /fit, /treasuries, /about, and the root layout.

const TERM_SET_ID = `${URL}#termset`;

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${URL}#webpage`,
      url: URL,
      name: "Bitcoin glossary · Galaxy Mind",
      description:
        "Plain-language definitions for the Bitcoin and treasury-company metrics used by Galaxy Mind: mNAV, MVRV, Puell, Mayer, Buying Gauge tier, accretion, sleeve, volatility tolerance, and more.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": `${SITE_URL}/#org` },
      inLanguage: "en-US",
      mainEntity: { "@id": TERM_SET_ID },
      hasPart: GLOSSARY.map((s) => ({
        "@type": "WebPageElement",
        "@id": `${URL}#${s.slug}`,
        name: s.title,
        description: s.blurb,
      })),
    },
    {
      "@type": "DefinedTermSet",
      "@id": TERM_SET_ID,
      name: "Galaxy Mind Bitcoin Glossary",
      description:
        "Vocabulary used across the Galaxy Mind Bitcoin tools (Buying Gauge, Treasury Scoreboard, Allocation Engine). Standalone definitions written to be quoted with attribution.",
      url: URL,
      inLanguage: "en-US",
      creator: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      hasDefinedTerm: ALL_TERMS.map((t) => ({
        "@type": "DefinedTerm",
        // Canonical @id is the per-term PAGE (2026-06-10) · those
        // pages emit the same @id, so the graph has exactly one node
        // per concept instead of hub-anchor + page duplicates. The
        // hub anchor remains a working in-page link; it's just no
        // longer the term's identity.
        "@id": `${URL}/${t.slug}`,
        name: t.term,
        description: t.definition,
        termCode: t.slug,
        url: `${URL}/${t.slug}`,
        inDefinedTermSet: { "@id": TERM_SET_ID },
        ...(t.sourceUrl
          ? {
              subjectOf: {
                "@type": "WebPage",
                url: t.sourceUrl,
              },
            }
          : {}),
        ...(t.internalUrl ? { sameAs: t.internalUrl } : {}),
      })),
    },
  ],
};


export default async function GlossaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <>
      {/* SAFE: Static, server-controlled JSON-LD generated from
          src/lib/glossary.ts · no user input. safeJsonLd() escapes
          `<` and U+2028/U+2029 for defense in depth. Inline <script>
          is required for JSON-LD discovery. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(STRUCTURED_DATA) }}
      />
      {children}
    </>
  );
}
