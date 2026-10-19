#!/usr/bin/env tsx
/**
 * review-submissions · operator CLI for the vendor submission queue.
 *
 * Run via:
 *   npx tsx scripts/review-submissions.ts
 *
 * What it does:
 *   1. Fetches all pending submissions from the KV moderation queue
 *      (via the auth-gated /api/admin/pending-submissions endpoint)
 *   2. Shows them one at a time with the submitted data
 *   3. For each: approve / reject / skip
 *   4. On approve: classifies an ambiguous `name@domain` handle as
 *      Nostr or Lightning (probing NIP-05 well-known + LNURL-pay to
 *      suggest a default · the /submit form's "skip · let us figure
 *      it out" path lands here), writes the vendor to
 *      src/lib/vendors.ts (same serializer + insertion logic as
 *      scripts/add-vendor.ts), runs the validator, and offers
 *      commit+push. Calls /api/admin/finalize-submission to mark the
 *      submission approved in KV, then (after a successful push)
 *      /api/admin/notify-submitter to fire the one-shot "you're live"
 *      email at approval time instead of waiting for the Sunday
 *      digest cron (which remains the fallback path).
 *   5. On reject: prompts for a reason, calls finalize endpoint
 *      to mark rejected (kept in KV with 30-day TTL for auditability),
 *      then offers (default NO · operator discretion) to email the
 *      reason to the submitter's notify address when one exists.
 *
 * Auth: CRON_SECRET in env, same shared secret used elsewhere.
 *
 * The script never auto-modifies vendors.ts without your explicit
 * "approve" decision · removal stays a human choice, same as the
 * audit-vendors and dormant patterns.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  vendorSlug,
  vendorsByHandle,
  type Vendor,
  type VendorPlatform,
} from "../src/lib/vendors";
import type { VendorSubmission } from "../src/lib/vendor-submissions";
import {
  conflictErrors,
  findListingConflicts,
  ownershipGate,
} from "../src/lib/vendor-dedupe";
import { untrustedWebsiteReview } from "../src/lib/submit-guard";
import { resolveNostrHandleToPubkey } from "../src/lib/nostr-resolve";
import { isSafeHttpsHref, safeFetch } from "../src/lib/safe-fetch";
import { printBadgeHandoff } from "./lib/badge-handoff";
import {
  OUTCOMES,
  OUTCOME_CODES,
  type OutcomeCode,
  noteHeadroom,
} from "../src/lib/submission-outcomes";
import { ISO_COUNTRY_NAMES, flagFor } from "../src/lib/iso-countries";

const REPO_ROOT = pathResolve(__dirname, "..");
const VENDORS_PATH = pathResolve(REPO_ROOT, "src", "lib", "vendors.ts");
const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const rl = readline.createInterface({ input, output });
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  console.error(
    `${C.fail} CRON_SECRET env var required (admin endpoints are auth-gated)`,
  );
  process.exit(1);
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? C.dim(` [${defaultValue}]`) : "";
  const a = await rl.question(`${C.cyan("?")} ${question}${suffix}: `);
  return a.trim() || defaultValue || "";
}

async function askYN(question: string, defaultYes = false): Promise<boolean> {
  const a = await rl.question(
    `${C.cyan("?")} ${question} ${C.dim(defaultYes ? "[Y/n]" : "[y/N]")}: `,
  );
  const t = a.trim().toLowerCase();
  if (!t) return defaultYes;
  return t === "y" || t === "yes";
}

async function fetchPending(): Promise<VendorSubmission[]> {
  const r = await fetch(`${SITE_URL}/api/admin/pending-submissions`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  if (!r.ok) {
    throw new Error(`fetch pending failed: HTTP ${r.status}`);
  }
  const data = (await r.json()) as { submissions: VendorSubmission[] };
  return data.submissions;
}

async function finalize(
  id: string,
  decision:
    | {
        status: "approved";
        approvedAsAddedAt: number;
        ownershipConfirmedByDm?: boolean;
      }
    | {
        status: "rejected";
        reason: string;
        outcome?: { code: OutcomeCode; note?: string };
      },
): Promise<{ ok: boolean; notify?: NotifyOutcome }> {
  const r = await fetch(`${SITE_URL}/api/admin/finalize-submission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, ...decision }),
  });
  if (!r.ok) return { ok: false };
  const data = (await r.json().catch(() => ({}))) as {
    notify?: NotifyOutcome;
  };
  return { ok: true, notify: data.notify };
}

/** Mirror of NotifyResult in src/lib/submission-notify.ts. */
type NotifyOutcome =
  | { notified: "sent" }
  | { notified: "silent"; code: string }
  | { notified: "no-address"; handoff: { profileUrl: string; text: string } }
  | { notified: "failed"; error: string }
  | { notified: "skipped"; reason: string };

