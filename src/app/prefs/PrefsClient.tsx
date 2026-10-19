"use client";

// Client island for /prefs · reads ?token=… from the URL, loads
// current prefs via /api/prefs, renders an editable form, POSTs
// changes back. Each checkbox is one opt-in channel; thresholds
// stay editable too because normalizePrefs requires them to be
// present and valid on POST.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";

type Prefs = {
  warmThreshold: number;
  coldThreshold: number;
  digestEnabled: boolean;
  notifyOnTierChange: boolean;
  notifyOnMnavCheap: boolean;
  notifyOnMnavRich: boolean;
  notifyOnForecastWindow: boolean;
  notifyOnFloatMilestone: boolean;
  notifyOnNewVendors: boolean;
  notifyOnFitChange: boolean;
  notifyOnHashrateAvailable: boolean;
  monthlyRoundupEnabled: boolean;
  updatedAt: number;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; email: string; prefs: Prefs }
  | { kind: "error"; message: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function PrefsClient() {
  const sp = useSearchParams();
  const token = sp?.get("token") ?? "";
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (!token) {
      setLoad({
        kind: "error",
        message:
          "Missing token. Click the 'Edit preferences' link from any of our emails to land here with a valid one.",
      });
      return;
    }
    let cancelled = false;
    fetch(`/api/prefs?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = (await r.json()) as
          | { ok: true; email: string; prefs: Prefs }
          | { ok: false; error: string };
        if (cancelled) return;
        if (body.ok) {
          setLoad({ kind: "loaded", email: body.email, prefs: body.prefs });
          setPrefs(body.prefs);
        } else {
          setLoad({ kind: "error", message: body.error });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({
            kind: "error",
            message: "Network error. Try the link again in a moment.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setSave({ kind: "saving" });
    track("prefs_save_attempt");
    try {
      const r = await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, prefs }),
      });
      const body = (await r.json()) as
        | { ok: true; prefs: Prefs }
        | { ok: false; error: string };
      if (body.ok) {
        track("prefs_save_success");
        setSave({ kind: "saved" });
        setPrefs(body.prefs);
        // Brief "Saved" feedback then back to idle so subsequent
        // edits don't show stale state.
        setTimeout(() => setSave({ kind: "idle" }), 1800);
      } else {
        setSave({ kind: "error", message: body.error });
      }
    } catch {
      setSave({ kind: "error", message: "Network error. Try again." });
    }
  }

  if (load.kind === "loading") {
    return <p className="text-sm text-[var(--text-tertiary)]">Loading your preferences…</p>;
  }
  if (load.kind === "error") {
    return (
      <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/[0.05] p-5">
        <div className="text-sm text-[var(--text-secondary)] mb-2">{load.message}</div>
        <p className="text-xs text-[var(--text-tertiary)]">
          If you're trying to unsubscribe, use the link in any alert email.
        </p>
      </div>
    );
  }
  if (!prefs) return null;

  function set<K extends keyof Prefs>(key: K, val: Prefs[K]) {
    setPrefs((p) => (p ? { ...p, [key]: val } : p));
  }

  const togglePrefs: Array<{ key: keyof Prefs; label: string; desc: string }> = [
    {
      key: "notifyOnTierChange",
      label: "Tier flips",
      desc: "The gauge crossed between zones (WARM→HOT etc).",
    },
    {
      key: "notifyOnForecastWindow",
      label: "Imminent strong window",
      desc: "A forecasted high-score window is <24h away.",
    },
    {
      key: "notifyOnMnavCheap",
      label: "Treasury went cheap",
      desc: "MSTR / MPJPY / XXI / ASST crossed below 1.05× mNAV.",
    },
    {
      key: "notifyOnMnavRich",
      label: "Treasury went rich",
      desc: "A tracked treasury crossed above 1.6× mNAV.",
    },
    {
      key: "notifyOnFloatMilestone",
      label: "Float milestones",
      desc: "Buyable bitcoin float dropped below a 500K BTC round number.",
    },
    {
      key: "notifyOnFitChange",
      label: "/fit allocation changes",
      desc: "Weekly check · your recommended sleeve mix added/removed a sleeve or a weight moved ≥5pp. Opt in at /fit to set your baseline tuple.",
    },
    {
      key: "notifyOnNewVendors",
      label: "New merchants · weekly digest",
      desc: "Sundays only · skipped on weeks nothing new lands.",
    },
    {
      key: "notifyOnHashrateAvailable",
      label: "USA fleet opened",
      desc: "Another USA machine opened. At most one email a day, and nothing while the open count stays flat.",
    },
    {
      key: "digestEnabled",
      label: "Weekly Sunday gauge digest",
      desc: "7-day score range + top signal contributor + week-ahead forecast.",
    },
    {
      key: "monthlyRoundupEnabled",
      label: "Monthly market roundup · default on",
      desc: "First Sunday of each month. Gauge level + 30-day range, cheapest treasury, biggest monthly mover, new merchants this month. The one channel that's on by default; toggle off if you'd rather only hear about extremes.",
    },
  ];

  return (
    <form onSubmit={onSave} className="space-y-6">
      <p className="text-xs text-[var(--text-tertiary)]">
        Editing settings for{" "}
        <span className="font-mono text-[var(--text-secondary)]">
          {load.email}
        </span>
      </p>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-4">
        <div className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Notification channels
        </div>
        {togglePrefs.map(({ key, label, desc }) => (
          <label
            key={key}
            className="flex items-start gap-3 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={Boolean(prefs[key])}
              onChange={(e) => set(key, e.target.checked as Prefs[typeof key])}
              className="mt-1 accent-[var(--accent)] h-4 w-4 flex-shrink-0"
            />
            <span className="flex-1">
              <span className="block text-sm text-[var(--text-primary)] font-medium">
                {label}
              </span>
              <span className="block text-xs text-[var(--text-tertiary)] mt-0.5 leading-relaxed">
                {desc}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-3">
          Extreme alert thresholds
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">
              Warm threshold ·{" "}
              <span className="text-[var(--accent-ink)] font-mono">
                {prefs.warmThreshold}
              </span>
            </span>
            <input
              type="range"
              min={60}
              max={100}
              step={1}
              value={prefs.warmThreshold}
              onChange={(e) => set("warmThreshold", Number(e.target.value))}
              className="w-full mt-1 accent-[var(--accent)]"
              aria-label="Warm alert threshold"
            />
            <span className="t-xs text-[var(--text-tertiary)]">
              Score ≥ this fires an "extreme buy" alert.
            </span>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">
              Cold threshold ·{" "}
              <span className="text-[var(--accent-ink)] font-mono">
                {prefs.coldThreshold}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={prefs.coldThreshold}
              onChange={(e) => set("coldThreshold", Number(e.target.value))}
              className="w-full mt-1 accent-[var(--accent)]"
              aria-label="Cold alert threshold"
            />
            <span className="t-xs text-[var(--text-tertiary)]">
              Score ≤ this fires a "frothy euphoria" alert.
            </span>
          </label>
        </div>
        {prefs.warmThreshold <= prefs.coldThreshold + 20 ? (
          <div className="mt-3 text-xs text-[var(--warning)] font-mono">
            ⚠ Warm must be at least 20 above cold (currently{" "}
            {prefs.warmThreshold} − {prefs.coldThreshold} ={" "}
            {prefs.warmThreshold - prefs.coldThreshold}).
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={
            save.kind === "saving" ||
            prefs.warmThreshold <= prefs.coldThreshold + 20
          }
          className="micro-label px-5 py-2.5 rounded-md bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {save.kind === "saving"
            ? "Saving…"
            : save.kind === "saved"
              ? "✓ Saved"
              : "Save preferences"}
        </button>
        <a
          href={`/api/unsubscribe?token=${encodeURIComponent(token)}`}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--warning)] underline decoration-[var(--border-subtle)] hover:decoration-[var(--warning)] underline-offset-2"
        >
          Or unsubscribe entirely
        </a>
      </div>

      {save.kind === "error" ? (
        <div className="text-xs text-[var(--warning)]">{save.message}</div>
      ) : null}
    </form>
  );
}
