import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";
import { STALE_THRESHOLD_DAYS } from "@/lib/vendors";

const SITE_URL = "https://galaxymind.space";
const URL = `${SITE_URL}/methodology`;

// JSON-LD for the Methodology page. One WebPage node, merged into the
// brand graph via @id refs (isPartOf #website, publisher/about #org)
// rather than duplicating the Organization. significantLink points at
// /submit + the directory so agents understand this page documents
// the process behind the listings.
//
// SECURITY: Static, server-controlled object literal · no user input
// ever flows in. safeJsonLd() escapes `<` and U+2028/U+2029 for
// defense in depth (same vetted helper used by every other layout).
// Inline <script> is required because search engines don't fetch
// external JSON-LD documents. Identical already-shipped pattern as
// /about, /stack, /fit, /treasuries, /glossary, /v/[slug] layouts —
// the hook warning is generic; there is no untrusted content here.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${URL}#webpage`,
      url: URL,
      name: "How Galaxy Mind vets vendors",
      description:
        `The full vendor-verification process for the Galaxy Mind directory: signature-verified Nostr profiles, live-site checks, a strict 'accepts Bitcoin' bar, HTTPS-only links, human moderation, and daily automated monitoring with a ${STALE_THRESHOLD_DAYS}-day human-touch backstop.`,
      about: { "@id": `${SITE_URL}/#org` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": `${SITE_URL}/#org` },
      inLanguage: "en-US",
      significantLink: [`${SITE_URL}/submit`, SITE_URL],
    },
  ],
};

export default async function MethodologyLayout({
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
          depth. */}
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
