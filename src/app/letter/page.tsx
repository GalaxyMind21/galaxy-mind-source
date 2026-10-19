// /letter · index of the monthly "Letter from the directory" (operator-approved
// 2026-10-18). Server-rendered list of every letter, newest first, with a
// Blog + BreadcrumbList JSON-LD node. Content lives in src/lib/letters.ts.
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/SiteHeader";
import { safeJsonLd } from "@/lib/json-ld";
import { LETTERS } from "@/lib/letters";
import { OG_DIRECTORY } from "@/lib/og";

const SITE_URL = "https://galaxymind.space";
const URL_ = `${SITE_URL}/letter`;
const DESCRIPTION =
  "A short monthly letter from the Galaxy Mind directory: which shops joined, what we fixed and what we are working on next.";

export const metadata: Metadata = {
  title: "Letter from the directory · Galaxy Mind",
  description: DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    type: "website",
    images: OG_DIRECTORY,
    url: URL_,
    title: "Letter from the directory · Galaxy Mind",
    description: DESCRIPTION,
  },
  twitter: { title: "Letter from the directory · Galaxy Mind", description: DESCRIPTION },
};

export default async function LetterIndexPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${URL_}#blog`,
        url: URL_,
        name: "Letter from the directory",
        description: DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en-US",
        blogPost: LETTERS.map((l) => ({
          "@type": "Article",
          "@id": `${SITE_URL}/letter/${l.slug}#article`,
          headline: l.title,
          url: `${SITE_URL}/letter/${l.slug}`,
          datePublished: l.published,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Galaxy Mind", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Letter from the directory", item: URL_ },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      {/* Static house strings only · no user input; safeJsonLd()
          escapes `<` and U+2028/U+2029. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Monthly letter
        </div>
        <h1 className="display-title mb-4">
          Letter from{" "}
          <span className="text-[var(--accent-ink)]">the directory</span>
          .
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed mb-10">
          Once a month we write down which shops joined, what we fixed and
          what comes next. It takes about two minutes to read.
        </p>

        <ul className="grid gap-4" data-letter-index>
          {LETTERS.map((l) => (
            <li key={l.slug}>
              <Link
                href={`/letter/${l.slug}`}
                className="nb-panel card-lift block p-5"
              >
                <div className="micro-label text-[var(--text-tertiary)] mb-1.5">
                  <time dateTime={l.published}>{l.month}</time>
                </div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1.5">
                  {l.title}
                </h2>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {l.summary}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-sm text-[var(--text-tertiary)]">
          Want new shops as they land? Follow the{" "}
          <Link href="/feed.xml" className="underline hover:text-[var(--accent-ink)]">
            vendor RSS feed
          </Link>{" "}
          or browse the{" "}
          <Link href="/" className="underline hover:text-[var(--accent-ink)]">
            directory
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
