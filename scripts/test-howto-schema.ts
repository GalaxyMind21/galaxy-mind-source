// HowTo JSON-LD schema checks for /hashrate/how-to-rent
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildHowTo } from "../src/lib/json-ld";
import {
  GUIDE_PAGE_TITLE,
  GUIDE_PAGE_DESCRIPTION,
  GUIDE_PREREQS,
  GUIDE_STEPS,
} from "../src/lib/hashrate-copy";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

const HOWTO_URL = "https://galaxymind.space/hashrate/how-to-rent";

function guideHowTo() {
  return buildHowTo({
    name: GUIDE_PAGE_TITLE,
    description: GUIDE_PAGE_DESCRIPTION,
    url: HOWTO_URL,
    totalTime: "PT10M",
    steps: GUIDE_STEPS.map((s) => ({
      name: s.title,
      text: s.note ? `${s.body} ${s.note}` : s.body,
    })),
    supply: [{ name: GUIDE_PREREQS[0] }],
    tool: [{ name: GUIDE_STEPS[1].title }],
  });
}

console.log("\nHowTo JSON-LD /hashrate/how-to-rent\n");

{
  check("GUIDE_STEPS is five steps", GUIDE_STEPS.length === 5);
  const node = guideHowTo();
  check("HowTo @type", node["@type"] === "HowTo");
  check("HowTo name is GUIDE_PAGE_TITLE", node.name === GUIDE_PAGE_TITLE);
  check(
    "HowTo description is GUIDE_PAGE_DESCRIPTION",
    node.description === GUIDE_PAGE_DESCRIPTION,
  );
  check("HowTo url is the walkthrough", node.url === HOWTO_URL);
  check("totalTime is PT10M", node.totalTime === "PT10M");
  const steps = node.step as { "@type": string; name: string; text: string }[];
  check("five HowToStep entries", Array.isArray(steps) && steps.length === 5);
  check(
    "every step is HowToStep",
    steps.every((s) => s["@type"] === "HowToStep"),
  );
  check(
    "HowToStep names === GUIDE_STEPS[].title",
    steps.every((s, i) => s.name === GUIDE_STEPS[i].title),
  );
  check(
    "HowToStep texts are body (+ note)",
    steps.every((s, i) => {
      const expected = GUIDE_STEPS[i].note
        ? `${GUIDE_STEPS[i].body} ${GUIDE_STEPS[i].note}`
        : GUIDE_STEPS[i].body;
      return s.text === expected;
    }),
  );
  const supply = node.supply as { "@type": string; name: string }[];
  check(
    "supply uses the bitcoin-wallet prereq string",
    Array.isArray(supply) &&
      supply.length === 1 &&
      supply[0]["@type"] === "HowToSupply" &&
      supply[0].name === GUIDE_PREREQS[0],
  );
  const tool = node.tool as { "@type": string; name: string }[];
  check(
    "tool uses the existing MiningRigRentals account string",
    Array.isArray(tool) &&
      tool.length === 1 &&
      tool[0]["@type"] === "HowToTool" &&
      tool[0].name === GUIDE_STEPS[1].title,
  );
}

{
  const page = readFileSync(
    resolve("src/app/hashrate/how-to-rent/page.tsx"),
    "utf8",
  );
  check("page imports buildHowTo", page.includes("buildHowTo"));
  check(
    "page emits a second application/ld+json script",
    page.split("application/ld+json").length === 3,
  );
  check("page calls buildHowTo with GUIDE_PAGE_TITLE", page.includes("name: GUIDE_PAGE_TITLE"));
  check(
    "page maps GUIDE_STEPS into HowTo steps",
    page.includes("steps: GUIDE_STEPS.map"),
  );
  check("page sets totalTime PT10M", page.includes("totalTime:") && page.includes("PT10M"));
  check(
    "page does not add a visible FAQ block",
    !page.includes("FAQ_ITEMS") && !page.includes("FAQ_TITLE"),
  );
}

{
  const sitemap = readFileSync(resolve("src/app/sitemap.ts"), "utf8");
  const idx = sitemap.indexOf("galaxymind.space/hashrate/how-to-rent");
  check("sitemap still lists /hashrate/how-to-rent", idx !== -1);
  const slice = sitemap.slice(idx, idx + 180);
  check(
    "sitemap lastModified for the walkthrough is 2026-08-31",
    slice.includes("2026-08-31"),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll HowTo schema checks passed.\n");
