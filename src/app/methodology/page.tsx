import type { Metadata } from "next";
import Link from "next/link";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";

export const metadata: Metadata = {
  title: "Methodology · how Galaxy Mind computes everything",
  description:
    "Open methodology for the Buying Gauge, Bitcoin float, treasury mNAV/CEBE, allocation engine, and how vendors are vetted. Cite the math.",
  alternates: { canonical: "https://galaxymind.space/methodology" },
  openGraph: {
    type: "website",
    images: OG_DIRECTORY,
    url: "https://galaxymind.space/methodology",
    title: "Galaxy Mind methodology · open, citable",
    description:
      "Gauge weights, float cohorts, mNAV/CEBE, fit engine, and vendor vetting · one trust hub.",
  },
};

const HUB = [
  {
    href: "/stack",
    label: "Buying Gauge",
    sub: "10 weighted signals, 0–100 score, tiers COLD→MOLTEN · full signal list on /stack and /glossary",
  },
  {
    href: "/float",
    label: "Bitcoin Float / Supply Clock",
    sub: "In-play supply, cohorts, drain rate · definitions on /float and glossary “in-play”",
  },
  {
    href: "/treasuries/methodology",
    label: "Treasuries · gross vs net mNAV",
    sub: "CEBE, BPS, amplification, share-count overrides · deep dive on /treasuries/methodology",
  },
  {
    href: "/fit",
    label: "Allocation engine",
    sub: "Horizon, tolerance, account type → sleeves · invariants tested in scripts/test-recommend.ts",
  },
  {
    href: "/status",
    label: "Data quality / degraded mode",
    sub: "When ≥4/8 market signals are null, crons refuse and UIs say updating · live /status",
  },
  {
    href: "/glossary",
    label: "Glossary",
    sub: "Citable DefinedTerm entries for every metric used on the site",
  },
] as const;

export default function MethodologyPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Methodology
        </div>
        <h1 className="display-title mb-4">
          How Galaxy Mind{" "}
          <span className="text-[var(--accent-ink)]">computes everything</span>
          .
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed mb-8">
          One trust hub for instruments, data quality, and the vendor
          bar. Open methodology · no black boxes. Not financial advice.
        </p>

        <nav
          aria-label="Methodology topics"
          className="mb-12 grid gap-3 sm:grid-cols-2"
        >
          {HUB.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nb-panel p-4 card-lift"
            >
              <div className="micro-label text-[var(--text-primary)] mb-1.5">
                {item.label}
              </div>
              <p className="text-xs text-[var(--text-tertiary)] leading-relaxed font-sans">
                {item.sub}
              </p>
            </Link>
          ))}
        </nav>

        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Vendor directory
        </div>
        <h2 className="text-2xl sm:text-3xl font-medium tracking-tight mb-6 text-[var(--text-primary)] leading-tight">
          How a vendor{" "}
          <span className="text-[var(--accent-ink)]">earns its spot</span>
          .
        </h2>

        <div className="space-y-5 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
          <p>
            A directory is only as good as the bar it holds. Anyone can
            scrape a list of &ldquo;Bitcoin&rdquo; accounts. The point
            of this one is that a human actually checked each entry
            against the rules below before it went live, and
            re-checks them on a schedule. Here is the entire process,
            unedited.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            1. Sells <em>for</em>{" "}Bitcoin, not just Bitcoin-themed
          </h2>
          <p>
            The inclusion test is &ldquo;you can pay this vendor in
            Bitcoin for a genuine, physical good or service,&rdquo; not
            &ldquo;this brand has an orange logo.&rdquo; A shop that
            sells Bitcoin-motif merch but only takes fiat at checkout is
            a different thing than a shop that takes sats. When a
            vendor is clearly themed but on-site acceptance can&apos;t
            be confirmed, the listing says exactly that rather than
            implying more than is known.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            2. Identity checks come first
          </h2>
          <ul className="space-y-3">
            <li>
              <span className="text-[var(--accent-ink)]">Nostr</span> · the
              vendor&apos;s <code>npub</code>{" "}is decoded and their
              published profile (kind:0 metadata) is fetched from
              multiple relays and{" "}
              <span className="text-[var(--text-primary)]">
                cryptographically signature-verified (BIP-340 Schnorr)
              </span>{" "}
              before a single field is trusted. Relays are untrusted
              infrastructure; a signature is not.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">Lightning</span> ·
              any Lightning Address is shape-validated, and when a
              vendor publishes a signed <code>lud16</code>{" "}it&apos;s
              cross-checked against what was submitted.
            </li>
            <li>
              <span className="text-[var(--accent-ink)]">X</span> · the
              linked profile is spot-checked by a human (there is no
              reliable public X activity API, so this is deliberate
              manual review, not an automated guess).
            </li>
          </ul>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            3. Every claim is corroborated
          </h2>
          <p>
            Submitted details are checked against the vendor&apos;s own
            signed profile and live site. A description, Lightning
            address, or website is only recorded when it&apos;s
            high-confidence and sourced, matching the
            vendor&apos;s signed metadata or stated plainly on their
            own site. Nothing is fabricated or guessed to fill a field;
            an unknown stays unknown. Marketing copy is rewritten into
            a short factual description.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            4. Outbound links are HTTPS-only
          </h2>
          <p>
            Every website and image URL must be{" "}
            <code>https://</code>. A plaintext outbound link is a
            mixed-content downgrade, is MITM-tamperable, and leaks a
            visitor&apos;s IP to an unauthenticated origin. A
            commit-time validator rejects anything that isn&apos;t
            HTTPS so it can never reach a card.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            5. A human approves every entry
          </h2>
          <p>
            There is no auto-add. Public submissions land in a
            moderation queue (with spam/honeypot filtering); a human
            reviews each one, runs the schema validator, and only then
            does it reach the public list. Approval is a deliberate
            decision every time.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            6. It stays fresh
          </h2>
          <p>
            Every card shows the date the vendor was last confirmed,
            and any entry past the staleness window is flagged for
            re-verification on the card itself, where you can see it.
            Every listing&apos;s platform profile is also checked
            automatically every day to confirm it still resolves. Where
            a shop URL is listed, that page is watched in case it stops
            mentioning bitcoin or Lightning at all. Anything that
            changes goes to a person to review. The date on the
            card is the last time a human confirmed it, not the last
            automated check. We also track Nostr vendors that go quiet,
            which is what feeds removal review, but nothing is hidden
            from you on that basis: the directory renders every listing
            and lets the confirmation date speak for itself.
          </p>

          <h2 className="text-xl font-semibold text-[var(--text-primary)] pt-4">
            7. What this is not
          </h2>
          <p>
            It is not an endorsement, a guarantee, or financial advice.
            It&apos;s a curated starting point. Verification
            reduces risk; it doesn&apos;t remove it. Always do your own
            due diligence before transacting, and tell us if something
            looks off.
          </p>

          <p className="pt-4">
            Think a shop belongs here? It&apos;ll go through exactly
            the above.{" "}
            <Link
              href="/submit"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
            >
              Submit a vendor
            </Link>
            . More about the project on the{" "}
            <Link
              href="/about"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] font-semibold"
            >
              about page
            </Link>
            .
          </p>
        </div>
      </article>

      <FooterDisclaimer />
    </main>
  );
}
