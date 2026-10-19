#!/usr/bin/env tsx
/**
 * post-thread · fire a multi-tweet X thread (or a single tweet)
 * via the existing /api/post-to-social endpoint.
 *
 * Run via:
 *   CRON_SECRET=xxx npx tsx scripts/post-thread.ts threads/<file>.json
 *   CRON_SECRET=xxx npx tsx scripts/post-thread.ts threads/<file>.json --dry-run
 *   CRON_SECRET=xxx npx tsx scripts/post-thread.ts threads/<file>.json --target=both
 *
 * JSON format (single post):
 *   { "tweets": ["text of one tweet"], "target": "x" }
 *
 * JSON format (multi-tweet thread):
 *   {
 *     "tweets": [
 *       "1/ first tweet text",
 *       "2/ second tweet text",
 *       ...
 *     ],
 *     "target": "x"
 *   }
 *
 * For multi-tweet threads, each tweet after the first is posted
 * as a reply to the previous one's ID · X v2 doesn't have a batch
 * thread endpoint at the free tier, so the script chains them
 * sequentially with a 1.5s pause between to be friendly to rate
 * limits and let X's UI catch up between posts.
 *
 * Aborts on first failure to prevent orphaned half-threads. If the
 * 3rd tweet of a 7-tweet thread fails, you get 2 successful tweets
 * and a clear "stopped at index 2" message; you can edit the JSON
 * to start from where it failed and re-run.
 *
 * Dry-run mode (--dry-run flag OR DRY_RUN_SOCIAL=1 env) prints what
 * WOULD be posted without firing.
 */
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SITE_URL = process.env.SITE_URL ?? "https://galaxymind.space";
const PAUSE_BETWEEN_MS = 1_500;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

type Thread = {
  tweets: string[];
  target?: "x" | "nostr" | "both";
  description?: string;
};

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));
const dryRunFlag =
  args.includes("--dry-run") ||
  process.env.DRY_RUN_SOCIAL === "1" ||
  process.env.DRY_RUN_SOCIAL === "true";
const targetOverride = args
  .find((a) => a.startsWith("--target="))
  ?.split("=")[1] as "x" | "nostr" | "both" | undefined;

if (!fileArg) {
  console.error("usage: post-thread.ts <threads/file.json> [--dry-run] [--target=x|nostr|both]");
  process.exit(1);
}

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret && !dryRunFlag) {
  console.error(
    `${C.fail} CRON_SECRET env var required (the /api/post-to-social endpoint is auth-gated). Either set it or pass --dry-run to preview without posting.`,
  );
  process.exit(1);
}

const filePath = pathResolve(process.cwd(), fileArg);
let thread: Thread;
try {
  thread = JSON.parse(readFileSync(filePath, "utf8")) as Thread;
} catch (e) {
  console.error(
    `${C.fail} couldn't read JSON from ${filePath}: ${e instanceof Error ? e.message : e}`,
  );
  process.exit(1);
}

if (!Array.isArray(thread.tweets) || thread.tweets.length === 0) {
  console.error(`${C.fail} JSON must have a non-empty 'tweets' array`);
  process.exit(1);
}

const target = targetOverride ?? thread.target ?? "x";
console.log();
console.log(C.bold(`Posting ${thread.tweets.length}-tweet thread to ${target}`));
if (thread.description) console.log(C.dim(`  ${thread.description}`));
if (dryRunFlag) console.log(C.dim("  DRY RUN · nothing will actually post"));
console.log();

// Pre-flight char check on every tweet · catches over-280 before we
// fire the first one. URLs auto-shorten to 23 chars on X.
const URL_RE = /https?:\/\/\S+/g;
let preflightErrors = 0;
thread.tweets.forEach((t, i) => {
  const urlCount = (t.match(URL_RE) ?? []).length;
  const visibleLen = t.replace(URL_RE, "").length + urlCount * 23;
  if (visibleLen > 280) {
    console.log(
      `  ${C.fail} tweet ${i + 1}: ${visibleLen} chars (over 280)`,
    );
    preflightErrors++;
  } else {
    console.log(
      `  ${visibleLen <= 270 ? C.ok : C.warn} tweet ${i + 1}: ${visibleLen} chars`,
    );
  }
});
if (preflightErrors > 0) {
  console.error(`\n${C.fail} ${preflightErrors} tweet(s) over 280 chars · trim and retry`);
  process.exit(1);
}

if (dryRunFlag) {
  console.log();
  console.log(C.bold("Tweets that would post:"));
  thread.tweets.forEach((t, i) => {
    console.log();
    console.log(C.dim(`--- ${i + 1}/${thread.tweets.length} ---`));
    console.log(t);
  });
  process.exit(0);
}

// Fire the thread sequentially. Each post after the first chains
// onto the previous via replyToId.
async function postOne(
  text: string,
  replyToId?: string,
): Promise<{ ok: boolean; tweetId?: string; error?: string }> {
  const r = await fetch(`${SITE_URL}/api/post-to-social`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target,
      ...(replyToId ? { replyToId } : {}),
    }),
  });
  const body = (await r.json().catch(() => null)) as {
    ok?: boolean;
    results?: { x?: { ok?: boolean; tweetId?: string; error?: string } };
    error?: string;
  } | null;
  if (!r.ok || !body?.ok) {
    return {
      ok: false,
      error: body?.error ?? body?.results?.x?.error ?? `HTTP ${r.status}`,
    };
  }
  return {
    ok: true,
    tweetId: body.results?.x?.tweetId,
  };
}

(async () => {
  let priorId: string | undefined;
  let firstId: string | undefined;
  for (let i = 0; i < thread.tweets.length; i++) {
    const text = thread.tweets[i];
    const label = `${i + 1}/${thread.tweets.length}`;
    process.stdout.write(`  ${C.dim(`posting ${label}...`)} `);
    const r = await postOne(text, priorId);
    if (!r.ok) {
      console.log(`${C.fail} ${r.error}`);
      console.error(
        `\n${C.fail} stopped at index ${i} (tweet ${label}). Prior tweets posted; resume by editing the JSON to start from index ${i} and re-running.`,
      );
      process.exit(1);
    }
    console.log(`${C.ok} id=${r.tweetId}`);
    priorId = r.tweetId;
    if (i === 0) firstId = r.tweetId;
    if (i < thread.tweets.length - 1) {
      // Pause between · gives X's UI a moment to register the parent
      // before the child arrives, and stays well under rate limits.
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_MS));
    }
  }
  console.log();
  console.log(`${C.ok} thread complete · ${thread.tweets.length} tweets posted`);
  if (firstId) {
    console.log(
      `  ${C.dim(`view: https://x.com/GalaxyMind/status/${firstId}`)}`,
    );
  }
})().catch((e) => {
  console.error(`${C.fail} thread failed: ${e}`);
  process.exit(1);
});
