/**
 * Waitlist notify rule · open count rose, at most once per UTC day,
 * never on the first baseline.
 */
import { readFileSync } from "node:fs";
import { shouldNotifyHashrateOpen } from "../src/lib/hashrate-waitlist";
import {
  interpretStoredPrefs,
  looksLikeLegacyHashrateWaitlist,
} from "../src/lib/subscribe-flow";

let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("hashrate waitlist");

const TODAY = "2026-09-24";
const YESTERDAY = "2026-09-23";

check(
  "first run (no baseline) never notifies",
  !shouldNotifyHashrateOpen(null, 5, null, TODAY),
);
check("0 → 3 notifies", shouldNotifyHashrateOpen(0, 3, null, TODAY));
check("0 → 1 notifies", shouldNotifyHashrateOpen(0, 1, null, TODAY));
check(
  "26 → 27 notifies when nothing was sent today",
  shouldNotifyHashrateOpen(26, 27, null, TODAY),
);
check(
  "a rise already sent today stays quiet",
  !shouldNotifyHashrateOpen(26, 27, TODAY, TODAY),
);
check(
  "the same rise sends again the next UTC day",
  shouldNotifyHashrateOpen(26, 27, YESTERDAY, TODAY),
);
check(
  "5 → 0 does not notify (sold out)",
  !shouldNotifyHashrateOpen(5, 0, null, TODAY),
);
check(
  "27 → 26 does not notify (count fell)",
  !shouldNotifyHashrateOpen(27, 26, null, TODAY),
);
check("flat count does not notify", !shouldNotifyHashrateOpen(26, 26, null, TODAY));
check("0 → 0 does not notify", !shouldNotifyHashrateOpen(0, 0, null, TODAY));
check("negative next is refused", !shouldNotifyHashrateOpen(0, -1, null, TODAY));
check(
  "a missing today refuses the send",
  !shouldNotifyHashrateOpen(26, 27, null, ""),
);
check(
  "a corrupt last-sent day does not silence a rise",
  shouldNotifyHashrateOpen(26, 27, "nope", TODAY),
);

const cron = readFileSync("src/app/api/cron/hashrate-available/route.ts", "utf8");
check("cron uses the open-count helper", cron.includes("shouldNotifyHashrateOpen"));
check(
  "cron stores the last notified UTC day",
  cron.includes("hashrate:last-notified-day"),
);
check(
  "cron skips the write when our-rigs is degraded",
  cron.includes('degraded.includes("our-rigs")'),
);
check(
  "a failed send does not advance the baseline",
  cron.includes("!send.ok") && cron.includes("status: 500"),
);
check("cron records hashrate-available in cron-health", cron.includes('recordCronRun("hashrate-available")'));

const prefs = readFileSync("src/lib/subscribe-flow.ts", "utf8");
check(
  "prefs include notifyOnHashrateAvailable",
  prefs.includes("notifyOnHashrateAvailable"),
);
check(
  "the waitlist form opts into the ping, not the weekly digest",
  readFileSync("src/components/InlineSubscribePrompt.tsx", "utf8").includes(
    "notifyOnHashrateAvailable: true",
  ),
);
const waitlistCopy = readFileSync("src/lib/hashrate-copy.ts", "utf8");
check(
  "WAITLIST_SUB promises an opening ping, at most once a day",
  waitlistCopy.includes("We email you when another USA machine opens") &&
    waitlistCopy.includes("At most one email a day"),
);
check(
  "WAITLIST_SUB does not deny the ping",
  !waitlistCopy.includes("There is no instant ping"),
);
const confirmCopy = readFileSync("src/lib/email.ts", "utf8");
check(
  "confirm email promises a rise, at most once a day",
  confirmCopy.includes("another Galaxy Mind USA machine opens") &&
    confirmCopy.includes("At most one email a day"),
);

check("legacy digest-only is the old waitlist", looksLikeLegacyHashrateWaitlist({ digestEnabled: true }));
check("empty prefs are not waitlist", !looksLikeLegacyHashrateWaitlist({}));
check("today bundle is not waitlist", !looksLikeLegacyHashrateWaitlist({ digestEnabled: true, notifyOnTierChange: true, notifyOnFloatMilestone: true }));
check("explicit opt-out stays out", !looksLikeLegacyHashrateWaitlist({ digestEnabled: true, notifyOnHashrateAvailable: false }));
check("new form flag is not the legacy fingerprint", !looksLikeLegacyHashrateWaitlist({ notifyOnHashrateAvailable: true }));
check("interpret upgrades legacy digest-only", interpretStoredPrefs({ digestEnabled: true }).notifyOnHashrateAvailable === true);
check("interpret does not upgrade a /today bundle", interpretStoredPrefs({ digestEnabled: true, notifyOnTierChange: true, notifyOnFloatMilestone: true }).notifyOnHashrateAvailable === false);
check("interpret honors opt-out", interpretStoredPrefs({ digestEnabled: true, notifyOnHashrateAvailable: false }).notifyOnHashrateAvailable === false);

if (fail) {
  console.error(`\n✗ ${fail} waitlist check(s) failed`);
  process.exit(1);
}
console.log("\n✓ hashrate waitlist notify rule");
