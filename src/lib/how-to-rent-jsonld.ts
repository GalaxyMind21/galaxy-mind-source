// Structured data for /hashrate/how-to-rent in RENTALS_MODE=mrr_only, the
// live marketplace guide (SEO desk fix, 2026-10-18). Built only from the five
// MRR_GUIDE_STEPS the page renders: no price, no rig id, no hardware model,
// nothing the visible copy does not already say.
import { buildBreadcrumb, buildHowTo } from "@/lib/json-ld";
import { MRR_GUIDE_DESCRIPTION, MRR_GUIDE_H1, MRR_GUIDE_STEPS } from "@/lib/mrr-page-copy";

const SITE_URL = "https://galaxymind.space";
export const HOW_TO_RENT_URL = `${SITE_URL}/hashrate/how-to-rent`;

export function mrrGuideJsonLd(): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      ...buildHowTo({
        name: MRR_GUIDE_H1,
        description: MRR_GUIDE_DESCRIPTION,
        url: HOW_TO_RENT_URL,
        totalTime: "PT15M",
        steps: MRR_GUIDE_STEPS.map((s) => ({ name: s.title, text: s.body })),
        supply: [{ name: "Your pool's stratum address and worker" }],
        tool: [{ name: MRR_GUIDE_STEPS[1].title }],
      }),
    },
    {
      "@context": "https://schema.org",
      ...buildBreadcrumb([
        { name: "Galaxy Mind", url: SITE_URL },
        { name: "Rent hashrate", url: `${SITE_URL}/hashrate` },
        { name: "How to rent", url: HOW_TO_RENT_URL },
      ]),
    },
  ];
}
