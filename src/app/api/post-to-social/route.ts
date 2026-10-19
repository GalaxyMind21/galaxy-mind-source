// Manual social-post endpoint.
//
// POST { text: string, target?: "x" | "nostr" | "both" }
// Authorization: Bearer $CRON_SECRET
//
// Lets the operator (or an authenticated tooling layer) post a
// pre-composed tweet/note without going through the cron path. The
// CRON_SECRET gate means this isn't a public-facing post API · only
// callers with the shared secret can fire it.
//
// Why this exists:
// The cron-driven posters (daily-tweet, snapshot-treasuries) handle
// scheduled / event-driven cases. This endpoint handles the
// in-between: a one-off "I want to post X about Y right now" without
// editing code. Useful when:
//   - Drafting a tweet via an external assistant and firing it from
//     the same auth context
//   - Posting an apology / correction outside the cron cycles
//   - Testing post composition in production with DRY_RUN_SOCIAL=1
//
// Safety:
//   - CRON_SECRET-gated · same auth as every other privileged route
//   - 280-char cap enforced before posting (Twitter limit · Nostr has
//     no hard cap but we share one body for simplicity)
//   - Refuses if SOCIAL_AUTOMATION_DISABLED env is set
//   - Honors DRY_RUN_SOCIAL=1 · returns the would-be-posted body
//     without hitting upstreams
//   - Returns per-target results so partial failures are visible

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { postTweet } from "@/lib/twitter";
import { postNostrNote, isNostrConfigured } from "@/lib/nostr";

const MAX_CHARS = 280;

type Target = "x" | "nostr" | "both";

export async function POST(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;

  const automationDisabled =
    process.env.SOCIAL_AUTOMATION_DISABLED === "1" ||
    process.env.SOCIAL_AUTOMATION_DISABLED === "true";
  if (automationDisabled) {
    return NextResponse.json(
      { ok: false, error: "SOCIAL_AUTOMATION_DISABLED env set" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be { text, target? }" },
      { status: 400 },
    );
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string" || text.length === 0) {
    return NextResponse.json(
      { ok: false, error: "text is required and must be non-empty string" },
      { status: 400 },
    );
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `text exceeds ${MAX_CHARS} char limit (got ${text.length})`,
      },
      { status: 400 },
    );
  }
  const target = ((body as { target?: unknown }).target ?? "x") as Target;
  if (!["x", "nostr", "both"].includes(target)) {
    return NextResponse.json(
      { ok: false, error: 'target must be "x" | "nostr" | "both"' },
      { status: 400 },
    );
  }

  const dryRun =
    process.env.DRY_RUN_SOCIAL === "1" || process.env.DRY_RUN_SOCIAL === "true";

  // Optional · X-only field. When set, the tweet posts as a reply to
  // the given tweet ID (used by scripts/post-thread.ts to chain a
  // multi-tweet thread). Nostr ignores this · Nostr threads are a
  // different mechanism (NIP-10 reply tags) we don't support here.
  const replyToIdRaw = (body as { replyToId?: unknown }).replyToId;
  const replyToId =
    typeof replyToIdRaw === "string" && replyToIdRaw.length > 0
      ? replyToIdRaw
      : undefined;

  const results: Record<string, unknown> = {};
  if (target === "x" || target === "both") {
    if (dryRun) {
      results.x = { ok: true, dryRun: true, text, replyToId };
    } else {
      const r = await postTweet(text, replyToId);
      results.x = r.ok
        ? { ok: true, tweetId: r.data.id, replyToId }
        : { ok: false, error: r.error };
    }
  }
  if (target === "nostr" || target === "both") {
    if (!isNostrConfigured()) {
      results.nostr = {
        ok: false,
        error:
          "NOSTR_NSEC_HEX not set · see SOCIAL_AUTOMATION.md for setup",
      };
    } else if (dryRun) {
      results.nostr = { ok: true, dryRun: true, text };
    } else {
      const r = await postNostrNote(text);
      results.nostr = r.ok
        ? { ok: true, eventId: r.eventId }
        : { ok: false, error: r.error };
    }
  }

  // Overall ok = at least one target succeeded (or all dryRun).
  const overallOk = Object.values(results).every(
    (r) => (r as { ok: boolean }).ok,
  );
  return NextResponse.json(
    {
      ok: overallOk,
      target,
      dryRun,
      results,
      charCount: text.length,
    },
    { status: overallOk ? 200 : 500 },
  );
}
