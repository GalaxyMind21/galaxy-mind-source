// Invariants for vendor-badge outreach (the flywheel's "tell them
// it exists" half). Pure: no KV, no network, no email.
//
// Run: npx tsx scripts/test-badge-outreach.ts

import { readFileSync } from "node:fs";
import {
  VENDORS,
  VENDOR_BADGE,
  STALE_THRESHOLD_DAYS,
  vendorSlug,
  vendorWebsite,
  vendorBadgeSnippet,
} from "../src/lib/vendors";
import {
  BADGE_OUTREACH_BATCH,
  BADGE_OUTREACH_KEY,
  BADGE_BENEFITS,
  BADGE_PAGE_HOST,
  badgeDmText,
  badgeHandoffText,
  badgeLaunchPost,
  badgeListingUrl,
  pickBadgeOutreachBatch,
  type BadgeOutreachVendor,
} from "../src/lib/badge-outreach";
import { renderDraftsEmail } from "../src/lib/social-drafts";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log("\nbadge-outreach\n");

const sample = VENDORS.find((v) => vendorWebsite(v)) ?? VENDORS[0]!;
const slug = vendorSlug(sample);
const dm = badgeDmText(sample);

check("sample vendor exists", Boolean(sample));
check("DM names the shop", dm.includes(sample.name));
const launch = badgeLaunchPost();
check("launch post fits in 280 with t.co", launch.charCount <= 280);
check("launch post points at /badge", launch.text.includes(BADGE_PAGE_HOST));
check(
  "launch post first line has no URL",
  !/galaxymind\.space|https?:/.test(launch.text.split("\n")[0] ?? ""),
);
check("launch post has no interpunct", !launch.text.includes("·"));
check("launch post has no em/en dash", !/[—–]/.test(launch.text));
check("launch post names Verified", /Verified/.test(launch.text));

check("live stamp contains Verified", /verified/i.test(VENDOR_BADGE.live));
check("stale stamp does not say Verified", !/verified/i.test(VENDOR_BADGE.stale));
check("alt names Galaxy Mind as the verifier", /verified by Galaxy Mind/i.test(VENDOR_BADGE.alt));
check("DM names the live badge words", dm.includes(`"${VENDOR_BADGE.label}, ${VENDOR_BADGE.live}"`));
check("DM names the stale words", dm.includes(`"${VENDOR_BADGE.stale}"`));
check("DM names the stale window", dm.includes(String(STALE_THRESHOLD_DAYS)));
check("DM includes the listing URL", dm.includes(badgeListingUrl(slug)));
check("DM includes the embed snippet", dm.includes(vendorBadgeSnippet(slug)));
check("DM tells them to paste in footer or checkout", /footer or near checkout/i.test(dm));
check("DM explains the click lands on the listing", /clicks it lands on that listing/i.test(dm));
check("DM says a person checked they take bitcoin", /person here checked that you take bitcoin/i.test(dm));
check("DM is free / no affiliate", /no listing fee, no affiliate/i.test(dm));
check("DM has no interpunct", !dm.includes("·"));
check("DM has no em/en dash", !/[—–]/.test(dm));
check("DM does not use payroll language", !/pays in bitcoin/i.test(dm));
check("benefits list has 4 shop-owner facts", BADGE_BENEFITS.length === 4);
check(
  "benefits mention the click-through listing",
  BADGE_BENEFITS.some((b) => /click opens your Galaxy Mind listing/i.test(b)),
);

const withShop = VENDORS.filter((v) => vendorWebsite(v));
const without = VENDORS.filter((v) => !vendorWebsite(v));
check("roster has shops to prioritize", withShop.length > BADGE_OUTREACH_BATCH);
check("daily batch size is 3", BADGE_OUTREACH_BATCH === 3);

const first = pickBadgeOutreachBatch(VENDORS, new Set(), 3);
check("default pick returns 3", first.length === 3);
check(
  "shops beat no-shop even if the no-shop row is newer",
  first.every((v) => vendorWebsite(v)),
);
const newestShop = [...withShop].sort(
  (a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0),
)[0];
check(
  "newest shop is first when nothing has been sent",
  first[0]?.handle === newestShop?.handle,
);

