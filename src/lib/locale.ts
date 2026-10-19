import { headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_PREFIX_HEADER,
  interpolate,
  type Locale,
} from "@/lib/i18n";
import { MESSAGES } from "@/lib/messages";

/** Spanish only on the /es LATAM URL. Cookie and Accept-Language do not count. */
export async function getMetadataLocale(): Promise<Locale> {
  const hdrs = await headers();
  return hdrs.get(LOCALE_PREFIX_HEADER) === "1" ? "es" : DEFAULT_LOCALE;
}

/** Same as metadata: prefix only, so chrome cannot go Spanish on an English URL. */
export async function getRequestLocale(): Promise<Locale> {
  return getMetadataLocale();
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = MESSAGES[locale] ?? MESSAGES.en;
  const raw = table[key] ?? MESSAGES.en[key] ?? key;
  return interpolate(raw, vars);
}

export function htmlLang(locale: Locale): string {
  return locale === "es" ? "es" : "en";
}
