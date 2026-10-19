// /is-metaplanet-overvalued · exact-match SEO doorway for the
// "is metaplanet overvalued" query (people search the brand, not the
// MPJPY ticker). Thin wrapper · shared logic in <OvervaluedPage>.
import { OvervaluedPage } from "@/components/OvervaluedPage";
import { buildOvervaluedMetadata } from "@/lib/overvalued";

export const revalidate = 300;
export const metadata = buildOvervaluedMetadata("MPJPY");

export default function Page() {
  return <OvervaluedPage ticker="MPJPY" />;
}
