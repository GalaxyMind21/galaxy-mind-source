"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { track } from "@vercel/analytics";

/**
 * Email opt-in form for Buying Gauge alerts.
 *
 * Triggers a notification when the live score moves into either
 * extreme — STACK NOW / STACK HUGE on the warm side, HOLD on the
 * cold side. Designed to be rare (~few times per month, at most
 * once per day) so subscribers don't unsubscribe from fatigue.
 *
 * POSTs to /api/subscribe. Three response shapes possible:
 *   - { ok:true, kind:"pending" }  → DOI flow, "check your email"
 *   - { ok:true, kind:"added" }    → KV unset, immediate add
 *   - { ok:false, error }          → validation/rate-limit/upstream
 *
 * If NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, we render the Turnstile
 * widget inline; the token is included in the POST body. Without the
 * env var, the form submits without a captcha (matches the route's
 * graceful degradation).
 */

// Public site key, exposed at build time. NEXT_PUBLIC_ prefix is
// what makes Next inline this into the browser bundle.
//
// Important: do NOT extract this into a shared module — Next's static
// analysis for NEXT_PUBLIC_* inlining works best on direct
// `process.env.NEXT_PUBLIC_*` references inside "use client" files.
// Re-exporting from another module sometimes confuses the bundler.
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

