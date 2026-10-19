#!/usr/bin/env tsx
/**
 * add-vendor · interactive onboarding CLI for Galaxy Mind vendors.
 *
 * Run via:
 *   npx tsx scripts/add-vendor.ts
 *
 * What it does:
 *   1. Walks you through the prompts to define a new vendor
 *   2. Auto-detects platform from handle format
 *   3. Fuzzy-matches country names to ISO codes
 *   4. Auto-enriches Nostr vendors with profile metadata (description,
 *      Lightning Address, NIP-05, website) pulled from kind:0 events
 *   5. Validates the LNURL-pay endpoint for Lightning vendors
 *   6. Computes addedAt (max+1) and verifiedAt (today UTC midnight)
 *   7. Previews the formatted entry
 *   8. Inserts into src/lib/vendors.ts at the correct position
 *   9. Runs scripts/check-vendors.ts to validate
 *  10. Finalizes any matching pending /submit row in KV (already-listed
 *      silent, or approved + "you're live" when they left a notify email)
 *  11. Optionally commits + pushes
 *
 * Why a CLI over a web form: zero infra, zero auth surface, runs on
 * your laptop where the repo already lives. Web form is Phase 2 if
 * you ever want to onboard from your phone.
 *
 * Security note: all subprocess invocations use `execFileSync` (no
 * shell · immune to injection). Commit messages with vendor data
 * are piped via stdin to `git commit -F -` rather than interpolated
 * into a command string.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  vendorSlug,
  type Vendor,
  type VendorCategory,
  type VendorPlatform,
} from "../src/lib/vendors";
import {
  fetchNostrProfileMetadata,
  resolveNostrHandleToPubkey,
} from "../src/lib/nostr-activity";
import { snapshotXAvatar } from "./snapshot-avatars";
import { printBadgeHandoff } from "./lib/badge-handoff";
import { ISO_COUNTRY_NAMES, flagFor } from "../src/lib/iso-countries";

// ─────────────────────────────────────────────────────────────────
// Constants + tiny terminal coloring
// ─────────────────────────────────────────────────────────────────

const REPO_ROOT = pathResolve(__dirname, "..");
const VENDORS_PATH = pathResolve(REPO_ROOT, "src", "lib", "vendors.ts");
const FETCH_TIMEOUT_MS = 5_000;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

const VALID_CATEGORIES: VendorCategory[] = Object.keys(
  CATEGORY_LABELS,
) as VendorCategory[];

// Lightning Address services we recognize · used to bias the
// platform detection toward "lightning" when a handle ends in one.
const KNOWN_LN_DOMAINS = new Set([
  "walletofsatoshi.com",
  "getalby.com",
  "strike.me",
  "primal.net",
  "stacker.news",
  "blink.sv",
  "coinos.io",
  "sparkwallet.me",
  "ln.tips",
  "bitnob.io",
]);

// Marketing-language flags · vendors should describe what they sell,
// not how amazing it is. Per the README: "Short, honest. ~100-200
// chars. No marketing copy."
const MARKETING_FLAGS = [
  "amazing",
  "best in class",
  "world-class",
  "revolutionary",
  "premium",
  "cutting-edge",
  "industry-leading",
  "next-generation",
  "game-changing",
  "unrivaled",
  "unmatched",
  "exclusive",
];

// ─────────────────────────────────────────────────────────────────
// Prompt helpers
// ─────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input, output });

async function ask(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue !== undefined && defaultValue !== "" ? C.dim(` [${defaultValue}]`) : "";
  const answer = await rl.question(`${C.cyan("?")} ${question}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

async function askYN(
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const a = await rl.question(`${C.cyan("?")} ${question} ${C.dim(suffix)}: `);
  const t = a.trim().toLowerCase();
  if (!t) return defaultYes;
  return t === "y" || t === "yes";
}

async function askChoice<T>(
  question: string,
  options: { value: T; label: string }[],
  defaultIdx?: number,
): Promise<T> {
  console.log(`${C.cyan("?")} ${question}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? C.accent("▶") : " ";
    console.log(`  ${marker} ${i + 1}. ${options[i].label}`);
  }
  while (true) {
    const a = await rl.question(
      `  ${C.dim(`Pick 1-${options.length}${defaultIdx !== undefined ? ` [${defaultIdx + 1}]` : ""}`)}: `,
    );
    const t = a.trim();
    if (!t && defaultIdx !== undefined) return options[defaultIdx].value;
    const n = Number.parseInt(t, 10);
    if (Number.isFinite(n) && n >= 1 && n <= options.length) {
      return options[n - 1].value;
    }
    console.log(`  ${C.fail} Pick a number 1-${options.length}.`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Smart detection + fuzzy matching
// ─────────────────────────────────────────────────────────────────

function detectPlatform(
  handle: string,
): { platform: VendorPlatform; confidence: "high" | "low" } {
  if (handle.startsWith("npub1") || handle.startsWith("nprofile1")) {
    return { platform: "nostr", confidence: "high" };
  }
  if (handle.includes("@")) {
    const domain = handle.split("@")[1]?.toLowerCase() ?? "";
    if (KNOWN_LN_DOMAINS.has(domain)) {
      return { platform: "lightning", confidence: "high" };
    }
    return { platform: "nostr", confidence: "low" };
  }
  return { platform: "x", confidence: "high" };
}

function fuzzyMatchCountry(input: string): string | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  if (COUNTRIES[t]) return t;
  const ALIASES: Record<string, string> = {
    USA: "US",
    AMERICA: "US",
    "UNITED STATES": "US",
    UK: "GB",
    BRITAIN: "GB",
    ENGLAND: "GB",
    "UNITED KINGDOM": "GB",
    DEUTSCHLAND: "DE",
    GERMANY: "DE",
    NEDERLAND: "NL",
    HOLLAND: "NL",
  };
  if (ALIASES[t]) return ALIASES[t];
  const tLower = input.trim().toLowerCase();
  for (const [code, info] of Object.entries(COUNTRIES)) {
    if (info.label.toLowerCase().includes(tLower)) return code;
  }
  // ISO fallback tier (2026-08-20). Before this, the CLI could only match
  // countries that ALREADY had a vendor — the operator's own tool had the
  // same country-#21 ceiling the /submit dropdown had. Matching here does
  // not list the country: check-vendors gate 8 still requires a COUNTRIES
  // row, which is what forces the deliberate promotion step.
  if (ISO_COUNTRY_NAMES[t]) return t;
  for (const [code, label] of Object.entries(ISO_COUNTRY_NAMES)) {
    if (label.toLowerCase() === tLower) return code;
  }
  for (const [code, label] of Object.entries(ISO_COUNTRY_NAMES)) {
    if (label.toLowerCase().includes(tLower)) return code;
  }
  return null;
}

/** Flag + label for any code, whether or not it is in COUNTRIES yet. */
function countryDisplay(code: string): string {
  const known = COUNTRIES[code];
  if (known) return `${known.flag} ${known.label}`;
  return `${flagFor(code)} ${ISO_COUNTRY_NAMES[code] ?? code}`;
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

function nextAddedAt(): number {
  return Math.max(0, ...VENDORS.map((v) => v.addedAt)) + 1;
}

// ─────────────────────────────────────────────────────────────────
// Lightning Address validation + LNURL metadata
// ─────────────────────────────────────────────────────────────────

async function fetchLnurlPayMetadata(
  address: string,
): Promise<{ ok: boolean; description?: string; reason?: string }> {
  if (!address.includes("@")) {
    return { ok: false, reason: "not a valid LN Address (name@domain.tld)" };
  }
  const [name, domain] = address.split("@");
  try {
    const r = await fetch(
      `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!r.ok) return { ok: false, reason: `LNURL-pay HTTP ${r.status}` };
    const data = (await r.json()) as {
      tag?: string;
      metadata?: string;
    };
    if (data?.tag !== "payRequest") {
      return { ok: false, reason: `tag="${data?.tag}" (expected payRequest)` };
    }
    let description: string | undefined;
    try {
      const md = data.metadata ? JSON.parse(data.metadata) : null;
      if (Array.isArray(md)) {
        const desc = md.find(
          (e): e is [string, string] =>
            Array.isArray(e) && e[0] === "text/plain",
        );
        if (desc) description = desc[1];
      }
    } catch {
      // Metadata parse failed · still alive, just no description.
    }
    return { ok: true, description };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Vendor entry serialization · vendors.ts source style
// ─────────────────────────────────────────────────────────────────

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
  push("verifiedAt", String(v.verifiedAt));
  if (v.country) push("country", JSON.stringify(v.country));
  if (v.lightningAddress)
    push("lightningAddress", JSON.stringify(v.lightningAddress));
  if (v.nostrPubkey) push("nostrPubkey", JSON.stringify(v.nostrPubkey));
  if (v.acceptsOnChain !== undefined)
    push("acceptsOnChain", String(v.acceptsOnChain));
  if (v.acceptsLightning !== undefined)
    push("acceptsLightning", String(v.acceptsLightning));
  if (v.shipsInternational !== undefined)
    push("shipsInternational", String(v.shipsInternational));
  if (v.tradeFriendly !== undefined)
    push("tradeFriendly", String(v.tradeFriendly));
  if (v.interestedIn && v.interestedIn.length > 0) {
    push(
      "interestedIn",
      "[" + v.interestedIn.map((c) => JSON.stringify(c)).join(", ") + "]",
    );
  }
  if (v.founderName) push("founderName", JSON.stringify(v.founderName));
  if (v.website) push("website", JSON.stringify(v.website));
  if (v.shopUrl) push("shopUrl", JSON.stringify(v.shopUrl));
  lines.push("  },");
  return lines.join("\n");
}

function insertVendorEntry(currentSource: string, entryText: string): string {
  const closingIdx = currentSource.lastIndexOf("];");
  if (closingIdx === -1) {
    throw new Error(
      "couldn't find closing `];` of VENDORS array in vendors.ts",
    );
  }
  const before = currentSource.slice(0, closingIdx).trimEnd();
  const after = currentSource.slice(closingIdx);
  return before + "\n" + entryText + "\n" + after;
}

// ─────────────────────────────────────────────────────────────────
// Subprocess wrapper · uses execFileSync (no shell, no injection)
// ─────────────────────────────────────────────────────────────────

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

function runInherit(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Pending-queue finalize · the /submit row that this add is fulfilling
// ─────────────────────────────────────────────────────────────────
//
// add-vendor used to write vendors.ts and leave the KV pending row
// sitting there. That's how the queue filled with already-listed
// phantoms, and how a submitter who left an email heard nothing.
// After a successful write + check-vendors we look up pending rows
// whose handle matches (X case-insensitive, nostr/lightning exact)
// and POST the same /api/admin/finalize-submission path the other
// CLIs use. already-listed is silent on purpose (a rejection email
// to a listed merchant is the failure). When they left a notify
// address we mark approved instead and fire the "you're live" mail
// after a successful push — same as review-submissions.ts.

const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";
const ENV_LOCAL = pathResolve(REPO_ROOT, ".env.local");
const CRON_SECRET_DROP = pathResolve(REPO_ROOT, ".cron-secret");

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadLocalSecrets(): void {
  if (existsSync(ENV_LOCAL)) {
    for (const line of readFileSync(ENV_LOCAL, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = stripQuotes(trimmed.slice(eq + 1).trim());
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
  if (process.env.CRON_SECRET) return;
  if (!existsSync(CRON_SECRET_DROP)) return;
  for (const line of readFileSync(CRON_SECRET_DROP, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const value = trimmed.startsWith("CRON_SECRET=")
      ? stripQuotes(trimmed.slice("CRON_SECRET=".length).trim())
      : stripQuotes(trimmed);
    if (value) {
      process.env.CRON_SECRET = value;
      return;
    }
  }
}

function readCronSecret(): string {
  loadLocalSecrets();
  return process.env.CRON_SECRET?.trim() ?? "";
}

type PendingMatch = {
  id: string;
  handle: string;
  hasNotifyAddress: boolean;
};

function handleMatchesListed(listed: Vendor, submitted: string): boolean {
  const p = listed.platform ?? "x";
  if (p === "x") return listed.handle.toLowerCase() === submitted.toLowerCase();
  return listed.handle === submitted;
}

type LiveNotify = { handle: string; name: string; viaHttp: boolean };

async function adminPost(
  secret: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const r = await fetch(`${SITE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

async function listMatchingPending(
  listed: Vendor,
  secret: string,
): Promise<PendingMatch[] | null> {
  if (secret) {
    try {
      const r = await fetch(`${SITE_URL}/api/admin/pending-submissions`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 401 || r.status === 403) {
        console.log(
          `  ${C.warn} queue list auth rejected · trying local KV`,
        );
        return null;
      }
      if (!r.ok) {
        console.log(
          `  ${C.warn} pending-submissions HTTP ${r.status} · trying local KV`,
        );
        return null;
      }
      const data = (await r.json()) as {
        submissions?: Array<{
          id: string;
          vendor?: { handle?: string };
          hasNotifyAddress?: boolean;
        }>;
      };
      const rows = Array.isArray(data.submissions) ? data.submissions : [];
      return rows.flatMap((s) => {
        const h = s.vendor?.handle;
        if (!h || !handleMatchesListed(listed, h)) return [];
        return [{ id: s.id, handle: h, hasNotifyAddress: Boolean(s.hasNotifyAddress) }];
      });
    } catch (e) {
      console.log(
        `  ${C.warn} queue list failed (${e instanceof Error ? e.message : "fetch"}) · trying local KV`,
      );
      return null;
    }
  }
  return null;
}

async function listMatchingPendingViaKv(
  listed: Vendor,
): Promise<PendingMatch[] | null> {
  // Dynamic import AFTER loadLocalSecrets so kv.ts sees UPSTASH_* from
  // .env.local. A static import would snapshot CONFIGURED as false.
  const { listPendingSubmissions } = await import(
    "../src/lib/vendor-submissions"
  );
  const { isKvConfigured } = await import("../src/lib/kv");
  const { readVendorNotify } = await import("../src/lib/vendor-notify-key");
  if (!isKvConfigured()) return null;
  const pending = await listPendingSubmissions();
  const matches: PendingMatch[] = [];
  // One handle may have several shops pending (2026-10). Match by
  // handle as before (operators often tweak the name at approval), but
  // when more than one pending shop shares the handle, narrow to the
  // one whose slug matches the listed name so finalizing this listing
  // never closes a sibling submission.
  let candidates = pending.filter((s) =>
    handleMatchesListed(listed, s.vendor.handle),
  );
  if (candidates.length > 1) {
    const slug = vendorSlug(listed);
    candidates = candidates.filter((s) => vendorSlug(s.vendor) === slug);
  }
  for (const s of candidates) {
    const notify = await readVendorNotify(s.vendor.handle, s.vendor.name);
    matches.push({
      id: s.id,
      handle: s.vendor.handle,
      hasNotifyAddress: Boolean(notify),
    });
  }
  return matches;
}

async function finalizeOne(
  listed: Vendor,
  match: PendingMatch,
  secret: string,
): Promise<boolean> {
  const reason = `listed via add-vendor.ts as ${listed.handle} (addedAt ${listed.addedAt})`;
  if (secret) {
    if (match.hasNotifyAddress) {
      const res = await adminPost(secret, "/api/admin/finalize-submission", {
        id: match.id,
        status: "approved",
        approvedAsAddedAt: listed.addedAt,
      });
      return res.ok;
    }
    const res = await adminPost(secret, "/api/admin/finalize-submission", {
      id: match.id,
      status: "rejected",
      reason,
      outcome: { code: "already-listed" },
    });
    return res.ok;
  }
  const { finalizeSubmission } = await import("../src/lib/vendor-submissions");
  if (match.hasNotifyAddress) {
    return finalizeSubmission(match.id, {
      status: "approved",
      approvedAsAddedAt: listed.addedAt,
    });
  }
  return finalizeSubmission(match.id, {
    status: "rejected",
    reason,
    outcome: { code: "already-listed" },
  });
}

/**
 * After vendors.ts + check-vendors succeed, drain matching pending
 * rows. Returns the handle/name to live-notify after a successful
 * push, or null when there is nothing to send.
 *
 * Prefer the HTTP admin path (same as the other queue CLIs) when
 * CRON_SECRET is available; otherwise the KV helpers, which read
 * UPSTASH_* from env / .env.local. Never prints the secret.
 */
async function finalizeMatchingPending(
  listed: Vendor,
): Promise<LiveNotify | null> {
  const secret = readCronSecret();
  let matches = await listMatchingPending(listed, secret);
  // HTTP list succeeded (even if empty) → stay on the HTTP finalize
  // path. A 401/timeout falls through to local KV so we don't then
  // POST the same rejected secret at finalize time.
  const viaHttp = matches !== null && Boolean(secret);
  if (matches === null) {
    matches = await listMatchingPendingViaKv(listed);
  }
  if (matches === null || matches.length === 0) {
    console.log(`  ${C.dim("no pending submission to finalize")}`);
    return null;
  }

  let live: LiveNotify | null = null;
  for (const match of matches) {
    // Notify address on file → this add IS their listing. Mark
    // approved (the live email is the listed/approved notify) and
    // never a rejection. No address → already-listed, silent, which
    // is the code that exists specifically so add-vendor can clear
    // the phantom without emailing a listed merchant a decline.
    const ok = await finalizeOne(listed, match, viaHttp ? secret : "");
    if (!ok) {
      console.log(
        `  ${C.warn} couldn't finalize pending ${match.id.slice(0, 12)}…`,
      );
      continue;
    }
    if (match.hasNotifyAddress) {
      console.log(
        `  ${C.ok} pending ${match.id.slice(0, 12)}… marked approved (you're-live after push)`,
      );
      live = { handle: match.handle, name: listed.name, viaHttp };
    } else {
      console.log(
        `  ${C.ok} pending ${match.id.slice(0, 12)}… finalized as already-listed (silent)`,
      );
    }
  }
  return live;
}

async function notifySubmitterLive(live: LiveNotify): Promise<void> {
  const secret = live.viaHttp ? readCronSecret() : "";
  if (secret) {
    const res = await adminPost(secret, "/api/admin/notify-submitter", {
      kind: "live",
      handle: live.handle,
      name: live.name,
    });
    if (!res.ok) {
      console.log(
        `  ${C.warn} "you're live" email failed (HTTP ${res.status}) · Sunday digest is the fallback`,
      );
      return;
    }
    if (res.json.sent === true) {
      console.log(`  ${C.ok} "you're live" email sent to the submitter`);
    } else {
      console.log(
        C.dim(
          `  no notify email on file (${typeof res.json.reason === "string" ? res.json.reason : "nothing to send"})`,
        ),
      );
    }
    return;
  }
  const { sendSubmissionOutcome } = await import(
    "../src/lib/submission-notify"
  );
  const result = await sendSubmissionOutcome({
    handle: live.handle,
    vendorName: live.name,
  });
  if (result.notified === "sent") {
    console.log(`  ${C.ok} "you're live" email sent to the submitter`);
  } else if (result.notified === "failed") {
    console.log(
      `  ${C.warn} "you're live" email failed (${result.error}) · Sunday digest is the fallback`,
    );
  } else {
    console.log(C.dim(`  no notify email on file · nothing to send`));
  }
}

// ─────────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────────

// --minimal mode skips every optional prompt (founder, website, LN
// address, nostr pubkey, ships international, trade friendly,
// interested-in). Useful when you want a vendor live FAST and will
// polish the rich fields later via a follow-up edit. Cuts an X-vendor
// onboarding from ~12 prompts to 5.
const minimalMode = process.argv.includes("--minimal");

async function main(): Promise<void> {
  console.log();
  console.log(C.bold("Galaxy Mind · vendor onboarding"));
  console.log(
    C.dim(
      `  Adding vendor #${nextAddedAt()} · directory currently has ${VENDORS.length} entries`,
    ),
  );
  if (minimalMode) {
    console.log(
      C.dim("  --minimal mode · optional fields will be skipped"),
    );
  }
  console.log();

  const handle = await ask(
    "Vendor handle (X username · npub1.../nprofile1... · or name@domain.tld)",
  );
  if (!handle) {
    console.log(`${C.fail} handle is required, aborting`);
    process.exit(1);
  }
  const existing = VENDORS.find((v) =>
    (v.platform ?? "x") === "x"
      ? v.handle.toLowerCase() === handle.toLowerCase()
      : v.handle === handle,
  );
  if (existing) {
    console.log(
      `${C.fail} vendor with handle "${handle}" already exists (${existing.name}) · aborting`,
    );
    process.exit(1);
  }

  const detected = detectPlatform(handle);
  let platform: VendorPlatform = detected.platform;
  if (detected.confidence === "low") {
    platform = await askChoice(
      "Handle could be either Nostr (NIP-05) or Lightning Address. Which?",
      [
        { value: "nostr" as const, label: "Nostr (NIP-05 verified identity)" },
        { value: "lightning" as const, label: "Lightning Address (LN payment)" },
      ],
    );
  } else {
    console.log(`  ${C.dim(`detected platform: ${platform}`)}`);
  }

  // ── Auto-enrichment ─────────────────────────────────────────────
  let enrichmentSeed: {
    description?: string;
    lightningAddress?: string;
    website?: string;
    nip05?: string;
  } = {};
  console.log();
  console.log(C.dim("  Fetching public profile data..."));
  if (platform === "nostr") {
    const pubkey = await resolveNostrHandleToPubkey(handle);
    if (pubkey) {
      const profile = await fetchNostrProfileMetadata(pubkey);
      if (profile) {
        console.log(
          `  ${C.ok} Nostr profile found · ${[
            profile.name && `name: ${profile.name}`,
            profile.lud16 && `lud16: ${profile.lud16}`,
            profile.nip05 && `nip05: ${profile.nip05}`,
            profile.website && `website: ${profile.website}`,
          ]
            .filter(Boolean)
            .join(" · ")}`,
        );
        enrichmentSeed = {
          description: profile.about,
          lightningAddress: profile.lud16,
          website: profile.website,
          nip05: profile.nip05,
        };
      } else {
        console.log(
          `  ${C.warn} no kind:0 profile event found across queried relays · skipping enrichment`,
        );
      }
    } else {
      console.log(
        `  ${C.warn} couldn't decode handle to pubkey · skipping enrichment`,
      );
    }
  } else if (platform === "lightning") {
    const lnurl = await fetchLnurlPayMetadata(handle);
    if (lnurl.ok) {
      console.log(
        `  ${C.ok} LNURL-pay endpoint alive${lnurl.description ? ` · description: "${lnurl.description.slice(0, 60)}"` : ""}`,
      );
      enrichmentSeed = { description: lnurl.description };
    } else {
      console.log(`  ${C.warn} LNURL-pay check failed · ${lnurl.reason}`);
    }
  } else {
    console.log(
      `  ${C.dim("X profiles can't be reliably auto-enriched (no public API) · proceeding manually")}`,
    );
  }

  // ── Display name ────────────────────────────────────────────────
  console.log();
  const name = await ask("Display name (brand/business)");
  if (!name) {
    console.log(`${C.fail} name is required, aborting`);
    process.exit(1);
  }
  const slug = vendorSlug({ name });
  const slugCollision = VENDORS.find((v) => vendorSlug(v) === slug);
  if (slugCollision) {
    console.log(
      `  ${C.fail} name slugifies to "${slug}" which collides with ${slugCollision.handle}.`,
    );
    console.log(
      `  ${C.dim("Pick a more distinctive name (e.g. add a regional/category suffix).")}`,
    );
    process.exit(1);
  }

  // ── Country ─────────────────────────────────────────────────────
  let country: string | undefined;
  while (true) {
    const c = await ask("Country (ISO code or name · skip if unknown)", "");
    if (!c) break;
    const matched = fuzzyMatchCountry(c);
    if (matched) {
      country = matched;
      console.log(`  ${C.ok} matched ${matched} · ${countryDisplay(matched)}`);
      if (!COUNTRIES[matched]) {
        console.log(
          `  ${C.warn} ${matched} has no COUNTRIES row yet · check-vendors will fail until it is promoted`,
        );
        console.log(
          `  ${C.dim("Promote it (COUNTRIES + COUNTRY_COORDS + COUNTRY_HUB_ALIASES) or leave the country blank.")}`,
        );
      }
      break;
    }
    console.log(
      `  ${C.fail} couldn't match "${c}" to a known country. Try ISO code (US, DE) or full name.`,
    );
  }

  // ── Category ────────────────────────────────────────────────────
  const category = await askChoice(
    "Category",
    VALID_CATEGORIES.map((c) => ({
      value: c,
      label: `${c} ${C.dim(`(${CATEGORY_LABELS[c]})`)}`,
    })),
  );

  // ── Description ─────────────────────────────────────────────────
  console.log();
  if (enrichmentSeed.description) {
    console.log(
      `  ${C.dim("Suggested from profile:")} ${enrichmentSeed.description.slice(0, 200)}${enrichmentSeed.description.length > 200 ? "…" : ""}`,
    );
  }
  let description: string;
  while (true) {
    description = await ask(
      "Description (50-250 chars, honest, no marketing fluff)",
      enrichmentSeed.description?.slice(0, 200),
    );
    if (description.length < 30) {
      console.log(
        `  ${C.warn} description is short (${description.length} chars) · aim for 50+ for context.`,
      );
      const ok = await askYN("Use it anyway?", false);
      if (ok) break;
      continue;
    }
    if (description.length > 280) {
      console.log(
        `  ${C.warn} description is long (${description.length} chars) · cards truncate around 200.`,
      );
      const ok = await askYN("Use it anyway?", false);
      if (ok) break;
      continue;
    }
    const lower = description.toLowerCase();
    const flagged = MARKETING_FLAGS.filter((f) => lower.includes(f));
    if (flagged.length > 0) {
      console.log(
        `  ${C.warn} marketing-language flags: ${flagged.join(", ")}. Galaxy Mind prefers honest plain descriptions.`,
      );
      const ok = await askYN("Use it anyway?", false);
      if (ok) break;
      continue;
    }
    break;
  }

  // ── Optional Phase 1A circular-economy fields ───────────────────
  //
  // In --minimal mode we skip all of these · the entry still works
  // (every field is optional). Enrichment-seeded values still apply
  // when present (a Nostr vendor's published lud16 / website still
  // get baked in even with --minimal · we only skip PROMPTING).
  let founderName = "";
  let website = enrichmentSeed.website ?? "";
  let lightningAddress = enrichmentSeed.lightningAddress ?? "";
  let nostrPubkey = "";
  let shipsInternational = false;
  let tradeFriendly = false;
  let interestedIn: VendorCategory[] = [];

  if (!minimalMode) {
    console.log();
    console.log(C.dim("  Optional fields (press enter to skip)"));
    founderName = await ask("Founder/operator name (e.g. 'Sarah')", "");
    website = await ask("Website URL", enrichmentSeed.website || "");
    lightningAddress = await ask(
      "Lightning Address (lud16)",
      enrichmentSeed.lightningAddress || "",
    );
    if (lightningAddress && lightningAddress !== handle) {
      console.log(C.dim("  Validating Lightning Address..."));
      const v = await fetchLnurlPayMetadata(lightningAddress);
      if (v.ok) {
        console.log(`  ${C.ok} LNURL-pay endpoint responds`);
      } else {
        console.log(`  ${C.warn} LNURL-pay check failed · ${v.reason}`);
        const keep = await askYN("Keep the value anyway?", false);
        if (!keep) lightningAddress = "";
      }
    }
    nostrPubkey =
      platform === "x"
        ? await ask("Nostr npub (cross-channel reachability)", "")
        : "";
    shipsInternational = await askYN(
      "Ships internationally (physical goods)?",
      false,
    );
    tradeFriendly = await askYN(
      "Open to barter/trade with other vendors?",
      false,
    );
    if (tradeFriendly) {
      const list = await ask(
        "Categories they'd trade FOR (comma-separated, e.g. 'consumables,apparel')",
        "",
      );
      if (list) {
        interestedIn = list
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((c): c is VendorCategory =>
            (VALID_CATEGORIES as string[]).includes(c),
          );
      }
    }
  }

  // ── Build the entry object ──────────────────────────────────────
  const newVendor: Vendor = {
    handle,
    ...(platform !== "x" ? { platform } : {}),
    name,
    description,
    category,
    addedAt: nextAddedAt(),
    verifiedAt: todayUtcMidnightSeconds(),
    // New vendor, added today · listedAt = verifiedAt (same day they first
    // appear in the directory is the day they're confirmed).
    listedAt: todayUtcMidnightSeconds(),
    ...(country ? { country } : {}),
    ...(lightningAddress ? { lightningAddress } : {}),
    ...(nostrPubkey ? { nostrPubkey } : {}),
    ...(shipsInternational ? { shipsInternational: true } : {}),
    ...(tradeFriendly ? { tradeFriendly: true } : {}),
    ...(interestedIn.length > 0 ? { interestedIn } : {}),
    ...(founderName ? { founderName } : {}),
    ...(website ? { website } : {}),
  };

  const entryText = serializeVendor(newVendor);
  console.log();
  console.log(C.bold("Preview:"));
  console.log(entryText);
  console.log();
  console.log(
    `  ${C.info} URL will be: https://galaxymind.space/v/${vendorSlug(newVendor)}`,
  );

  const ok = await askYN("Add this vendor to vendors.ts?", true);
  if (!ok) {
    console.log(`${C.dim("Aborted · no changes written.")}`);
    rl.close();
    process.exit(0);
  }

  // ── Write to disk ───────────────────────────────────────────────
  const currentSource = readFileSync(VENDORS_PATH, "utf8");
  const newSource = insertVendorEntry(currentSource, entryText);
  writeFileSync(VENDORS_PATH, newSource);
  console.log(`  ${C.ok} written to ${VENDORS_PATH}`);

  // ── Run validator ───────────────────────────────────────────────
  console.log();
  console.log(C.dim("  Running validator..."));
  const validateRes = runQuiet("npx", [
    "tsx",
    "scripts/check-vendors.ts",
  ]);
  if (validateRes.ok) {
    console.log(`  ${C.ok} validator passes`);
  } else {
    console.log(`  ${C.fail} validator FAILED:`);
    console.log(validateRes.stdout);
    console.log(validateRes.stderr);
    console.log();
    console.log(
      `  ${C.warn} The new entry has been written but validation failed. Inspect the diff and fix manually.`,
    );
    rl.close();
    process.exit(1);
  }

  // ── Matching pending /submit row ────────────────────────────────
  // Vendor is in vendors.ts and the validator passed · this is the
  // moment a leftover pending record becomes a phantom.
  const liveNotify = await finalizeMatchingPending(newVendor);

  // ── Avatar snapshot (X vendors) ─────────────────────────────────
  // Resolve the avatar ONCE at add time and commit the bytes under
  // public/avatars/x/ (unavatar.io free tier is ~25 req/IP/day · the
  // visitor's browser must never depend on it · see
  // scripts/snapshot-avatars.ts). Best-effort: a failure here never
  // blocks the add — the vendor just rides the unavatar fallback
  // until the next snapshot-avatars.ts run picks them up.
  if (platform === "x") {
    console.log();
    console.log(C.dim("  Snapshotting avatar from unavatar.io..."));
    const snap = await snapshotXAvatar(handle);
    if (snap.status === "saved") {
      console.log(
        `  ${C.ok} avatar → public/avatars/x/${snap.file} (${(snap.bytes / 1024).toFixed(1)}KB)`,
      );
    } else if (snap.status === "dead") {
      console.log(
        `  ${C.warn} unavatar 404 for '${handle}' · no avatar snapshot (card shows the initials chip) · double-check the handle is live`,
      );
    } else {
      console.log(
        `  ${C.warn} avatar snapshot failed (${snap.status === "error" ? snap.detail : "unavatar rate limit"}) · run \`npx tsx scripts/snapshot-avatars.ts\` later`,
      );
    }
  }

  // ── Diff ────────────────────────────────────────────────────────
  console.log();
  console.log(C.bold("Diff:"));
  const diffRes = runQuiet("git", [
    "diff",
    "--stat",
    "src/lib/vendors.ts",
  ]);
  if (diffRes.ok) console.log(C.dim(diffRes.stdout));

  // ── Optional commit + push ──────────────────────────────────────
  console.log();
  const commitOk = await askYN("Commit + push?", true);
  if (!commitOk) {
    console.log(C.dim(`  Done · run "git diff src/lib/vendors.ts" to inspect.`));
    if (liveNotify) {
      console.log(
        C.dim(
          `  "you're live" email (if the submitter left one) will fire from the Sunday digest cron once deployed`,
        ),
      );
    }
    rl.close();
    return;
  }

  const flag = country ? COUNTRIES[country]?.flag ?? flagFor(country) : "";
  const commitMsg = `Add @${handle} · ${name}${flag ? " " + flag : ""}\n\n${description}\n`;

  // Avatar snapshot rides in the same commit (no-ops when the
  // snapshot step didn't write anything).
  const addPaths = ["src/lib/vendors.ts", "src/lib/avatar-manifest.json"];
  if (existsSync(pathResolve(REPO_ROOT, "public", "avatars"))) {
    addPaths.push("public/avatars");
  }
  const addRes = runQuiet("git", ["add", ...addPaths]);
  if (!addRes.ok) {
    console.log(`  ${C.fail} git add failed: ${addRes.stderr}`);
    rl.close();
    return;
  }
  // -F - reads commit message from stdin · safe (no shell interpolation
  // of vendor data into a command string).
  const commitRes = runQuiet("git", ["commit", "-F", "-"], {
    input: commitMsg,
  });
  if (!commitRes.ok) {
    console.log(`  ${C.fail} git commit failed: ${commitRes.stderr}`);
    rl.close();
    return;
  }
  console.log(`  ${C.ok} ${commitRes.stdout.trim().split("\n")[0]}`);
  console.log(C.dim("  Pushing..."));
  const pushed = runInherit("git", ["push"]);
  if (pushed) {
    console.log();
    console.log(`  ${C.ok} pushed · Vercel will deploy in ~30s`);
    console.log(
      `  ${C.dim(`Auto-tweet fires tomorrow at 14:30 UTC for @${handle}`)}`,
    );
    if (liveNotify) {
      await notifySubmitterLive(liveNotify);
    }
  } else {
    console.log(
      `  ${C.warn} push failed · run \`git push\` manually when ready.`,
    );
    if (liveNotify) {
      console.log(
        C.dim(
          `  "you're live" email (if the submitter left one) will fire from the Sunday digest cron once deployed`,
        ),
      );
    }
  }

  printBadgeHandoff({ name, handle });

  rl.close();
}

main().catch((e) => {
  console.error("\nadd-vendor failed:", e);
  rl.close();
  process.exit(1);
});
