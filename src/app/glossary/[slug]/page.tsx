// /glossary/[slug] · one page per glossary term (2026-06-10).
//
// Why per-term pages when /glossary already has anchors: featured
// snippets and AI-agent citations link to dedicated URLs, not
// fragment anchors on a combined page. "What is mNAV" resolving to
// /glossary/mnav (with its own title, OG card, and DefinedTerm
// JSON-LD) is what wins those surfaces. The hub stays as the
// browsable index; these pages are the citable leaves.
//
// Data: same src/lib/glossary.ts single source of truth as the hub ·
// adding a term there ships hub entry + page + sitemap entry + OG
// card with zero extra wiring (generateStaticParams walks ALL_TERMS).
//
// JSON-LD: the canonical DefinedTerm @id for each term is THIS page's
// URL (the hub's hasDefinedTerm[] references the same @ids so the
// graph stays one node per concept · no duplicate-term forks).

import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";
import { ALL_TERMS, GLOSSARY } from "@/lib/glossary";
import { DEEP_DIVES } from "@/lib/glossary-deep";
import { SiteHeader } from "@/components/SiteHeader";

const SITE_URL = "https://galaxymind.space";

export function generateStaticParams() {
  return ALL_TERMS.map((t) => ({ slug: t.slug }));
}

// Terms change only on deploy (data lives in the repo) · fully static.
export const dynamicParams = false;

function findTerm(slug: string) {
  for (const section of GLOSSARY) {
    const term = section.terms.find((t) => t.slug === slug);
    if (term) return { term, section };
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hit = findTerm(slug);
  if (!hit) return {};
  const { term } = hit;
  // Two terms carry their expansion inside the name ("CEBE BPS (Common
  // Equity Bitcoin Exposure per share)", "BTC ARR (bitcoin annualized
  // return) vs cost of capital"), which put their titles at 83 and 86
  // chars against the ~70 Ahrefs cuts at. Drop to the bare term ONLY
  // when the full form would overflow, so every other glossary title is
  // untouched and a future long term fixes itself. The expansion is not
  // lost: it is the H1, the description and the DefinedTerm JSON-LD.
  const SUFFIX = "? · Galaxy Mind Glossary";
  const full = `What is ${term.term}${SUFFIX}`;
  const short = term.term.split(" (")[0].split(" vs ")[0].trim();
  const title = full.length > 70 ? `What is ${short}${SUFFIX}` : full;
  const description =
    term.definition.length > 155
      ? term.definition.slice(0, 152).trimEnd() + "..."
      : term.definition;
  const url = `${SITE_URL}/glossary/${term.slug}`;
  return {
    title,
    description,
    openGraph: { type: "article", url, title, description, siteName: "Galaxy Mind", images: pageOgImage(`/glossary/${term.slug}/opengraph-image`, title) },
    twitter: { card: "summary_large_image", title, description, creator: "@GalaxyMind" },
    alternates: { canonical: url },
  };
}

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hit = findTerm(slug);
  if (!hit) notFound();
  const { term, section } = hit;
  const deepDive = DEEP_DIVES[term.slug];
  const url = `${SITE_URL}/glossary/${term.slug}`;

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // Canonical DefinedTerm node for this concept + breadcrumb. The
  // FAQPage mirrors the page's own "What is X?" framing so the
  // direct-question query has a direct-answer schema.
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTerm",
        "@id": url,
        name: term.term,
        description: term.definition,
        termCode: term.slug,
        url,
        inDefinedTermSet: { "@id": `${SITE_URL}/glossary#termset` },
        ...(term.sourceUrl
          ? { subjectOf: { "@type": "WebPage", url: term.sourceUrl } }
          : {}),
        ...(term.internalUrl ? { sameAs: term.internalUrl } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Glossary",
            item: `${SITE_URL}/glossary`,
          },
          { "@type": "ListItem", position: 2, name: term.term, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: `What is ${term.term}?`,
            acceptedAnswer: { "@type": "Answer", text: term.definition },
          },
        ],
      },
    ],
  };

  const related = section.terms.filter((t) => t.slug !== term.slug).slice(0, 4);

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)] pb-16">
      {/* SAFE: static, server-controlled JSON-LD from lib/glossary.ts ·
          no user input. safeJsonLd escapes for defense in depth. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-10">
        <nav className="t-xs font-medium text-[var(--text-tertiary)]">
          <Link href="/glossary" className="hover:text-[var(--accent-ink)] transition-colors">
            Glossary
          </Link>{" "}
          <span aria-hidden>·</span> {section.title}
        </nav>

        <h1 className="mt-3 text-3xl sm:text-4xl tracking-tight leading-tight">
          {term.term}
        </h1>

        <p className="mt-5 text-base sm:text-lg text-[var(--text-secondary)] font-sans leading-relaxed">
          {term.definition}
        </p>

        {term.expansion && (
          <p className="mt-4 text-sm text-[var(--text-tertiary)] font-sans leading-relaxed border-l-2 border-[var(--accent)]/40 pl-4">
            {term.expansion}
          </p>
        )}

        <div className="micro-label mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {term.internalUrl && (
            <a
              href={term.internalUrl}
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              See it live →
            </a>
          )}
          {term.sourceUrl && (
            <a
              href={term.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Source ↗
            </a>
          )}
        </div>

        {/* Deep dive · the depth layer (content pass 2026-06-12).
            Three sections per term from lib/glossary-deep.ts ·
            presentation-only prose, never part of the citable
            DefinedTerm contract above. Roughly triples each page's
            content (the pages averaged ~130 words of body text,
            too thin to rank as standalone results). */}
        {deepDive && (
          <div className="mt-10 space-y-8">
            {(
              [
                ["How to read it", deepDive.howToRead],
                ["On Galaxy Mind", deepDive.onGalaxyMind],
                ["Context", deepDive.context],
              ] as const
            ).map(([heading, body]) => (
              <section key={heading}>
                <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-2.5">
                  {heading}
                </h2>
                <p className="text-sm sm:text-[15px] text-[var(--text-secondary)] font-sans leading-relaxed">
                  {body}
                </p>
              </section>
            ))}
          </div>
        )}

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Related terms
            </h2>
            <ul className="space-y-2">
              {related.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/glossary/${t.slug}`}
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors font-sans"
                  >
                    {t.term} →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="micro-label mt-12 pt-6 border-t border-[var(--border-subtle)]">
          <Link href="/glossary" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
            ← All {ALL_TERMS.length} terms
          </Link>
        </div>
      </div>
    </main>
  );
}
