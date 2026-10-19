// /spend-bitcoin-in-latin-america · dedicated research page.
// The only first-party Spanish URL is /es/spend-bitcoin-in-latin-america.
// Static route on purpose: overloading /spend-bitcoin-in/[country] would
// either 404 empty countries (Argentina) or break that notFound()
// contract. Brazil has a real hub at /spend-bitcoin-in/brazil as of
// 2026-08-25. Cards are filtered from VENDORS, never hardcoded.
// Growth 2026-09-08: quiet VendorHashrateModule after the ship shelf so
// LATAM SERP visitors (EN + /es) get the same directory→/hashrate hop
// country hubs already have. Same module; no homepage hero.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { LocaleToggle } from "@/components/LocaleToggle";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { OG_DIRECTORY } from "@/lib/og";
import { getMetadataLocale, getRequestLocale, translate } from "@/lib/locale";
import {
  BTC_MAP_COUNTRIES,
  LATAM_COMMUNITIES,
  btcMapUrl,
  countByLatamCountry,
  countryLabel,
  honestLead,
  isLatamCountry,
  latamMetaDescription,
  latamVendors,
} from "@/lib/latam";
import { DirectoryShelf } from "@/components/DirectoryShelf";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import {
  COUNTRIES,
  VENDORS,
  countrySlug,
  vendorSlug,
} from "@/lib/vendors";

export const revalidate = 3600;

const EN_URL = "https://galaxymind.space/spend-bitcoin-in-latin-america";
const ES_URL = "https://galaxymind.space/es/spend-bitcoin-in-latin-america";
const SITE = "https://galaxymind.space";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMetadataLocale();
  const list = latamVendors();
  const title =
    locale === "es"
      ? `Gasta bitcoin en América Latina · ${list.length} comercios · Galaxy Mind`
      : `Spend bitcoin in Latin America · ${list.length} verified shops · Galaxy Mind`;
  const description = latamMetaDescription(locale, list.length);
  // Self-canonical per locale. The ES URL used to point canonical at EN
  // while also sitting in the sitemap and in hreflang, which is the
  // Ahrefs pair "non-canonical page in sitemap" + "hreflang to
  // non-canonical". Spanish metadata follows the /es URL only.
  const canonical = locale === "es" ? ES_URL : EN_URL;
  return {
    title,
    description,
    alternates: {
      canonical: canonical,
      languages: {
        en: EN_URL,
        es: ES_URL,
        "x-default": EN_URL,
      },
    },
    openGraph: {
      images: OG_DIRECTORY,
      title,
      description,
      url: canonical,
      siteName: "Galaxy Mind",
      type: "website",
      locale: locale === "es" ? "es_LA" : "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: "@GalaxyMind",
    },
  };
}

export default async function LatinAmericaPage() {
  const locale = await getRequestLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const list = latamVendors();
  const byCc = countByLatamCountry(list);
  const lead = honestLead(locale, list.length, byCc);
  const grouped = new Map<string, typeof list>();
  for (const v of list) {
    const cc = v.country ?? "—";
    const arr = grouped.get(cc) ?? [];
    arr.push(v);
    grouped.set(cc, arr);
  }
  const groupOrder = [...grouped.keys()].sort((a, b) =>
    countryLabel(a, locale).localeCompare(
      countryLabel(b, locale),
      locale === "es" ? "es" : "en",
    ),
  );

  const others = Object.entries(COUNTRIES)
    .filter(([c]) => !isLatamCountry(c) && VENDORS.some((v) => v.country === c))
    .map(([c, i]) => ({ cc: c, ...i }))
    .sort((a, b) =>
      countryLabel(a.cc, locale).localeCompare(
        countryLabel(b.cc, locale),
        locale === "es" ? "es" : "en",
      ),
    );

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("latam.jsonName"),
    description: t("latam.jsonDesc"),
    numberOfItems: list.length,
    url: EN_URL,
    inLanguage: locale === "es" ? "es" : "en",
    itemListElement: list.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/v/${vendorSlug(v)}`,
      name: v.name,
    })),
  };

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="night-bench-kicker mb-0">
            {t("latam.kicker")} · {t("latam.count", { n: list.length })}
          </p>
          <LocaleToggle />
        </div>
        <h1 className="display-title mb-3">
          {t("latam.h1Lead")}
          {t("latam.h1Place")}
          {t("latam.h1End")}
        </h1>
        <p className="night-bench-lede mb-10">
          {lead}
        </p>

        <section className="mb-12">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            {t("latam.nearTitle")}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl mb-4">
            {t("latam.nearBody")}
          </p>
          <div className="flex flex-wrap gap-2">
            {BTC_MAP_COUNTRIES.map((c) => (
              <a
                key={c.code}
                href={btcMapUrl(c.code)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] t-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
              >
                {t("latam.btcMap", {
                  place: locale === "es" ? c.labelEs : c.labelEn,
                })}
              </a>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            {t("latam.shipTitle")}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl mb-6">
            {t("latam.shipBody")}
          </p>
          {(byCc.BR ?? 0) === 0 && (byCc.AR ?? 0) === 0 && (
            <p className="text-sm text-[var(--text-tertiary)] mb-6">
              {t("latam.noneBrAr")}
            </p>
          )}
          {groupOrder.map((cc) => (
            <div key={cc} className="mb-8">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {COUNTRIES[cc]?.flag ?? ""} {countryLabel(cc, locale)} ·{" "}
                {grouped.get(cc)?.length ?? 0}
              </h3>
              <DirectoryShelf vendors={grouped.get(cc) ?? []} />
            </div>
          ))}
        </section>

        <VendorHashrateModule className="mb-12" />

        <section className="mb-12">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
            {t("latam.communitiesTitle")}
          </h2>
          <ul className="space-y-2 max-w-2xl">
            {LATAM_COMMUNITIES.map((c) => (
              <li
                key={c.name}
                className="text-sm text-[var(--text-secondary)]"
              >
                <span className="text-[var(--text-primary)] font-semibold">
                  {c.name}
                </span>
                {" · "}
                {locale === "es" ? c.placeEs : c.placeEn}
                {c.woundDown ? ` · ${t("latam.praiaNote")}` : ""}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 elevate">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            {t("latam.submitTitle")}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xl">
            {t("latam.submitBody")}
          </p>
          <Link
            href="/submit"
            className="inline-flex px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-all"
          >
            {t("latam.submitCta")}
          </Link>
        </section>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            {t("latam.filterDirectory")}
          </Link>
        </div>

        <section className="mt-12">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
            {t("latam.elsewhere")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {others.map((o) => (
              <Link
                key={o.cc}
                href={`/spend-bitcoin-in/${countrySlug(o.label)}`}
                className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] t-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
              >
                {o.flag} {countryLabel(o.cc, locale)}
              </Link>
            ))}
          </div>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
