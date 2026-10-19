// /letter/YYYY-MM · one monthly "Letter from the directory" (operator-approved
// 2026-10-18). Server-rendered prose from src/lib/letters.ts with Article
// + BreadcrumbList JSON-LD. Unknown months 404.
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { safeJsonLd } from "@/lib/json-ld";
import { LETTERS, letterBySlug, letterText } from "@/lib/letters";
import { OG_DIRECTORY } from "@/lib/og";

const SITE_URL = "https://galaxymind.space";

export const dynamicParams = false;

export function generateStaticParams() {
  return LETTERS.map((l) => ({ month: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ month: string }>;
}): Promise<Metadata> {
  const { month } = await params;
  const letter = letterBySlug(month);
  if (!letter) return { title: "Letter not found · Galaxy Mind" };
  const url = `${SITE_URL}/letter/${letter.slug}`;
  return {
    title: `${letter.title} · Galaxy Mind`,
    description: letter.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      images: OG_DIRECTORY,
      url,
      title: letter.title,
      description: letter.summary,
      publishedTime: letter.published,
      modifiedTime: letter.modified,
    },
    // Root layout sets twitter:title/description for the home page; without
    // these the X card would show the home title on a shared letter.
    twitter: { title: letter.title, description: letter.summary },
  };
}

export default async function LetterPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;
  const letter = letterBySlug(month);
  if (!letter) notFound();

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const url = `${SITE_URL}/letter/${letter.slug}`;

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: letter.title,
        description: letter.summary,
        url,
        mainEntityOfPage: url,
        datePublished: letter.published,
        dateModified: letter.modified,
        wordCount: letterText(letter).split(/\s+/).filter(Boolean).length,
        author: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isPartOf: { "@id": `${SITE_URL}/letter#blog` },
        image: `${SITE_URL}/opengraph-image`,
        inLanguage: "en-US",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Galaxy Mind", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Letter from the directory", item: `${SITE_URL}/letter` },
          { "@type": "ListItem", position: 3, name: letter.month, item: url },
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

      <article className="max-w-2xl mx-auto px-6 pt-10 pb-20" data-letter={letter.slug}>
        <nav
          aria-label="Breadcrumb"
          className="t-xs font-medium text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/letter" className="hover:text-[var(--accent-ink)] transition-colors">
            Letter from the directory
          </Link>
          <span aria-hidden> · </span>
          <span>{letter.month}</span>
        </nav>
        <h1 className="display-title mb-3">{letter.title}</h1>
        <p className="micro-label text-[var(--text-tertiary)] mb-8">
          Published <time dateTime={letter.published}>{letter.month}</time> by
          the Galaxy Mind directory
        </p>

        <div className="nb-panel p-6 sm:p-8 space-y-5 text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
          {letter.body.map((b, i) => {
            if (b.kind === "h2")
              return (
                <h2 key={i} className="text-xl font-semibold text-[var(--text-primary)] pt-2">
                  {b.text}
                </h2>
              );
            if (b.kind === "shops")
              return (
                <ul key={i} className="space-y-3">
                  {b.items.map((s) => (
                    <li key={s.href}>
                      <Link
                        href={s.href}
                        className="font-semibold text-[var(--text-primary)] underline hover:text-[var(--accent-ink)]"
                      >
                        {s.name}
                      </Link>
                      <span aria-hidden> · </span>
                      {s.note}
                    </li>
                  ))}
                </ul>
              );
            return <p key={i}>{b.text}</p>;
          })}
          <p className="pt-2">
            <Link href="/submit" className="underline hover:text-[var(--accent-ink)]">
              List your shop free
            </Link>
            <span aria-hidden> · </span>
            <Link href="/" className="underline hover:text-[var(--accent-ink)]">
              Browse the directory
            </Link>
            <span aria-hidden> · </span>
            <Link href="/letter" className="underline hover:text-[var(--accent-ink)]">
              All letters
            </Link>
          </p>
        </div>
      </article>
    </main>
  );
}
