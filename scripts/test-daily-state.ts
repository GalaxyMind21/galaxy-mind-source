/**
 * Daily-loop roster · CHOP must count, and "N dailies open" must deep-link
 * the NEXT open game (not always /wen).
 */
import {
  countOpenDailies,
  emptyDailyDone,
  nextOpenDaily,
  type DailyDone,
} from "../src/lib/daily-state";
import { readFileSync } from "node:fs";

let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("daily-state");

const none = emptyDailyDone();
check("empty roster has 6 open (chop in the set)", countOpenDailies(none) === 6);
check("first open is WEN", nextOpenDaily(none, 45)?.href === "/wen");

const wenDone: DailyDone = { ...none, wen: true };
check("after WEN, next is CHOP", nextOpenDaily(wenDone, 45)?.href === "/chop");
check("after WEN, 5 still open", countOpenDailies(wenDone) === 5);

const allDone: DailyDone = {
  wen: true,
  chop: true,
  trail: true,
  gauntlet: true,
  summit: true,
  kart: true,
};
check("all done → no next", nextOpenDaily(allDone, 45) === null);
check("all done → 0 open", countOpenDailies(allDone) === 0);

const chop = readFileSync("src/lib/daily-state.ts", "utf8");
check("CHOP LS key is gm:chop:res:{n}", chop.includes("`gm:chop:res:${n}`"));

const form = readFileSync("src/app/submit/SubmitForm.tsx", "utf8");
const emailAt = form.indexOf('id="notifyEmail"');
const founderAt = form.indexOf('id="founderName"');
check("notify email field exists", emailAt >= 0);
check(
  "notify email sits on the required path, not under more-details",
  emailAt >= 0 && founderAt >= 0 && emailAt < founderAt,
);
check(
  "notify email is required, not labelled optional",
  form.includes('htmlFor="notifyEmail"') &&
    !form.includes("(optional · one-shot, listed or not)"),
);

const nav = readFileSync("src/components/MobileBottomNav.tsx", "utf8");
check("Play tab matches /chop", nav.includes('p.startsWith("/chop")'));
check("Play tab deep-links via nextOpenDaily", nav.includes("nextOpenDaily"));

const chip = readFileSync("src/components/HeaderDailiesChip.tsx", "utf8");
check("header chip uses nextOpenDaily", chip.includes("nextOpenDaily"));
check("header chip hides on /chop", chip.includes('pathname.startsWith("/chop")'));

const loop = readFileSync("src/components/DailyLoop.tsx", "utf8");
check("DailyLoop has a CHOP row", loop.includes('href: "/chop"'));

const chopMain = readFileSync("public/chop/js/main.js", "utf8");
check(
  "CHOP writes gm:chop:res:{n} on run end",
  chopMain.includes("gm:chop:res:") && chopMain.includes("gm:arcade-finished"),
);

if (fail) {
  console.error(`\n✗ ${fail} daily-state check(s) failed`);
  process.exit(1);
}
console.log("\n✓ daily-state roster");