/**
 * Report what happened to the submitter notification, and when nothing
 * could be emailed, print the paste-ready DM so the outcome still
 * reaches a human being.
 */
function reportNotify(n: NotifyOutcome | undefined): void {
  if (!n) return;
  if (n.notified === "sent") {
    console.log(`  ${C.ok} outcome emailed to the submitter`);
    return;
  }
  if (n.notified === "silent") {
    console.log(C.dim(`  silent outcome (${n.code}) · nobody notified, by design`));
    return;
  }
  if (n.notified === "failed") {
    console.log(
      `  ${C.warn} notification FAILED: ${n.error} · queued for the daily cron report`,
    );
    return;
  }
  if (n.notified === "skipped") {
    console.log(C.dim(`  no notification · ${n.reason}`));
    return;
  }
  // no-address · the handoff IS the mechanism.
  console.log();
  console.log(`  ${C.warn} no notify email on file`);
  if (n.handoff.profileUrl) {
    console.log(`  DM HANDOFF · ${n.handoff.profileUrl}`);
  }
  console.log(C.dim("  ┌ paste this ─────────────────────────────────────"));
  for (const line of n.handoff.text.split("\n")) {
    console.log(C.dim("  │ ") + line);
  }
  console.log(C.dim("  └─────────────────────────────────────────────────"));
  console.log();
}

/**
 * Pick the outcome code. This replaced a free-text reason prompt: the
 * code is what makes the "and here is how to fix it" line automatic,
 * and what keeps four categories of rejection (spam, phantom records,
 * bulk clears, superseded) deliberately silent.
 */
async function pickOutcome(): Promise<OutcomeCode | null> {
  console.log();
  console.log(C.bold("  Outcome:"));
  OUTCOME_CODES.forEach((code, i) => {
    const o = OUTCOMES[code];
    const tag = o.notifies ? "notifies" : C.dim("silent  ");
    console.log(`    ${String(i + 1).padStart(2)}. [${tag}] ${o.label}`);
  });
  const raw = await ask("  Number");
  const idx = Number.parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx < 1 || idx > OUTCOME_CODES.length) {
    return null;
  }
  return OUTCOME_CODES[idx - 1];
}

/**
 * Fire the one-shot submitter notification ("you're live" on approval,
 * the stored reason on rejection). The endpoint reads the
 * `vendor-notify:<handle>:<slug>` (lib/vendor-notify-key) KV key the /submit form wrote · when the
 * submitter didn't leave an address it responds {ok:true, sent:false}
 * and nothing goes out. Never throws · the notification is a courtesy
 * layer, not part of the approval/rejection transaction.
 */
