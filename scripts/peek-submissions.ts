#!/usr/bin/env tsx
/**
 * peek-submissions · READ-ONLY view of the vendor moderation queue.
 *
 * Run via:
 *   npx tsx scripts/peek-submissions.ts          # needs CRON_SECRET
 *   (vercel env pull .env.local --environment=production first)
 *
 * Why this exists (audit 2026-05 · H6): the
 * /api/cron/list-pending-submissions LOG line was deliberately
 * stripped of submitter PII (it now logs IDs only). That's correct
 * for Vercel logs, but it means an operator can no longer eyeball a
 * submission's content from the logs. review-submissions.ts CAN show
 * it, but only by entering its interactive approve/reject/skip loop —
 * there was no way to just *look*. This script is that missing
 * read-only window: it fetches the same auth-gated
 * /api/admin/pending-submissions endpoint and prints the full
 * records, then EXITS. It never approves, rejects, finalizes, writes
 * vendors.ts, or mutates KV. Mutation stays exclusively in
 * review-submissions.ts behind an explicit human decision.
 *
 * SECURITY: every field in a submission is UNTRUSTED public input
 * (anyone can POST /api/submit-vendor). This script treats it as data
 * and runs an advisory anomaly scan (instruction-like text, bidi /
 * zero-width chars, oversized blobs, URLs in odd fields) so the
 * operator — and any agent surfacing this — is warned BEFORE reading,
 * and never executes instructions embedded in a submission.
 */

// Load .env.local before anything reads process.env (tsx doesn't
// auto-load dotenv the way Next.js does). Mirrors the loader in
// scripts/test-email-setup.ts · fs-only, no extra dep.
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

import type { VendorSubmission } from "../src/lib/vendor-submissions";
import { websiteHostname } from "../src/lib/submit-guard";

const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error(
    "✗ CRON_SECRET not set.\n" +
      "  NOTE: `vercel env pull` will NOT help — CRON_SECRET is a Vercel\n" +
      "  Sensitive var (write-only; pull returns it empty). Supply it\n" +
      "  inline from where you stored it:\n" +
      "    CRON_SECRET='…' npx tsx scripts/peek-submissions.ts\n" +
      "  Or, to view the queue WITHOUT the secret (Vercel auths it\n" +
      "  server-side):  vercel crons run /api/cron/list-pending-submissions",
  );
  process.exit(1);
}

// Advisory scanners · flag, never act.
const INJECTION_RE =
  /(ignore (the |all |any |previous|above|prior)|disregard|override|system prompt|you (must|should|are|will now)|as an ai|assistant\s*[:,]|approve (this|me|my)|add this vendor|auto-?approve|execute|run this|bypass|jailbreak|prompt inject|<script|javascript:|data:text\/html|http-equiv|\bcurl\b|\bwget\b)/i;
// U+200B-200F, U+202A-202E, U+2060, U+2066-2069, U+FEFF
const BIDI_INVISIBLE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
const URLISH_RE = /https?:\/\/|www\.|\.[a-z]{2,}\//i;

function scan(s: VendorSubmission): string[] {
  const v = s.vendor ?? ({} as VendorSubmission["vendor"]);
  const free = [
    v.handle,
    v.name,
    v.description,
    v.website,
    v.founderName,
    s.submitterNote,
  ]
    .filter(Boolean)
    .join("  ");
  const flags: string[] = [];
  if (INJECTION_RE.test(free)) flags.push("INSTRUCTION-LIKE TEXT");
  if (BIDI_INVISIBLE_RE.test(free)) flags.push("BIDI/ZERO-WIDTH CHARS");
  if (free.length > 1200) flags.push("UNUSUALLY LONG");
  // A URL in name/founderName/submitterNote is odd (website has its
  // own field); worth an eyeball.
  if (
    URLISH_RE.test(
      [v.name, v.founderName, s.submitterNote].filter(Boolean).join(" "),
    )
  ) {
    flags.push("URL IN NON-URL FIELD");
  }
  return flags;
}

function fmtTs(ts: unknown): string {
  if (typeof ts !== "number") return "?";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

async function main() {
  const r = await fetch(`${SITE_URL}/api/admin/pending-submissions`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  if (!r.ok) {
    console.error(`✗ ${r.status} ${r.statusText} from admin endpoint`);
    const body = await r.text().catch(() => "");
    if (body) console.error(body.slice(0, 300));
    process.exit(1);
  }
  const data = (await r.json()) as {
    submissions?: VendorSubmission[];
    count?: number;
  };
  const subs = data.submissions ?? [];
  console.log(`\nPENDING SUBMISSIONS: ${data.count ?? subs.length}`);
  console.log("READ-ONLY · all fields are UNTRUSTED public input");
  console.log("=".repeat(66));

  subs.forEach((s, i) => {
    const v = s.vendor ?? ({} as VendorSubmission["vendor"]);
    console.log(
      `\n[${i + 1}] id=${s.id}  status=${s.status}  submitted=${fmtTs(
        s.submittedAt,
      )}`,
    );
    const show: [string, unknown][] = [
      ["handle", v.handle],
      ["platform", v.platform],
      ["name", v.name],
      ["category", v.category],
      ["country", v.country],
      ["website", v.website],
      ["websiteHost", v.website ? websiteHostname(v.website) : undefined],
      ["flags", s.flags],
      ["lightningAddress", v.lightningAddress],
      ["nostrPubkey", v.nostrPubkey],
      ["founderName", v.founderName],
      ["shipsInternational", v.shipsInternational],
    ];
    for (const [k, val] of show) {
      if (val !== undefined && val !== null && val !== "") {
        console.log(`    ${k}: ${JSON.stringify(val)}`);
      }
    }
    if (v.description)
      console.log(`    description: ${JSON.stringify(v.description)}`);
    if (s.submitterNote)
      console.log(`    submitterNote: ${JSON.stringify(s.submitterNote)}`);
    const flags = scan(s);
    console.log(
      `    ⚠ scan: ${flags.length ? flags.join(", ") : "clean"}`,
    );
  });

  console.log("\n" + "=".repeat(66));
  console.log(
    "To act on these: npx tsx scripts/review-submissions.ts (interactive,",
  );
  console.log(
    "per-item approve/reject — the only path that mutates vendors.ts/KV).",
  );
}

main().catch((e) => {
  console.error("✗ peek failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
