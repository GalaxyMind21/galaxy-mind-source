// Home-page FAQ (competitor teardown lesson A4, 2026-10-18). Message keys
// only: the visible <details> list (components/HomeFaq.tsx) and the FAQPage
// JSON-LD (app/page.tsx) both resolve these same keys, so the markup can
// never drift from what a visitor reads. Keep answers to 1-3 sentences and
// make no claim /terms does not already make. /faq stays the full version.
export type HomeFaqItem = { q: string; a: string; link?: { href: string; label: string } };

export const HOME_FAQ: HomeFaqItem[] = [
  { q: "home.faq1Q", a: "home.faq1A" },
  { q: "home.faq2Q", a: "home.faq2A" },
  { q: "home.faq3Q", a: "home.faq3A", link: { href: "/methodology", label: "home.faq3Link" } },
  { q: "home.faq4Q", a: "home.faq4A" },
  { q: "home.faq5Q", a: "home.faq5A" },
  { q: "home.faq6Q", a: "home.faq6A", link: { href: "/how-to-pay-with-lightning", label: "home.faq6Link" } },
];

/** FAQPage node for the home @graph, from any key → string resolver. */
export function homeFaqLd(t: (key: string) => string, pageUrl: string) {
  return {
    "@type": "FAQPage",
    "@id": `${pageUrl}/#home-faq`,
    mainEntity: HOME_FAQ.map((f) => ({
      "@type": "Question",
      name: t(f.q),
      acceptedAnswer: { "@type": "Answer", text: t(f.a) },
    })),
  };
}
