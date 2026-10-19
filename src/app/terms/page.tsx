import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";

// Terms of use (2026-09-20). Written in the same plain-English house
// style as /privacy · describes how the site is actually used, not a
// copy-pasted template. Covers the directory, instruments, arcade,
// hashrate desk, submissions, and embeds. Update this page in the same
// commit when a product surface changes the deal with visitors.

export const metadata: Metadata = {
  title: "Terms · Galaxy Mind",
  description:
    "Terms of use for Galaxy Mind: the Bitcoin merchant directory, instruments, arcade, and hashrate rentals desk. Plain English, not legalese theater.",
  alternates: { canonical: "https://galaxymind.space/terms" },
  // Declaring openGraph at all REPLACES the root layout's block whole,
  // so title/description/images have to be restated here even though
  // they echo the fields above. Same merge semantics as /privacy and
  // lib/og.ts.
  openGraph: {
    type: "website",
    title: "Terms · Galaxy Mind",
    description:
      "Terms of use for Galaxy Mind: directory, instruments, arcade, and hashrate desk. Plain English.",
    url: "https://galaxymind.space/terms",
    images: OG_DIRECTORY,
  },
};

const UPDATED = "September 20, 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--text-primary)] mb-3">
        {title}
      </h2>
      <div className="space-y-4 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Terms
        </div>
        <h1 className="display-title mb-6 text-[var(--text-primary)]">
          The rules for using{" "}
          <span className="text-[var(--accent-ink)] glow-text">
            Galaxy Mind
          </span>
          , written so a human can read them.
        </h1>

        <div className="space-y-5 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
          <p>
            By using galaxymind.space you agree to these terms. If you do
            not agree, do not use the site. We keep this page honest and
            short on purpose · the same spirit as our{" "}
            <Link
              href="/privacy"
              className="text-[var(--accent-ink)] underline underline-offset-4"
            >
              privacy policy
            </Link>
            .
          </p>
        </div>

        <Section title="What Galaxy Mind is">
          <p>
            Galaxy Mind is an independent project. The free core includes a
            human-verified directory of merchants that accept Bitcoin, a set
            of educational Bitcoin instruments and charts, an arcade, and a
            hashrate rentals desk. We are not a bank, broker, exchange,
            payment processor, or mining host.
          </p>
          <p>
            Nothing on this site is financial, investment, tax, or legal
            advice. Tools that show prices, gauges, treasury metrics, or
            allocation ideas are educational. You decide what to do with
            your own money.
          </p>
        </Section>

        <Section title="The merchant directory">
          <p>
            Listings are human-reviewed and inbound: a shop generally asks
            to be listed before we publish a page. A listing is not an
            endorsement, warranty, or guarantee that a merchant is honest,
            solvent, legal in your jurisdiction, or still accepting Bitcoin
            tomorrow.
          </p>
          <p>
            We may refuse, edit, pause, or remove any listing for any
            reason, including listings that involve drugs or other
            controlled substances, illegal goods or services, fraud, or
            material that fails our review bar. Naming a shop in chat or
            research is not permission to list it.
          </p>
          <p>
            When you buy from a merchant in the directory, that deal is
            entirely between you and them. Galaxy Mind never takes the
            order, holds funds, or processes the payment.
          </p>
        </Section>

        <Section title="Vendor submissions">
          <p>
            If you submit a shop, you must have the right to share what you
            send, and the information must be accurate to the best of your
            knowledge. You grant Galaxy Mind permission to publish the
            fields needed for a public listing and to contact you about the
            outcome of the review.
          </p>
          <p>
            Do not spam the form, submit competitors as harassment, or use
            the submission channel to push malware, scams, or illegal
            goods. We may reject or delete submissions without a debate.
          </p>
        </Section>

        <Section title="Hashrate rentals">
          <p>
            The hashrate desk helps you discover and rent SHA-256 hashrate
            from machines Galaxy Mind operates. Rentals are finished
            directly with Galaxy Mind.
          </p>
          <p>
            Availability, pricing, and uptime can change. There is no
            general Galaxy Mind SLA beyond what is stated for your rental. Mining is risky and can lose
            money; treat the desk as a convenience layer, not a promise of
            profit.
          </p>
        </Section>

        <Section title="Arcade, badges, and embeds">
          <p>
            Arcade games, leaderboards, badges, and embed snippets are
            provided as-is for personal, non-abusive use. Do not cheat
            scoring systems, scrape in a way that harms the service, or
            misrepresent a Galaxy Mind badge as proof of anything we have
            not verified.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            Use the site and public APIs within published rate limits. Do
            not attempt unauthorized access, disrupt the service, harvest
            personal data, or use Galaxy Mind to break the law. We may
            throttle, block, or ban abusive traffic.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p>
            Galaxy Mind branding, site design, and original copy belong to
            the project. Merchants and third parties keep their own marks
            and content. Do not copy the directory wholesale or present our
            work as yours.
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            The site is provided “as is.” We do not warrant uninterrupted
            availability, perfect data, or fitness for a particular
            purpose. Market numbers, directory status, and rental quotes
            can be wrong, delayed, or stale.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the fullest extent allowed by law, Galaxy Mind and its
            operator are not liable for indirect, incidental, special, or
            consequential damages, or for losses tied to using or not being
            able to use the site, a listed merchant, or a hashrate rental.
            If liability cannot be fully excluded, it is limited to the
            greater of ten US dollars or what you paid Galaxy Mind for the
            specific paid feature at issue in the prior twelve months (most
            visitors pay nothing).
          </p>
        </Section>

        <Section title="Indemnity">
          <p>
            If your misuse of the site, a false submission, or your dispute
            with a merchant or rental counterparty causes us claims or
            costs, you agree to indemnify the project and its operator for
            those losses to the extent the law allows.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of the State of Tennessee,
            USA, without regard to conflict-of-law rules. Courts located in
            Tennessee have exclusive jurisdiction for disputes that cannot
            be resolved informally, except where applicable consumer law
            says otherwise.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update these terms. The date below changes when we do.
            Continued use after a material update means you accept the new
            terms. If you cannot accept them, stop using the site.
          </p>
          <p className="t-xs font-medium text-[var(--text-tertiary)] pt-2">
            Last updated {UPDATED}
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms:{" "}
            <a
              href="https://x.com/GalaxyMind"
              className="text-[var(--accent-ink)] underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              @GalaxyMind on X
            </a>
            . Same channel we use for privacy requests · one person reading
            them, so replies are honest rather than instant.
          </p>
        </Section>
      </article>
    </main>
  );
}
