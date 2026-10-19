// /is-mstr-overvalued · exact-match SEO doorway for the high-volume
// "is mstr overvalued" query. Thin wrapper · all logic + structured
// data live in <OvervaluedPage> and lib/overvalued.ts (shared across
// the four treasury valuation pages).
import { OvervaluedPage } from "@/components/OvervaluedPage";
import { buildOvervaluedMetadata } from "@/lib/overvalued";

export const revalidate = 300;
export const metadata = buildOvervaluedMetadata("MSTR");

export default function Page() {
  return <OvervaluedPage ticker="MSTR" />;
}
