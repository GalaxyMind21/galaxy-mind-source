// /hashrate/rent · human browser-wallet checkout (operator, 2026-10-16).
// Pick rigs and days, give your pool, pay with USDC on Base from your own
// wallet. Server-rendered state comes from checkoutView(): when the kill
// switch is on, phase 2 is off or RENTALS_HUMAN_CHECKOUT is not set, the
// page shows a calm "opening soon" card and the client never calls the
// order route.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { checkoutView } from "@/lib/rentals/phase2/human";
import { RentCheckout } from "./RentCheckout";
import { RentShell } from "./RentShell";
import { SupportLine } from "../components/SupportLine";
import { supportInfo, type SupportInfo } from "@/lib/support";
import { payRailsLabel } from "@/lib/rentals/rails";
import { mrrOnly } from "@/lib/rentals/mode";
import {
  MARKETPLACE_REGISTER_URL, MARKETPLACE_REGISTER_CTA,
  MARKETPLACE_REFERRAL_NOTE, MARKETPLACE_LINK_REL, MARKETPLACE_CARD_EYEBROW,
} from "@/lib/marketplace-listing";
import { MRR_RENT_TITLE, MRR_RENT_DESCRIPTION, MRR_RENT_H1, MRR_RENT_BODY, MRR_RENT_PICK_CTA } from "@/lib/mrr-page-copy";

const SITE_URL = "https://galaxymind.space";
const URL_ = `${SITE_URL}/hashrate/rent`;
const TITLE = "Rent Bitcoin Hashrate · Checkout · Galaxy Mind";
const DESCRIPTION = "Rent SHA-256 Bitcoin hash power by the day. Choose your hashrate and days, point it at your pool and pay from your own wallet. No account needed.";

export const dynamic = "force-dynamic";

const DIRECT_METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL_ },
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: URL_,
    images: [{ url: "/hashrate/opengraph-image", width: 1200, height: 630, alt: "Rent bitcoin hashrate · Galaxy Mind" }],
  },
};

// RENTALS_MODE=mrr_only (default): the marketplace page, noindex, 200 so old links and Discord embeds land somewhere useful.
const MRR_METADATA: Metadata = {
  title: MRR_RENT_TITLE,
  description: MRR_RENT_DESCRIPTION,
  alternates: { canonical: URL_ },
  robots: { index: false, follow: true },
  openGraph: { ...DIRECT_METADATA.openGraph, title: MRR_RENT_TITLE, description: MRR_RENT_DESCRIPTION },
  // Stays noindex. Twitter tags so shared links stop inheriting the directory card.
  twitter: {
    card: "summary_large_image",
    site: "@GalaxyMind",
    title: MRR_RENT_TITLE,
    description: MRR_RENT_DESCRIPTION,
    images: [{ url: "/hashrate/opengraph-image", width: 1200, height: 630, alt: "Rent bitcoin hashrate · Galaxy Mind" }],
  },
};

export function generateMetadata(): Metadata {
  return mrrOnly() ? MRR_METADATA : DIRECT_METADATA;
}

export default async function RentPage() {
  if (mrrOnly()) {
    return (
      <>
        <SiteHeader />
        <RentShell>
          <MarketplaceRent support={supportInfo()} />
        </RentShell>
        <FooterDisclaimer />
      </>
    );
  }
  const view = await checkoutView();
  const support = supportInfo();
  return (
    <>
      <SiteHeader />
      <RentShell>
        {view.open ? <RentCheckout view={view} support={support} /> : <OpeningSoon support={support} paused={view.reason === "paused"} />}
      </RentShell>
      <FooterDisclaimer />
    </>
  );
}

/** Checkout off (flag unset, phase 2 off or kill switch on). Every "Rent now" on
 *  /hashrate lands here, so this must never send the renter back to /hashrate:
 *  the primary action is the agents page, where bots rent today. */
function OpeningSoon({ support, paused }: { support: SupportInfo; paused: boolean }) {
  return (
    <section className="rent-glass mt-2 rounded-xl p-6 sm:p-8" aria-labelledby="soon-h">
      <p className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-1 text-[13px] text-[var(--accent-ink)]">
        <span aria-hidden>●</span> {paused ? "Direct rentals are paused" : "Rentals are open for AI bots"}
      </p>
      <h1 id="soon-h" className="night-bench-title mt-4">
        {paused ? "Checkout is paused right now" : "Browser checkout opening soon"}
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[var(--text-secondary)]">
        {paused
          ? "We've paused new direct rentals for a moment. Nothing you've already paid for is affected. Your AI bot can tell you the moment rentals reopen."
          : `Soon you can rent US-based Bitcoin hash power right here and pay with ${payRailsLabel()} from your own wallet.`}
      </p>
      <div className="mt-5 rounded-lg border border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/60 p-4">
        <p className="micro-label text-[var(--text-tertiary)]">{paused ? "When rentals reopen, rent with your AI bot" : "Rent today with your AI bot"}</p>
        <ol className="mt-2 space-y-1.5 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          <li><span className="font-mono text-[var(--accent-ink)]">1</span>{" "}Connect Grok Bot or any AI bot to Galaxy Mind.</li>
          <li><span className="font-mono text-[var(--accent-ink)]">2</span>{" "}Ask it for hashrate, days and a quote, and give it your pool.</li>
          <li><span className="font-mono text-[var(--accent-ink)]">3</span>{" "}It pays in {payRailsLabel()} and hands you an access code.</li>
        </ol>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/hashrate/agents"
          className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black lit-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
        >
          Rent with your AI bot →
        </Link>
        <Link
          href="/hashrate"
          className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-[var(--nb-hair-2)] bg-[var(--nb-surface)] px-6 text-[15px] text-[var(--text-primary)] hover:border-[var(--accent)]/40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
        >
          See live hashrate and odds
        </Link>
      </div>
      <SupportLine support={support} className="mt-6" />
    </section>
  );
}

/** mrr_only: direct checkout closed; send people to the /hashrate selector (the marketplace profile is login-walled, so
 *  it is not linked). The referral disclosure stays next to the one outbound signup link. No ?pay= handling. */
function MarketplaceRent({ support }: { support: SupportInfo }) {
  return (
    <section className="rent-glass mt-2 rounded-xl p-6 sm:p-8" aria-labelledby="mrr-rent-h" data-mrr-rent>
      <p className="micro-label text-[var(--accent-ink)]">{MARKETPLACE_CARD_EYEBROW}</p>
      <h1 id="mrr-rent-h" className="night-bench-title mt-4">{MRR_RENT_H1}</h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[var(--text-secondary)]">{MRR_RENT_BODY}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/hashrate#rent-hero"
          className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black lit-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
        >
          {MRR_RENT_PICK_CTA} →
        </Link>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-tertiary)]" data-referral-note>{MARKETPLACE_REFERRAL_NOTE}</p>
      <a href={MARKETPLACE_REGISTER_URL} target="_blank" rel={MARKETPLACE_LINK_REL} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-[var(--accent-ink)] underline underline-offset-2">
        {MARKETPLACE_REGISTER_CTA}
        <span aria-hidden>↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <SupportLine support={support} className="mt-6" />
    </section>
  );
}
