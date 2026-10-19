// /fit · server wrapper around the client allocation engine.
//
// Why this file exists (2026-07-07 · share-card upgrade): the engine
// itself is a client component (FitClient.tsx · live recompute, URL
// state, localStorage recall). But a shared /fit?h=10&t=4&a=roth link
// used to show scrapers the GENERIC live-signals OG image · the
// recipient saw a card about the tool, not the sender's portfolio.
// generateMetadata here routes Twitter/Facebook scrapers to
// /api/og/fit?h&t&a, which recomputes the SAME recommendation
// server-side and renders the actual sleeve mix as the card.
//
// Security model mirrors /api/og/stack: only the three enum-ish inputs
// (h 1-30 int, t 1-6 int, a ∈ {taxable,traditional,roth}) are honored.
// Nothing free-text flows from the URL into the card · the sleeves are
// engine OUTPUT, so a fabricated URL can only ever render a portfolio
// the engine would genuinely recommend. Invalid/absent params fall
// back to the file-convention opengraph-image.tsx (live signals card).

import type { Metadata } from "next";
import { FitClient } from "./FitClient";

const SITE = "https://galaxymind.space";

function parseFitParams(sp: {
  h?: string | string[];
  t?: string | string[];
  a?: string | string[];
}): { h: number; t: number; a: string } | null {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const h = parseInt(one(sp.h) ?? "", 10);
  const t = parseInt(one(sp.t) ?? "", 10);
  const a = one(sp.a) ?? "";
  if (!Number.isFinite(h) || h < 1 || h > 30) return null;
  if (!Number.isFinite(t) || t < 1 || t > 6) return null;
  if (a !== "taxable" && a !== "traditional" && a !== "roth") return null;
  return { h, t, a };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{
    h?: string | string[];
    t?: string | string[];
    a?: string | string[];
  }>;
}): Promise<Metadata> {
  const parsed = parseFitParams(await searchParams);
  // Bare /fit → inherit the layout metadata + the file-convention
  // opengraph-image (live signals). Returning {} keeps both.
  if (!parsed) return {};

  const og = `${SITE}/api/og/fit?h=${parsed.h}&t=${parsed.t}&a=${parsed.a}`;
  const title = "My bitcoin fit · Galaxy Mind Allocation Engine";
  const alt = "A shared portfolio mix card from the Galaxy Mind allocation engine, sizing bitcoin and bitcoin-linked stocks to a time horizon and risk tolerance.";
  const description =
    "A shared portfolio mix from the Galaxy Mind allocation engine · Bitcoin and Bitcoin-linked stocks sized to a time horizon, risk tolerance, and account type.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE}/fit?h=${parsed.h}&t=${parsed.t}&a=${parsed.a}`,
      siteName: "Galaxy Mind",
      type: "website",
      images: [{ url: og, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: "@GalaxyMind",
      images: [{ url: og, alt }],
    },
  };
}

export default function FitPage() {
  return <FitClient />;
}
