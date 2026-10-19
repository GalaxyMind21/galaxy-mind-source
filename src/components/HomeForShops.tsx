"use client";
// "For shops" merchant pitch (competitor teardown lesson A3, 2026-10-18).
// Replaces the old "Know a vendor we're missing?" box near the bottom of the
// home page, BELOW the directory, so shoppers keep the first viewport. Gives
// sellers their own CTA ("List your shop free" → /submit) next to a shopper
// CTA ("Browse shops" → the directory). Click event is anonymous: surface
// only, through the Vercel Analytics already wired on this page.
import Link from "next/link";
import { track } from "@vercel/analytics";
import { useT } from "@/components/LocaleProvider";
import { FOR_SHOPS_POINTS } from "@/lib/for-shops";

export function HomeForShops() {
  const { t } = useT();
  return (
    <section
      aria-labelledby="home-shops-h"
      className="max-w-3xl mx-auto px-4 sm:px-6 pb-12"
      data-home-for-shops
    >
      <div className="hero-glass rounded-2xl p-6 sm:p-8">
        <p className="night-bench-kicker">{t("home.shopsKicker")}</p>
        <h2 id="home-shops-h" className="text-2xl sm:text-3xl font-medium tracking-tight mb-4">
          {t("home.shopsH2")}
        </h2>
        <ul className="space-y-2 mb-6 text-sm text-[var(--text-secondary)] leading-relaxed">
          {FOR_SHOPS_POINTS.map((k) => (
            <li key={k} className="flex gap-2">
              <span aria-hidden className="text-[var(--accent-ink)]">✓</span>
              <span>
                {t(k)}
                {k === "home.shopsPoint3" ? (
                  <>
                    {" "}
                    <Link
                      href="/badge"
                      className="text-[var(--text-primary)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
                    >
                      {t("home.shopsBadgeLink")}
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/submit"
            onClick={() => track("submit_cta_click", { surface: "home_for_shops" })}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-6 text-sm font-semibold text-black transition-colors hover:bg-[var(--accent-hover)]"
            data-submit-cta
          >
            {t("home.shopsCta")}
            <span aria-hidden>→</span>
          </Link>
          <a
            href="#vendor-directory"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--border-subtle)] px-5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]/60"
            data-browse-cta
          >
            {t("home.shopsBrowse")}
          </a>
        </div>
        <div className="mt-4 text-sm text-[var(--text-tertiary)]">
          <a href="#email-updates" className="underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]">
            {t("home.shopsEmail")} →
          </a>
        </div>
      </div>
    </section>
  );
}
