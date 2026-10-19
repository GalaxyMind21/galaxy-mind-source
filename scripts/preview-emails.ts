// Renders the operator's outbound email templates to standalone HTML
// files so they can be opened in a browser and visually verified
// without triggering a real send. Useful when:
//
//   - Iterating on a template's copy or layout (rebuild + reload, no
//     KV/Resend round-trip)
//   - Verifying that the cron-produced email would render correctly
//     before a real subscriber receives one (audit gap: tsc + next
//     build can't tell you "this <table> looks broken in Gmail-dark")
//   - Showing the operator what a subscriber will see, end-to-end
//
// Outputs HTML files into /tmp/galaxymind-email-previews/ and prints
// the absolute paths. Open them in any browser (or Playwright for an
// automated screenshot pass) to inspect.
//
// Add new templates here as we ship them · the pattern is:
//   1. Construct realistic mock inputs (real shapes, no real users)
//   2. Call the renderer
//   3. Write {subject, html} to disk with a self-explanatory filename
//
// Run with:
//   npx tsx scripts/preview-emails.ts
//
// IMPORTANT: this script never calls Resend. It only generates HTML
// for local inspection. A real test send would require a separate
// authenticated flow (or just opting yourself in via /fit + waiting
// for the Sunday cron).

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  renderAlertEmail,
  renderConfirmEmail,
  renderDigestEmail,
  renderFitChangeEmail,
  renderFloatMilestoneEmail,
  renderHashrateAvailableEmail,
  renderForecastAlertEmail,
  renderMnavAlertEmail,
  renderMonthlyRoundupEmail,
  renderNewVendorDigestEmail,
  renderTierFlipEmail,
  renderVendorLiveEmail,
  renderWelcomeEmail,
  type MonthlyRoundupTreasuryMover,
  type MonthlyRoundupVendor,
} from "../src/lib/email";
import type { SleeveSnapshot } from "../src/lib/fit-alert";

// Where to write the previews. /tmp keeps them out of the repo + auto-
// cleaned by the OS over time.
const OUT_DIR = "/tmp/galaxymind-email-previews";
mkdirSync(OUT_DIR, { recursive: true });

const RECIPIENT = "preview@galaxymind.space";

// ---- /fit allocation-change · WEIGHT diff scenario ----------------
// Realistic: a Moderate-tolerance 10y Roth portfolio where the engine
// re-routed some MSTR weight into income sleeves after live signals
// shifted (MSTR mNAV compressed, F&G drifted lower). All weights are
// integer percent · matches the toSleeveSnapshot(rec.allocation) shape
// the cron actually produces.
const prevWeight: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 40 },
  { ticker: "BTC", weight: 25 },
  { ticker: "STRC", weight: 20 },
  { ticker: "MPJPY", weight: 15 },
];
const nextWeight: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 31 },  // -9pp
  { ticker: "BTC", weight: 25 },
  { ticker: "STRC", weight: 24 },  // +4pp (under threshold · won't appear in shifted)
  { ticker: "MPJPY", weight: 20 }, // +5pp
];

const weightHtml = renderFitChangeEmail({
  recipientEmail: RECIPIENT,
  h: 10,
  t: 4,
  a: "roth",
  diff: {
    changed: true,
    kind: "weight",
    added: [],
    removed: [],
    shifted: [
      { ticker: "MSTR", prevWeight: 40, nextWeight: 31, deltaPp: -9 },
      { ticker: "MPJPY", prevWeight: 15, nextWeight: 20, deltaPp: 5 },
    ],
  },
  prev: prevWeight,
  next: nextWeight,
  lastSentAt: Date.now() - 7 * 24 * 3600 * 1000, // "since 7 days ago"
});
writeFileSync(join(OUT_DIR, "fit-change-weight.html"), weightHtml.html);

// ---- /fit allocation-change · COMPOSITION diff scenario ----------
// Engine added STRD (high-yield) and removed MSTY (NAV-decay risk at
// 5y+) · sleeve count changed. The diff-summary highlights composition
// changes more prominently than weight-only shifts.
const prevComp: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 35 },
  { ticker: "BTC", weight: 25 },
  { ticker: "MSTY", weight: 20 },
  { ticker: "STRC", weight: 20 },
];
const nextComp: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 35 },
  { ticker: "BTC", weight: 25 },
  { ticker: "STRC", weight: 25 },
  { ticker: "STRD", weight: 15 },
];

const compHtml = renderFitChangeEmail({
  recipientEmail: RECIPIENT,
  h: 7,
  t: 5,
  a: "taxable",
  diff: {
    changed: true,
    kind: "composition",
    added: [{ ticker: "STRD", weight: 15 }],
    removed: [{ ticker: "MSTY", weight: 20 }],
    shifted: [
      // STRC: 20 → 25 (+5pp, just hits threshold)
      { ticker: "STRC", prevWeight: 20, nextWeight: 25, deltaPp: 5 },
    ],
  },
  prev: prevComp,
  next: nextComp,
  lastSentAt: null, // first send after opt-in
});
writeFileSync(join(OUT_DIR, "fit-change-composition.html"), compHtml.html);

