// /hashrate/how-to-rent and /hashrate/agents in RENTALS_MODE=mrr_only: short marketplace guides, primary CTA to the
// /hashrate selector, plus the marketplace signup link with its referral disclosure (the login-walled profile page is
// never linked). No prices, no rig ids, no hardware model.
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { SupportLine } from "./SupportLine";
import { supportInfo } from "@/lib/support";
import {
  MARKETPLACE_REGISTER_URL, MARKETPLACE_REGISTER_CTA, MARKETPLACE_REFERRAL_NOTE, MARKETPLACE_LINK_REL,
} from "@/lib/marketplace-listing";
import { MRR_RENT_PICK_CTA } from "@/lib/mrr-page-copy";
import { safeJsonLd } from "@/lib/json-ld";

// jsonLd (optional): whole schema.org documents, each emitted as its own inert
// data block. Callers build them from the same steps this component renders.
export function MarketplaceGuide({ h1, lede, steps, jsonLd, nonce }: {
  h1: string; lede: string; steps: { title: string; body: string }[];
  jsonLd?: Record<string, unknown>[]; nonce?: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className="night-bench mx-auto w-full max-w-4xl px-4 py-10 sm:px-6" data-mrr-guide>
        {jsonLd?.map((doc, i) => (
          <script
            key={i}
            type="application/ld+json"
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: safeJsonLd(doc) }}
          />
        ))}
        <h1 className="display-title">{h1}</h1>
        <p className="night-bench-lede">{lede}</p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.title} className="glass-rest rounded-2xl p-5">
              <p className="font-mono text-[13px] text-[var(--accent-ink)]">0{i + 1}</p>
              <p className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">{s.body}</p>
            </li>
          ))}
        </ol>
        <section className="hero-glass mt-8 rounded-3xl p-6 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/hashrate#rent-hero"
              className="lit-primary inline-flex min-h-[52px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              {MRR_RENT_PICK_CTA} →
            </Link>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]" data-referral-note>{MARKETPLACE_REFERRAL_NOTE}</p>
          <a href={MARKETPLACE_REGISTER_URL} target="_blank" rel={MARKETPLACE_LINK_REL} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-[var(--accent-ink)] underline underline-offset-2">
            {MARKETPLACE_REGISTER_CTA}
            <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </section>
        <SupportLine support={supportInfo()} className="mt-8" />
      </main>
      <FooterDisclaimer />
    </>
  );
}
