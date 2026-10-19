// /is-strive-overvalued · exact-match SEO doorway for the "is strive
// overvalued" query (people search the brand, not the ASST ticker).
// Thin wrapper · shared logic in <OvervaluedPage>.
import { OvervaluedPage } from "@/components/OvervaluedPage";
import { buildOvervaluedMetadata } from "@/lib/overvalued";

export const revalidate = 300;
export const metadata = buildOvervaluedMetadata("ASST");

export default function Page() {
  return <OvervaluedPage ticker="ASST" />;
}
