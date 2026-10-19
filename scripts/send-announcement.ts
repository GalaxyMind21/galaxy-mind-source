#!/usr/bin/env tsx
/**
 * scripts/send-announcement.ts
 *
 * Send a one-off announcement email to the entire alerts audience.
 * Use sparingly — subscribers signed up for "extreme threshold
 * alerts," not "marketing newsletter." Reasonable cadence is a
 * few times a year (major feature drops, anniversaries, asks).
 *
 * Each email includes a per-recipient unsubscribe link in the
 * footer + List-Unsubscribe header (RFC 8058 one-click).
 *
 * USAGE:
 *
 *   1. Edit content/announcements/template.html (or supply --html-file)
 *   2. Dry run (lists who WOULD get it, sends nothing):
 *
 *        npx tsx scripts/send-announcement.ts \
 *          --subject "We hit 50 vendors!" \
 *          --html-file content/announcements/example.html \
 *          --dry-run
 *
 *   3. Test send to yourself first:
 *
 *        npx tsx scripts/send-announcement.ts \
 *          --subject "We hit 50 vendors!" \
 *          --html-file content/announcements/example.html \
 *          --to-only your@email.com
 *
 *   4. The real thing (requires --confirm):
 *
 *        npx tsx scripts/send-announcement.ts \
 *          --subject "We hit 50 vendors!" \
 *          --html-file content/announcements/example.html \
 *          --confirm
 *
 * SAFETY:
 *   • Refuses to send without --confirm OR --dry-run OR --to-only
 *   • Refuses subjects > 100 chars (Gmail truncates)
 *   • Refuses bodies > 80KB (Gmail clips at ~102KB)
 *   • Always shows recipient count + sample subject before sending
 *   • Per-recipient List-Unsubscribe header injected automatically
 *
 * RATIONALE:
 *   Lives as a LOCAL CLI script (not a web endpoint) so it can't be
 *   triggered by a compromised cron secret or a leaked auth token.
 *   To send, you must clone the repo + have the env vars locally.
 */

// Load .env.local — same pattern as test-email-setup.ts
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
  buildUnsubscribeUrl,
  listSubscribers,
  sendAlertBatch,
} from "../src/lib/email";

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

const MAX_SUBJECT_LEN = 100;
const MAX_BODY_BYTES = 80 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  console.log(C.bold("\n📣 Galaxy Mind one-off announcement\n"));

  const subject = arg("subject");
  const htmlFile = arg("html-file");
  const html = arg("html"); // raw HTML inline (small messages)
  const toOnly = arg("to-only"); // single test recipient
  const dryRun = flag("dry-run");
  const confirm = flag("confirm");

  // Validation
  if (!subject) {
    console.error(`${C.fail} --subject is required`);
    process.exit(1);
  }
  if (subject.length > MAX_SUBJECT_LEN) {
    console.error(
      `${C.fail} subject too long (${subject.length} > ${MAX_SUBJECT_LEN}). Gmail will truncate.`,
    );
    process.exit(1);
  }
  let body: string;
  if (htmlFile) {
    const resolved = path.resolve(process.cwd(), htmlFile);
    if (!fs.existsSync(resolved)) {
      console.error(`${C.fail} html-file not found: ${resolved}`);
      process.exit(1);
    }
    body = fs.readFileSync(resolved, "utf-8");
  } else if (html) {
    body = html;
  } else {
    console.error(`${C.fail} provide --html-file or --html`);
    process.exit(1);
  }
  const bodyBytes = new TextEncoder().encode(body).length;
  if (bodyBytes > MAX_BODY_BYTES) {
    console.error(
      `${C.fail} body too large (${bodyBytes} > ${MAX_BODY_BYTES} bytes). Gmail clips at ~102KB.`,
    );
    process.exit(1);
  }
  // Body should already include {{UNSUB_URL}} placeholder, replaced
  // per-recipient. Refuse if the placeholder is missing — every
  // outbound MUST have a visible unsubscribe link (CAN-SPAM).
  if (!body.includes("{{UNSUB_URL}}")) {
    console.error(
      `${C.fail} body must include the {{UNSUB_URL}} placeholder.\n  Example footer:\n    <a href="{{UNSUB_URL}}">Unsubscribe</a>\n  Required for CAN-SPAM compliance.`,
    );
    process.exit(1);
  }

  // Resolve recipients
  let recipients: string[];
  if (toOnly) {
    recipients = [toOnly.trim().toLowerCase()];
    console.log(`${C.info} test mode — sending only to ${C.bold(toOnly)}`);
  } else {
    const subs = await listSubscribers();
    if (!subs.ok) {
      console.error(`${C.fail} couldn't list subscribers: ${subs.error}`);
      process.exit(1);
    }
    recipients = subs.data.emails;
  }

  // Plan summary
  console.log(`\n${C.bold("PLAN")}`);
  console.log(`  Subject:    ${subject}`);
  console.log(`  Body:       ${bodyBytes} bytes (${body.split("\n").length} lines)`);
  console.log(`  Recipients: ${recipients.length}`);
  console.log(
    `  Mode:       ${
      dryRun ? "DRY RUN (no sends)" : toOnly ? "TEST (one recipient)" : confirm ? "REAL SEND" : "UNCONFIRMED"
    }`,
  );

  if (recipients.length === 0) {
    console.log(`\n${C.warn} no recipients. exiting.`);
    process.exit(0);
  }

  if (dryRun) {
    console.log(`\n${C.bold("RECIPIENTS (would receive):")}`);
    recipients.slice(0, 20).forEach((r) => console.log(`  • ${r}`));
    if (recipients.length > 20) {
      console.log(`  ${C.dim(`… and ${recipients.length - 20} more`)}`);
    }
    console.log(`\n${C.ok} dry run complete. nothing sent.\n`);
    return;
  }

  if (!toOnly && !confirm) {
    console.error(
      `\n${C.fail} refusing to send without --confirm.\n  Re-run with --confirm to actually send.\n  Or --dry-run to see who would get it.\n  Or --to-only your@email.com to send a test.\n`,
    );
    process.exit(1);
  }

  // Send. The renderer replaces {{UNSUB_URL}} per recipient.
  console.log(`\n${C.info} sending…`);
  const send = await sendAlertBatch(recipients, subject, (recipientEmail) => {
    return body.replace(/\{\{UNSUB_URL\}\}/g, buildUnsubscribeUrl(recipientEmail));
  });

  if (send.ok) {
    console.log(`${C.ok} sent ${send.sent} emails.\n`);
  } else {
    console.log(
      `${C.fail} partial failure — sent ${send.sent}/${recipients.length}. error: ${send.error}\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n💥 announcement script crashed:", e);
  process.exit(1);
});
