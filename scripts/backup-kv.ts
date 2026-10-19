#!/usr/bin/env tsx
/**
 * backup-kv · full dump / restore of the Upstash KV instance.
 *
 * WHY THIS EXISTS (bus-factor): the single Upstash Redis instance is
 * the ONLY copy of every piece of accumulated dynamic data — years of
 * append-only daily history that the crons cannot regenerate. An
 * accidental FLUSHALL, an account lapse, or an Upstash-side incident
 * erases all of it. This script is the off-platform copy.
 *
 * USAGE:
 *
 *   1. Put KV creds in .env.local. NOTE: `vercel env pull` will NOT
 *      work here — UPSTASH_REDIS_REST_URL/TOKEN are stored as
 *      SENSITIVE env vars on Vercel (verified 2026-07-11), which pull
 *      as empty strings. Copy them from the Upstash console (or the
 *      Vercel → Storage → Upstash integration page) into .env.local:
 *
 *        UPSTASH_REDIS_REST_URL="https://…upstash.io"
 *        UPSTASH_REDIS_REST_TOKEN="…"
 *
 *      (Both naming conventions from lib/kv.ts are honored —
 *      KV_REST_API_URL/TOKEN work too. .env* is gitignored.)
 *
 *   2. Dump (READ-ONLY · only SCAN/TYPE/PTTL/GET/LRANGE/ZRANGE/…):
 *
 *        npx tsx scripts/backup-kv.ts
 *
 *      Writes backups/kv-YYYY-MM-DD.json and prints a per-namespace
 *      summary table (key count + bytes). Re-running on the same day
 *      overwrites that day's file.
 *
 *   3. Restore (DESTRUCTIVE · DEL + rewrite each key in the file):
 *
 *        npx tsx scripts/backup-kv.ts --restore backups/kv-2026-07-11.json --dry-run
 *        npx tsx scripts/backup-kv.ts --restore backups/kv-2026-07-11.json
 *        npx tsx scripts/backup-kv.ts --restore backups/kv-2026-07-11.json --only stack:history
 *
 *      --dry-run prints the plan and writes nothing. Without it you
 *      must type RESTORE at the confirmation prompt. --only <prefix>
 *      restores just the keys starting with that prefix (targeted
 *      recovery of one namespace). Keys NOT present in the backup are
 *      never touched. Recorded TTLs are re-applied; ephemeral keys
 *      restored long after their window simply re-expire fast.
 *
 * CADENCE: set a MONTHLY calendar reminder to run the dump (e.g. the
 * 1st, alongside the quarterly vendor sweep). Deliberately NOT a
 * Vercel cron — a full dump costs ~a few hundred KV commands, which
 * would eat into the free-tier 10K/day budget, and a backup stored
 * next to the thing it backs up isn't a backup. Run it locally; copy
 * the file somewhere off-machine (iCloud/Drive) for real safety.
 *
 * ⚠ PII: sub:prefs:* / fit-alert:* / vendor-notify:* / push:sub:*
 * contain subscriber emails and push endpoints. backups/ is
 * gitignored — NEVER commit a dump, never share one unredacted.
 *
 * KEY NAMESPACES (audit 2026-07-11 · grep of kv* call sites; SCAN *
 * captures everything regardless, this table drives the summary and
 * documents what lives where):
 *
 *   Durable history (lists · the irreplaceable stuff)
 *     stack:history                daily gauge verdicts (cap 365)
 *     treasury:history:{ticker}    daily mNAV per ticker (cap 365)
 *     float:history                daily float snapshots (cap 1825)
 *     pulse:archive                weekly pulse archive (cap 60)
 *   Durable state (strings unless noted)
 *     filings:{ticker}             latest SEC filings per treasury
 *     vendor:activity:{handle}     last-seen Nostr activity
 *     vendor:dormant:{handle}      dormancy overlay (+ _index list)
 *     sub:prefs:{email}            subscriber prefs · PII
 *     fit-alert:{email}            /fit alert baselines · PII
 *     alerts:*                     threshold-alert cron state
 *     digest:newvendors:lastSentAt · submission:digest:lastNotifiedAt
 *     submission:pending:{id}      moderation queue (+ _index · 60d TTL)
 *     push:sub:{hash}              web-push subscriptions · PII (180d)
 *     push:subs:v2                 push subscription index (zset)
 *     vendor-notify:{handle}[:{slug}] submitter notify-me emails · PII (90d)
 *     social:cd:{platform}:{handle} social-draft cooldowns (14d)
 *     cron:last:{slug}             cron-health last-fired stamps (120d)
 *   Leaderboards (sorted sets)
 *     gm:lb:*                      wen/gauntlet/runner/horizon · daily + all-time
 *   Ephemeral (backed up for completeness · expected to churn)
 *     heartbeat:cache · subscriber:count:cached
 *     ratelimit:* · *:rl:* · subscribe:* (rate limits, DOI tokens)
 *
 * MECHANICS: mirrors lib/kv.ts's REST wrapper (POST base URL, JSON
 * array body, Bearer token) but keeps its own raw command + /pipeline
 * helpers rather than expanding the lib — backups need the RAW stored
 * string (kvGet's polymorphic JSON.parse would coerce e.g. the bare
 * "12345" timestamps and break byte-fidelity round-trips), and SCAN /
 * TYPE / full-range reads have no app-side caller to justify a lib
 * surface.
 */

