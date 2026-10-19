"use client";

/* =====================================================================
 * AlertSubscribeCompact — slim mailing-list signup for non-/stack pages.
 *
 * Same backend (POST /api/subscribe → DOI flow → welcome email) as the
 * full AlertSubscribe on /stack, but with a tighter visual footprint
 * suitable for above-footer placement on /, /fit, /treasuries.
 *
 * Design:
 *   • Single horizontal row: brand label + email input + button.
 *   • Captcha-protected (same Turnstile widget) but the widget only
 *     mounts AFTER the user focuses the email input — keeps the
 *     above-the-fold area clean for visitors not signing up.
 *   • Subscriber count badge inline (uses the same /api/subscriber-count
 *     endpoint with edge cache).
 *   • Compact preferences disclosure (same as full form, also collapsed
 *     by default) so motivated visitors can still customize without us
 *     duplicating the entire prefs UI on every page.
 *
 * Why a separate component vs reusing AlertSubscribe:
 *   • The full form's heading + prose ("Don't check the page every day…")
 *     is content-heavy and inappropriate above a non-/stack page footer.
 *   • The full form is taller (3-card visual block) and would dominate
 *     the bottom of pages whose primary purpose is something else.
 *   • Same backend means no API duplication; only the UI shell differs.
 *
 * Dev note:
 *   Turnstile script is loaded on focus (not on mount) to avoid 5
 *   parallel Turnstile scripts loading across the site on every
 *   navigation. The /stack form remains the primary path; this is a
 *   secondary CTA, weighted accordingly.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { track } from "@vercel/analytics";

const TURNSTILE_SITE_KEY: string | undefined =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "dark" | "light" | "auto";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; pending: boolean }
  | { kind: "error"; message: string };

// Per-source copy + default pref bundle. The compact widget appears
// on multiple surfaces (homepage, /fit, /treasuries, /float, etc) ·
// each surface has a different "natural" alert to lead with. The
// generic "gauge enters extreme buy zones" framing is misleading on
// /treasuries (where mNAV alerts are the page-relevant signal) and
// /float (where milestone alerts are). Each entry pre-checks the
// most-relevant opt-in for that page so a one-click subscribe
// delivers contextually-relevant emails rather than a wrong-channel
// signup. The user can still expand the full prefs UI on /stack via
// the AlertSubscribe component for finer-grained control.
type CompactSource =
  | "vendors"
  | "fit"
  | "treasuries"
  | "float"
  | "embed"
  | "about"
  | "faq";

type CompactCopy = {
  eyebrow: string;
  headline: React.ReactNode;
  blurb: string;
  defaultPrefs?: Record<string, boolean>;
};

const COPY: Record<CompactSource, CompactCopy> = {
  vendors: {
    eyebrow: "New merchants digest",
    headline: (
      <>
        Get the{" "}
        <span className="text-[var(--accent-ink)]">weekly new-merchant</span>{" "}
        digest.
      </>
    ),
    blurb:
      "One Sunday email listing vendors added to the directory that week. Skipped on weeks nothing new lands.",
    defaultPrefs: { notifyOnNewVendors: true },
  },
  treasuries: {
    eyebrow: "Treasury alerts",
    headline: (
      <>
        Alert me when a{" "}
        <span className="text-[var(--accent-ink)]">treasury goes cheap</span>.
      </>
    ),
    blurb:
      "Emails on the day any tracked treasury (MSTR / MPJPY / XXI / ASST) crosses below 1.05× mNAV. One email per crossing.",
    defaultPrefs: { notifyOnMnavCheap: true },
  },
  float: {
    eyebrow: "Float milestones",
    headline: (
      <>
        Alert me when the float{" "}
        <span className="text-[var(--accent-ink)]">crosses a milestone</span>.
      </>
    ),
    blurb:
      "Email each time the buyable bitcoin float drops below a 500K BTC round number (6.0M, 5.5M, …). Down-crossings only.",
    defaultPrefs: { notifyOnFloatMilestone: true },
  },
  fit: {
    eyebrow: "Buying Gauge alerts",
    headline: (
      <>
        Get an email when bitcoin enters{" "}
        <span className="text-[var(--accent-ink)]">extreme buy zones</span>.
      </>
    ),
    blurb:
      "No newsletter. Score-driven alerts only, typically a few per month.",
  },
  embed: {
    eyebrow: "Buying Gauge alerts",
    headline: (
      <>
        Get an email when bitcoin enters{" "}
        <span className="text-[var(--accent-ink)]">extreme buy zones</span>.
      </>
    ),
    blurb:
      "No newsletter. Score-driven alerts only, typically a few per month.",
  },
  about: {
    eyebrow: "Buying Gauge alerts",
    headline: (
      <>
        Get an email when bitcoin enters{" "}
        <span className="text-[var(--accent-ink)]">extreme buy zones</span>.
      </>
    ),
    blurb:
      "No newsletter. Score-driven alerts only, typically a few per month.",
  },
  faq: {
    eyebrow: "Buying Gauge alerts",
    headline: (
      <>
        Get an email when bitcoin enters{" "}
        <span className="text-[var(--accent-ink)]">extreme buy zones</span>.
      </>
    ),
    blurb:
      "No newsletter. Score-driven alerts only, typically a few per month.",
  },
};

export function AlertSubscribeCompact({
  // Where this widget appears — drives both analytics tracking AND
  // the per-source copy/default-prefs from COPY above.
  source,
}: {
  source: CompactSource;
}) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [activated, setActivated] = useState(false); // user focused the input
  const [subCount, setSubCount] = useState<number | null>(null);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Subscriber count fetch on mount — tiny, cached at edge for 5min.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/subscriber-count", { cache: "default" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count: number | null } | null) => {
        if (!cancelled && d && typeof d.count === "number") setSubCount(d.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Detect already-loaded Turnstile script (e.g., user navigated from
  // /stack which loaded it). Same bfcache cleanup pattern as full form.
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state.kind === "submitting") return;
    setState({ kind: "submitting" });
    track("compact_subscribe_attempt", { source });
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(turnstileToken ? { turnstileToken } : {}),
          // Per-source default opt-in · pre-checks the page-relevant
          // alert channel (e.g. mNAV alerts on /treasuries) so a
          // one-click subscribe delivers contextually-relevant emails
          // rather than the wrong channel.
          ...(COPY[source].defaultPrefs
            ? { prefs: COPY[source].defaultPrefs }
            : {}),
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
        track("compact_subscribe_success", {
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
      setState({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  return (
    <section className="mt-16 mb-12 max-w-3xl mx-auto px-4 sm:px-6">
      {/* Lazily load Turnstile script when user activates the form.
          On /stack the script is already loaded; this is a no-op there
          if user navigates here from there. */}
      {TURNSTILE_SITE_KEY && activated && !turnstileReady && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onReady={() => setTurnstileReady(true)}
        />
      )}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="micro-label text-[var(--text-tertiary)]">
              {COPY[source].eyebrow}
            </div>
            <h3 className="mt-1.5 font-semibold text-base sm:text-lg text-[var(--text-primary)]">
              {COPY[source].headline}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed max-w-md">
              {COPY[source].blurb}
            </p>
          </div>
          {subCount != null && subCount > 0 && (
            <span className="micro-label inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/8 text-[var(--accent-ink)] shrink-0">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                style={{
                  boxShadow: "0 0 6px var(--accent)",
                  animation: "compactSubPulse 1.6s ease-in-out infinite",
                }}
                aria-hidden
              />
              Join {subCount.toLocaleString()}
            </span>
          )}
        </div>

        {state.kind === "success" ? (
          <div className="mt-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 p-3 text-sm text-[var(--text-primary)]">
            {state.pending
              ? "Check your inbox · confirm the link to finish signup."
              : "You're in. We'll email you when the gauge fires."}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                required
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setActivated(true)}
                disabled={state.kind === "submitting"}
                className="flex-1 min-w-0 bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)] focus:lit-active transition-all font-sans"
                aria-label="Email address"
              />
              <button
                type="submit"
                disabled={
                  state.kind === "submitting" ||
                  !email.trim() ||
                  captchaBlock
                }
                className="micro-label bg-[var(--accent)] text-black font-semibold px-5 py-2 rounded-lg lit-primary hover:bg-[var(--accent-hover)] hover:lit-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              >
                {state.kind === "submitting" ? "Sending…" : "Get alerts"}
              </button>
            </div>
            {/* Turnstile mount · only renders after activation */}
            {TURNSTILE_SITE_KEY && activated && (
              <div ref={turnstileContainerRef} className="mt-1" />
            )}
          </form>
        )}

        {state.kind === "error" && (
          <div className="mt-2 text-xs text-[var(--warning)]">
            {state.message}
          </div>
        )}

        <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed">
          One-click unsubscribe in every email. Customize thresholds on the{" "}
          <a
            href="/stack#alerts"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors underline decoration-[var(--border-subtle)] decoration-1 underline-offset-2"
          >
            full signup form
          </a>
          .
        </p>

        <style>{`
          @keyframes compactSubPulse {
            0%, 100% { opacity: 0.55; }
            50%      { opacity: 1; }
          }
        `}</style>
      </div>
    </section>
  );
}
