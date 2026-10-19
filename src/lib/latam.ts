// Latin America helpers for /spend-bitcoin-in-latin-america.
// Shop cards are ALWAYS filtered from VENDORS — never a hardcoded roster.

import type { Locale } from "@/lib/i18n";
import { COUNTRIES, VENDORS, type Vendor } from "@/lib/vendors";

export const LATAM_COUNTRY_CODES = [
  "AR",
  "BO",
  "BR",
  "CL",
  "CO",
  "CR",
  "CU",
  "DO",
  "EC",
  "GT",
  "HN",
  "MX",
  "NI",
  "PA",
  "PE",
  "PY",
  "SV",
  "UY",
  "VE",
] as const;

const LATAM_SET = new Set<string>(LATAM_COUNTRY_CODES);

export function isLatamCountry(code: string | undefined): code is string {
  return !!code && LATAM_SET.has(code);
}

export function latamVendors(vendors: readonly Vendor[] = VENDORS): Vendor[] {
  return vendors
    .filter((v) => isLatamCountry(v.country))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countByLatamCountry(vendors: readonly Vendor[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vendors) {
    const cc = v.country;
    if (!isLatamCountry(cc)) continue;
    out[cc] = (out[cc] ?? 0) + 1;
  }
  return out;
}

function fold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const LATAM_QUERY_NEEDLES = [
  "latin america",
  "america latina",
  "latinoamerica",
  "latam",
  "brazil",
  "brasil",
  "argentina",
  "mexico",
  "colombia",
  "peru",
  "chile",
  "guatemala",
  "venezuela",
  "el salvador",
  "salvador",
  "cuba",
  "dominican",
  "bolivia",
  "ecuador",
  "panama",
  "paraguay",
  "uruguay",
  "honduras",
  "nicaragua",
  "costa rica",
] as const;

/** Homepage empty-state: a search that is looking for the region, not a shop name. */
export function looksLikeLatamQuery(q: string): boolean {
  const n = fold(q);
  if (!n) return false;
  return LATAM_QUERY_NEEDLES.some((needle) => n.includes(needle));
}

export function honestLead(
  locale: Locale,
  n: number,
  byCc: Record<string, number>,
): string {
  const br = byCc.BR ?? 0;
  const ar = byCc.AR ?? 0;
  const listed = Object.entries(byCc)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) =>
      countryLabel(a, locale).localeCompare(
        countryLabel(b, locale),
        locale === "es" ? "es" : "en",
      ),
    )
    .map(([cc, count]) => `${countryLabel(cc, locale)} ${count}`);
  const none = [
    br === 0 ? (locale === "es" ? "Brasil" : "Brazil") : null,
    ar === 0 ? "Argentina" : null,
  ].filter(Boolean);
  if (locale === "es") {
    const noneBit = none.length
      ? ` y todavía ninguno en ${none.join(" ni ")}`
      : "";
    return `Los locales físicos en Brasil, Argentina y el resto de la región viven en BTC Map. Este directorio lista tiendas en línea independientes que aceptan bitcoin, cada una revisada por una persona. Hoy tenemos ${n} comercio${n === 1 ? "" : "s"} LATAM (${listed.join(", ") || "—"})${noneBit}.`;
  }
  const noneBit = none.length ? ` and none yet in ${none.join(" or ")}` : "";
  return `Physical shops in Brazil, Argentina, and the rest of the region live on BTC Map. This directory lists independent online stores that take bitcoin, each checked by a human. We have ${n} LATAM shop${n === 1 ? "" : "s"} today (${listed.join(", ") || "—"})${noneBit}.`;
}

/** Meta description · keep ≤155 chars. The on-page lead is honestLead(). */
export function latamMetaDescription(locale: Locale, n: number): string {
  if (locale === "es") {
    return `Tiendas en línea de América Latina que aceptan bitcoin. ${n} comercio${n === 1 ? "" : "s"} verificados por una persona. Los locales físicos viven en BTC Map.`;
  }
  return `Independent online shops in Latin America that take bitcoin. ${n} human-verified listing${n === 1 ? "" : "s"}. Physical stores live on BTC Map.`;
}

