// GET /api/admin/review-queue · auth-gated read of gm:vendor:review-queue.
//
// Read-only triage for the operator UI at /admin/review-queue. The
// nightly monitor-vendors cron rewrites QUEUE_KEY wholesale, so this
// route never PATCHes or deletes entries — an ack here would reappear
// tomorrow. Directory rows are not mutated from here.
//
// Auth: Bearer ADMIN_SECRET (preferred) or CRON_SECRET fallback.

import { NextRequest, NextResponse } from "next/server";
import { kvGet, isKvConfigured } from "@/lib/kv";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { QUEUE_KEY, parseQueue, queueKey } from "@/lib/vendor-queue";
import { findVendorByKey, resolveVendorRef, vendorSlug } from "@/lib/vendors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function reverifyCli(ref: string): string {
  // `ref` is the listing slug when the vendor resolves (reverify's
  // --handle accepts a slug and then targets exactly that shop), else
  // the raw handle. NIP-05 handles carry @; JSON.stringify is
  // paste-ready in zsh/bash and never interpolates.
  const arg = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(ref)
    ? ref
    : JSON.stringify(ref);
  return `npx tsx scripts/reverify-vendors.ts --handle ${arg}`;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuthLimited(req);
  if (!auth.ok) return auth.response;

  if (!isKvConfigured()) {
    return NextResponse.json({
      ok: true,
      configured: false,
      count: 0,
      entries: [],
    });
  }

  const raw = await kvGet<unknown>(QUEUE_KEY);
  const queue = parseQueue(raw);
  // Entries carry a listing key (slug) since 2026-10; older stored
  // queues only have the handle, which resolves to its oldest listing.
  const entries = queue.map((e) => {
    const v = e.key ? findVendorByKey(e.key) : resolveVendorRef(e.handle);
    const slug = v ? vendorSlug(v) : null;
    return {
      handle: e.handle,
      key: queueKey(e),
      reason: e.reason,
      priority: e.priority,
      name: v?.name ?? null,
      slug,
      cli: reverifyCli(slug ?? e.handle),
    };
  });

  return NextResponse.json({
    ok: true,
    configured: true,
    count: entries.length,
    entries,
  });
}
