"use client";

import { useCallback, useEffect, useState } from "react";
import { OUTCOMES, OUTCOME_CODES } from "@/lib/submission-outcomes";
import type { VendorSubmission } from "@/lib/vendor-submissions";
import { untrustedWebsiteReview } from "@/lib/submit-guard";



type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; submissions: VendorSubmission[] };

function ageLabel(submittedAt: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - submittedAt);
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function AdminSubmissionsClient() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Auto-lock after 30 min of tab open. The secret stays in React
  // state only — never sessionStorage (same-origin game pages can
  // read that).
  useEffect(() => {
    if (!unlocked) return;
    const t = window.setTimeout(() => {
      setUnlocked(false);
      setSecret("");
      setFlash("Session expired · re-enter ADMIN_SECRET");
    }, 30 * 60 * 1000);
    return () => window.clearTimeout(t);
  }, [unlocked]);

  const load = useCallback(async (token: string) => {
    setState({ status: "loading" });
    try {
      const r = await fetch("/api/admin/pending-submissions", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (r.status === 401) {
        setState({
          status: "error",
          message: "Unauthorized — check ADMIN_SECRET (CRON_SECRET works only while ADMIN_SECRET is unset)",
        });
        setUnlocked(false);
        return;
      }
      if (!r.ok) {
        setState({
          status: "error",
          message: `HTTP ${r.status}`,
        });
        return;
      }
      const data = (await r.json()) as { submissions: VendorSubmission[] };
      setState({ status: "ok", submissions: data.submissions ?? [] });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }, []);

  useEffect(() => {
    if (unlocked && secret) void load(secret);
  }, [unlocked, secret, load]);

  const unlock = (e: React.FormEvent) => {
    e.preventDefault();
    const t = secret.trim();
    if (!t) return;
    setSecret(t);
    setUnlocked(true);
  };

  const reject = async (id: string) => {
    // Outcome code first · it decides what (if anything) the submitter
    // is told, and it carries the "what to fix" line. Before this, a
    // browser reject notified nobody at all.
    const menu = OUTCOME_CODES.map(
      (c, i) =>
        `${i + 1}. ${OUTCOMES[c].label}${OUTCOMES[c].notifies ? "" : "  (silent)"}`,
    ).join("\n");
    const pick = window.prompt(`Outcome:\n${menu}\n\nNumber:`, "1");
    if (!pick) return;
    const idx = Number.parseInt(pick, 10);
    if (!Number.isInteger(idx) || idx < 1 || idx > OUTCOME_CODES.length) {
      setFlash("Not a valid outcome number · nothing changed");
      return;
    }
    const code = OUTCOME_CODES[idx - 1];

    const reason = window.prompt(
      "Internal audit note (never sent to the submitter):",
      OUTCOMES[code].label,
    );
    if (!reason?.trim()) return;

    setBusyId(id);
    setFlash(null);
    try {
      const r = await fetch("/api/admin/finalize-submission", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          status: "rejected",
          reason: reason.trim(),
          outcome: { code },
        }),
      });
      if (!r.ok) {
        setFlash(`Reject failed: HTTP ${r.status}`);
        return;
      }
      const data = (await r.json().catch(() => ({}))) as {
        notify?: {
          notified?: string;
          error?: string;
          handoff?: { profileUrl: string; text: string };
        };
      };
      const n = data.notify?.notified;
      let tail = "";
      if (n === "sent") tail = " · submitter emailed";
      else if (n === "silent") tail = " · silent outcome, nobody notified";
      else if (n === "no-address") {
        const text = data.notify?.handoff?.text ?? "";
        const url = data.notify?.handoff?.profileUrl ?? "";
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            /* clipboard blocked */
          }
        }
        tail = url
          ? ` · no email; DM copied · ${url}`
          : " · no email on file; DM text copied if available";
      } else if (n === "failed") {
        tail = ` · NOTIFY FAILED: ${data.notify?.error ?? "unknown"}`;
      }
      setFlash(`Rejected ${id.slice(0, 12)}…${tail}`);
      await load(secret);
    } finally {
      setBusyId(null);
    }
  };

  const markApproved = async (id: string) => {
    const raw = window.prompt(
      "Mark approved in KV only (after vendors.ts write). Enter approvedAsAddedAt integer:",
    );
    if (!raw?.trim()) return;
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n <= 0) {
      setFlash("approvedAsAddedAt must be a positive number");
      return;
    }
    // Multi-shop gate: a new shop under a handle that already owns a
    // listing, with no backlink/nostr.json evidence, needs a DM from
    // the ACCOUNT before it can be marked approved.
    const sub =
      state.status === "ok" ? state.submissions.find((x) => x.id === id) : undefined;
    let ownershipConfirmedByDm = false;
    if (sub?.flags?.includes("existing-handle") && sub.ownershipCheck?.ok !== true) {
      ownershipConfirmedByDm = window.confirm(
        `@${sub.vendor.handle} already owns a listing and the new site shows no backlink. Did the ACCOUNT itself confirm this shop by DM?`,
      );
      if (!ownershipConfirmedByDm) {
        setFlash("Not marked · ownership proof needed (backlink, nostr.json or a DM from the account)");
        return;
      }
    }
    setBusyId(id);
    setFlash(null);
    try {
      const r = await fetch("/api/admin/finalize-submission", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          status: "approved",
          approvedAsAddedAt: n,
          ...(ownershipConfirmedByDm ? { ownershipConfirmedByDm: true } : {}),
        }),
      });
      if (!r.ok) {
        setFlash(`Approve mark failed: HTTP ${r.status}`);
        return;
      }
      setFlash(`Marked approved · addedAt ${n}`);
      await load(secret);
    } finally {
      setBusyId(null);
    }
  };

  if (!unlocked) {
    return (
      <form
        onSubmit={unlock}
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
      >
        <label className="mb-2 block font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
          ADMIN_SECRET (preferred) or CRON_SECRET
        </label>
        <input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          placeholder="paste secret · never commit this"
        />
        <p className="mb-4 text-xs text-[var(--text-tertiary)] leading-relaxed">
          Prefer a dedicated{" "}
          <code className="text-[var(--accent-ink)]">ADMIN_SECRET</code> in
          Vercel so a browser session cannot fire crons or{" "}
          <code className="text-[var(--accent-ink)]">/api/post-to-social</code>.
          Falls back to CRON_SECRET if ADMIN_SECRET is unset. Approve still
          writes vendors.ts via CLI — this UI is triage only.
        </p>
        <button
          type="submit"
          className="micro-label rounded-full bg-[var(--accent)] px-5 py-2 text-black"
        >
          Unlock queue
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void load(secret)}
          className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => {
            setUnlocked(false);
            setSecret("");
            setState({ status: "idle" });
          }}
          className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
        >
          Lock
        </button>
        {state.status === "ok" && (
          <span className="font-mono text-xs text-[var(--text-tertiary)]">
            {state.submissions.length} pending
          </span>
        )}
      </div>

      {flash && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--accent-ink)]">
          {flash}
        </div>
      )}

      {state.status === "loading" && (
        <p className="font-mono text-xs text-[var(--text-tertiary)]">Loading…</p>
      )}
      {state.status === "error" && (
        <p className="font-mono text-xs text-[var(--warning)]">{state.message}</p>
      )}
      {state.status === "ok" && state.submissions.length === 0 && (
        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 font-mono text-sm text-[var(--text-secondary)]">
          Queue empty. Nice.
        </p>
      )}
      {state.status === "ok" &&
        state.submissions.map((s) => {
          const v = s.vendor;
          const site = v.website ? untrustedWebsiteReview(v.website) : null;
          return (
            <article
              key={s.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {v.name}{" "}
                  <span className="font-mono text-sm font-normal text-[var(--text-tertiary)]">
                    {v.platform === "x" || !v.platform
                      ? `@${v.handle}`
                      : v.handle}
                  </span>
                </h2>
                <span className="font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
                  {ageLabel(s.submittedAt)} · {v.category}
                  {v.country ? ` · ${v.country}` : ""}
                </span>
              </div>
              <p className="mb-3 text-sm text-[var(--text-secondary)]">
                {v.description}
              </p>
              {s.ownershipCheck && (
                <p className="mb-3 font-mono text-xs text-[var(--text-secondary)]">
                  Ownership: {s.ownershipCheck.ok ? "✓" : "⚠ needs DM"} · {s.ownershipCheck.detail}
                </p>
              )}
              {s.flags && s.flags.length > 0 && (
                <p className="mb-3 border-l-2 border-[var(--warning)] pl-3 font-mono text-xs text-[var(--warning)]">
                  Flags: {s.flags.join(", ")}
                </p>
              )}
              {site && (
                <p className="mb-3 font-mono text-xs text-[var(--text-tertiary)]">
                  {site.label}: {site.host}
                </p>
              )}
              {s.submitterNote && (
                <p className="mb-3 border-l-2 border-[var(--accent)]/40 pl-3 text-xs text-[var(--text-tertiary)]">
                  Note: {s.submitterNote}
                </p>
              )}
              {/* LN guard verdict (2026-07-23 · lib/ln-guard) · red
                  strip = fund-diversion hold, amber = unanchored
                  payment address needing out-of-band confirmation.
                  Full approve happens in the CLI (which enforces the
                  gate) · this badge is so a reject-from-browser
                  decision is made with the verdict in view. */}
              {s.profileCheck && s.profileCheck.lnGuard.status !== "no-ln-submitted" && (
                <p
                  className={`mb-3 border-l-2 pl-3 font-mono text-xs ${
                    s.profileCheck.lnGuard.requiresHold
                      ? "border-red-500 text-red-400"
                      : s.profileCheck.lnGuard.needsConfirm
                        ? "border-[var(--warning)] text-[var(--warning)]"
                        : "border-[var(--success)] text-[var(--success)]"
                  }`}
                >
                  LN guard: {s.profileCheck.lnGuard.summary}
                </p>
              )}
              {!s.profileCheck && v.lightningAddress && (
                <p className="mb-3 border-l-2 border-[var(--warning)] pl-3 font-mono text-xs text-[var(--warning)]">
                  LN guard: no verdict on record (pre-guard submission) ·
                  treat {v.lightningAddress} as unverified
                </p>
              )}
              <div className="mb-4 font-mono t-xs text-[var(--text-tertiary)]">
                id {s.id}
                {v.shopUrl ? ` · ${v.shopUrl}` : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void reject(s.id)}
                  className="rounded-full border border-[var(--warning)]/50 px-4 py-1.5 font-mono t-xs uppercase tracking-widest text-[var(--warning)] hover:bg-[var(--warning)]/10 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void markApproved(s.id)}
                  className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated-2)] disabled:opacity-50"
                  title="Only marks KV after you already wrote vendors.ts via CLI"
                >
                  Mark approved (KV only · after CLI write)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cmd = `CRON_SECRET=… npx tsx scripts/review-submissions.ts`;
                    void navigator.clipboard?.writeText(cmd);
                    setFlash("CLI command copied · full approve writes vendors.ts");
                  }}
                  className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 font-mono t-xs uppercase tracking-widest text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
                >
                  Copy CLI review command
                </button>
              </div>
            </article>
          );
        })}
    </div>
  );
}