// ---- Monthly market roundup -----------------------------------------
// Realistic: late-spring 2026 snapshot · gauge in HOT zone, MPJPY
// cheapest treasury, ASST biggest monthly mover, 4 new vendors this
// month.
const mover: MonthlyRoundupTreasuryMover = {
  ticker: "ASST",
  fromMnav: 1.42,
  toMnav: 1.12,
  deltaPct: -21.1, // re-priced lower (cheaper) over the month
};
const newVendors: MonthlyRoundupVendor[] = [
  {
    name: "Bitcoin Ranch",
    displayHandle: "@bitcoin_ranch",
    category: "apparel",
    slug: "bitcoin-ranch",
    country: "US",
  },
  {
    name: "MrSatoshi",
    displayHandle: "@Lightningmaxi",
    category: "apparel",
    slug: "mrsatoshi",
    country: "US",
  },
  {
    name: "Crinkl",
    displayHandle: "@crinklrewards",
    category: "services",
    slug: "crinkl",
    country: "US",
  },
];

const monthlyHtml = renderMonthlyRoundupEmail({
  recipientEmail: RECIPIENT,
  monthLabel: "May 2026",
  gauge: {
    score: 75,
    tier: "SEND IT",
    range30d: { min: 41, max: 78, avg: 62 },
    scoreAMonthAgo: 52,
  },
  treasuries: {
    cheapest: { ticker: "MPJPY", mNAV: 0.98 },
    biggestMover: mover,
  },
  newVendors: {
    count: newVendors.length + 1, // +1 to exercise the "+ N more this month" line
    top: newVendors,
  },
});
writeFileSync(join(OUT_DIR, "monthly-roundup.html"), monthlyHtml.html);

// ---- Welcome email · confirms the shared footer (Saylor quote +
// the forward-to-a-friend referral line that rides in every email) ---
const welcomeHtml = renderWelcomeEmail({
  recipientEmail: RECIPIENT,
  currentScore: 72,
  currentTier: "HOT",
  source: "stack",
});
writeFileSync(join(OUT_DIR, "welcome.html"), welcomeHtml.html);

// ---- The full alert + transactional family (refresh 2026-07-03) ----
// One realistic preview per template so a masthead/footer change can
// be eyeballed across every outbound surface in a single pass.
const rest: Record<string, { subject: string; html: string }> = {
  confirm: renderConfirmEmail({
    confirmUrl: "https://galaxymind.space/api/confirm?token=preview",
    source: "stack",
  }),
  digest: renderDigestEmail({
    recipientEmail: RECIPIENT,
    weekRange: { min: 48, max: 79, avg: 63 },
    currentScore: 75,
    currentTier: "HOT",
    topContributor: "MVRV ratio",
    bestWindow: "Sun 2am-4am ET",
    daysIncluded: 7,
  }),
  "alert-molten": renderAlertEmail({
    score: 84,
    tier: "MOLTEN",
    tierLabel: "STACK HUGE",
    subjectFlavor: "molten",
    recipientEmail: RECIPIENT,
  }),
  "alert-frozen": renderAlertEmail({
    score: 14,
    tier: "COLD",
    tierLabel: "WAIT",
    subjectFlavor: "frozen",
    recipientEmail: RECIPIENT,
  }),
  "tier-flip": renderTierFlipEmail({
    fromTier: "WARM",
    toTier: "HOT",
    fromTierLabel: "STEADY",
    toTierLabel: "SEND IT",
    score: 68,
    direction: "up",
    recipientEmail: RECIPIENT,
  }),
  "mnav-alert": renderMnavAlertEmail({
    direction: "cheap",
    crossings: [{ ticker: "MPJPY", mNav: 0.63, prevMNav: 0.72 }],
    recipientEmail: RECIPIENT,
  }),
  "forecast-alert": renderForecastAlertEmail({
    windowLabel: "Sun 2am-4am ET",
    hoursFromNow: 9,
    score: 81,
    recipientEmail: RECIPIENT,
  }),
  "float-milestone": renderFloatMilestoneEmail({
    milestone: 6_000_000,
    inPlay: 5_998_212,
    prevInPlay: 6_003_500,
    recipientEmail: RECIPIENT,
  }),
  "vendor-digest": renderNewVendorDigestEmail({
    vendors: [
      {
        name: "Lady Laurette",
        displayHandle: "@ladylaurette21",
        description:
          "Linen dresses and natural-fabric clothing made in Finland.",
        category: "apparel",
        country: "FI",
        slug: "lady-laurette",
      },
      {
        name: "Admiral Wildlife Services",
        displayHandle: "@AdmiralWild",
        description: "Wildlife removal for homes and businesses.",
        category: "services",
        country: "US",
        slug: "admiral-wildlife-services",
      },
    ],
    recipientEmail: RECIPIENT,
  }),
  "vendor-live": renderVendorLiveEmail({
    vendorName: "Lady Laurette",
    vendorSlug: "lady-laurette",
  }),
  "hashrate-available": renderHashrateAvailableEmail({
    openCount: 3,
    recipientEmail: RECIPIENT,
  }),
};
for (const [name, r] of Object.entries(rest)) {
  writeFileSync(join(OUT_DIR, `${name}.html`), r.html);
}

// ---- Report -----------------------------------------------------------
console.log("\nEmail previews written:\n");
console.log(`  ${join(OUT_DIR, "fit-change-weight.html")}`);
console.log(`    subject: ${weightHtml.subject}`);
console.log(`  ${join(OUT_DIR, "fit-change-composition.html")}`);
console.log(`    subject: ${compHtml.subject}`);
console.log(`  ${join(OUT_DIR, "monthly-roundup.html")}`);
console.log(`    subject: ${monthlyHtml.subject}`);
console.log(`  ${join(OUT_DIR, "welcome.html")}`);
console.log(`    subject: ${welcomeHtml.subject}`);
for (const [name, r] of Object.entries(rest)) {
  console.log(`  ${join(OUT_DIR, `${name}.html`)}`);
  console.log(`    subject: ${r.subject}`);
}
console.log("\nOpen any of the above in a browser to inspect rendering.");
