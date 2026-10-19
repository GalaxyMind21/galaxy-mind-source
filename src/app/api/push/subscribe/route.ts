// POST /api/push/subscribe · store a browser push subscription.
//
// Public + anonymous by design (a push subscription is a browser
// credential, not an identity · see lib/push.ts). Hardening mirrors
// the other public POST surfaces:
//   · 4KB body cap (subscriptions are ~300-600 bytes)
//   · shape validation + SSRF guard on the endpoint URL
//   · IP-keyed sliding-window rate limit (10/hour · re-subscribes
//     from the same browser are normal, abuse floods are not)
//   · capped KV index bounds total storage blast radius

import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { kvIncrWithTtl, isKvConfigured } from "@/lib/kv";
import {
  PUSH_TOPICS,
  isPushConfigured,
  storeSubscription,
  validateSubscription,
  type PushTopic,
} from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 3600;

export async function POST(req: NextRequest) {
  if (!isPushConfigured()) {
    return NextResponse.json(
      { ok: false, error: "push not configured" },
      { status: 503 },
    );
  }

  // Rate limit · fail-open on KV trouble (house posture: a KV blip
  // must not lock legitimate users out of a low-stakes endpoint).
  if (isKvConfigured()) {
    const ip = getClientIp(req);
    const count = await kvIncrWithTtl(
      `ratelimit:push-sub:${ip}`,
      RATE_WINDOW_SECONDS,
    );
    if (count !== null && count > RATE_LIMIT) {
      return NextResponse.json(
        { ok: false, error: "rate limited · try again later" },
        { status: 429 },
      );
    }
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "body too large" },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  const sub = (body as { subscription?: unknown })?.subscription;
  const err = validateSubscription(sub);
  if (err) {
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  // Optional topics · unknown values are dropped, absent means the
  // legacy gauge contract. Merged (union) with any existing record in
  // storeSubscription so two toggles never clobber each other.
  const rawTopics = (body as { topics?: unknown })?.topics;
  const topics: PushTopic[] = Array.isArray(rawTopics)
    ? rawTopics.filter((t): t is PushTopic =>
        (PUSH_TOPICS as readonly string[]).includes(t as string),
      )
    : [];
  const rawRemove = (body as { remove?: unknown })?.remove;
  const remove: PushTopic[] = Array.isArray(rawRemove)
    ? rawRemove.filter((t): t is PushTopic =>
        (PUSH_TOPICS as readonly string[]).includes(t as string),
      )
    : [];

  const ok = await storeSubscription(
    sub as { endpoint: string; keys: { p256dh: string; auth: string } },
    // A pure-removal call must not implicitly (re)subscribe gauge.
    topics.length > 0 ? topics : remove.length > 0 ? [] : ["gauge"],
    remove,
  );
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "storage unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}
