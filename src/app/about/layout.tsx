import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";

const SITE_URL = "https://galaxymind.space";
const URL = `${SITE_URL}/about`;

// JSON-LD for the About page. Three schemas:
//   1. AboutPage · the page itself, links back to the Organization
//      (root layout's #org node) as `mainEntity`.
//   2. Person · the pseudonymous author "@GalaxyMind". Adding a Person
//      with `sameAs` to X + Nostr is an authority signal: it gives AI
//      agents and search engines a stable identifier to attribute
//      content to, even though the author chooses not to publish a
//      legal name. founder/employee back-ref onto the Organization
//      establishes the brand-author relationship.
//   3. Organization (additional facts) · uses @id to merge with the
//      root layout's #org node rather than duplicate it. Adds founder
//      and slogan info that's About-page specific.
//
// SECURITY: Static, server-controlled object literal · no user input
// ever flows in. safeJsonLd() escapes `<` and U+2028/U+2029 for defense
// in depth. Inline <script> is required because search engines do not
// fetch external JSON-LD documents. Same already-shipped pattern as
// /stack, /fit, /treasuries, and root layouts.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${URL}#aboutpage`,
      url: URL,
      name: "About Galaxy Mind",
      description:
        "Galaxy Mind is an independent set of free Bitcoin tools: vendor directory, Buying Gauge, treasury mNAV scoreboard, allocation engine. Built solo. Not financial advice.",
      mainEntity: { "@id": `${SITE_URL}/#org` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      inLanguage: "en-US",
    },
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#author`,
      name: "GalaxyMind",
      url: SITE_URL,
      sameAs: [
        "https://x.com/GalaxyMind",
        "https://primal.net/p/nprofile1qqspwnkez659yrnzx2fu4kzpngtkak7v3sdpuh6jw83key38xru5wrcny0sdm",
      ],
      jobTitle: "Founder, Galaxy Mind",
      worksFor: { "@id": `${SITE_URL}/#org` },
      knowsAbout: [
        "Bitcoin",
        "Bitcoin treasury companies",
        "MSTR Strategy",
        "mNAV",
        "MVRV",
        "Puell Multiple",
        "Mayer Multiple",
        "Bitcoin allocation",
        "Bitcoin payment vendors",
      ],
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      founder: { "@id": `${SITE_URL}/#author` },
      slogan: "Independent Bitcoin tools. Educational, not financial advice.",
      knowsAbout: [
        "Bitcoin spot price",
        "Bitcoin treasury companies (MSTR, XXI, MPJPY, ASST)",
        "On-chain metrics (MVRV, Puell, Mayer)",
        "Crypto perpetual funding rates",
        "Bitcoin merchant directory",
      ],
    },
  ],
};


export default async function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <>
      {/* SAFE: Static, server-controlled JSON-LD · no user input.
          safeJsonLd() escapes `<` and U+2028/U+2029 for defense in
          depth. Inline <script> required for JSON-LD discovery. */}
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
