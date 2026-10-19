/**
 * LATAM page + the one Spanish URL. Sitewide /es is retired.
 * Wired into `npm run verify`. Pure and offline.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ES_LATAM_ALIAS_PATHS,
  LATAM_ES_PATH,
  LATAM_PATH,
  hasLocalePrefix,
  isSpanishLatamAlias,
  isSpanishLatamPath,
  stripLocalePrefix,
  withLocalePrefix,
} from "../src/lib/i18n";
import {
  LATAM_COUNTRY_CODES,
  countByLatamCountry,
  countryLabel,
  honestLead,
  latamMetaDescription,
  isLatamCountry,
  latamVendors,
  looksLikeLatamQuery,
  btcMapUrl,
} from "../src/lib/latam";
import { COUNTRIES, VENDORS } from "../src/lib/vendors";
import { MESSAGES } from "../src/lib/messages";
import { INDEPENDENCE_CLAIM } from "../src/lib/listing";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n🌎 LATAM / i18n\n");

{
  const list = latamVendors();
  check("latamVendors is drawn from VENDORS, not a hardcoded roster", true);
  check(
    "every listed shop has a LATAM country code",
    list.every((v) => isLatamCountry(v.country)),
  );
  check(
    "Brazil has at least one listed online shop",
    list.some((v) => v.country === "BR"),
  );
  check(
    "Brazil is in COUNTRIES so the country hub can generate",
    Object.prototype.hasOwnProperty.call(COUNTRIES, "BR"),
  );
  check(
    "Argentina is not invented as an online shop",
    list.every((v) => v.country !== "AR"),
  );
  check(
    "live LATAM shops are a subset of the real roster",
    list.every((v) => VENDORS.some((x) => x.handle === v.handle)),
  );
  check(
    "LATAM set still includes BR and AR",
    (LATAM_COUNTRY_CODES as readonly string[]).includes("BR") &&
      (LATAM_COUNTRY_CODES as readonly string[]).includes("AR"),
  );
}

{
  check("btcMapUrl is the country page, no pin counts", btcMapUrl("br") === "https://btcmap.org/country/br");
  check("Perú is the Spanish label", countryLabel("PE", "es") === "Perú");
  check("Peru stays unaccented in English", countryLabel("PE", "en") === "Peru");
}

{
  const lead = honestLead("en", 3, { CO: 2, PE: 1 });
  check("honestLead interpolates the live count, not 'four'", lead.includes("3") && !/\bfour\b/i.test(lead));
  check("honestLead names the countries that have shops", lead.includes("Colombia") && lead.includes("Peru"));
  check("honestLead still names empty Brazil and Argentina", lead.includes("none yet in Brazil or Argentina"));
  const withBr = honestLead("en", 1, { BR: 1 });
  check(
    "honestLead drops Brazil from the empty list once a shop lands",
    !withBr.includes("none yet in Brazil") && withBr.includes("none yet in Argentina"),
  );
  const es = honestLead("es", 2, { SV: 2 });
  check("Spanish honestLead pluralizes and uses ni", es.includes("2 comercios") && es.includes("Brasil ni Argentina"));
  const liveList = latamVendors();
  const liveLead = honestLead(
    "en",
    liveList.length,
    countByLatamCountry(liveList),
  );
  check(
    "live honestLead no longer claims Brazil is empty",
    !liveLead.includes("none yet in Brazil"),
  );
  check(
    "live honestLead still names empty Argentina",
    liveLead.includes("Argentina"),
  );
  const metaEn = latamMetaDescription("en", liveList.length);
  const metaEs = latamMetaDescription("es", liveList.length);
  check("English LATAM meta description stays under 155 chars", metaEn.length <= 155);
  check("Spanish LATAM meta description stays under 155 chars", metaEs.length <= 155);
  check("English LATAM meta interpolates the live count", metaEn.includes(String(liveList.length)));
}

{
  check("brazil search is a LATAM query", looksLikeLatamQuery("brazil"));
  check("México folds to a LATAM query", looksLikeLatamQuery("México"));
  check("latinoamérica folds to a LATAM query", looksLikeLatamQuery("latinoamérica"));
  check("germany is not a LATAM query", !looksLikeLatamQuery("germany"));
  check("empty search is not a LATAM query", !looksLikeLatamQuery(""));
}

{
  check("strip /es", stripLocalePrefix("/es") === "/");
  check("strip /es/submit", stripLocalePrefix("/es/submit") === "/submit");
  check("English path is unchanged", stripLocalePrefix("/submit") === "/submit");
  check("prefix English is a no-op", withLocalePrefix("/submit", "en") === "/submit");
  check("prefix Spanish adds /es", withLocalePrefix("/submit", "es") === "/es/submit");
  check("prefix Spanish home is /es", withLocalePrefix("/", "es") === "/es");
  check("hasLocalePrefix /es", hasLocalePrefix("/es") && hasLocalePrefix("/es/submit") && !hasLocalePrefix("/submit"));
  check("Spanish LATAM path is the only Spanish page", isSpanishLatamPath(LATAM_ES_PATH) && !isSpanishLatamPath(LATAM_PATH) && !isSpanishLatamPath("/es/hashrate"));
  check("trailing slash still counts as the Spanish LATAM page", isSpanishLatamPath(LATAM_ES_PATH + "/"));
  check(
    "empty-roster /es aliases are listed",
    ES_LATAM_ALIAS_PATHS.every((p) => isSpanishLatamAlias(p)) &&
      !isSpanishLatamAlias("/es/hashrate"),
  );
}

{
  const enKeys = Object.keys(MESSAGES.en).sort();
  const esKeys = Object.keys(MESSAGES.es).sort();
  check(
    "en.json and es.json have the same keys",
    JSON.stringify(enKeys) === JSON.stringify(esKeys),
    `en ${enKeys.length} · es ${esKeys.length}`,
  );
  const missingEs = enKeys.filter((k) => MESSAGES.es[k] === undefined);
  check("no English key is missing in Spanish", missingEs.length === 0, missingEs.join(","));
  check(
    "homepage independence claim matches listing.ts",
    MESSAGES.en["home.independence"] === INDEPENDENCE_CLAIM,
  );
  const stale = [...enKeys, ...esKeys].filter((k) => {
    const v = (MESSAGES.en[k] ?? "") + (MESSAGES.es[k] ?? "");
    return /four LATAM|cuatro comercios LATAM/i.test(v);
  });
  check("no dictionary string hardcodes the LATAM shop count", stale.length === 0, stale.join(","));
}

{
  const cfg = readFileSync(resolve("next.config.ts"), "utf8");
  for (const source of [
    "/spend-bitcoin-in/brazil",
    "/spend-bitcoin-in/brasil",
    "/spend-bitcoin-in/br",
  ]) {
    check(
      `${source} is not a LATAM empty-roster redirect`,
      !cfg.includes(`"${source}"`),
    );
  }
  check(
    'COUNTRY_HUB_ALIASES maps br → brazil',
    /br:\s*"brazil"/.test(cfg),
  );
  check(
    "COUNTRY_HUB_ALIASES do not emit /es twins (proxy 308s leftover /es to English)",
    !cfg.includes("`/es/spend-bitcoin-in/${alias}`"),
  );
  for (const source of [
    "/spend-bitcoin-in/argentina",
    "/spend-bitcoin-in/ar",
    "/spend-bitcoin-in/latin-america",
    "/spend-bitcoin-in/latinoamerica",
  ]) {
    check(`${source} is in the LATAM redirect list`, cfg.includes(`"${source}"`));
  }
  check(
    "English guessed URLs 308 to the LATAM page",
    cfg.includes('destination: "/spend-bitcoin-in-latin-america"'),
  );
  check(
    "/es guessed URLs 308 to the Spanish LATAM page",
    cfg.includes('destination: "/es/spend-bitcoin-in-latin-america"') &&
      cfg.includes("`/es${source}`"),
  );
  check(
    "next.config rewrites only the Spanish LATAM URL",
    cfg.includes('source: "/es/spend-bitcoin-in-latin-america"') &&
      cfg.includes('destination: "/spend-bitcoin-in-latin-america"') &&
      cfg.includes("beforeFiles") &&
      !cfg.includes('source: "/es/:path*"'),
  );
}

{
  const proxy = readFileSync(resolve("src/proxy.ts"), "utf8");
  check(
    "proxy imports locale helpers from lib/i18n (no second copy)",
    proxy.includes('from "@/lib/i18n"') &&
      !proxy.includes("function stripLocalePrefix") &&
      !proxy.includes("function hasLocalePrefix"),
  );
  check(
    "proxy stamps the prefix header only for the Spanish LATAM page",
    proxy.includes("LOCALE_PREFIX_HEADER") &&
      proxy.includes("isSpanishLatamPath") &&
      proxy.includes('hasEsPrefix ? "1" : "0"'),
  );
  check(
    "proxy 308s leftover /es paths instead of rewriting them",
    proxy.includes("bounceNonLatamSpanish") &&
      proxy.includes("NextResponse.redirect") &&
      !proxy.includes("NextResponse.rewrite"),
  );
  check(
    "proxy expires the retired gm_locale cookie",
    proxy.includes("retireLocaleCookie") && proxy.includes("maxAge: 0"),
  );
  check(
    "proxy does not read Accept-Language or set gm_locale",
    !proxy.includes("acceptLanguagePrefersEs") &&
      !proxy.includes("attachLocaleCookie"),
  );
}

{
  const page = readFileSync(
    resolve("src/app/spend-bitcoin-in-latin-america/page.tsx"),
    "utf8",
  );
  const meta = page.slice(
    page.indexOf("export async function generateMetadata"),
    page.indexOf("export default async function"),
  );
  check("LATAM metadata uses prefix locale, not cookie/Accept-Language", meta.includes("getMetadataLocale"));
  check("LATAM generateMetadata does not call getRequestLocale", !meta.includes("getRequestLocale"));
  check("LATAM page hosts the language toggle", page.includes("LocaleToggle"));
  const loc = readFileSync(resolve("src/lib/locale.ts"), "utf8");
  check(
    "request locale ignores cookies and Accept-Language",
    !loc.includes("cookies") &&
      !loc.includes("LOCALE_COOKIE") &&
      loc.includes("getMetadataLocale"),
  );
}

{
  const toggle = readFileSync(resolve("src/components/LocaleToggle.tsx"), "utf8");
  check(
    "locale toggle does a full load so /es is not a no-op client transition",
    toggle.includes("location.assign") && !toggle.includes("router.push("),
  );
  check(
    "locale toggle only switches the LATAM URLs",
    toggle.includes("LATAM_ES_PATH") &&
      toggle.includes("LATAM_PATH") &&
      !toggle.includes("withLocalePrefix") &&
      !toggle.includes("LOCALE_COOKIE"),
  );
  const header = readFileSync(resolve("src/components/SiteHeader.tsx"), "utf8");
  const mobile = readFileSync(resolve("src/components/MobileBottomNav.tsx"), "utf8");
  check(
    "site chrome no longer carries a sitewide language toggle",
    !header.includes("LocaleToggle") && !mobile.includes("LocaleToggle"),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll LATAM / i18n checks passed.\n");
