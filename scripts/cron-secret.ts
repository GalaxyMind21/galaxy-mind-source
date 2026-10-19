#!/usr/bin/env tsx
/**
 * cron-secret · drop-in loader for the Vercel Production CRON_SECRET.
 *
 * Why this exists: CRON_SECRET is a Vercel Sensitive var. `vercel env
 * pull` returns it empty, so the queue CLIs cannot auth unless the
 * operator supplies it. Pasting it into chat is how secrets leak.
 * This file is the drop:
 *
 *   1. Open `.cron-secret` at the repo root (gitignored)
 *   2. Paste the Vercel Production CRON_SECRET as one line
 *   3. Save, then:
 *
 *        npx tsx scripts/cron-secret.ts check
 *
 * Never pass the secret as a CLI argument (it lands in shell history).
 *
 * Commands:
 *   check            Verify the secret against /api/admin/pending-submissions
 *   finalize-listed  Mark an already-written vendor approved in KV and
 *                    fire the one-shot "you're live" email
 *
 *     npx tsx scripts/cron-secret.ts finalize-listed \
 *       --id <submission-id> --handle Bitbrandshop \
 *       --name BitBrand --addedAt 134
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const REPO_ROOT = pathResolve(__dirname, "..");
const DROP_FILE = pathResolve(REPO_ROOT, ".cron-secret");
const ENV_LOCAL = pathResolve(REPO_ROOT, ".env.local");
const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** `.env.local` KEY=value, never overrides a var already in the process. */
function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL)) return;
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

/**
 * `.cron-secret` is one secret, not a dotenv file. Accepted shapes:
 *   · a bare token on its own line
 *   · `CRON_SECRET=token`
 * Comments and blank lines are ignored. First real line wins.
 */
function loadDropFile(): void {
  if (process.env.CRON_SECRET) return;
  if (!existsSync(DROP_FILE)) return;
  for (const line of readFileSync(DROP_FILE, "utf8").split("\n")) {
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

function requireCronSecret(): string {
  loadEnvLocal();
  loadDropFile();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    die(
      "CRON_SECRET is not set.\n" +
        "  This is the Vercel Production env var of the same name\n" +
        "  (Project → Settings → Environment Variables). It is Sensitive,\n" +
        "  so `vercel env pull` returns it empty.\n" +
        "\n" +
        "  Drop it locally — do not paste it into chat:\n" +
        `    1. Open ${DROP_FILE}\n` +
        "    2. Paste the secret as one line (quotes optional)\n" +
        "    3. Save, then: npx tsx scripts/cron-secret.ts check\n",
    );
  }
  return secret;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

async function check(secret: string): Promise<void> {
  const r = await fetch(`${SITE_URL}/api/admin/pending-submissions`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (r.status === 401) {
    die(
      "secret was rejected (HTTP 401). Check it is the Production CRON_SECRET,\n" +
        "  no extra whitespace or quotes around the token.",
    );
  }
  if (!r.ok) {
    die(`pending-submissions returned HTTP ${r.status}`);
  }
  const data = (await r.json()) as { count?: number };
  const n = data.count ?? 0;
  console.log(`✓ CRON_SECRET works · ${n} pending submission${n === 1 ? "" : "s"}`);
}

async function finalizeListed(secret: string): Promise<void> {
  const id = argValue("--id");
  const handle = argValue("--handle");
  const name = argValue("--name");
  const addedAtRaw = argValue("--addedAt");
  const addedAt = addedAtRaw ? Number(addedAtRaw) : NaN;
  if (!id || !handle || !name || !Number.isInteger(addedAt) || addedAt <= 0) {
    die(
      "usage: npx tsx scripts/cron-secret.ts finalize-listed \\\n" +
        "         --id <submission-id> --handle <handle> --name <name> --addedAt <n>",
    );
  }

  const fin = await fetch(`${SITE_URL}/api/admin/finalize-submission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      status: "approved",
      approvedAsAddedAt: addedAt,
    }),
  });
  if (fin.status === 404) {
    die(`no pending submission "${id}" (already finalized, expired, or wrong id)`);
  }
  if (!fin.ok) {
    const body = await fin.text().catch(() => "");
    die(`finalize failed HTTP ${fin.status}: ${body.slice(0, 200)}`);
  }
  console.log(`✓ ${id} marked approved in the queue (addedAt ${addedAt})`);

  const notify = await fetch(`${SITE_URL}/api/admin/notify-submitter`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kind: "live", handle, name }),
  });
  const data = (await notify.json().catch(() => ({}))) as {
    ok?: boolean;
    sent?: boolean;
    reason?: string;
    error?: string;
  };
  if (!notify.ok || data.ok === false) {
    console.log(
      `⚠ "you're live" email failed (${data.error ?? `HTTP ${notify.status}`}) · Sunday digest is the fallback`,
    );
    return;
  }
  if (data.sent) {
    console.log(`✓ "you're live" email sent`);
  } else {
    console.log(`· no notify address on file (${data.reason ?? "nothing to send"})`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(
      "Drop the Vercel Production CRON_SECRET into .cron-secret (gitignored),\n" +
        "then run one of:\n" +
        "  npx tsx scripts/cron-secret.ts check\n" +
        "  npx tsx scripts/cron-secret.ts finalize-listed --id … --handle … --name … --addedAt …\n",
    );
    process.exit(0);
  }
  const secret = requireCronSecret();
  if (cmd === "check") {
    await check(secret);
    return;
  }
  if (cmd === "finalize-listed") {
    await finalizeListed(secret);
    return;
  }
  die(`unknown command "${cmd}" · try: check | finalize-listed | help`);
}

main().catch((e) => {
  die(e instanceof Error ? e.message : String(e));
});
