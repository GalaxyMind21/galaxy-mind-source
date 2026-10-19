#!/usr/bin/env tsx
/**
 * scripts/test-email-setup.ts
 *
 * End-to-end verifier for the Buying Gauge mailing list. Runs through
 * each step of the email pipeline and reports what's working / broken.
 *
 * USAGE:
 *
 *   1. Local check (uses your .env.local Resend creds — pulled from
 *      Vercel via `vercel env pull .env.local`):
 *
 *        npx tsx scripts/test-email-setup.ts
 *
 *   2. Send a test email to a specific address:
 *
 *        npx tsx scripts/test-email-setup.ts --to your@email.com
 *
 *      The address gets BOTH the confirmation email AND a sample
 *      alert email, so you can preview the templates in your inbox.
 *
 * WHAT IT CHECKS:
 *   ✓ Required env vars exist
 *   ✓ Resend API key is valid (lists audiences via real API call)
 *   ✓ The configured RESEND_AUDIENCE_ID exists in your account
 *   ✓ The audience has at least 0 contacts (sanity)
 *   ✓ KV is configured (required for double-opt-in)
 *   ✓ CRON_SECRET is set (required for the alert cron)
 *
 * SAFE: never adds anyone to your audience. Test sends are
 * transactional only (single-recipient /emails endpoint), not added
 * to any list.
 */

// Load .env.local before importing any modules that read process.env
// at import time. tsx doesn't auto-load dotenv the way Next.js does,
// so without this the env vars look "missing" even when they're in
// the file. Uses fs (no extra dep) so the script stays portable.
import * as fs from "node:fs";
import * as path from "node:path";

(function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes (Vercel's `vercel env pull` quotes everything).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

import {
  subscribeEmail,
  sendTransactionalEmail,
  renderConfirmEmail,
  renderAlertEmail,
  listSubscribers,
} from "../src/lib/email";
import { isKvConfigured } from "../src/lib/kv";

const args = process.argv.slice(2);
const toIdx = args.indexOf("--to");
const sendTo = toIdx >= 0 ? args[toIdx + 1] : null;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

async function main() {
  console.log(C.bold("\n📧 Galaxy Mind email setup verifier\n"));

  let failures = 0;
  const fail = (m: string) => {
    console.log(`${C.fail} ${m}`);
    failures++;
  };
  const ok = (m: string) => console.log(`${C.ok} ${m}`);
  const warn = (m: string) => console.log(`${C.warn} ${m}`);
  const info = (m: string) => console.log(`${C.info} ${m}`);

  // ---- 1. Env vars ----
  console.log(C.bold("1. Required env vars"));
  const required = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_AUDIENCE_ID: process.env.RESEND_AUDIENCE_ID,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    CRON_SECRET: process.env.CRON_SECRET,
  };
  for (const [k, v] of Object.entries(required)) {
    if (v) ok(`${k} set ${C.dim(`(${v.slice(0, 6)}…)`)}`);
    else fail(`${k} is missing — set in Vercel env settings`);
  }
  if (failures > 0) {
    console.log(
      `\n${C.fail} ${failures} required var(s) missing. Fix those first, then re-run.\n`,
    );
    console.log("Quick setup:");
    console.log("  1. https://resend.com → sign up + verify domain");
    console.log("  2. Create an Audience → copy the audience ID");
    console.log("  3. Generate an API key");
    console.log("  4. vercel env add RESEND_API_KEY production");
    console.log("     vercel env add RESEND_AUDIENCE_ID production");
    console.log("     vercel env add RESEND_FROM_EMAIL production");
    console.log("  5. vercel env pull .env.local  # so this script can re-test\n");
    process.exit(1);
  }

  // ---- 2. KV (required for double-opt-in) ----
  console.log(C.bold("\n2. KV (required for double-opt-in)"));
  if (isKvConfigured()) ok("KV configured (DOI flow active)");
  else warn("KV not configured — subscribe will skip DOI + add immediately");

  // ---- 3. Resend connectivity (live API call) ----
  console.log(C.bold("\n3. Resend API connectivity"));
  const subs = await listSubscribers();
  if (!subs.ok) {
    fail(`Resend API call failed: ${subs.error}`);
    if (subs.error.toLowerCase().includes("not configured")) {
      info("Re-check RESEND_API_KEY value");
    } else if (subs.error.toLowerCase().includes("not found")) {
      info("RESEND_AUDIENCE_ID likely wrong — copy it again from Resend dashboard");
    } else if (subs.error.toLowerCase().includes("invalid api key")) {
      info("Re-generate the API key in Resend dashboard, update RESEND_API_KEY");
    }
    process.exit(1);
  }
  ok(`Audience reachable — ${subs.data.emails.length} active subscriber(s)`);

  // ---- 4. Optional: send test emails ----
  if (sendTo) {
    console.log(C.bold(`\n4. Sending test emails to ${sendTo}`));

    // Confirm template
    const confirm = renderConfirmEmail({
      confirmUrl: "https://galaxymind.space/api/subscribe/confirm?token=TEST",
    });
    info("Sending confirmation template…");
    const cRes = await sendTransactionalEmail({
      to: sendTo,
      subject: `[TEST] ${confirm.subject}`,
      html: confirm.html,
    });
    if (cRes.ok) ok(`Confirmation email sent (id: ${cRes.data.id})`);
    else fail(`Confirmation send failed: ${cRes.error}`);

    // Alert template (sample MOLTEN reading) — recipientEmail is now
    // required because each alert carries a per-recipient unsubscribe
    // link in the body + List-Unsubscribe headers.
    const alert = renderAlertEmail({
      score: 87,
      tier: "MOLTEN",
      tierLabel: "STACK HUGE",
      subjectFlavor: "molten",
      recipientEmail: sendTo,
    });
    info("Sending sample MOLTEN alert template…");
    const aRes = await sendTransactionalEmail({
      to: sendTo,
      subject: `[TEST] ${alert.subject}`,
      html: alert.html,
    });
    if (aRes.ok) ok(`Alert email sent (id: ${aRes.data.id})`);
    else fail(`Alert send failed: ${aRes.error}`);

    if (cRes.ok && aRes.ok) {
      console.log(`\n${C.bold("Check your inbox.")} Both should arrive within ~30s.`);
      console.log(`${C.dim("(Check spam if missing — first sends from a new domain land there sometimes.)")}`);
    }
  } else {
    info("No --to flag → skipping test sends");
    info(`Run with --to your@email.com to preview templates in your inbox`);
  }

  // ---- Summary ----
  if (failures === 0) {
    console.log(`\n${C.bold("✅ Email pipeline ready.")}`);
    console.log("\nNext steps:");
    console.log("  • Visit /stack and use the AlertSubscribe form to test the live DOI flow");
    console.log("  • Wait for /api/cron/check-thresholds to fire (daily 14:00 UTC)");
    console.log("  • Or trigger manually:");
    console.log(`      curl -H "Authorization: Bearer $CRON_SECRET" \\`);
    console.log(`           https://galaxymind.space/api/cron/check-thresholds`);
    console.log();
  } else {
    console.log(`\n${C.fail} ${failures} issue(s). See above.\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n💥 Verifier crashed:", e);
  process.exit(1);
});
