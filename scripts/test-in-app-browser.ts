// Invariants for in-app browser detection. Pure fixtures, no DOM.
// The public JS twin must keep the same UA pattern strings.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chromeIntentUrl,
  detectInAppBrowser,
  IN_APP_PATTERNS,
  INAPP_COPY,
} from "../src/lib/in-app-browser";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const X_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone";
const X_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) TwitterAndroid";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IG =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0";
const FB =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/1.0]";
const TIKTOK =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 musical_ly_202310";
const BOT =
  "Twitterbot/1.0";

console.log("── in-app-browser · detection ───────────────────");
{
  const x = detectInAppBrowser(X_IOS);
  assert("X iPhone is in-app", x.inApp && x.app === "x" && x.ios);
  const xa = detectInAppBrowser(X_ANDROID);
  assert("X Android is in-app", xa.inApp && xa.app === "x" && xa.android);
  assert("Safari is not in-app", !detectInAppBrowser(SAFARI).inApp);
  assert("Chrome Android is not in-app", !detectInAppBrowser(CHROME_ANDROID).inApp);
  assert("Instagram is in-app", detectInAppBrowser(IG).app === "instagram");
  assert("Facebook is in-app", detectInAppBrowser(FB).app === "facebook");
  assert("TikTok is in-app", detectInAppBrowser(TIKTOK).app === "tiktok");
  assert("Twitterbot is not a player", !detectInAppBrowser(BOT).inApp);
  assert(
    "standalone PWA is never in-app",
    !detectInAppBrowser(X_IOS, { standalone: true }).inApp,
  );
  assert("empty UA is not in-app", !detectInAppBrowser("").inApp);
}

console.log("── in-app-browser · chrome intent ───────────────");
{
  const intent = chromeIntentUrl("https://galaxymind.space/bitcoin-kart?ghost=daily");
  assert("intent is produced", intent != null);
  assert(
    "intent names Chrome and the path",
    !!intent &&
      intent.startsWith("intent://galaxymind.space/bitcoin-kart") &&
      intent.includes("package=com.android.chrome") &&
      intent.includes("scheme=https"),
  );
  assert("rejects javascript href", chromeIntentUrl("javascript:alert(1)") == null);
  assert("rejects garbage", chromeIntentUrl("not a url") == null);
}

console.log("── in-app-browser · public twin drift ───────────");
{
  const js = readFileSync(
    join(process.cwd(), "public", "arcade-open-browser.js"),
    "utf8",
  );
  assert("public helper has no innerHTML", !js.includes(".innerHTML"));
  for (const [name, pat] of Object.entries(IN_APP_PATTERNS)) {
    assert(
      `public helper still carries the ${name} pattern`,
      js.includes(pat),
      pat,
    );
  }
  assert("public helper uses the same storage key", js.includes("gm:open-in-browser"));
  assert("public helper never uses em dashes", !js.includes("—"));
  for (const line of Object.values(INAPP_COPY.lead)) {
    assert(`public helper carries lead: ${line.slice(0, 24)}…`, js.includes(line));
  }
}

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed · ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