const sent = new Set(first.map((v) => v.handle));
const second = pickBadgeOutreachBatch(VENDORS, sent, 3);
check("sent handles are skipped", second.every((v) => !sent.has(v.handle)));
check("second batch is still 3", second.length === 3);

const fakeLn: BadgeOutreachVendor = {
  name: "LN Only",
  handle: "lnonly@example.com",
  platform: "lightning",
  listedAt: Date.now() / 1000 + 1e9,
  website: "https://example.com",
};
const withLn = pickBadgeOutreachBatch([fakeLn, ...first], new Set(), 5);
check(
  "Lightning-only rows are not in the DM pool",
  withLn.every((v) => v.handle !== fakeLn.handle),
);

const drained = pickBadgeOutreachBatch(first, new Set(first.map((v) => v.handle)), 3);
check("exhausted pool returns empty", drained.length === 0);

if (without.length > 0) {
  const onlyWithout = pickBadgeOutreachBatch(without, new Set(), 2);
  check(
    "no-shop vendors are still drafted once shops are gone",
    onlyWithout.length > 0 && onlyWithout.every((v) => !vendorWebsite(v)),
  );
}

const handoff = badgeHandoffText(sample);
check("handoff wraps the same DM", handoff.includes(dm));
check("handoff is framed as a send-this block", handoff.includes("Send them this"));

const email = renderDraftsEmail(
  {
    x: { text: "x draft", charCount: 7, mentionedHandles: [] },
    nostr: { text: "nostr draft", charCount: 11 },
    picksX: [],
    picksNostr: [],
    badgeOutreach: [
      {
        name: sample.name,
        handle: sample.handle,
        channelHref: "https://x.com/example",
        channelLabel: "@example",
        dm,
      },
    ],
  },
  new Date("2026-08-21T12:00:00Z"),
);
check("drafts email subject is the daily social subject", /daily social drafts/.test(email.subject));
check("drafts email has a Badge DMs section", /Badge DMs to send today/.test(email.html));
const withLaunch = renderDraftsEmail(
  {
    x: { text: "x", charCount: 1, mentionedHandles: [] },
    nostr: { text: "n", charCount: 1 },
    picksX: [],
    picksNostr: [],
    badgeLaunch: launch,
  },
  new Date("2026-08-21T12:00:00Z"),
);
check(
  "drafts email can carry the launch post",
  /Badge launch/.test(withLaunch.html) && withLaunch.html.includes(BADGE_PAGE_HOST),
);
check("drafts email includes the shop name", email.html.includes(sample.name));
check(
  "drafts email escapes the snippet tags",
  email.html.includes("&lt;a href") && !email.html.includes("<a href=\"https://galaxymind.space/v/"),
);

const done = renderDraftsEmail(
  {
    x: { text: "x", charCount: 1, mentionedHandles: [] },
    nostr: { text: "n", charCount: 1 },
    picksX: [],
    picksNostr: [],
    badgeOutreach: [],
  },
  new Date("2026-08-21T12:00:00Z"),
);
check(
  "empty campaign prints a done line, not a blank card",
  /already been drafted a badge DM/.test(done.html),
);

const skipped = renderDraftsEmail(
  {
    x: { text: "x", charCount: 1, mentionedHandles: [] },
    nostr: { text: "n", charCount: 1 },
    picksX: [],
    picksNostr: [],
    badgeOutreach: null,
  },
  new Date("2026-08-21T12:00:00Z"),
);
check(
  "failed KV read omits the badge section rather than repeating",
  !/Badge DMs/.test(skipped.html),
);

const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
check(
  "privacy inventories gm:badge-outreach:v2",
  privacy.includes(BADGE_OUTREACH_KEY),
);
check(
  "privacy inventories gm:badge-launch:v1",
  privacy.includes("gm:badge-launch:v1"),
);

const cron = readFileSync(
  "src/app/api/cron/social-post-drafts/route.ts",
  "utf8",
);
check(
  "daily drafts cron marks badge outreach after a successful send",
  /markBadgeOutreachSent/.test(cron) && /badgeOutreach/.test(cron),
);
check(
  "daily drafts cron skips the drip when the KV read fails",
  /badge outreach skipped/.test(cron),
);

console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} passed · ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
