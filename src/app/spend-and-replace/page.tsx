// /spend-and-replace · the rebuttal to the #1 objection the directory
// gets on X ("I HODL, I will never sell my bitcoin"). Reframes spending
// as spend-and-replace: pay a merchant in bitcoin, then immediately
// rebuy the same amount with fiat. Stack unchanged, but bitcoin got used
// as money and the circular economy grew. Grounded in the Gresham's-law
// tension, real circular economies (Bitcoin Beach, Bitcoin Ekasi), and
// Square's 2026 auto-enable of BTC for eligible US sellers. This is the
// shareable URL to drop in an X reply when someone pushes back, and the
// SEO/AEO doorway for "spend and replace" / "bitcoin circular economy".
// Server-rendered, ISR, FAQPage JSON-LD. Built 2026-06-18.

// Growth 2026-09-17: quiet VendorHashrateModule after the practice grid so
// spend-and-replace / circular-economy readers (vs BTC Map physical pins and
// Cryptwerk multi-coin catalogues) convert onto paid USA ASIC rentals — same
// module as /v, online-stores, LATAM, /map, coffee, how-many, state-of, nostr-vendors.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { VENDORS } from "@/lib/vendors";
import { TimeMachine } from "./TimeMachine";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";

const URL = "https://galaxymind.space/spend-and-replace";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Spend and Replace: Keep Your Bitcoin Stack · Galaxy Mind",
  description:
    "Spend and replace: pay a merchant in bitcoin, then rebuy the same amount with fiat. Your stack stays unchanged and the bitcoin circular economy grows.",
  alternates: { canonical: URL },
  openGraph: {
    type: "article",
    url: URL,
    title: "Spend and Replace: Keep Your Bitcoin Stack",
    description:
      "You do not have to choose between HODLing and spending. Spend bitcoin, rebuy the same amount with fiat, grow the circular economy. Your stack stays the same.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/spend-and-replace/opengraph-image", "Spend and Replace: Keep Your Bitcoin Stack"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Spend and Replace: Keep Your Bitcoin Stack",
    description:
      "Spend bitcoin at a merchant, rebuy the same amount with fiat. Stack unchanged, circular economy grown. The answer to 'I will never sell my bitcoin.'",
    creator: "@GalaxyMind",
  },
};

