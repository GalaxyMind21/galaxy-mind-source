"use client";
// Short collapsible FAQ near the bottom of the home page (competitor
// teardown lesson A4, 2026-10-18). Sits BELOW the directory, so the first
// viewport stays the free vendor directory. Answer text is rendered from the
// same keys as the FAQPage JSON-LD in app/page.tsx (lib/home-faq.ts); any
// follow-up link sits outside the answer paragraph so the two stay identical.
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";
import { HOME_FAQ } from "@/lib/home-faq";

export function HomeFaq() {
  const { t } = useT();
  return (
    <section
      aria-labelledby="home-faq-h"
      className="max-w-3xl mx-auto px-4 sm:px-6 mb-10"
      data-home-faq
    >
      <div className="hero-glass rounded-2xl p-5 sm:p-7">
        <p className="night-bench-kicker">{t("home.faqKicker")}</p>
        <h2 id="home-faq-h" className="text-xl sm:text-2xl font-medium tracking-tight mb-4">
          {t("home.faqH2")}
        </h2>
        <div className="divide-y divide-[var(--border-subtle)]">
          {HOME_FAQ.map((f) => (
            <details key={f.q} className="group py-3" data-home-faq-item>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
                {t(f.q)}
                <span aria-hidden className="shrink-0 text-[var(--text-tertiary)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]" data-home-faq-answer>
                {t(f.a)}
              </p>
              {f.link ? (
                <Link
                  href={f.link.href}
                  className="mt-2 inline-block text-sm text-[var(--accent-ink)] underline decoration-[var(--accent-ink)]/40 underline-offset-2 hover:decoration-[var(--accent-ink)]"
                >
                  {t(f.link.label)} →
                </Link>
              ) : null}
            </details>
          ))}
        </div>
        <Link
          href="/faq"
          className="mt-4 inline-block text-sm text-[var(--text-tertiary)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]"
        >
          {t("home.faqMore")} →
        </Link>
      </div>
    </section>
  );
}
