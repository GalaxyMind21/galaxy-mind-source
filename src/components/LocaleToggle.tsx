"use client";

import { LATAM_ES_PATH, LATAM_PATH, type Locale } from "@/lib/i18n";
import { useT } from "@/components/LocaleProvider";

/**
 * EN|ES for the Latin America page only. A full load is required: /es/…
 * is rewritten onto the English route, so a client transition would
 * leave the previous locale's tree on screen.
 */
export function LocaleToggle() {
  const { locale, t } = useT();

  function setLocale(next: Locale) {
    if (next === locale) return;
    const qs = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const href = next === "es" ? LATAM_ES_PATH : LATAM_PATH;
    window.location.assign(`${href}${qs}${hash}`);
  }

  return (
    <div
      role="group"
      aria-label={t("locale.toggleAria")}
      className="micro-label inline-flex items-center text-[var(--text-secondary)]"
    >
      <button
        type="button"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
        className={[
          "px-1.5 h-8 rounded-md transition-colors",
          locale === "en"
            ? "text-[var(--text-primary)] font-semibold"
            : "hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        EN
      </button>
      <span aria-hidden className="text-[var(--text-secondary)]/60">
        |
      </span>
      <button
        type="button"
        aria-pressed={locale === "es"}
        onClick={() => setLocale("es")}
        className={[
          "px-1.5 h-8 rounded-md transition-colors",
          locale === "es"
            ? "text-[var(--text-primary)] font-semibold"
            : "hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        ES
      </button>
    </div>
  );
}