export default async function SpendAndReplacePage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const vendorCount = VENDORS.length;

  const FAQ = [
    {
      q: "Does spending bitcoin mean I lose it?",
      a: "Not if you spend and replace. The moment you pay a merchant in bitcoin, you buy the same amount back with fiat on your usual exchange or DCA. Your bitcoin balance ends up exactly where it started; the only thing that changed is that some of your dollars went through the bitcoin economy instead of the bitcoin leaving your stack for good. You stay fully invested and still use bitcoin as money.",
    },
    {
      q: "Should I ever sell my bitcoin?",
      a: "The \"never sell your bitcoin\" mantra is good discipline, and spend and replace lets you honor it while still using bitcoin. Spending at a merchant and rebuying the same amount with fiat is not selling: your position is unchanged, so the rule holds and bitcoin still gets used as money. Selling outright, converting to fiat and keeping the cash, is a separate personal decision that depends on your own situation. Not financial advice.",
    },
    {
      q: "Should I spend my bitcoin or hold it?",
      a: "You can do both, and that is the point of spend and replace. Hold for the long term, but when you spend bitcoin at a merchant, rebuy the same amount with fiat so your position is unchanged. You get the upside of holding and the utility of spending without choosing one over the other. Whether to stack a little extra when you replace is a timing question, which is what the Galaxy Mind buying gauge is for. Not financial advice.",
    },
    {
      q: "What is spend and replace?",
      a: "Spend and replace is a simple habit: pay for something in bitcoin, then immediately rebuy the exact amount of bitcoin you just spent using fiat. It resolves the tension between HODLing (store of value) and spending (medium of exchange). You keep your long-term stack intact while still circulating bitcoin as money, which is what grows the circular economy and gives merchants a reason to keep accepting it.",
    },
    {
      q: "Doesn't Gresham's law say I should hoard bitcoin and spend fiat?",
      a: "Gresham's law (bad money drives out good) does make pure hoarding individually rational: spend the depreciating fiat, keep the appreciating bitcoin. But if every bitcoiner only ever hoards, bitcoin never becomes a usable currency and fiat wins as the medium of exchange by default. Spend and replace is the way out of that trap. You are not choosing spend OR hold; you do both in one motion, so bitcoin gets used as money AND your savings stay in bitcoin. This is exactly how working circular economies like Bitcoin Beach actually run.",
    },
    {
      q: "How do I replace the bitcoin I spent?",
      a: "Right after the purchase, place a buy for the same amount on whatever you already use to stack: your exchange, a DCA service, or a no-KYC swap. If you spent the equivalent of $25, buy $25 of bitcoin back. Many people batch it into their regular weekly buy. The Galaxy Mind buying gauge can tell you whether conditions favor stacking a little extra when you replace.",
    },
    {
      q: "Isn't spending bitcoin a taxable event?",
      a: "Yes, and it is fair to raise it. In the US, spending bitcoin is a disposal: you realize a capital gain or loss on the difference between what the bitcoin is worth when you spend it and what you originally paid for it. Spend and replace does not make that go away. What it does, paired with HIFO cost-basis accounting, is shrink the gain to almost nothing. Coins held longer than a year are also taxed at lower long-term rates. Rules vary by country, and this is general information, not tax advice.",
    },
    {
      q: "How does HIFO make spend and replace tax-efficient?",
      a: "HIFO (Highest In, First Out) is a specific-identification method the IRS allows: you dispose of your highest-cost-basis coins first. Those have appreciated the least, so each spend realizes the smallest possible gain. It pairs naturally with spend and replace, because every time you replace you buy bitcoin at the current price, which creates a fresh high-basis lot. Spending those newest coins first means a tiny or even zero realized gain, while your cheap, long-held coins stay untouched and keep deferring. If a high-basis lot is underwater, spending it can even book a loss to offset other gains. HIFO requires specific-identification records (acquisition date, cost, wallet); the US default is FIFO. US-centric, not tax advice.",
    },
    {
      q: "What if I'm underwater on my bitcoin?",
      a: "Then spend and replace can actively save you money. Spending a lot that is below your cost basis realizes a capital loss, and with HIFO you target your highest-cost, most-underwater lots first. In the US that loss offsets other capital gains plus up to $3,000 of ordinary income a year, with the rest carried forward. Because you really spent the bitcoin on a good or service, the loss has clear economic substance, and crypto is not currently subject to the wash-sale rule, so you can rebuy the same amount immediately. In a drawdown, when much of the market is underwater, this turns ordinary spending into tax-loss harvesting. Not tax advice; rules vary by country and can change.",
    },
    {
      q: "Where can I spend bitcoin?",
      a: `Galaxy Mind maintains a directory of ${vendorCount} verified merchants that accept native bitcoin (on-chain or Lightning) for everyday goods and services. Beyond that, Square now turns on bitcoin payments for eligible US sellers by default, so a growing number of ordinary shops can take it at checkout even if they have never thought about it. Browse the directory at galaxymind.space.`,
    },
    {
      q: "Can I pay with bitcoin at regular stores now?",
      a: "Increasingly, yes. In 2026 Square (part of Block) began automatically enabling bitcoin payments for eligible US sellers over the Lightning Network, with the seller receiving US dollars by default and no processing fee through 2026 (1% after that). Customers pay by flipping a toggle or scanning a QR code at checkout. It is worth asking any merchant whether they accept bitcoin; even a no plants the idea and raises awareness.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${URL}#article`,
        headline: "Spend and Replace: How to Use Bitcoin Without Shrinking Your Stack",
        description:
          "Spend and replace lets you use bitcoin as money while keeping your stack intact, growing the bitcoin circular economy.",
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · Spend and replace"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Grow the circular economy
        </div>
        <h1 className="display-title mb-4">
          Spend and replace
        </h1>

        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            You do not have to choose between holding bitcoin and spending it.
            Pay a merchant in bitcoin, then immediately rebuy the same amount
            with fiat. Your stack ends up exactly where it started, but you have
            used bitcoin as money and put a dollar of demand into the bitcoin
            economy instead of leaving it sitting idle. That is spend and
            replace, and it is how the circular economy grows without anyone
            giving up their savings.
          </p>
        </section>

        {/* Interactive proof · the prose above states the thesis, the
            time machine lets a skeptic run THEIR number through it
            (B4 · 2026-07-07). Placed before the Gresham's-law section
            so the visitor has felt the math before reading the theory. */}
        <section className="mb-10">
          <TimeMachine />
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            &quot;Never sell your bitcoin&quot; still lets you spend it
          </h2>
          <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            <p>
              The most common pushback on a bitcoin merchant directory is fair
              on its face: if bitcoin is the best money ever made, why would you
              ever part with it? Economists have a name for the instinct.
              Gresham&apos;s law says bad money drives out good, so the rational
              move is to spend the money that loses value (fiat) and hold the
              money that gains it (bitcoin). On its own, that logic says hoard
              forever.
            </p>
            <p>
              Here is the trap. If every bitcoiner only ever hoards, bitcoin
              never actually becomes money. It stays a savings account, fiat
              stays the thing you transact in, and the dream of a parallel
              bitcoin economy never arrives. Pure hoarding is rational for one
              person and self-defeating for the movement.
            </p>
            <p>
              Spend and replace is the way out. You are not choosing to spend{" "}
              <span className="italic">or</span>{" "}hold. You do both in a
              single motion: bitcoin leaves your wallet to pay an actual merchant,
              and the
              same amount comes back from your next fiat buy. You stay a
              store-of-value maximalist and you make bitcoin work as a medium of
              exchange at the same time.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            How it works, in three steps
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                n: "1",
                t: "Spend bitcoin",
                d: "Buy something tangible from a merchant that accepts bitcoin, on-chain or over Lightning. Say it comes to $25.",
              },
              {
                n: "2",
                t: "Replace it",
                d: "Immediately buy $25 of bitcoin back on your usual exchange or DCA. Same amount you just spent.",
              },
              {
                n: "3",
                t: "Net effect",
                d: "Your bitcoin balance is unchanged. A merchant just made a bitcoin sale, and $25 of demand entered the economy.",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
              >
                <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                  Step {s.n}
                </div>
                <div className="text-base font-semibold text-[var(--text-primary)] mb-2">
                  {s.t}
                </div>
                <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                  {s.d}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            The dollars you would have spent anyway now flow through a
            bitcoin-accepting business instead of a card network, and the
            merchant has one more reason to keep taking bitcoin. Do it enough and
            the loop becomes self-sustaining, because every new spender gives the
            next merchant a reason to sign up.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            What about the taxes?
          </h2>
          <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            <p>
              Worth saying plainly: in the US, spending bitcoin is a taxable
              disposal. You realize a capital gain or loss on the difference
              between what the bitcoin is worth when you spend it and what you
              originally paid. Pretending otherwise would be dishonest. The good
              news is that the size of that gain is largely up to you.
            </p>
            <p>
              Use{" "}
              <Link
                href="/glossary/hifo"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                HIFO
              </Link>{" "}
              (Highest In, First Out), a specific-identification method the IRS
              allows. It disposes of your highest-cost-basis coins first, the ones
              that have appreciated the least, so each spend realizes the smallest
              possible gain.
            </p>
            <p>
              Replacing also sets up the tax math in your favor. Every
              time you replace, you buy bitcoin at the current price, which mints a
              fresh high-basis lot. When you spend via HIFO you spend those newest
              coins first, the ones bought near today's price, so the realized gain
              is tiny or even zero. Your cheap, long-held coins stay untouched and
              keep deferring. If a high-basis lot is underwater, spending it can
              even book a loss to offset other gains.
            </p>
            <p>
              This matters most in a down market. When bitcoin trades below what
              you paid, which is true for much of the supply during any drawdown,
              spending those underwater lots via HIFO realizes a capital loss. In
              the US that loss offsets other capital gains, plus up to $3,000 of
              ordinary income a year, with the rest carried forward. And because
              you genuinely spent the bitcoin on something tangible, the disposal has
              clear economic substance, unlike a sham sell-and-rebuy. Crypto is
              not currently subject to the wash-sale rule either, so you can
              replace the coins right away. In a dip, spend and replace can lower your tax
              bill, not just defer it.
            </p>
            <p className="text-[var(--text-tertiary)]">
              HIFO needs specific-identification records (acquisition date, cost,
              and wallet for each lot); without them the US default is FIFO. Rules
              are US-centric and differ by country. This is general information,
              not tax advice · check with a professional or use crypto tax
              software.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            It already works: living circular economies
          </h2>
          <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            <p>
              This is not a thought experiment. In El Salvador,{" "}
              <span className="text-[var(--text-primary)] font-semibold">
                Bitcoin Beach
              </span>{" "}
              in El Zonte has run on a circular bitcoin economy since 2019: an
              anonymous donor funded it on the condition that the bitcoin be
              spent into local commerce rather than cashed out, and residents now
              pay for groceries, electricity, and school lunches in bitcoin.
            </p>
            <p>
              The model has spread. {" "}
              <span className="text-[var(--text-primary)] font-semibold">
                Bitcoin Ekasi
              </span>{" "}
              in South Africa, inspired by El Zonte, became the first bitcoin
              circular economy in Africa and pays some of its surf-school
              instructors in bitcoin. A federation of these communities now spans
              dozens of countries, sharing the same lesson: a circular economy
              survives when people keep spending bitcoin into it.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            The on-ramp just got a lot wider
          </h2>
          <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
            <p>
              In 2026, Square (part of Block) began{" "}
              <span className="text-[var(--text-primary)] font-semibold">
                automatically enabling bitcoin payments
              </span>{" "}
              for eligible US sellers over the Lightning Network. It is an opt-out rollout, not opt-in: the
              merchant receives US dollars by default, pays no processing fee
              through 2026 (1% after that), and the customer simply flips a toggle or scans a QR
              code at checkout. No new training, no setup.
            </p>
            <p>
              That means a huge number of ordinary shops can already take bitcoin
              whether or not they realize it. So one more habit worth keeping:{" "}
              <span className="text-[var(--text-primary)] font-semibold">
                ask whether a merchant accepts bitcoin.
              </span>{" "}
              If the answer is yes, spend and replace. If the answer is no, you
              have planted the idea and raised awareness, which is how the next
              merchant gets added.
            </p>
          </div>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Put it into practice
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⌂ Vendor directory
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                {vendorCount} merchants that take bitcoin
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Everyday goods and services for native bitcoin, on-chain or Lightning.
              </div>
            </Link>
            <Link
              href="/stack"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ₿ /stack
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                When to replace your sats
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The live buying gauge: is now a good time to stack what you spent?
              </div>
            </Link>
            <Link
              href="/how-to-help-grow-bitcoin"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group sm:col-span-2"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ↗ /how-to-help-grow-bitcoin
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                More ways to help grow bitcoin
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Spend and replace is one of several. The full list, from
                onboarding a merchant to running a node.
              </div>
            </Link>
          </div>
        </section>

        <VendorHashrateModule className="mb-10" />

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {f.q}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
