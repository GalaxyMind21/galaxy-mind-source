#!/usr/bin/env tsx
/**
 * reject-submission · one-shot, NON-INTERACTIVE rejection of a vendor
 * submission in the KV moderation queue.
 *
 * Run:
 *   npx tsx scripts/reject-submission.ts <id> "<reason>"
 *   (vercel env pull .env.local --environment=production first, or
 *    pass CRON_SECRET=… inline)
 *
 * Why this exists: clearing stale/test/spam submissions previously
 * required driving the full interactive review-submissions.ts loop
 * (TTY-only). During a submission spike — e.g. pushing toward a
 * vendor-count milestone — that latency lets the queue rot (we had a
 * real case of test entries sitting pending for days). This is the
 * fast path: reject one id in a single command, scriptable, no TTY.
 *
 * Companion to scripts/peek-submissions.ts (read-only viewer). The
 * trio is: peek (look) · reject (decline, one-shot) · review-
 * submissions (interactive approve/reject).
 *
 * APPROVE IS DELIBERATELY NOT HERE. Approving writes to the public
 * vendors.ts + commits + pushes — that MUST stay a deliberate human
 * action behind review-submissions.ts. Making approval a one-liner
 * would turn a queue-auth leak into a "push anything live" primitive
 * and remove the human-in-the-loop that the directory's trust model
 * depends on. Rejection is safe to automate: worst case is a
 * wrongly-declined submission, which is reversible (the record is
 * kept in KV with a 30-day TTL and can be reconsidered).
 */

// Load .env.local before reading process.env (tsx doesn't auto-load
// dotenv). Identical fs-only loader as peek-submissions.ts /
// test-email-setup.ts.
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

const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// argv: [node, script, id, ...reasonWords]  (reason may be quoted as
// one arg or several bare words — join the remainder either way).
// Validate args + intent BEFORE the secret check so `--help`-style
// misuse and the approve redirect are helpful even without env set.
const [, , id, ...reasonParts] = process.argv;
const reason = reasonParts.join(" ").trim();

if (id === "--approve" || reasonParts.includes("--approve")) {
  die(
    'approve is intentionally not supported here · it mutates the public list.\n  Use the human-in-the-loop path: CRON_SECRET=… npx tsx scripts/review-submissions.ts',
  );
}
if (!id || id.startsWith("--")) {
  die('usage: npx tsx scripts/reject-submission.ts <id> "<reason>"');
}
if (!reason) {
  die(
    'a reason is required (kept in KV 30 days for auditability).\n  usage: npx tsx scripts/reject-submission.ts <id> "<reason>"',
  );
}

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  die(
    "CRON_SECRET not set.\n" +
      "  NOTE: `vercel env pull` will NOT help — CRON_SECRET is a Vercel\n" +
      "  Sensitive var (write-only; pull returns it empty). Supply it\n" +
      "  inline from where you stored it:\n" +
      `    CRON_SECRET='…' npx tsx scripts/reject-submission.ts ${id} "${reason}"\n` +
      "  (Or just leave the queue — pending entries auto-expire via the\n" +
      "  60-day TTL; nothing in it is ever auto-acted-on.)",
  );
}

async function main() {
  const r = await fetch(`${SITE_URL}/api/admin/finalize-submission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      status: "rejected",
      reason,
      // Default to the silent bulk code. A one-shot CLI reject is
      // usually housekeeping; pass GM_OUTCOME=<code> to send the
      // submitter a real explanation instead.
      outcome: { code: process.env.GM_OUTCOME || "bulk-clear" },
    }),
  });

  if (r.status === 404) {
    die(
      `no pending submission with id "${id}" (already finalized, expired, or wrong id · run scripts/peek-submissions.ts to list).`,
    );
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    die(`${r.status} ${r.statusText} from finalize endpoint. ${body.slice(0, 200)}`);
  }
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean };
  if (data.ok === false) {
    die(`endpoint reported failure for id "${id}".`);
  }
  console.log(
    `✓ rejected submission "${id}" · reason: ${reason}\n  (kept in KV ~30 days for audit; removed from the pending queue)`,
  );
}

main().catch((e) =>
  die(`reject failed: ${e instanceof Error ? e.message : String(e)}`),
);