// Load .env.local before importing modules that read process.env at
// import time (same pattern as test-email-setup.ts · tsx doesn't
// auto-load dotenv the way Next.js does).
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

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Same precedence as lib/kv.ts: Upstash naming wins over legacy Vercel KV.
const URL =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ----- Raw REST helpers (script-local · see header for why) ---------

async function command<T>(args: (string | number)[]): Promise<T> {
  const r = await fetch(URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    throw new Error(`KV HTTP ${r.status}: ${await r.text().catch(() => "")}`);
  }
  const body = (await r.json()) as { result?: T; error?: string };
  if (body.error) throw new Error(`KV error: ${body.error}`);
  return body.result as T;
}

/** Batched commands via Upstash's /pipeline endpoint — one HTTP
 * round-trip for N commands (each still counts against the command
 * budget, but latency collapses). */
async function pipeline(
  cmds: (string | number)[][],
): Promise<unknown[]> {
  if (cmds.length === 0) return [];
  const r = await fetch(`${URL!.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    throw new Error(
      `KV pipeline HTTP ${r.status}: ${await r.text().catch(() => "")}`,
    );
  }
  const body = (await r.json()) as { result?: unknown; error?: string }[];
  return body.map((entry, i) => {
    if (entry.error) {
      throw new Error(`KV pipeline[${i}] (${cmds[i][0]}): ${entry.error}`);
    }
    return entry.result;
  });
}

async function scanAllKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await command<[string, string[]]>([
      "SCAN",
      cursor,
      "MATCH",
      "*",
      "COUNT",
      500,
    ]);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  // SCAN may return duplicates across iterations; dedupe + stable order.
  return [...new Set(keys)].sort();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ----- Backup file shape --------------------------------------------

type BackupEntry = {
  key: string;
  type: "string" | "list" | "zset" | "set" | "hash";
  /** Remaining TTL in ms at dump time · null = no expiry. */
  pttlMs: number | null;
  /** string → raw stored string · list/set → string[] (head-first for
   * lists) · zset → [member, score][] · hash → Record<string,string>. */
  value: unknown;
};

type BackupFile = {
  format: "galaxy-mind-kv-backup";
  version: 1;
  createdAt: string;
  keyCount: number;
  entries: BackupEntry[];
};

// Ordered prefix → namespace label map for the summary table. First
// match wins; anything unmatched lands in "(uncategorized)" so brand-new
// namespaces surface loudly instead of hiding in a lump.
const NAMESPACES: [string, string][] = [
  ["stack:history", "stack:history"],
  ["treasury:history:", "treasury:history:*"],
  ["float:history", "float:history"],
  ["pulse:archive", "pulse:archive"],
  ["filings:", "filings:*"],
  ["vendor:activity:", "vendor:activity:*"],
  ["vendor:dormant:", "vendor:dormant:*"],
  ["sub:prefs:", "sub:prefs:* (PII)"],
  ["fit-alert:", "fit-alert:* (PII)"],
  ["alerts:", "alerts:*"],
  ["digest:", "digest:*"],
  ["submission:", "submission:*"],
  ["push:sub", "push:* (PII)"],
  ["vendor-notify:", "vendor-notify:* (PII)"],
  ["social:cd:", "social:cd:*"],
  ["cron:last:", "cron:last:*"],
  ["gm:lb:", "gm:lb:* (leaderboards)"],
  ["heartbeat:cache", "caches"],
  ["subscriber:count:cached", "caches"],
  ["ratelimit:", "rate limits / tokens"],
  ["subscribe:", "rate limits / tokens"],
  ["submit-vendor:rl:", "rate limits / tokens"],
  ["unsubscribe:rl:", "rate limits / tokens"],
  ["enrich-handle:rl:", "rate limits / tokens"],
  ["og:", "rate limits / tokens"],
];

function namespaceOf(key: string): string {
  for (const [prefix, label] of NAMESPACES) {
    if (key.startsWith(prefix)) return label;
  }
  return "(uncategorized)";
}

// ----- Dump (read-only) ---------------------------------------------

const PIPE_BATCH = 100;

async function dump(): Promise<void> {
  console.log(C.bold("\n🧳 Galaxy Mind KV backup (read-only dump)\n"));

  const keys = await scanAllKeys();
  console.log(`${C.info} SCAN found ${keys.length} keys`);
  if (keys.length === 0) {
    console.log(`${C.warn} store is empty — nothing to back up`);
    return;
  }

  // TYPE + PTTL for every key, batched.
  const types: string[] = [];
  const pttls: number[] = [];
  for (const batch of chunk(keys, PIPE_BATCH)) {
    const t = await pipeline(batch.map((k) => ["TYPE", k]));
    const p = await pipeline(batch.map((k) => ["PTTL", k]));
    types.push(...(t as string[]));
    pttls.push(...(p as number[]));
  }

  // Per-type full-content reads, batched.
  const readCmd = (key: string, type: string): (string | number)[] => {
    switch (type) {
      case "string":
        return ["GET", key];
      case "list":
        return ["LRANGE", key, 0, -1];
      case "zset":
        return ["ZRANGE", key, 0, -1, "WITHSCORES"];
      case "set":
        return ["SMEMBERS", key];
      case "hash":
        return ["HGETALL", key];
      default:
        throw new Error(`unsupported type "${type}" for key "${key}"`);
    }
  };

  const entries: BackupEntry[] = [];
  const indexed = keys.map((key, i) => ({ key, type: types[i], pttl: pttls[i] }));
  // Keys can expire between SCAN and TYPE — Redis reports "none".
  const live = indexed.filter((k) => k.type !== "none");
  for (const batch of chunk(live, PIPE_BATCH)) {
    const results = await pipeline(batch.map((k) => readCmd(k.key, k.type)));
    batch.forEach((k, i) => {
      let value: unknown = results[i];
      if (k.type === "zset") {
        // Flat [member, score, member, score, ...] → [member, score][]
        const flat = results[i] as string[];
        const pairs: [string, number][] = [];
        for (let j = 0; j + 1 < flat.length; j += 2) {
          pairs.push([flat[j], Number(flat[j + 1])]);
        }
        value = pairs;
      } else if (k.type === "hash") {
        // Flat [field, value, ...] → object
        const flat = results[i] as string[];
        const obj: Record<string, string> = {};
        for (let j = 0; j + 1 < flat.length; j += 2) obj[flat[j]] = flat[j + 1];
        value = obj;
      }
      entries.push({
        key: k.key,
        type: k.type as BackupEntry["type"],
        pttlMs: k.pttl >= 0 ? k.pttl : null,
        value,
      });
    });
  }

  const backup: BackupFile = {
    format: "galaxy-mind-kv-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    keyCount: entries.length,
    entries,
  };

  const date = backup.createdAt.slice(0, 10);
  const dir = path.resolve(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kv-${date}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));

  // Summary table: namespace → keys → bytes.
  const stats = new Map<string, { keys: number; bytes: number }>();
  for (const e of entries) {
    const ns = namespaceOf(e.key);
    const s = stats.get(ns) ?? { keys: 0, bytes: 0 };
    s.keys += 1;
    s.bytes += Buffer.byteLength(JSON.stringify(e.value ?? ""));
    stats.set(ns, s);
  }
  const rows = [...stats.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  const nsWidth = Math.max(9, ...rows.map(([ns]) => ns.length));
  const fmtBytes = (b: number) =>
    b >= 1024 * 1024
      ? `${(b / 1024 / 1024).toFixed(1)} MB`
      : b >= 1024
        ? `${(b / 1024).toFixed(1)} KB`
        : `${b} B`;

  console.log();
  console.log(
    C.bold(`  ${"namespace".padEnd(nsWidth)}  ${"keys".padStart(5)}  ${"bytes".padStart(9)}`),
  );
  console.log(C.dim(`  ${"─".repeat(nsWidth)}  ${"─".repeat(5)}  ${"─".repeat(9)}`));
  let totalBytes = 0;
  for (const [ns, s] of rows) {
    totalBytes += s.bytes;
    console.log(
      `  ${ns.padEnd(nsWidth)}  ${String(s.keys).padStart(5)}  ${fmtBytes(s.bytes).padStart(9)}`,
    );
  }
  console.log(C.dim(`  ${"─".repeat(nsWidth)}  ${"─".repeat(5)}  ${"─".repeat(9)}`));
  console.log(
    C.bold(
      `  ${"total".padEnd(nsWidth)}  ${String(entries.length).padStart(5)}  ${fmtBytes(totalBytes).padStart(9)}`,
    ),
  );

  console.log(`\n${C.ok} wrote ${path.relative(process.cwd(), file)}`);
  console.log(
    `${C.warn} contains subscriber emails (sub:prefs / fit-alert / vendor-notify) — gitignored, keep it that way`,
  );
  console.log(
    C.dim("  tip: copy the file off-machine (iCloud/Drive) · a backup on the same disk is half a backup\n"),
  );
}

// ----- Restore (destructive · opt-in) --------------------------------

async function restore(
  file: string,
  opts: { dryRun: boolean; only: string | null },
): Promise<void> {
  console.log(C.bold("\n🧯 Galaxy Mind KV restore\n"));

  const raw = fs.readFileSync(file, "utf-8");
  const backup = JSON.parse(raw) as BackupFile;
  if (backup.format !== "galaxy-mind-kv-backup" || backup.version !== 1) {
    console.error(`${C.fail} not a recognized backup file (format/version mismatch)`);
    process.exit(1);
  }

  let entries = backup.entries;
  if (opts.only) {
    entries = entries.filter((e) => e.key.startsWith(opts.only!));
  }
  console.log(
    `${C.info} backup from ${backup.createdAt} · ${backup.keyCount} keys total · ${entries.length} selected${opts.only ? ` (prefix "${opts.only}")` : ""}`,
  );
  if (entries.length === 0) {
    console.log(`${C.warn} nothing matches — no keys restored`);
    return;
  }

  // Plan, grouped by namespace.
  const byNs = new Map<string, number>();
  for (const e of entries) byNs.set(namespaceOf(e.key), (byNs.get(namespaceOf(e.key)) ?? 0) + 1);
  console.log(`\n  will ${C.bold("DEL + rewrite")} the following:`);
  for (const [ns, n] of [...byNs.entries()].sort()) {
    console.log(`    ${String(n).padStart(5)}  ${ns}`);
  }

  if (opts.dryRun) {
    console.log(`\n${C.ok} dry run — nothing written\n`);
    return;
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n${C.warn} this OVERWRITES the ${entries.length} keys above in the LIVE store. Type ${C.bold("RESTORE")} to proceed: `,
  );
  rl.close();
  if (answer.trim() !== "RESTORE") {
    console.log(`${C.info} aborted — nothing written\n`);
    return;
  }

  // Each entry becomes a small command group: DEL + rewrite + PEXPIRE.
  // Grouped per key (not one giant pipeline) so a mid-restore failure
  // leaves whole keys either restored or untouched, never half-written.
  let done = 0;
  for (const e of entries) {
    const cmds: (string | number)[][] = [["DEL", e.key]];
    switch (e.type) {
      case "string":
        cmds.push(["SET", e.key, e.value as string]);
        break;
      case "list": {
        const items = e.value as string[];
        // Dump order is head-first (LRANGE 0 -1) · RPUSH preserves it.
        for (const c of chunk(items, 500)) cmds.push(["RPUSH", e.key, ...c]);
        break;
      }
      case "zset": {
        const pairs = e.value as [string, number][];
        for (const c of chunk(pairs, 250)) {
          cmds.push(["ZADD", e.key, ...c.flatMap(([m, s]) => [s, m])]);
        }
        break;
      }
      case "set": {
        const members = e.value as string[];
        for (const c of chunk(members, 500)) cmds.push(["SADD", e.key, ...c]);
        break;
      }
      case "hash": {
        const obj = e.value as Record<string, string>;
        cmds.push(["HSET", e.key, ...Object.entries(obj).flat()]);
        break;
      }
    }
    if (e.pttlMs != null && e.pttlMs > 0) {
      cmds.push(["PEXPIRE", e.key, e.pttlMs]);
    }
    await pipeline(cmds);
    done++;
    if (done % 50 === 0) console.log(C.dim(`  …${done}/${entries.length}`));
  }

  console.log(`\n${C.ok} restored ${done} keys\n`);
}

// ----- Entry point ----------------------------------------------------

async function main() {
  // Dynamic import — lib/kv.ts reads process.env at module load, and
  // esbuild/tsx hoists STATIC imports above the .env.local loader IIFE,
  // which would freeze CONFIGURED=false before the env file loads.
  const { isKvConfigured } = await import("../src/lib/kv");
  if (!isKvConfigured() || !URL || !TOKEN) {
    console.error(
      `${C.fail} KV not configured — set UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN), e.g. via \`vercel env pull .env.local\``,
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const restoreIdx = args.indexOf("--restore");
  if (restoreIdx >= 0) {
    const file = args[restoreIdx + 1];
    if (!file || file.startsWith("--")) {
      console.error(`${C.fail} usage: --restore <backups/kv-YYYY-MM-DD.json>`);
      process.exit(1);
    }
    const onlyIdx = args.indexOf("--only");
    await restore(path.resolve(file), {
      dryRun: args.includes("--dry-run"),
      only: onlyIdx >= 0 ? (args[onlyIdx + 1] ?? null) : null,
    });
  } else {
    await dump();
  }
}

main().catch((e) => {
  console.error(`${C.fail} ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
