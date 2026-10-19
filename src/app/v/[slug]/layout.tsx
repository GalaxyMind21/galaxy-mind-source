import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  COUNTRIES,
  CATEGORY_LABELS,
  findVendorBySlug,
  getActionUrl,
  getDisplayHandle,
  vendorSiblings,
  vendorSlug,
  vendorWebsite,
} from "@/lib/vendors";
import { ownerOrganizationLd } from "@/lib/vendor-owner-ld";
import { safeJsonLd } from "@/lib/json-ld";
import { isSafeHttpsHref } from "@/lib/outbound-url";

const SITE_URL = "https://galaxymind.space";

// Per-vendor JSON-LD. Three schemas combined:
//
//   1. LocalBusiness · Schema.org's primary "real-world merchant"
//      type. AI agents recognize this as a citable entity for "where
//      can I buy [thing] with bitcoin" queries.
//
//   2. WebPage · brand-graph rollup back to the site Organization.
//      The mainEntity points at the LocalBusiness so agents know
//      this page IS about that vendor (not just describing them).
//
//   3. BreadcrumbList · Directory → category hub → [Vendor Name],
//      matching the visible trail on page.tsx (SERP breadcrumb).
//
// SECURITY: Vendor data is server-controlled (lives in
// src/lib/vendors.ts, validated by scripts/check-vendors.ts). No user
// input ever flows into the schema. safeJsonLd() escapes `<` and
// U+2028/U+2029 for defense in depth. Same already-shipped pattern
// as the 6 other layouts that emit JSON-LD.

export default async function VendorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vendor = findVendorBySlug(slug);
  if (!vendor) notFound();

  const url = `${SITE_URL}/v/${slug}`;
  const country = vendor.country ? COUNTRIES[vendor.country] : null;
  const displayHandle = getDisplayHandle(vendor);
  const actionUrl = getActionUrl(vendor);
  // LocalBusiness.url is where agents and SERP send the shopper.
  // Prefer the merchant's own checkout/storefront when we have one;
  // fall back to the profile/Lightning action URL for Nostr-only or
  // LN-address listings. Social profiles stay in sameAs either way.
  // Evidence 2026-10-14: live /v/voltvault emitted url=x.com/shopvoltvault
  // while Visit shop (and guest BTC checkout) is shopvoltvault.com —
  // directory → checkout was handing AI/SERP the wrong primary URL.
  const shopHref = vendorWebsite(vendor);
  const businessUrl =
    shopHref && isSafeHttpsHref(shopHref) ? shopHref : actionUrl;

  // Multi-shop (2026-10 · lib/vendor-owner-ld): a listing whose handle
  // runs other shops names the shared identity as parentOrganization and
  // keeps only its own storefront in sameAs. Single-shop pages (all of
  // them today) keep the original sameAs: [actionUrl, shopHref].
  const hasSiblings = vendorSiblings(vendor).length > 0;
  const sameAsUrls = hasSiblings
    ? [shopHref, actionUrl === businessUrl ? actionUrl : undefined]
    : [actionUrl, shopHref];

  const STRUCTURED_DATA = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: `${vendor.name} · accepts Bitcoin · Galaxy Mind`,
        description: vendor.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        mainEntity: { "@id": `${url}#vendor` },
      },
      {
        "@type": "LocalBusiness",
        "@id": `${url}#vendor`,
        name: vendor.name,
        url: businessUrl,
        description: vendor.description,
        mainEntityOfPage: { "@id": `${url}#webpage` },
        // sameAs strengthens entity resolution · the profile link
        // PLUS the vendor's own website (when distinct) tell search /
        // AI agents these URLs are the same real-world entity. Audit
        // 2026-05 enrichment. Deduped so an identical website/profile
        // doesn't emit twice. businessUrl may equal shop or action.
        sameAs: Array.from(
          new Set(
            sameAsUrls.filter(
              (u): u is string =>
                !!u && (u === actionUrl || isSafeHttpsHref(u)),
            ),
          ),
        ),
        ...(hasSiblings
          ? { parentOrganization: ownerOrganizationLd(vendor, SITE_URL) }
          : {}),
        identifier: displayHandle,
        // image · LocalBusiness image earns richer SERP / agent cards.
        // pictureUrl is HTTPS-validated at commit (check-vendors).
        ...(vendor.pictureUrl ? { image: vendor.pictureUrl } : {}),
        // founder · "Made by <name>" as a structured Person, when the
        // vendor chose to share it (optional field, never fabricated).
        ...(vendor.founderName
          ? { founder: { "@type": "Person", name: vendor.founderName } }
          : {}),
        currenciesAccepted: "BTC",
        paymentAccepted:
          vendor.acceptsLightning === false
            ? ["Bitcoin"]
            : vendor.acceptsOnChain === false
              ? ["Lightning Network"]
              : ["Bitcoin", "Lightning Network"],
        ...(country
          ? {
              address: {
                "@type": "PostalAddress",
                addressCountry: vendor.country,
              },
              areaServed: {
                "@type": "Country",
                name: country.label,
              },
            }
          : {}),
        category: CATEGORY_LABELS[vendor.category],
        // Human confirmation date · same cadence the listing shows.
        dateModified: new Date(vendor.verifiedAt * 1000)
          .toISOString()
          .slice(0, 10),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Directory",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: CATEGORY_LABELS[vendor.category],
            item: `${SITE_URL}/spend-bitcoin-on/${vendor.category}`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: vendor.name,
            item: url,
          },
        ],
      },
    ],
  };

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <>
      {/* SAFE: Static, server-controlled JSON-LD generated from
          src/lib/vendors.ts · no user input. safeJsonLd() escapes
          `<` and U+2028/U+2029 for defense in depth. */}
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

void vendorSlug;