export function AlertSubscribe() {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Turnstile (and its Cloudflare third-party script + the widget's
  // own internal CSP/Trusted-Types console noise) only loads once the
  // visitor actually engages the form · mirrors AlertSubscribeCompact.
  // ~99% of /stack visitors never subscribe, so they no longer pay
  // the third-party load or see the iframe's console errors.
  const [activated, setActivated] = useState(false);
  // Subscriber count for the social-proof badge. null = either still
  // loading or Resend unreachable; in both cases we hide the badge
  // entirely (better than showing "Loading..." or "0").
  const [subCount, setSubCount] = useState<number | null>(null);
  // Optional preferences UI. Default to the platform-wide thresholds
  // (80/20) and digest-off so a user who never opens the customize
  // panel gets exactly the original behavior — no behavior change for
  // existing flow.
  const [showPrefs, setShowPrefs] = useState(false);
  const [warmThreshold, setWarmThreshold] = useState(80);
  const [coldThreshold, setColdThreshold] = useState(20);
  const [digestEnabled, setDigestEnabled] = useState(false);
  // New opt-in notification channels (Tier 1 retention work). All
  // default false to preserve the original "extremes only" behaviour
  // for users who don't expand prefs.
  const [notifyOnTierChange, setNotifyOnTierChange] = useState(false);
  const [notifyOnMnavCheap, setNotifyOnMnavCheap] = useState(false);
  const [notifyOnMnavRich, setNotifyOnMnavRich] = useState(false);
  const [notifyOnForecastWindow, setNotifyOnForecastWindow] = useState(false);
  const [notifyOnFloatMilestone, setNotifyOnFloatMilestone] = useState(false);
  const [notifyOnNewVendors, setNotifyOnNewVendors] = useState(false);
  const [notifyOnFitChange, setNotifyOnFitChange] = useState(false);
  const [notifyOnHashrateAvailable, setNotifyOnHashrateAvailable] =
    useState(false);
  const [monthlyRoundupEnabled, setMonthlyRoundupEnabled] = useState(false);
  // Whether the user has touched the prefs at all — used to decide
  // whether to send `prefs` in the body. Sending {} when they haven't
  // touched it would force a KV write for defaults, wasted work.
  const prefsTouched =
    showPrefs &&
    (warmThreshold !== 80 ||
      coldThreshold !== 20 ||
      digestEnabled ||
      notifyOnTierChange ||
      notifyOnMnavCheap ||
      notifyOnMnavRich ||
      notifyOnForecastWindow ||
      notifyOnFloatMilestone ||
      notifyOnNewVendors ||
      notifyOnFitChange ||
      notifyOnHashrateAvailable ||
      monthlyRoundupEnabled);
  // Tracks whether the Turnstile API has loaded. Set to true via the
  // <Script onReady> callback below. Without this dependency the
  // useEffect that calls turnstile.render() runs once during
  // hydration (when window.turnstile is undefined), bails, and never
  // re-runs — leaving the captcha container permanently empty. This
  // was the actual root cause of "the widget never rendered."
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; pending: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Handle the back-navigation case where the Turnstile API script was
  // already loaded by a prior page visit (browser cache). In that
  // scenario the <Script onReady> callback never fires (Next/React
  // sees the script is already in the DOM). Without this we'd be
  // permanently stuck waiting for a callback that won't come.
  //
  // ALSO clear widgetIdRef on bfcache restore. Previously, after an
  // Subscriber-count fetch for the social-proof badge. Lazy — only
  // shown if Resend returns a real number; failures gracefully hide
  // the badge entirely (no broken-zero state).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/subscriber-count", { cache: "default" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count: number | null } | null) => {
        if (!cancelled && d && typeof d.count === "number") {
          setSubCount(d.count);
        }
      })
      .catch(() => {
        /* hide badge on any failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // SPA navigation away+back, the widgetId in our ref still held the
  // stale id of a now-destroyed widget. The render-effect would then
  // call turnstile.reset() on the stale id (silent no-op), bail
  // before calling render(), and leave the captcha box empty —
  // submit button stuck disabled with no error message.
  useEffect(() => {
    if (typeof window !== "undefined" && window.turnstile) {
      setTurnstileReady(true);
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // Restored from bfcache — any prior widget id is stale.
        widgetIdRef.current = null;
        setTurnstileToken(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Initialize the Turnstile widget once the script loads. Re-render
  // whenever the form state goes back to "idle" (after an error) so
  // the captcha refreshes and the user can retry.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (!activated) return;
    if (!turnstileReady) return;
    if (state.kind !== "idle" && state.kind !== "error") return;
    const container = turnstileContainerRef.current;
    if (!container || !window.turnstile) return;
    // Reset prior widget if any (re-render scenario).
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
  }, [state.kind, turnstileReady, activated]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state.kind === "submitting") return;
    setState({ kind: "submitting" });
    track("stack_alert_subscribe_attempt");
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          // Only include if we have a token; the route checks
          // isTurnstileConfigured() and only validates if so.
          ...(turnstileToken ? { turnstileToken } : {}),
          // Explicit source threads through DOI so the confirmation +
          // welcome emails route the user back to /stack (gauge-themed
          // copy). Without this, the route's normalizeSubscribeSource()
          // default IS "stack" today so it still works · but the default
          // is an implementation detail and could change. Sibling
          // InlineSubscribePrompt + StickySubscribeChip already pass
          // source explicitly · audit 2026-05-22 caught the asymmetry.
          source: "stack",
          // Only send prefs if the user actually customized them ·
          // sending {} would force a KV write for defaults.
          ...(prefsTouched
            ? {
                prefs: {
                  warmThreshold,
                  coldThreshold,
                  digestEnabled,
                  notifyOnTierChange,
                  notifyOnMnavCheap,
                  notifyOnMnavRich,
                  notifyOnForecastWindow,
                  notifyOnFloatMilestone,
                  notifyOnNewVendors,
                  notifyOnFitChange,
                  notifyOnHashrateAvailable,
                  monthlyRoundupEnabled,
                },
              }
            : {}),
        }),
      });
      const body = (await r.json()) as {
        ok: boolean;
        kind?: "pending" | "added";
        error?: string;
      };
      if (body.ok) {
        track("stack_alert_subscribe_success", {
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
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  // Block submit until captcha is solved (when configured).
  const captchaBlock =
    TURNSTILE_SITE_KEY != null && activated && turnstileToken == null;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-8">
      {/* Turnstile script · only loaded when the site key is configured.
          `strategy="lazyOnload"` means it doesn't block initial paint;
          the form just won't show the captcha until it lands. */}
      {TURNSTILE_SITE_KEY && activated && !turnstileReady && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onReady={() => setTurnstileReady(true)}
        />
      )}

      <div className="micro-label text-[var(--text-tertiary)] flex items-center gap-3 flex-wrap">
        <span>Get the signal without daily checking</span>
        {subCount != null && subCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--accent-ink)] t-xs tracking-[0.22em] font-semibold">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
              style={{
                boxShadow: "0 0 8px var(--accent)",
                animation: "subBadgePulse 1.6s ease-in-out infinite",
              }}
              aria-hidden
            />
            {subCount} others already on the list
          </span>
        )}
        <style>{`
          @keyframes subBadgePulse {
            0%, 100% { opacity: 0.55; }
            50%      { opacity: 1; }
          }
        `}</style>
      </div>
      <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
        Build a lasting habit.{" "}
        <span className="text-[var(--accent-ink)]">Skip the daily reminder.</span>
      </h2>
      <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed max-w-2xl">
        One calm email when the gauge hits meaningful extremes (or the rare euphoric top).
        Most months you get zero. Your daily streak keeps growing every time you check the page; the email just removes the "did I remember?" friction.
      </p>

      {state.kind === "success" ? (
        <div className="mt-6 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 p-4">
          <div className="micro-label text-[var(--accent-ink)]">
            ✓ {state.pending ? "Check your inbox" : "Subscribed"}
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {state.pending
              ? "We sent a confirmation link to your email. Click it to finish subscribing. The link expires in 24 hours."
              : "You're on the list. You'll hear from us the next time conditions get extreme."}
          </p>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 flex flex-col gap-3"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              required
              maxLength={254}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setActivated(true)}
              disabled={state.kind === "submitting"}
              className="flex-1 min-w-0 bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)] focus:lit-active transition-all font-sans"
              aria-label="Email address"
            />
            <button
              type="submit"
              disabled={
                state.kind === "submitting" || !email.trim() || captchaBlock
              }
              className="micro-label bg-[var(--accent)] text-black font-semibold px-6 py-3 rounded-lg lit-primary hover:bg-[var(--accent-hover)] hover:lit-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
            >
              {state.kind === "submitting" ? "Sending…" : "Get alerts"}
            </button>
          </div>
          {/* Turnstile widget mount point · empty when key isn't set so
              there's no UI footprint for visitors on a no-captcha deploy. */}
          {TURNSTILE_SITE_KEY && activated && (
            <div ref={turnstileContainerRef} className="mt-1" />
          )}

          {/* Alert-types menu · ALWAYS visible so every visitor learns
              the breadth of channels before deciding (operator report
              2026-06-10: the collapsed tertiary-text toggle hid the
              entire fine-tuning system from average users). The chips
              are informational; the button below opens the actual
              controls. Threshold ranges enforced client-side AND on
              the server (defense in depth). */}
          <div className="mt-3">
            <div className="font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] mb-2">
              One signup covers all of these · defaults marked
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[
                "Gauge ≥80 / ≤20 ✓",
                "Tier flips",
                "Strong-window forecast",
                "Cheap mNAV",
                "Rich mNAV",
                "Float milestones",
                "New merchants",
                "Weekly digest",
                "Monthly roundup ✓",
              ].map((t) => (
                <span
                  key={t}
                  className="px-2.5 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/50 font-mono t-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]"
                >
                  {t}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowPrefs((v) => !v)}
              className="micro-label inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/70 transition-all"
              aria-expanded={showPrefs}
            >
              {showPrefs
                ? "▾ Collapse · keep my choices"
                : "⚙ Choose alerts + set thresholds"}
            </button>
          </div>
          {showPrefs && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 p-4 mt-1 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Warm threshold (default 80) */}
                <label className="block">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="micro-label text-[var(--text-secondary)]">
                      Stack alert at score ≥
                    </span>
                    <span className="font-mono text-sm tabular-nums text-[var(--accent-ink)]">
                      {warmThreshold}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={100}
                    step={1}
                    value={warmThreshold}
                    onChange={(e) =>
                      setWarmThreshold(Number(e.target.value))
                    }
                    className="vol-slider w-full"
                    aria-label="Warm threshold"
                  />
                  <div className="t-xs text-[var(--text-tertiary)] mt-0.5">
                    Default 80. Lower = more frequent alerts.
                  </div>
                </label>
                {/* Cold threshold (default 20) */}
                <label className="block">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="micro-label text-[var(--text-secondary)]">
                      Hold alert at score ≤
                    </span>
                    <span
                      className="font-mono text-sm tabular-nums"
                      style={{ color: "var(--cool-ink)" }}
                    >
                      {coldThreshold}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={coldThreshold}
                    onChange={(e) =>
                      setColdThreshold(Number(e.target.value))
                    }
                    className="vol-slider w-full"
                    aria-label="Cold threshold"
                  />
                  <div className="t-xs text-[var(--text-tertiary)] mt-0.5">
                    Default 20. Higher = more frequent alerts.
                  </div>
                </label>
              </div>
              {/* Digest opt-in */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={digestEnabled}
                  onChange={(e) => setDigestEnabled(e.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="text-xs text-[var(--text-secondary)] leading-snug">
                  Also send me a{" "}
                  <span className="text-[var(--text-primary)]">weekly digest</span>{" "}
                  every Sunday · score range over the past 7 days, top
                  contributors, week-ahead forecast highlight.
                </span>
              </label>
              {/* Additional opt-in notification channels · each fires
                  from its own cron with its own dedupe. All default
                  false so the user sees zero behaviour change from the
                  classic "extremes only" alert unless they actively
                  opt in. */}
              <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                <div className="t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1">
                  More signals · all optional
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnTierChange}
                    onChange={(e) => setNotifyOnTierChange(e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Tier flips</span>{" "}
                    · the gauge crossed between zones (WARM→HOT etc).
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnForecastWindow}
                    onChange={(e) =>
                      setNotifyOnForecastWindow(e.target.checked)
                    }
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Imminent strong window</span>{" "}
                    · a forecasted high-score window is &lt;24h away.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnMnavCheap}
                    onChange={(e) => setNotifyOnMnavCheap(e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Treasury went cheap</span>{" "}
                    · MSTR / MPJPY / XXI / ASST crossed below 1.05× mNAV.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnMnavRich}
                    onChange={(e) => setNotifyOnMnavRich(e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Treasury went rich</span>{" "}
                    · a tracked treasury crossed above 1.6× mNAV.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnFloatMilestone}
                    onChange={(e) =>
                      setNotifyOnFloatMilestone(e.target.checked)
                    }
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Float milestones</span>{" "}
                    · the buyable bitcoin float dropped below a 500K BTC
                    round number (6.0M, 5.5M, …).
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnNewVendors}
                    onChange={(e) => setNotifyOnNewVendors(e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">New merchants</span>{" "}
                    · weekly digest of vendors added to the directory.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnFitChange}
                    onChange={(e) => setNotifyOnFitChange(e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Allocation change</span>{" "}
                    · /fit sleeves moved by 5pp or more.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnHashrateAvailable}
                    onChange={(e) =>
                      setNotifyOnHashrateAvailable(e.target.checked)
                    }
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Hashrate open</span>{" "}
                    · a Galaxy Mind machine goes from none open to at least one.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={monthlyRoundupEnabled}
                    onChange={(e) =>
                      setMonthlyRoundupEnabled(e.target.checked)
                    }
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">Monthly roundup</span>{" "}
                    · first Sunday of the month.
                  </span>
                </label>
              </div>
              {/* Validation hint */}
              {warmThreshold <= coldThreshold + 20 && (
                <div className="t-xs text-[var(--warning)] font-mono">
                  ⚠ Warm threshold must be at least 20 above cold (currently {warmThreshold} − {coldThreshold} = {warmThreshold - coldThreshold})
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {state.kind === "error" && (
        <div className="mt-3 text-xs text-[var(--warning)]">
          {state.message}
        </div>
      )}

      <p className="mt-6 t-xs text-[var(--text-tertiary)] leading-relaxed">
        Email is stored at Resend (the sending provider). One-click
        unsubscribe in every email. We&apos;ll never share or sell it. No
        marketing emails · alerts only.
      </p>
    </section>
  );
}
