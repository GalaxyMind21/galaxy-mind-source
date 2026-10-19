"use client";
// Renders the home directory JSON-LD from the client bundle's own copy of
// the roster (lib/home-directory-ld.ts). As a client component its markup
// appears once in the SSR HTML; the RSC payload only carries the nonce and
// the small extra nodes, instead of a second copy of the ~18 KB ItemList.
// suppressHydrationWarning: browsers blank the nonce attribute after load.
import { safeJsonLd } from "@/lib/json-ld";
import { buildHomeDirectoryLd } from "@/lib/home-directory-ld";

export function HomeDirectoryLd({
  nonce,
  extraNodes = [],
}: {
  nonce?: string;
  extraNodes?: object[];
}) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      suppressHydrationWarning
      // Static roster + house strings → no XSS surface; safeJsonLd()
      // escapes `<` and U+2028/U+2029.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJsonLd(buildHomeDirectoryLd(extraNodes)) }}
    />
  );
}
