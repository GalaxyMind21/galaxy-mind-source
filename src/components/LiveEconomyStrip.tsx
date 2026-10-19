"use client";

/* =====================================================================
 * LiveEconomyStrip · "Live from the circular economy" (B6 · 2026-07-07)
 *
 * A slim homepage strip of recent verified Nostr posts from directory
 * vendors. The directory stops being a list and starts being a living
 * economy · real merchants saying real things, minutes ago.
 *
 * Reuses the HARDENED relay plumbing end to end: fetchRecentNostrPosts
 * (BIP-340 signature verification, size caps before verify, untrusted-
 * relay posture per lib/nostr-activity) + the same content filter the
 * /v pages use. Nothing new touches a relay.
 *
 * Honesty + perf rules:
 *   · Renders NOTHING until posts actually arrive · no skeleton on the
 *     homepage (an empty promise above the grid is worse than absence).
 *   · Fetch is deferred until the browser is idle AND the strip's
 *     mount point is near the viewport · the homepage LCP path never
 *     waits on a relay.
 *   · Vendor pool rotates deterministically by day-of-year (the
 *     FeaturedVendor pattern) across bech32 Nostr vendors, 3 per day ·
 *     bounded relay load, fresh faces daily.
 *   · Cards link to the vendor's /v page · the stay-on-site rule.
 *     njump exits live on the detail page, not here.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { VENDORS, getPlatform, vendorSlug, type Vendor } from "@/lib/vendors";
// Type-only · erased at compile time. The RUNTIME import of
// nostr-activity happens inside load(), because its module top level
// pulls in @noble/curves schnorr + @noble/hashes · deferring the
// fetch but statically importing the verifier would still ship the
// crypto in every homepage visitor's first-load JS (review 2026-07-07).
import type { RecentNostrPost } from "@/lib/nostr-activity";
import { filterAndSelectPosts } from "@/lib/nostr-content-filter";

type StripPost = RecentNostrPost & { vendor: Vendor };

const VENDORS_PER_DAY = 3;
const POSTS_PER_VENDOR = 4;
const MAX_DISPLAY = 3;

/** Deterministic daily rotation over bech32 Nostr vendors · same
 *  zero-curation pattern as FeaturedVendor's weekly pick. */
function todaysNostrVendors(
  decodeNostrBech32ToPubkey: (handle: string) => string | null,
): Vendor[] {
  const pool = VENDORS.filter(
    (v) =>
      getPlatform(v) === "nostr" && decodeNostrBech32ToPubkey(v.handle) !== null,
  );
  if (pool.length === 0) return [];
  const dayOfYear = Math.floor(
    (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const out: Vendor[] = [];
  for (let i = 0; i < Math.min(VENDORS_PER_DAY, pool.length); i++) {
    out.push(pool[(dayOfYear + i) % pool.length]);
  }
  return out;
}

export function LiveEconomyStrip() {
  const [posts, setPosts] = useState<StripPost[] | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    async function load() {
      if (startedRef.current) return;
      startedRef.current = true;
      const { decodeNostrBech32ToPubkey, fetchRecentNostrPosts } =
        await import("@/lib/nostr-activity");
      if (cancelled) return;
      const vendors = todaysNostrVendors(decodeNostrBech32ToPubkey);
      if (vendors.length === 0) return;
      const settled = await Promise.allSettled(
        vendors.map(async (vendor) => {
          const pubkey = decodeNostrBech32ToPubkey(vendor.handle);
          if (!pubkey) return [] as StripPost[];
          const fetched = await fetchRecentNostrPosts(
            pubkey,
            POSTS_PER_VENDOR,
          );
          return filterAndSelectPosts(fetched, 2).map((p) => ({
            ...p,
            vendor,
          }));
        }),
      );
      if (cancelled) return;
      const merged = settled
        .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
        .sort((a, b) => b.createdAt - a.createdAt)
        // One post per vendor in the strip · variety beats volume.
        .filter(
          (p, i, arr) =>
            arr.findIndex((q) => q.vendor.handle === p.vendor.handle) === i,
        )
        .slice(0, MAX_DISPLAY);
      if (merged.length > 0) {
        setPosts(merged);
        track("live_economy_strip_shown", { count: merged.length });
      }
    }

    // Defer: wait until the strip is near the viewport, then until
    // the main thread is idle · relays never compete with LCP.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          const idle =
            "requestIdleCallback" in window
              ? (cb: () => void) =>
                  (window as unknown as {
                    requestIdleCallback: (cb: () => void) => void;
                  }).requestIdleCallback(cb)
              : (cb: () => void) => setTimeout(cb, 800);
          idle(() => {
            void load();
          });
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(host);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef}>
      {posts && (
        <section
          aria-label="Live posts from directory vendors on Nostr"
          className="mt-8"
        >
          <div className="flex items-baseline gap-3 mb-3">
            <span className="inline-flex items-center gap-2 t-xs font-medium text-[var(--text-tertiary)]">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse"
                aria-hidden
              />
              Live from the circular economy
            </span>
            <span className="t-xs text-[var(--text-tertiary)]">
              Nostr · signature-verified
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/v/${vendorSlug(post.vendor)}`}
                onClick={() =>
                  track("live_economy_strip_click", {
                    handle: post.vendor.handle,
                  })
                }
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 card-lift block"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {post.vendor.name}
                  </span>
                  <time
                    className="font-mono t-xs tabular-nums text-[var(--text-tertiary)] shrink-0"
                    dateTime={new Date(post.createdAt * 1000).toISOString()}
                  >
                    {stripRelativeTime(post.createdAt)}
                  </time>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2 break-words">
                  {post.content}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function stripRelativeTime(unixSeconds: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
