"use client";

// /fit allocation-change alert opt-in · compact one-row form placed
// AT THE MOMENT OF PEAK INTEREST (right after the recommendation
// shows). Captures email + posts the user's current (h, t, a) tuple
// so the server-side baseline is computed against exactly the
// recommendation they're looking at.
//
// Same lazy-Turnstile pattern as InlineSubscribePrompt + the sticky
// chip · captcha script only loads when the email input is focused
// so we don't pay the Turnstile-script-on-every-fit-render cost.
//
// On success: collapses into a confirmation row. The "expect a magic
// link" copy differs from the regular subscribe form because we always
// want explicit confirmation here · the (h, t, a) profile only
// materializes server-side after they click the link (KV write
// gated by email-ownership-proof, see /api/subscribe/confirm).

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { track } from "@vercel/analytics";
import type { AccountType, Tolerance } from "@/lib/recommend";

const TURNSTILE_SITE_KEY: string | undefined =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; pending: boolean }
  | { kind: "error"; message: string };

export function FitChangeAlertOptIn({
  horizon,
  tolerance,
  account,
}: {
  horizon: number;
  tolerance: Tolerance;
  account: AccountType;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [activated, setActivated] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Detect already-loaded Turnstile + bfcache cleanup · matches the
  // pattern in InlineSubscribePrompt / StickySubscribeChip so all
  // three forms share the same single Turnstile-script load.
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
      // Clear the stale token state BEFORE issuing reset() · without
      // this, the OLD (server-rejected) token persists in React state
      // until the new render's token-callback fires. A user who hits
      // submit during that race window would re-fire the same invalid
      // token, causing a second 4xx. captchaBlock = !!key && activated
      // && !token relies on the null state to gate the form. Audit
      // 2026-05-22.
      setTurnstileToken(null);
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
    if (captchaBlock) return;
    setState({ kind: "submitting" });
    track("fit_change_alert_attempt", {
      h: horizon,
      t: tolerance,
      a: account,
    });
    try {
      const r = await fetch("/api/fit-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          h: horizon,
          t: tolerance,
          a: account,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
      const body = (await r.json()) as {
        ok: boolean;
        kind?: "pending" | "added";
        error?: string;
      };
      if (body.ok) {
        track("fit_change_alert_success", {
          h: horizon,
          t: tolerance,
          a: account,
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
      <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/[0.08] px-4 py-3 text-sm text-[var(--text-secondary)]">
        <span className="text-[var(--accent-ink)] font-semibold">✓ </span>
        {state.pending
          ? "Check your inbox · click the magic link to lock in this recommendation as your baseline. We'll email when it changes."
          : "You're opted in. The weekly check starts Sunday."}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3"
    >
      {/* Lazy-load Turnstile script on first focus · matches the
          pattern shared with the other subscribe surfaces. */}
      {TURNSTILE_SITE_KEY && activated && !turnstileReady && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onReady={() => setTurnstileReady(true)}
        />
      )}

      <div className="text-sm text-[var(--text-secondary)] mb-2.5 leading-snug">
        <span className="text-[var(--accent-ink)]">✉</span> Get an email when this
        recommendation changes
        <span className="text-[var(--text-tertiary)]">
          {" "}
          · weekly check, only fires on meaningful shifts
        </span>
      </div>
      <div className="flex items-stretch gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => setActivated(true)}
          placeholder="you@example.com"
          maxLength={254}
          aria-label="Email address"
          className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm"
        />
        <button
          type="submit"
          disabled={
            state.kind === "submitting" || !email.trim() || captchaBlock
          }
          className="micro-label px-4 py-2 rounded-md bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {state.kind === "submitting" ? "..." : "Notify me →"}
        </button>
      </div>

      {/* Captcha · only renders when activated AND site key configured. */}
      {TURNSTILE_SITE_KEY && activated ? (
        <div ref={turnstileContainerRef} className="mt-2" />
      ) : null}

      {state.kind === "error" ? (
        <div className="mt-2 text-xs text-[var(--warning)]">
          {state.message}
        </div>
      ) : null}
      <div className="mt-2 t-xs text-[var(--text-tertiary)] leading-relaxed">
        We&apos;ll email you only when a sleeve is added/removed or any
        weight moves at least 5pp. Everything smaller is engine jitter.
      </div>
    </form>
  );
}
