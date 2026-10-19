// /submit · public-facing vendor submission form.
//
// This is the URL you send to vendors who tag you on X / Nostr
// saying "add me". They paste their handle, the form auto-fills via
// /api/enrich-handle, they fill in the few remaining required
// fields (country, category), and submit. The submission lands in
// the KV moderation queue · you review with
// `npx tsx scripts/review-submissions.ts`.
//
// Page = server component (SSR metadata + canonical URL).
// Form = SubmitForm client component (handles state + fetches).

import type { Metadata } from "next";
import Link from "next/link";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { SubmitForm } from "./SubmitForm";
import { SiteHeader } from "@/components/SiteHeader";
import { pageOgImage, SUBMIT_OG_ALT } from "@/lib/og";
import { getRequestLocale, translate } from "@/lib/locale";
import { FOR_SHOPS_POINTS } from "@/lib/for-shops";

const URL = "https://galaxymind.space/submit";

export const metadata: Metadata = {
  title: "Submit your shop · Galaxy Mind",
  description:
    "Add your Bitcoin-accepting shop to the Galaxy Mind directory. Paste your handle · we auto-fill the rest from your public profile. Review within 24-48 hours.",
  alternates: { canonical: URL },
  openGraph: {
    images: pageOgImage("/submit/opengraph-image", SUBMIT_OG_ALT),
    title: "Submit your shop to Galaxy Mind",
    description:
      "Get listed in the Bitcoin vendor directory. Auto-enriched onboarding · a person confirms a bitcoin payment before anything goes live.",
    url: URL,
    siteName: "Galaxy Mind",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Submit your shop to Galaxy Mind",
    description:
      "Get listed in the Bitcoin vendor directory. A person confirms a bitcoin payment before anything goes live.",
    site: "@GalaxyMind",
  },
};

export default async function SubmitPage() {
  const locale = await getRequestLocale();
  const t = (key: string) => translate(locale, key);
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      {/* max-w widens at lg so SubmitForm's sticky live-preview rail
          fits beside the form · the intro/footer prose below stays
          capped at 2xl for line-length readability. */}
      <article className="max-w-2xl lg:max-w-5xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          {t("submit.kicker")}
        </div>
        <h1 className="display-title mb-4 text-[var(--text-primary)]">
          {t("submit.h1Lead")}
          <span className="text-[var(--accent-ink)] glow-text">{t("submit.h1Shop")}</span>
          {t("submit.h1End")}
        </h1>
        <p className="max-w-2xl text-[var(--text-secondary)] text-base sm:text-lg mb-8 leading-relaxed">
          {t("submit.lead")}
        </p>

        {/* WHY LIST HERE (competitor teardown lesson A3, 2026-10-18) · the
            same five "For shops" points as the home page, compact. */}
        <div className="hero-glass max-w-2xl mb-6 rounded-xl p-4 sm:p-5" data-submit-pitch>
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            {t("submit.pitchKicker")}
          </div>
          <ul className="space-y-1.5 text-sm text-[var(--text-secondary)] leading-relaxed">
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
        </div>

        <div className="max-w-2xl mb-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/50 p-4">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            {t("submit.eligibilityKicker")}
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {t("submit.eligibility")}
          </p>
        </div>

        <SubmitForm />

        <div className="max-w-2xl mt-12 pt-6 border-t border-[var(--border-subtle)]">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            {t("submit.howKicker")}
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
            {t("submit.how")}
          </p>
          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            {t("submit.preferOld")}{" "}
            <a
              href="https://x.com/GalaxyMind"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              @GalaxyMind on X
            </a>{" "}
            {t("submit.orNostr")}
          </p>
        </div>
      </article>

      <FooterDisclaimer />
    </main>
  );
}
