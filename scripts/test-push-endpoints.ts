// Push endpoints are pinned to known push services (CodeQL review follow-up,
// 2026-10). web-push opens its own HTTPS connection with the system
// resolver, so the subscribe route and every send only accept endpoints on
// FCM, Mozilla autopush, Apple Push or WNS. Offline: pure checks only.
//
// Run: npx tsx scripts/test-push-endpoints.ts

import { readFileSync } from "node:fs";
import { Agent } from "node:https";

import {
  isKnownPushEndpoint,
  partitionSendable,
  pushAgent,
  skippedHostCounts,
  validateSubscription,
} from "../src/lib/push";
import { BlockedAddressError } from "../src/lib/safe-fetch";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log("\nisKnownPushEndpoint · the four push services");
for (const ok of [
  "https://fcm.googleapis.com/fcm/send/abc123:APA91b",
  "https://FCM.googleapis.com/wp/abc",
  "https://fcm.googleapis.com./fcm/send/abc",
  "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
  "https://web.push.apple.com/QGx9abc",
  "https://wns2-par02p.notify.windows.com/w/?token=abc",
  "https://fcm.googleapis.com:443/fcm/send/abc",
  "https://jmt17.google.com/fcm/send/abc",
  "https://JMT17.google.com./fcm/send/abc",
]) check(`allowed: ${ok}`, isKnownPushEndpoint(ok));

console.log("\nisKnownPushEndpoint · everything else is refused");
for (const bad of [
  "https://evil.example/push",
  "https://googleapis.com/fcm/send/abc",
  "https://evilfcm.googleapis.com/fcm/send/abc",
  "https://fcm.googleapis.com.evil.example/fcm/send/abc",
  "https://push.apple.com/abc",
  "https://evilpush.apple.com/abc",
  "https://web.push.apple.com.evil.example/abc",
  "https://push.services.mozilla.com/abc",
  "https://notify.windows.com/abc",
  "https://jmt18.google.com/fcm/send/abc",
  "https://x.jmt17.google.com/fcm/send/abc",
  "https://jmt17.google.com.evil.example/fcm/send/abc",
  "https://google.com/fcm/send/abc",
  "https://xnotify.windows.com/abc",
  "http://fcm.googleapis.com/fcm/send/abc",
  "https://fcm.googleapis.com:8443/fcm/send/abc",
  "https://user:pw@fcm.googleapis.com/fcm/send/abc",
  "https://127.0.0.1/fcm/send/abc",
  "https://localhost/fcm",
  "https://[::1]/fcm",
  "not a url",
  "",
  `https://fcm.googleapis.com/${"a".repeat(1100)}`,
]) check(`refused: ${bad.slice(0, 70)}`, !isKnownPushEndpoint(bad));
check("non-string refused", !isKnownPushEndpoint(undefined) && !isKnownPushEndpoint(42));

console.log("\nvalidateSubscription · checked when a subscription is saved");
// Synthetic, low-entropy key material in the base64url alphabet (shape only, not a real key).
const keys = { p256dh: "BTEST_" + "a".repeat(80), auth: "TEST_" + "b".repeat(17) };
check("FCM subscription accepted", validateSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys }) === null);
check("Apple subscription accepted", validateSubscription({ endpoint: "https://web.push.apple.com/QGx9abc", keys }) === null);
{
  const err = validateSubscription({ endpoint: "https://evil.example/push", keys });
  check("unknown host rejected at save", typeof err === "string" && err.includes("not a known push service"));
}
check("private IP still rejected by the SSRF guard first", (validateSubscription({ endpoint: "https://10.0.0.1/push", keys }) ?? "").includes("endpoint rejected"));

console.log("\npartitionSendable · re-checked right before sending; unlisted hosts are skipped, not deleted");
{
  const subs = [
    { endpoint: "https://fcm.googleapis.com/fcm/send/a" },
    { endpoint: "https://evil.example/push/SECRET-TOKEN-1" },
    { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/b" },
    { endpoint: "https://192.168.0.1/push/SECRET-TOKEN-2" },
    { endpoint: "https://evil.example/push/SECRET-TOKEN-3" },
    { endpoint: "https://jmt17.google.com/fcm/send/c" },
  ];
  const { sendable, skipped } = partitionSendable(subs);
  check("known hosts are sendable (incl. jmt17)", sendable.length === 3 && sendable.every((s) => !s.endpoint.includes("evil") && !s.endpoint.includes("192.168")));
  check("unlisted and private hosts are skipped", skipped.length === 3);
  const counts = skippedHostCounts(skipped);
  check("skipped hosts are counted by host", counts["evil.example"] === 2 && counts["192.168.0.1"] === 1);
  const logged = JSON.stringify(counts);
  check("host log never carries the endpoint path or token", !logged.includes("SECRET") && !logged.includes("/push"));
  check("unparseable endpoint logs a placeholder, not the raw value", JSON.stringify(skippedHostCounts([{ endpoint: "garbage SECRET-TOKEN-4" }])) === '{"(unparseable)":1}');
}
{
  const src = readFileSync("src/lib/push.ts", "utf8");
  const send = src.indexOf("webpush.sendNotification(");
  const part = src.indexOf("partitionSendable(topical)");
  check("broadcastPush partitions before any send", part > 0 && send > part);
  const bc = src.slice(src.indexOf("export async function broadcastPush"));
  const skipBlock = bc.slice(bc.indexOf("partitionSendable(topical)"), bc.indexOf("const json = JSON.stringify(payload)"));
  check("skipped records are NOT deleted at send time", !skipBlock.includes("deleteSubscription"));
  check("skipped hosts are logged via skippedHostCounts", skipBlock.includes("skippedHostCounts(skipped)"));
  check("save-time rejection of unlisted hosts stays", src.includes('return "endpoint rejected: not a known push service"'));
  check("sendNotification uses the pinned agent", /sendNotification\([\s\S]{0,400}agent: pushAgent/.test(src));
}

console.log("\npinned agent · web-push dials only checked addresses");
{
  check("pushAgent is an https.Agent (web-push requires that type)", pushAgent instanceof Agent);
  const lookup = (pushAgent as unknown as { options: { lookup?: unknown } }).options.lookup;
  check("pushAgent carries a custom lookup", typeof lookup === "function");
}

async function agentLookupCheck() {
  const lookup = (pushAgent as unknown as {
    options: { lookup: (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void };
  }).options.lookup;
  // "localhost" resolves to loopback from the hosts file, offline.
  const err = await new Promise<Error | null>((resolve) => lookup("localhost", {}, (e) => resolve(e)));
  check("pinned lookup refuses a name that resolves to loopback", err instanceof BlockedAddressError);
}

agentLookupCheck().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log("✓ push endpoints pinned to known push services, unlisted hosts skipped, pinned agent wired");
});
