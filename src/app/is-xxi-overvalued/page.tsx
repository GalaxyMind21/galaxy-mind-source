// /is-xxi-overvalued · exact-match SEO doorway for the "is xxi
// overvalued" query. XXI is used (not "twenty one") because it is the
// unambiguous search token · "twenty one" collides with blackjack and
// the film. Thin wrapper · shared logic in <OvervaluedPage>.
import { OvervaluedPage } from "@/components/OvervaluedPage";
import { buildOvervaluedMetadata } from "@/lib/overvalued";

export const revalidate = 300;
export const metadata = buildOvervaluedMetadata("XXI");

export default function Page() {
  return <OvervaluedPage ticker="XXI" />;
}
