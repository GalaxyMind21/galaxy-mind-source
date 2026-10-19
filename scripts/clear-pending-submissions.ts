/* clear-pending-submissions · bulk-reject EVERY pending vendor
 * submission in one command. The fast path for "the moderation queue
 * has piled up and the daily digest email is huge."
 *
 * Run:
 *   # 1. dry run · just lists what WOULD be cleared (no writes):
 *   CRON_SECRET='…' npx tsx scripts/clear-pending-submissions.ts
 *   # 2. actually clear them:
 *   CRON_SECRET='…' npx tsx scripts/clear-pending-submissions.ts --yes "reason"
 *
 * Why a bulk tool (companion to peek + reject-submission): clearing a
 * backlog with reject-submission.ts means copying each id by hand. This
 * lists + rejects all in one pass. Default is a DRY RUN so you always
 * see the list before anything is touched.
 *
 * Safety:
 *   · Rejection is reversible · each record is kept in KV ~30 days
 *     (audit TTL) and can be reconsidered; nothing is hard-deleted.
 *   · APPROVE is intentionally NOT here (same reason as
 *     reject-submission.ts · approving writes the public vendors.ts +
 *     pushes, which must stay a deliberate human action behind
 *     review-submissions.ts).
 *   · Submission fields are UNTRUSTED public input · names are printed
 *     with control chars stripped so a hostile submission can't garble
 *     or inject into your terminal. We never execute their content.
 *
 * CRON_SECRET is a Vercel Sensitive var (write-only · `vercel env pull`
 * returns it blank), so it must be supplied inline from where you
 * stored it. Do not commit it.
 */
import * as fs from "node:fs";
import {
  VENDORS,
  normalizeWebsite,
  vendorSlug,
  vendorWebsite,
} from "../src/lib/vendors";
import * as path from "node:path";

// Load .env.local if present (tsx doesn't auto-load dotenv). Same
// fs-only loader as peek-submissions.ts / reject-submission.ts.
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

function safeLabel(s: unknown): string {
  // Drop control chars (codepoint < 0x20, the terminal-injection
  // vector, plus DEL) and cap length. No literal control chars or
  // regex · submission names are untrusted public input.
  return [...String(s ?? "")]
    .filter((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return cp >= 0x20 && cp !== 0x7f;
    })
    .join("")
    .slice(0, 60);
}

const args = process.argv.slice(2);
if (args.includes("--approve")) {
  die(
    "approve is intentionally not supported here · it mutates the public list.\n  Use the human-in-the-loop path: CRON_SECRET=… npx tsx scripts/review-submissions.ts",
  );
}
const confirmed = args.includes("--yes");
const reason =
  args.filter((a) => !a.startsWith("--")).join(" ").trim() ||
  "bulk-cleared via clear-pending-submissions";

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  die(
    "CRON_SECRET not set.\n" +
      "  It's a Vercel Sensitive var (write-only · `vercel env pull` returns it\n" +
      "  blank). Supply it inline from where you stored it:\n" +
      "    CRON_SECRET='…' npx tsx scripts/clear-pending-submissions.ts --yes\n" +
      "  (Or leave the queue · pending entries auto-expire via the 60-day TTL.)",
  );
}

type Submission = {
  id: string;
  submittedAt?: number;
  vendor?: { name?: string; handle?: string; website?: string };
  /** Annotated by /api/admin/pending-submissions · boolean, never the address. */
  hasNotifyAddress?: boolean;
};

async function listPending(): Promise<Submission[]> {
  const r = await fetch(`${SITE_URL}/api/admin/pending-submissions`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  if (r.status === 401 || r.status === 403) {
    die("auth rejected (401/403) · CRON_SECRET is wrong or stale.");
  }
  if (!r.ok) die(`${r.status} ${r.statusText} listing pending submissions.`);
  const data = (await r.json().catch(() => ({}))) as {
    submissions?: Submission[];
  };
  return Array.isArray(data.submissions) ? data.submissions : [];
}

async function reject(id: string, code: string): Promise<boolean> {
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
      // A bulk sweep is explicitly SILENT · see the guard in main().
      outcome: { code },
    }),
  });
  return r.ok;
}

