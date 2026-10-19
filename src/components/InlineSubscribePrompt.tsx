"use client";

// Inline subscribe prompt · placed AT THE MOMENT OF PEAK INTEREST on
// each surface, not the bottom of the page. The compact full-form
// AlertSubscribeCompact still lives at the bottom for users who want
// to tune multiple opt-ins; this is the high-conversion catch.
//
// One row: email input + arrow button. Pre-selects the page-relevant
// opt-in via a source-keyed pref bundle so one click = subscribed to
// the right channel. Captcha is lazy-loaded on first email focus
// (same pattern as AlertSubscribeCompact) so the bot defense is
// active without paying the Turnstile-script-on-every-page cost.

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { track } from "@vercel/analytics";

const TURNSTILE_SITE_KEY: string | undefined =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type PrefBundle = Record<string, boolean>;

const SOURCE_PREFS: Record<string, PrefBundle> = {
  stack: { notifyOnTierChange: true },
  treasuries: { notifyOnMnavCheap: true },
  float: { notifyOnFloatMilestone: true },
  vendors: { notifyOnNewVendors: true },
  today: {
    notifyOnTierChange: true,
    notifyOnFloatMilestone: true,
    digestEnabled: true,
  },
  seo: { notifyOnTierChange: true },
  // Hashrate waitlist: availability pings only. The hourly cron emails
  // when the open-machine count goes up, at most once per UTC day.
  hashrate: {
    notifyOnHashrateAvailable: true,
    monthlyRoundupEnabled: false,
  },
};

// Stronger habit-focused headlines for the lightweight inline form.
// These appear at moments of peak interest and are often the first
// subscription touchpoint for many visitors.
const SOURCE_HEADLINES: Record<string, string> = {
  stack: "Get the signal. Build the daily streak.",
  treasuries: "Know when a treasury gets cheap.",
  float: "Get notified on major float moves.",
  vendors: "Weekly new Bitcoin merchants.",
  today: "Get the briefing without opening a tab.",
  seo: "Extreme days, straight to your inbox.",
  hashrate: "Email me when a machine is open.",
};

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; pending: boolean }
  | { kind: "error"; message: string };

// `window.turnstile` is already declared by AlertSubscribe and
// AlertSubscribeCompact · TS merges interface Window across files
// in the same compilation, so a re-declare here would conflict.
// We just use it; the existing declaration covers our access.

export function InlineSubscribePrompt({
  source,
  headline,
  subhead,
}: {
  source: keyof typeof SOURCE_PREFS;
  headline?: string;
  subhead?: string;
}) {
  // Use the strong habit-focused default if no custom headline is passed.
  const displayHeadline = headline || SOURCE_HEADLINES[source];
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [activated, setActivated] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Detect already-loaded Turnstile (e.g., user navigated from /stack
  // which loaded it). Same bfcache cleanup pattern as the full form.
  useEffect(() => {
    if (typeof window !== "undefined" && window.turnstile) {
      setTurnstileReady(true);
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        widgetIdRef.current = null;
        setTurnstileToken(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Render Turnstile widget once activated + script ready.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !activated || !turnstileReady) return;
    if (state.kind !== "idle" && state.kind !== "error") return;
    const container = turnstileContainerRef.current;
    if (!container || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      return;
    }
    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      size: "flexible",
      callback: (token) => setTurnstileToken(token),
      "error-callback": () => setTurnstileToken(null),
      "expired-callback": () => setTurnstileToken(null),
    });
  }, [activated, turnstileReady, state.kind]);

  const captchaBlock = !!TURNSTILE_SITE_KEY && activated && !turnstileToken;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state.kind === "submitting") return;
    if (captchaBlock) return; // still waiting on captcha
    setState({ kind: "submitting" });
    track("inline_subscribe_attempt", { source });
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(turnstileToken ? { turnstileToken } : {}),
          prefs: SOURCE_PREFS[source],
          // Source threads through DOI so the confirmation email +
          // post-confirm CTA route the user back to the surface they
          // came from (fixed 2026-05-21 · was hardcoded /stack).
          source,
        }),
      });
      const body = (await r.json()) as {
        ok: boolean;
        kind?: "pending" | "added";
        error?: string;
      };
      if (body.ok) {
        track("inline_subscribe_success", {
          source,
          flow: body.kind ?? "unknown",
        });
        setState({ kind: "success", pending: body.kind === "pending" });
        setEmail("");
      } else {
        setState({
          kind: "error",
          message: body.error ?? "Something went wrong.",
        });
      }
    } catch {
      setState({ kind: "error", message: "Network error. Try again." });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="my-6 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.08] px-4 py-3 text-sm text-[var(--text-secondary)]">
        <span className="text-[var(--accent-ink)] font-semibold">✓ </span>
        {state.pending
          ? "Check your inbox to confirm · click the link in the magic-link email."
          : "You're subscribed. The next alert lands when conditions warrant."}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="my-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 elevate"
    >
      {/* Lazy-load Turnstile script on first focus · matches the
          AlertSubscribeCompact pattern so we don't pay the script
          cost on every page render. */}
      {TURNSTILE_SITE_KEY && activated && !turnstileReady && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onReady={() => setTurnstileReady(true)}
        />
      )}

      <div className="text-sm text-[var(--text-secondary)] mb-2.5 leading-snug">
        <span className="text-[var(--accent-ink)]">✉</span> {displayHeadline}
        {subhead ? (
          <span className="text-[var(--text-tertiary)]"> · {subhead}</span>
        ) : null}
      </div>
      <div className="flex items-stretch gap-2">
        {/* min-w-0 is load-bearing: a flex child refuses to shrink
            below its intrinsic width without it, which pushed the
            Subscribe button past the card edge on 375px screens
            (operator report 2026-06-10). */}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => setActivated(true)}
          placeholder="you@example.com"
          maxLength={254}
          aria-label="Email address"
          className="flex-1 min-w-0 min-h-11 px-3 py-2 rounded-md bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm"
        />
        <button
          type="submit"
          disabled={
            state.kind === "submitting" || !email.trim() || captchaBlock
          }
          className="micro-label min-h-11 px-4 py-2 rounded-md bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {state.kind === "submitting" ? "..." : "Subscribe →"}
        </button>
      </div>

      {/* Captcha · only renders when activated AND site key configured.
          Hidden in the no-key local-dev case to avoid layout shift. */}
      {TURNSTILE_SITE_KEY && activated ? (
        <div ref={turnstileContainerRef} className="mt-2" />
      ) : null}

      {state.kind === "error" ? (
        <div className="mt-2 text-xs text-[var(--warning)]">
          {state.message}
        </div>
      ) : null}
      {/* Alert-types teaser · one signup unlocks every channel, but
          nobody knew (operator report 2026-06-10: "I want users to be
          aware they can sign up for more types of emails"). Name them
          where the email field is, not in a footnote. */}
      <div className="mt-2.5 t-xs text-[var(--text-tertiary)] leading-relaxed">
        <span className="text-[var(--text-secondary)]">
          One signup · 8 alert types:
        </span>{" "}
        gauge extremes, tier flips, strong-window forecasts, cheap mNAV,
        float milestones, new merchants, weekly digest, monthly roundup.{" "}
        <a
          href="/stack#alerts"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] whitespace-nowrap"
        >
          Pick yours →
        </a>
      </div>
    </form>
  );
}