async function notifySubmitter(
  body:
    | { kind: "live"; handle: string; name: string }
    | { kind: "rejected"; handle: string; name: string; reason: string },
): Promise<{ ok: boolean; sent?: boolean; reason?: string; error?: string }> {
  try {
    const r = await fetch(`${SITE_URL}/api/admin/notify-submitter`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await r.json().catch(() => ({}))) as {
      sent?: boolean;
      reason?: string;
      error?: string;
    };
    return { ok: r.ok, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────
// Ambiguous-platform classification · `name@domain` handles
// ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;
// Same shape the /api/submit-vendor validator calls "ambiguous" ·
// a NIP-05 identifier and a Lightning Address are indistinguishable
// without a network probe.
const NAME_AT_DOMAIN_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Is there a live LNURL-pay endpoint behind this name@domain? */
async function probeLnurlPay(address: string): Promise<boolean> {
  const [name, domain] = address.split("@");
  if (!name || !domain) return false;
  try {
    const r = await safeFetch(
      `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!r) return false;
    if (!r.ok) return false;
    const data = (await r.json()) as { tag?: string };
    return data?.tag === "payRequest";
  } catch {
    return false;
  }
}

/**
 * The /submit form's "Skip · let us figure it out" option leaves
 * `platform` unset on ambiguous `name@domain` handles, promising the
 * review CLI will classify at approval time. This is that
 * classification: probe the NIP-05 well-known and the LNURL-pay
 * endpoint to suggest a default, then let the operator decide.
 * Probes are advisory only · many services (Primal, Alby) answer BOTH,
 * and either can be down at probe time.
 */
async function classifyAmbiguousHandle(handle: string): Promise<VendorPlatform> {
  console.log(
    `  ${C.info} platform unset + \`name@domain\` handle · probing NIP-05 / LNURL-pay...`,
  );
  const [nostrPubkey, lnAlive] = await Promise.all([
    resolveNostrHandleToPubkey(handle).catch(() => null),
    probeLnurlPay(handle),
  ]);
  console.log(
    `    NIP-05 well-known: ${nostrPubkey ? C.ok + " resolves (pubkey " + nostrPubkey.slice(0, 12) + "…)" : C.dim("no match")}`,
  );
  console.log(
    `    LNURL-pay endpoint: ${lnAlive ? C.ok + " alive" : C.dim("no response")}`,
  );
  // Only suggest a default when the probes are decisive · when both
  // (or neither) answer, the operator picks with no default.
  const suggested =
    nostrPubkey && !lnAlive ? "n" : lnAlive && !nostrPubkey ? "l" : undefined;
  while (true) {
    const a = (
      await ask("Platform · [n]ostr (NIP-05) / [l]ightning (LN Address)", suggested)
    ).toLowerCase();
    if (a === "n" || a === "nostr") return "nostr";
    if (a === "l" || a === "lightning") return "lightning";
    console.log(`  ${C.fail} pick n or l`);
  }
}

function nextAddedAt(): number {
  return Math.max(0, ...VENDORS.map((v) => v.addedAt)) + 1;
}

function todayUtcMidnightSeconds(): number {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor(utcMidnight / 1000);
}

function serializeVendor(v: Vendor): string {
  const lines: string[] = ["  {"];
  const push = (key: string, value: string) => {
    lines.push(`    ${key}: ${value},`);
  };
  push("handle", JSON.stringify(v.handle));
  if (v.platform && v.platform !== "x") {
    push("platform", JSON.stringify(v.platform));
  }
  push("name", JSON.stringify(v.name));
  push("description", JSON.stringify(v.description));
  push("category", JSON.stringify(v.category));
  push("addedAt", String(v.addedAt));
  push("listedAt", String(v.listedAt));
  push("verifiedAt", String(v.verifiedAt));
  if (v.country) push("country", JSON.stringify(v.country));
  if (v.lightningAddress)
    push("lightningAddress", JSON.stringify(v.lightningAddress));
  if (v.nostrPubkey) push("nostrPubkey", JSON.stringify(v.nostrPubkey));
  if (v.shipsInternational) push("shipsInternational", "true");
  if (v.tradeFriendly) push("tradeFriendly", "true");
  if (v.interestedIn && v.interestedIn.length > 0) {
    push(
      "interestedIn",
      "[" + v.interestedIn.map((c) => JSON.stringify(c)).join(", ") + "]",
    );
  }
  if (v.founderName) push("founderName", JSON.stringify(v.founderName));
  if (v.website) push("website", JSON.stringify(v.website));
  // pictureUrl · adopted from the signed kind:0 at approval time
  // (see the ln-guard gate in approve()) · pre-populating kills the
  // 1-3s relay query the detail modal would otherwise need.
  if (v.pictureUrl) push("pictureUrl", JSON.stringify(v.pictureUrl));
  lines.push("  },");
  return lines.join("\n");
}

function insertVendorEntry(currentSource: string, entryText: string): string {
  const closingIdx = currentSource.lastIndexOf("];");
  if (closingIdx === -1) {
    throw new Error("couldn't find closing `];` of VENDORS array");
  }
  const before = currentSource.slice(0, closingIdx).trimEnd();
  const after = currentSource.slice(closingIdx);
  return before + "\n" + entryText + "\n" + after;
}

function runQuiet(
  command: string,
  args: string[],
  opts: { input?: string } = {},
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: opts.input,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(e),
    };
  }
}

function formatSubmission(s: VendorSubmission, idx: number, total: number): void {
  const v = s.vendor;
  console.log();
  console.log(C.bold(`──── Submission ${idx + 1} of ${total} ────`));
  console.log(
    `  ${C.dim(`submitted ${new Date(s.submittedAt * 1000).toLocaleString()} · id ${s.id}`)}`,
  );
  console.log();
  console.log(`  ${C.cyan("Handle:")}      ${v.handle}`);
  console.log(`  ${C.cyan("Platform:")}    ${v.platform ?? "x (default)"}`);
  console.log(`  ${C.cyan("Name:")}        ${v.name}`);
  console.log(`  ${C.cyan("Category:")}    ${CATEGORY_LABELS[v.category]}`);
  if (v.country) {
    const flag = COUNTRIES[v.country]?.flag ?? "";
    const label = COUNTRIES[v.country]?.label ?? v.country;
    console.log(`  ${C.cyan("Country:")}     ${flag} ${label} (${v.country})`);
  }
  console.log(`  ${C.cyan("Description:")} ${v.description}`);
  if (v.lightningAddress)
    console.log(`  ${C.cyan("Lightning:")}   ${v.lightningAddress}`);
  if (s.flags && s.flags.length > 0) {
    console.log(
      `  ${C.warn} ${C.cyan("Flags:")}       ${s.flags.join(", ")}`,
    );
  }
  if (v.website) {
    const w = untrustedWebsiteReview(v.website);
    console.log(`  ${C.warn} ${C.cyan("Website:")}     untrusted storefront · not a Galaxy Mind link`);
    for (const line of w.cliLines) {
      console.log(`               ${line}`);
    }
  }
  if (v.founderName) console.log(`  ${C.cyan("Founder:")}     ${v.founderName}`);
  if (v.shipsInternational) console.log(`  ${C.cyan("Ships int'l:")} yes`);
  if (v.tradeFriendly) {
    const list = v.interestedIn?.join(", ") ?? "(any)";
    console.log(`  ${C.cyan("Trade-open:")}  yes · for ${list}`);
  }
  if (s.submitterNote) {
    console.log();
    console.log(`  ${C.cyan("Note:")} ${C.dim(s.submitterNote)}`);
  }
  // LN guard verdict (2026-07-23 · lib/ln-guard) · "form vs signed
  // profile" side by side. A pre-guard submission that carries an
  // LN address renders as UNVERIFIED — fail-visible, never silent.
  const pc = s.profileCheck;
  if (pc) {
    console.log();
    const g = pc.lnGuard;
    const icon = g.requiresHold ? C.fail : g.needsConfirm ? C.warn : C.ok;
    console.log(`  ${icon} ${C.cyan("LN guard:")}    ${g.summary}`);
    if (pc.profileName)
      console.log(
        `  ${C.cyan("Profile:")}     ${pc.profileName} ${C.dim("· name from signed kind:0")}`,
      );
    if (pc.profilePicture)
      console.log(`  ${C.cyan("Avatar:")}      ${C.dim(pc.profilePicture)}`);
  } else if (v.lightningAddress) {
    console.log();
    console.log(
      `  ${C.warn} ${C.cyan("LN guard:")}    no verdict on record (pre-guard submission) · treat address as UNVERIFIED`,
    );
  }
  // Multi-shop (2026-10): the handle already runs listed shops · show
  // them and the ownership evidence so the reviewer judges "same owner"
  // before anything else.
  const siblings = findListingConflicts(
    { handle: v.handle, platform: v.platform, name: v.name, website: v.website },
    VENDORS,
  ).sameHandle;
  if (siblings.length > 0) {
    console.log();
    console.log(
      `  ${C.warn} ${C.cyan("Same handle:")} already lists ${siblings.map((x) => `"${x.name}"`).join(", ")}`,
    );
    const oc = s.ownershipCheck;
    console.log(
      `  ${oc?.ok ? C.ok : C.warn} ${C.cyan("Ownership:")}   ${oc ? oc.detail : "no evidence on record · confirm by DM from the account"}`,
    );
  }
  console.log();
  console.log(`  ${C.dim(`Slug would be: /v/${vendorSlug({ name: v.name })}`)}`);
}

async function approve(s: VendorSubmission): Promise<boolean> {
  const addedAt = nextAddedAt();
  const verifiedAt = todayUtcMidnightSeconds();
  // Approval day IS the listing day · this is the one true "new vendor"
  // path, so listedAt = verifiedAt here (same as add-vendor.ts).
  const listedAt = verifiedAt;

  // Resolve an unset platform BEFORE serializing. serializeVendor
  // omits an unset platform, which defaults to "x" at read time ·
  // for a `name@domain` or npub handle that means check-vendors.ts
  // fails its per-platform handle regex AFTER the file is written
  // (the "write succeeded but validation failed" branch below).
  // Classify here instead, as the /submit form's skip-option promises.
  let platform = s.vendor.platform;
  if (!platform) {
    if (/^(npub1|nprofile1)/.test(s.vendor.handle)) {
      // Unambiguous · bech32 is Nostr by definition, no prompt needed.
      platform = "nostr";
      console.log(`  ${C.dim("platform unset · npub/nprofile handle → nostr")}`);
    } else if (NAME_AT_DOMAIN_RE.test(s.vendor.handle)) {
      platform = await classifyAmbiguousHandle(s.vendor.handle);
    }
    // Plain X-shaped handles fall through · the implicit "x" default
    // is correct for them.
  }

  // ── Lightning-address guard gate (2026-07-23 · lib/ln-guard) ────
  // The publish decision for a payment-bearing field. Policy:
  //   · mismatch (form contradicts signed lud16) → HARD hold: the
  //     reviewer must pick profile/form/omit explicitly, after
  //     confirming with the KEY HOLDER (DM the npub, not the
  //     submitter — the submitter might be the attacker).
  //   · unanchored/unverified → soft gate: reviewer attests
  //     out-of-band confirmation or the submission is skipped.
  //   · pre-guard submissions with an LN address → same soft gate.
  let lightningAddress = s.vendor.lightningAddress;
  const guard = s.profileCheck?.lnGuard;
  if (guard?.requiresHold) {
    console.log();
    console.log(`  ${C.fail} ${C.bold("LN GUARD HOLD")} · ${guard.summary}`);
    console.log(
      C.dim(
        "  Neither value publishes by default. Confirm with the key holder (DM the npub) first.",
      ),
    );
    for (;;) {
      const choice = (
        await ask(
          "  publish [p]rofile lud16 / [f]orm value / [o]mit lightning / [s]kip submission",
          "s",
        )
      ).toLowerCase();
      if (choice === "p" && guard.profileLud16) {
        lightningAddress = guard.profileLud16;
        console.log(`  ${C.ok} publishing signed-profile lud16: ${lightningAddress}`);
        break;
      }
      if (choice === "f" && guard.submittedLn) {
        const sure = await askYN(
          "Form value is the UNANCHORED one · key holder explicitly confirmed it?",
          false,
        );
        if (!sure) continue;
        lightningAddress = guard.submittedLn;
        console.log(`  ${C.ok} publishing form value: ${lightningAddress}`);
        break;
      }
      if (choice === "o") {
        lightningAddress = undefined;
        console.log(`  ${C.ok} lightning address omitted from the entry`);
        break;
      }
      if (choice === "s") {
        console.log(C.dim("  held · submission stays pending"));
        return false;
      }
      console.log(`  ${C.fail} pick p, f, o, or s`);
    }
  } else if (lightningAddress && (guard ? guard.needsConfirm : true)) {
    // Soft gate · covers no-anchor (X/lightning platforms),
    // unverified (fetch failed), profile-missing-ln, AND legacy
    // records with no guard verdict at all.
    const confirmed = await askYN(
      `LN address ${lightningAddress} has no crypto anchor · confirmed out-of-band with the vendor's real identity?`,
      false,
    );
    if (!confirmed) {
      console.log(
        C.dim(
          "  held · DM the vendor's pinned identity to confirm, then re-run",
        ),
      );
      return false;
    }
  }
  // Nothing submitted but the SIGNED profile carries a lud16 →
  // offer it. Never auto-adopt: a kind:0 lud16 is the zap wallet,
  // which is not necessarily the business till.
  if (!lightningAddress && guard?.suggestedLn) {
    const adopt = await askYN(
      `No LN address submitted · adopt signed-profile lud16 ${guard.suggestedLn}?`,
      false,
    );
    if (adopt) lightningAddress = guard.suggestedLn;
  }

  // Adopt the signed profile's avatar when the submission has none ·
  // pre-populating pictureUrl at add time is the documented fix for
  // the 1-3s relay query the detail modal otherwise pays.
  //
  // Multi-shop (2026-10): a second shop under the same handle is NOT
  // the account · don't auto-offer the account avatar (the logo
  // fallback already renders it). Offer an optional per-shop logo
  // instead; blank keeps the account-avatar fallback.
  let pictureUrl = s.vendor.pictureUrl;
  const isSibling =
    vendorsByHandle(s.vendor.handle, platform ?? s.vendor.platform ?? "x")
      .length > 0;
  if (!pictureUrl && isSibling) {
    const logo = (
      await ask(
        "  Per-shop logo URL (https, blank = fall back to the account avatar)",
        "",
      )
    ).trim();
    if (logo && isSafeHttpsHref(logo)) pictureUrl = logo;
    else if (logo) console.log(`  ${C.warn} not a safe https URL · ignored`);
  } else if (!pictureUrl && s.profileCheck?.profilePicture) {
    const adopt = await askYN(
      `Adopt profile picture from signed kind:0? (${s.profileCheck.profilePicture.slice(0, 60)}…)`,
      true,
    );
    if (adopt) pictureUrl = s.profileCheck.profilePicture;
  }

  const newVendor: Vendor = {
    ...s.vendor,
    ...(platform ? { platform } : {}),
    addedAt,
    listedAt,
    verifiedAt,
  };
  // Apply the guard-gate resolutions AFTER the spread so they win
  // over (or delete) the raw submitted values.
  if (lightningAddress) newVendor.lightningAddress = lightningAddress;
  else delete newVendor.lightningAddress;
  if (pictureUrl) newVendor.pictureUrl = pictureUrl;

  // Duplicate re-check (something might have landed since submission).
  // Multi-shop (2026-10): the handle may already own listings; what
  // must not exist is the same STOREFRONT (under any handle) or the
  // same /v slug.
  const conflicts = findListingConflicts(
    {
      handle: s.vendor.handle,
      platform: newVendor.platform,
      name: s.vendor.name,
      website: s.vendor.website,
    },
    VENDORS,
  );
  const dupErrors = conflictErrors(
    { handle: s.vendor.handle, name: s.vendor.name, website: s.vendor.website },
    conflicts,
  );
  if (dupErrors.length > 0) {
    for (const e of dupErrors) console.log(`  ${C.fail} ${e} · skipping write`);
    return false;
  }

  // Ownership gate · a NEW shop under a handle that already owns one
  // needs proof (operator, 2026-10-16): the intake backlink / nostr.json
  // check, else a DM from the ACCOUNT (never the submitter's word).
  let ownershipConfirmedByDm = false;
  const blocked = ownershipGate({
    sameHandle: conflicts.sameHandle,
    check: s.ownershipCheck,
  });
  if (blocked) {
    console.log();
    console.log(`  ${C.warn} ${C.bold("OWNERSHIP")} · ${blocked}`);
    ownershipConfirmedByDm = await askYN(
      `  Did @${s.vendor.handle} itself confirm this shop by DM?`,
      false,
    );
    if (!ownershipConfirmedByDm) {
      console.log(`  ${C.fail} no ownership proof · skipping (leave it pending, DM the account)`);
      return false;
    }
  }

  // Country pre-flight · MUST run before the write (2026-08-20).
  //
  // /api/submit-vendor accepts any /^[A-Z]{2}$/, and the submit form now
  // offers the full ISO table, so a submission can legitimately carry a
  // country that has no COUNTRIES row yet. check-vendors gate 8 will
  // reject that — but it only runs AFTER writeFileSync below, which left
  // the entry half-applied in a dirty working tree and made a data
  // question look like a validator failure.
  //
  // Promoting a country is three coordinated edits (COUNTRIES,
  // COUNTRY_COORDS, and COUNTRY_HUB_ALIASES in next.config.ts, the last
  // two parity-enforced), and it stands up a new public hub page — an
  // operator decision, not something to do implicitly mid-approval.
  if (newVendor.country && !COUNTRIES[newVendor.country]) {
    const cc = newVendor.country;
    const known = ISO_COUNTRY_NAMES[cc];
    console.log();
    console.log(
      `  ${C.warn} ${flagFor(cc)} ${known ?? cc} (${cc}) is not in COUNTRIES yet.`,
    );
    console.log(
      known
        ? `  Listing it would stand up a new /spend-bitcoin-in/${known
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")} hub page.`
        : `  ${cc} is not an officially assigned ISO-3166-1 alpha-2 code.`,
    );
    console.log(
      `  To list it properly: abort here, promote ${cc} (COUNTRIES + COUNTRY_COORDS + COUNTRY_HUB_ALIASES), then re-run.`,
    );
    const dropIt = await askYN(
      `Drop the country field and approve without it?`,
      false,
    );
    if (!dropIt) {
      console.log(`  ${C.fail} aborted before write · nothing changed`);
      return false;
    }
    delete newVendor.country;
    console.log(`  ${C.ok} country dropped · vendor will list without a flag`);
  }

  const entryText = serializeVendor(newVendor);
  console.log();
  console.log(C.bold("Preview:"));
  console.log(entryText);

  const ok = await askYN("Write to vendors.ts?", true);
  if (!ok) return false;

  const currentSource = readFileSync(VENDORS_PATH, "utf8");
  const newSource = insertVendorEntry(currentSource, entryText);
  writeFileSync(VENDORS_PATH, newSource);
  console.log(`  ${C.ok} written to vendors.ts`);

  // Validate.
  const v = runQuiet("npx", ["tsx", "scripts/check-vendors.ts"]);
  if (!v.ok) {
    console.log(`  ${C.fail} validator failed:`);
    console.log(v.stdout);
    console.log(v.stderr);
    console.log(
      `  ${C.warn} write succeeded but validation failed · inspect git diff`,
    );
    return false;
  }
  console.log(`  ${C.ok} validator passes`);

  // Mark approved in KV.
  const finalized = await finalize(s.id, {
    status: "approved",
    approvedAsAddedAt: addedAt,
    ...(ownershipConfirmedByDm ? { ownershipConfirmedByDm: true } : {}),
  });
  if (!finalized.ok) {
    console.log(
      `  ${C.warn} couldn't mark approved in KV · entry is written but queue has a stale "pending" record`,
    );
  } else {
    console.log(`  ${C.ok} submission marked approved in queue`);
  }

  // Commit + push?
  const commitOk = await askYN("Commit + push?", true);
  if (!commitOk) {
    console.log(C.dim(`  Done · run "git diff" to inspect`));
    console.log(
      C.dim(
        `  "you're live" email (if the submitter left one) will fire from the Sunday digest cron once deployed`,
      ),
    );
    return true;
  }
  const flag = newVendor.country
    ? COUNTRIES[newVendor.country]?.flag ?? ""
    : "";
  const commitMsg = `Add @${newVendor.handle} · ${newVendor.name}${flag ? " " + flag : ""}\n\n${newVendor.description}\n\nApproved via /submit (id ${s.id})\n`;
  runQuiet("git", ["add", "src/lib/vendors.ts"]);
  const commitRes = runQuiet("git", ["commit", "-F", "-"], {
    input: commitMsg,
  });
  if (!commitRes.ok) {
    console.log(`  ${C.fail} git commit failed: ${commitRes.stderr}`);
    return true;
  }
  console.log(`  ${C.ok} ${commitRes.stdout.trim().split("\n")[0]}`);
  try {
    execFileSync("git", ["push"], { cwd: REPO_ROOT, stdio: "inherit" });
    console.log(`  ${C.ok} pushed · Vercel will deploy in ~30s`);
  } catch {
    console.log(`  ${C.warn} push failed · run \`git push\` manually`);
    console.log(
      C.dim(
        `  "you're live" email (if the submitter left one) will fire from the Sunday digest cron once deployed`,
      ),
    );
    return true;
  }

  // One-shot "you're live" email · fired at approval time instead of
  // waiting up to a week for the Sunday new-vendor-digest cron (which
  // stays as the fallback when this fails · the endpoint only clears
  // the vendor-notify key on a successful send). Deploy takes
  // ~30s after the push; email delivery + open time comfortably covers
  // that gap, so the /v/<slug> link works by the time it's clicked.
  const notify = await notifySubmitter({
    kind: "live",
    handle: newVendor.handle,
    name: newVendor.name,
  });
  if (notify.sent) {
    console.log(`  ${C.ok} "you're live" email sent to the submitter`);
  } else if (notify.ok) {
    console.log(C.dim(`  no notify email on file · nothing to send`));
  } else {
    console.log(
      `  ${C.warn} "you're live" email failed (${notify.error ?? "endpoint error"}) · Sunday digest cron remains the fallback`,
    );
  }

  // Always print the badge handoff, even when the email went out — the
  // operator is usually about to reply to this merchant anyway, and
  // when there was no address on file (the `notify.ok` branch above)
  // this is the ONLY way the badge ever reaches them.
  printBadgeHandoff({ name: newVendor.name, handle: newVendor.handle });

  return true;
}

async function reject(s: VendorSubmission): Promise<boolean> {
  const code = await pickOutcome();
  if (!code) {
    console.log(`  ${C.warn} no outcome selected · cancelled`);
    return false;
  }
  const outcome = OUTCOMES[code];

  let note: string | undefined;
  if (outcome.notifies) {
    console.log();
    console.log(C.dim(`  They will be told: ${outcome.message}`));
    if (outcome.remedy) {
      console.log(C.dim(`  What to fix:       ${outcome.remedy}`));
    } else {
      console.log(C.dim(`  What to fix:       (none · this outcome is closed)`));
    }
    const extra = await ask(
      `  Extra sentence for the submitter (optional, max ${noteHeadroom(code)} chars)`,
    );
    note = extra.trim() || undefined;
  }

  // The PRIVATE audit note. Deliberately prompted after the outcome so
  // it is obvious these are two different audiences: this one is for
  // whoever re-vets this handle in six months, and it is never sent.
  const reason = await ask(
    "  Internal audit note (stored 30d in KV, never sent to the submitter)",
  );
  if (!reason) {
    console.log(`  ${C.warn} audit note required · cancelled`);
    return false;
  }

  const res = await finalize(s.id, {
    status: "rejected",
    reason,
    outcome: { code, note },
  });
  if (!res.ok) {
    console.log(`  ${C.fail} couldn't mark rejected in KV`);
    return false;
  }
  console.log(`  ${C.ok} submission ${s.id} marked rejected (${code})`);
  reportNotify(res.notify);
  return true;
}

async function main(): Promise<void> {
  console.log();
  console.log(C.bold("Galaxy Mind · submission review"));
  let pending: VendorSubmission[];
  try {
    pending = await fetchPending();
  } catch (e) {
    console.error(`${C.fail} ${e instanceof Error ? e.message : e}`);
    rl.close();
    process.exit(1);
  }
  if (pending.length === 0) {
    console.log(`  ${C.ok} no pending submissions`);
    rl.close();
    return;
  }
  console.log(`  ${C.info} ${pending.length} pending`);

  for (let i = 0; i < pending.length; i++) {
    const s = pending[i];
    formatSubmission(s, i, pending.length);
    const action = await ask(
      "[a]pprove / [r]eject / [s]kip / [q]uit",
      "s",
    );
    const t = action.toLowerCase();
    if (t === "q" || t === "quit") break;
    if (t === "a" || t === "approve") {
      await approve(s);
    } else if (t === "r" || t === "reject") {
      await reject(s);
    } else {
      console.log(C.dim("  skipped · still pending"));
    }
  }
  console.log();
  console.log(C.dim("Done."));
  rl.close();
}

main().catch((e) => {
  console.error(`\nreview-submissions failed:`, e);
  rl.close();
  process.exit(1);
});