async function main() {
  const pending = await listPending();
  if (pending.length === 0) {
    console.log("✓ queue already empty · nothing to clear.");
    return;
  }

  const nowSec = Date.now() / 1000;
  console.log(`${pending.length} pending submission(s):\n`);
  for (const s of pending) {
    const ageDays =
      typeof s.submittedAt === "number"
        ? Math.floor((nowSec - s.submittedAt) / 86_400)
        : "?";
    console.log(
      `  · ${safeLabel(s.vendor?.name).padEnd(32)} @${safeLabel(
        s.vendor?.handle,
      )}  (${ageDays}d old · id ${s.id.slice(0, 12)}…)`,
    );
  }

  if (!confirmed) {
    console.log(
      `\nDRY RUN · nothing changed. To reject all ${pending.length}, re-run with --yes:\n` +
        `  CRON_SECRET='…' npx tsx scripts/clear-pending-submissions.ts --yes "${reason}"`,
    );
    return;
  }

  // ── THE SWEEP GUARD (2026-08-20) ──────────────────────────────────
  //
  // A bulk clear is SILENT by design: it exists to drain a queue that
  // has piled up with phantoms and stale junk, and firing a burst of
  // weeks-old rejections would be worse than saying nothing.
  //
  // But silence is exactly the failure that made this feature
  // necessary. A real merchant who left an email and got swept up in
  // housekeeping hears nothing and tells people so. So the sweep
  // refuses to absorb anyone it could actually have answered: records
  // with a notify address that are NOT already-live phantoms get held
  // back for individual review instead of being cleared.
  // "Already live" means THIS LISTING is live, not just the handle:
  // since 2026-10 one handle may run several shops, and a pending second
  // shop under a live handle is a real submission, not a phantom. A
  // listing matches on handle + (same slug OR same normalized website),
  // so an approval where the operator tweaked the name still counts.
  const isLive = (s: Submission) => {
    const h = s.vendor?.handle;
    if (!h) return false;
    return VENDORS.some(
      (v) =>
        v.handle === h &&
        ((s.vendor?.name && vendorSlug(v) === vendorSlug({ name: s.vendor.name })) ||
          (s.vendor?.website &&
            vendorWebsite(v) &&
            normalizeWebsite(vendorWebsite(v)!) === normalizeWebsite(s.vendor.website))),
    );
  };
  const phantoms = pending.filter(isLive);
  const answerable = pending.filter((s) => s.hasNotifyAddress && !isLive(s));
  const sweepable = pending.filter((s) => !s.hasNotifyAddress && !isLive(s));

  if (answerable.length > 0) {
    console.log(
      `\n⚠ ${answerable.length} submission(s) left an email address and are NOT already listed.\n` +
        "  A silent bulk clear would drop them without a word, which is the\n" +
        "  exact failure this guard exists to prevent. Handle these first:\n",
    );
    for (const s of answerable) {
      console.log(
        `    · ${safeLabel(s.vendor?.name).padEnd(32)} id ${s.id.slice(0, 12)}…`,
      );
    }
    console.log(
      "\n  Use the review CLI so they get a real outcome and a fix-it line:\n" +
        "    CRON_SECRET='…' npx tsx scripts/review-submissions.ts\n\n" +
        "  Then re-run this sweep for the rest.",
    );
    return;
  }

  console.log(
    `\nRejecting ${sweepable.length + phantoms.length} ` +
      `(${phantoms.length} already-listed phantom(s), ${sweepable.length} with no reply address)…\n`,
  );
  let ok = 0;
  let failed = 0;
  for (const s of [...phantoms, ...sweepable]) {
    const code = isLive(s) ? "already-listed" : "bulk-clear";
    const success = await reject(s.id, code);
    if (success) {
      ok++;
      console.log(`  ✓ ${safeLabel(s.vendor?.name)}`);
    } else {
      failed++;
      console.log(`  ✗ FAILED ${safeLabel(s.vendor?.name)} (id ${s.id})`);
    }
  }
  console.log(
    `\nDone · ${ok} rejected${failed ? `, ${failed} failed (re-run to retry)` : ""}.` +
      "\nRecords kept ~30 days for audit; the daily digest will now be empty.",
  );
}

main().catch((e) =>
  die(`clear failed: ${e instanceof Error ? e.message : String(e)}`),
);
