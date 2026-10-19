"use client";

/* =====================================================================
 * VendorRecentPosts · "What they're saying right now"
 *
 * Renders the last 3 displayable kind:1 (text note) posts from a
 * Nostr-platform vendor on their /v/[slug] detail page. Pulls live
 * from 3 relays via lib/nostr-activity, filters via
 * lib/nostr-content-filter, displays the top 3 that pass.
 *
 * Why client-side rather than SSR:
 *   · /v/[slug] is statically generated (generateStaticParams) ·
 *     adding relay queries to the build would slow it ~7 minutes
 *     for 80+ vendors × 5s relay timeout
 *   · Posts are intentionally real-time (visitor sees what the
 *     vendor said TODAY, not what was cached at last build)
 *   · Loading state is acceptable on detail pages (the visitor
 *     already committed to a click-through)
 *
 * SCOPE LIMITS:
 *   · Only renders for vendor.platform === "nostr" (X vendors get
 *     no Nostr-content surface · would be misleading)
 *   · Only renders for npub-format handles (NIP-05 handles need
 *     additional resolution we skip in v1 · can extend later)
 *   · Hides the section entirely if no posts pass the filter ·
 *     better to show nothing than a "no recent activity" placeholder
 *     that competes for attention with the rest of the page
 *
 * MODERATION:
 *   · Content filter at lib/nostr-content-filter.ts skips strong
 *     profanity, slurs, spam patterns, shouting, URL/emoji-heavy
 *     posts. Mild profanity / strong opinions deliberately pass ·
 *     they're part of the vendor's voice.
 *   · Caller fetches 10 posts so the filter can drop a few without
 *     leaving the section empty.
 * ===================================================================== */

import { useEffect, useState } from "react";
import {
  fetchRecentNostrPosts,
  decodeNostrBech32ToPubkey,
  type RecentNostrPost,
} from "@/lib/nostr-activity";
import { filterAndSelectPosts } from "@/lib/nostr-content-filter";

type Props = {
  // Nostr handle from vendor.handle · either an npub1.../nprofile1...
  // bech32 string, or a NIP-05 (name@domain). v1 only supports the
  // bech32 format; NIP-05 returns an empty render.
  handle: string;
};

type State =
  | { kind: "loading" }
  | { kind: "empty" } // fetched OK but no displayable posts (after filter)
  | { kind: "error" } // fetch failed entirely (relay timeout, decode failure)
  | { kind: "ready"; posts: RecentNostrPost[] };

const HOW_MANY_TO_FETCH = 10;
const HOW_MANY_TO_DISPLAY = 3;

export function VendorRecentPosts({ handle }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // V1 · only support bech32 npub/nprofile handles. NIP-05
      // resolution adds a /.well-known fetch + an additional roundtrip
      // we don't need for the bulk of Nostr vendors (most use npub).
      const pubkey = decodeNostrBech32ToPubkey(handle);
      if (!pubkey) {
        if (!cancelled) setState({ kind: "empty" });
        return;
      }

      try {
        const posts = await fetchRecentNostrPosts(pubkey, HOW_MANY_TO_FETCH);
        if (cancelled) return;
        const filtered = filterAndSelectPosts(posts, HOW_MANY_TO_DISPLAY);
        if (filtered.length === 0) {
          setState({ kind: "empty" });
        } else {
          setState({ kind: "ready", posts: filtered });
        }
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // Hide the section entirely on empty / error · avoids competing
  // for visitor attention with the rest of the page when there's
  // nothing useful to show.
  if (state.kind === "empty" || state.kind === "error") return null;

  return (
    <section
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 mt-6"
      aria-label="Recent posts on Nostr"
    >
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="t-xs font-medium text-[var(--text-tertiary)]">
          Recent posts · Nostr
        </h3>
        <span className="t-xs text-[var(--text-tertiary)]">
          live from relays
        </span>
      </div>

      {state.kind === "loading" && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {state.kind === "ready" && (
        <ul className="space-y-3">
          {state.posts.map((post) => (
            <li
              key={post.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] p-4"
            >
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words">
                {post.content}
              </p>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <time
                  className="font-mono t-xs tabular-nums text-[var(--text-tertiary)]"
                  dateTime={new Date(post.createdAt * 1000).toISOString()}
                >
                  {relativeTime(post.createdAt)}
                </time>
                <a
                  href={`https://njump.me/${post.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                >
                  view ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "5m ago", "2h ago", "3d ago", "Apr 3" · keeps the strip scannable.
function relativeTime(unixSeconds: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  // Older than a week · show absolute date in concise form.
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