export const BTC_MAP_COUNTRIES: { code: string; labelEn: string; labelEs: string }[] = [
  { code: "br", labelEn: "Brazil", labelEs: "Brasil" },
  { code: "ar", labelEn: "Argentina", labelEs: "Argentina" },
  { code: "co", labelEn: "Colombia", labelEs: "Colombia" },
  { code: "pe", labelEn: "Peru", labelEs: "Perú" },
  { code: "sv", labelEn: "El Salvador", labelEs: "El Salvador" },
  { code: "mx", labelEn: "Mexico", labelEs: "México" },
  { code: "cl", labelEn: "Chile", labelEs: "Chile" },
  { code: "gt", labelEn: "Guatemala", labelEs: "Guatemala" },
  { code: "do", labelEn: "Dominican Republic", labelEs: "República Dominicana" },
  { code: "cu", labelEn: "Cuba", labelEs: "Cuba" },
  { code: "ve", labelEn: "Venezuela", labelEs: "Venezuela" },
];

export function btcMapUrl(code: string): string {
  return `https://btcmap.org/country/${code}`;
}

export type LatamCommunity = {
  name: string;
  placeEn: string;
  placeEs: string;
  woundDown?: boolean;
};

export const LATAM_COMMUNITIES: LatamCommunity[] = [
  { name: "Bitcoin School Argentina", placeEn: "Argentina", placeEs: "Argentina" },
  { name: "Crypto Mar del Plata", placeEn: "Argentina", placeEs: "Argentina" },
  { name: "ColomBia P2P", placeEn: "Colombia", placeEs: "Colombia" },
  { name: "Bitcoin Lake Guatemala", placeEn: "Guatemala", placeEs: "Guatemala" },
  { name: "Bitcoin Dominicana", placeEn: "Dominican Republic", placeEs: "República Dominicana" },
  { name: "Cuba Bitcoin", placeEn: "Cuba", placeEs: "Cuba" },
  { name: "Santiago de Chile", placeEn: "Chile", placeEs: "Chile" },
  { name: "Satoshi en Venezuela", placeEn: "Venezuela", placeEs: "Venezuela" },
  {
    name: "Praia Bitcoin Jeri",
    placeEn: "Brazil",
    placeEs: "Brasil",
    woundDown: true,
  },
];

const LATAM_LABEL_ES: Record<string, string> = {
  AR: "Argentina",
  BO: "Bolivia",
  BR: "Brasil",
  CL: "Chile",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  DO: "República Dominicana",
  EC: "Ecuador",
  GT: "Guatemala",
  HN: "Honduras",
  MX: "México",
  NI: "Nicaragua",
  PA: "Panamá",
  PE: "Perú",
  PY: "Paraguay",
  SV: "El Salvador",
  UY: "Uruguay",
  VE: "Venezuela",
};

// English labels for every LATAM country, mirroring LATAM_LABEL_ES.
//
// These MUST NOT be derived from COUNTRIES: that map only holds countries with
// a live roster, so a LATAM country with zero shops fell through to the raw
// alpha-2 code. Argentina is still absent from COUNTRIES (empty-roster rule).
// Brazil joined COUNTRIES on 2026-08-25 (Homedock, KriptoBR); the labels
// here stay so empty LATAM countries (AR, PE, …) never render as "AR 0".
// Peru's only vendor was corrected to US on 2026-08-20.
const LATAM_LABEL_EN: Record<string, string> = {
  AR: "Argentina",
  BO: "Bolivia",
  BR: "Brazil",
  CL: "Chile",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  DO: "Dominican Republic",
  EC: "Ecuador",
  GT: "Guatemala",
  HN: "Honduras",
  MX: "Mexico",
  NI: "Nicaragua",
  PA: "Panama",
  PE: "Peru",
  PY: "Paraguay",
  SV: "El Salvador",
  UY: "Uruguay",
  VE: "Venezuela",
};

export function countryLabel(code: string, locale: "en" | "es" = "en"): string {
  if (locale === "es" && LATAM_LABEL_ES[code]) return LATAM_LABEL_ES[code];
  if (locale === "en" && LATAM_LABEL_EN[code]) return LATAM_LABEL_EN[code];
  return COUNTRIES[code]?.label ?? code;
}
