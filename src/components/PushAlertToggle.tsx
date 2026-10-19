"use client";

/* =====================================================================
 * PushAlertToggle · opt-in for lock-screen gauge alerts (2026-06-10)
 *
 * The email-independent alert channel. Sits directly under
 * AlertSubscribe on /stack: same alert, different rail · email goes
 * through Resend + the recipient's inbox rules (which have buried
 * Galaxy Mind mail three documented times); push goes browser →
 * lock screen with nothing in between.
 *
 * 2026-06-10 v2 (operator iPhone report: "I don't see an option to
 * receive push alerts"): the iOS-needs-install state was a one-line
 * tertiary hint · invisible next to the email form. Every visible
 * state is now a proper bordered card with a heading, and the iOS
 * state walks through the install steps explicitly · on iPhone the
 * option DOES exist, but Apple only allows web push for installed
 * home-screen apps, so the card has to teach that.
 *
 * Source of truth is pushManager.getSubscription() · no localStorage
 * mirror to drift. While enabled, every mount re-POSTs the
 * subscription so the server-side 180-day TTL keeps refreshing for
 * active visitors (lib/push.ts hygiene contract).
 * ===================================================================== */

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "hidden" | "ios-install" | "off" | "busy" | "on" | "denied";

function Shell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  // Shared card chrome · matches the AlertSubscribe section's register
  // so the push option reads as a sibling channel, not a footnote.
  return (
    <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5">
      <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-2.5">
        {heading}
      </div>
      {children}
    </div>
  );
}

/**
 * Topic-aware push toggle (2026-07-11). Default props keep the original
 * /stack gauge-alert behavior byte-for-byte; pass topic="wen" (+ copy)
 * for the daily WEN drop ping. Non-gauge topics track their own enabled
 * state in a localStorage marker · the raw browser subscription only
 * proves SOME topic is on, and disabling a topic must never nuke the
 * others (a WEN-off must not kill gauge alerts · the server removes
 * just that topic from the record).
 */
export function PushAlertToggle({
  topic = "gauge",
  heading = "🔔 Push alerts · no email needed",
  pitch = "Get a lock-screen ping when the gauge crosses 80 or 20, a treasury crosses into cheap or rich mNAV, or the bitcoin float hits a new low · no inbox in the loop.",
  sideNote = "Lock-screen ping on gauge 80 / 20, treasury mNAV crossings, and bitcoin-float milestones.",
  onLabel = "✓ Push alerts on · tap to disable",
  offLabel = "Enable push alerts",
}: {
  topic?: "gauge" | "wen" | "tier";
  heading?: string;
  pitch?: string;
  sideNote?: string;
  onLabel?: string;
  offLabel?: string;
} = {}) {
  const [state, setState] = useState<State>("hidden");
  const topicMarker = `gm:push:topic:${topic}`;
  const markerOn = () => {
    try {
      return window.localStorage.getItem(topicMarker) === "1";
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (
      !VAPID_PUBLIC_KEY ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("Notification" in window)
    ) {
      // One more chance for iOS Safari: it lacks Notification/Push in
      // the BROWSER but supports both inside an installed PWA · the
      // install walkthrough must still show there.
      if (
        typeof navigator !== "undefined" &&
        /iPad|iPhone|iPod/.test(navigator.userAgent)
      ) {
        setState("ios-install");
      }
      return;
    }
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIos && !standalone) {
      setState("ios-install");
      return;
    }
    if (!("PushManager" in window)) return;

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        // Gauge (legacy contract): a live browser subscription means on.
        // Other topics: the subscription is shared across topics, so
        // this topic is on only when ITS marker is set.
        if (sub && (topic === "gauge" || markerOn())) {
          setState("on");
          // TTL refresh · best-effort, invisible to the user. Sends
          // this topic only · merge semantics keep the others intact.
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscription: sub.toJSON(),
              topics: [topic],
            }),
          }).catch(() => {});
        } else {
          setState("off");
        }
      } catch {
        setState("off");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  async function enable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          VAPID_PUBLIC_KEY!,
        ) as unknown as ArrayBuffer,
      });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), topics: [topic] }),
      });
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {});
        setState("off");
        return;
      }
      try {
        window.localStorage.setItem(topicMarker, "1");
      } catch {
        /* best-effort */
      }
      track("push_enabled", { topic });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // A full browser-level unsubscribe kills EVERY topic riding this
        // subscription · only allowed when no other topic is enabled
        // (audit 2026-07-11: gauge-off was silently killing the WEN
        // drop ping). Otherwise remove just this topic server-side.
        const otherTopicOn = (["gauge", "wen"] as const).some((t) => {
          if (t === topic) return false;
          try {
            return window.localStorage.getItem(`gm:push:topic:${t}`) === "1";
          } catch {
            return false;
          }
        });
        if (topic === "gauge" && !otherTopicOn) {
          // Legacy contract · the /stack toggle owns the whole browser
          // subscription when nothing else rides it.
          const endpoint = sub.endpoint;
          await sub.unsubscribe().catch(() => {});
          fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          }).catch(() => {});
        } else {
          // Remove THIS topic only · the browser subscription and any
          // other topics stay live.
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscription: sub.toJSON(),
              remove: [topic],
            }),
          }).catch(() => {});
        }
      }
      try {
        window.localStorage.removeItem(topicMarker);
      } catch {
        /* best-effort */
      }
      track("push_disabled", { topic });
    } finally {
      setState("off");
    }
  }

  if (state === "hidden") return null;

  if (state === "ios-install") {
    return (
      <Shell heading={heading}>
        <p className="t-xs font-sans text-[var(--text-secondary)] leading-relaxed">
          {pitch} On iPhone, Apple only allows this for installed web
          apps, so it&apos;s two steps:
        </p>
        <ol className="mt-2.5 space-y-1.5 t-xs font-sans text-[var(--text-secondary)] leading-relaxed list-decimal pl-5">
          <li>
            Tap <span className="text-[var(--text-primary)]">Share</span>{" "}
            <span aria-hidden>⎙</span> →{" "}
            <span className="text-[var(--text-primary)]">
              Add to Home Screen
            </span>
          </li>
          <li>
            Open Galaxy Mind from your Home Screen and tap{" "}
            <span className="text-[var(--accent-ink)]">Enable push alerts</span>{" "}
            right here
          </li>
        </ol>
      </Shell>
    );
  }

  if (state === "denied") {
    return (
      <Shell heading={heading}>
        <p className="t-xs font-sans text-[var(--text-secondary)] leading-relaxed">
          Notifications are blocked for this site. Re-allow them in your
          browser settings, then come back and flip the switch.
        </p>
      </Shell>
    );
  }

  const on = state === "on";
  return (
    <Shell heading={heading}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={state === "busy"}
          onClick={on ? disable : enable}
          aria-pressed={on}
          className={[
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-mono t-xs uppercase tracking-[0.2em] transition-all disabled:opacity-60",
            on
              ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-ink)] lit-active"
              : "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/70",
          ].join(" ")}
        >
          {state === "busy" ? "Working…" : on ? onLabel : offLabel}
        </button>
        <span className="t-xs font-sans text-[var(--text-tertiary)]">
          {sideNote}
        </span>
      </div>
    </Shell>
  );
}
