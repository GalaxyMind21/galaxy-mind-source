"use client";

import { useCallback, useEffect, useState } from "react";



type QueueRow = {
  handle: string;
  key: string;
  reason: string;
  priority: "high" | "normal";
  name: string | null;
  slug: string | null;
  cli: string;
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; configured: boolean; entries: QueueRow[] };

export function AdminReviewQueueClient() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [flash, setFlash] = useState<string | null>(null);

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
      const r = await fetch("/api/admin/review-queue", {
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
        setState({ status: "error", message: `HTTP ${r.status}` });
        return;
      }
      const data = (await r.json()) as {
        configured?: boolean;
        entries?: QueueRow[];
      };
      setState({
        status: "ok",
        configured: data.configured !== false,
        entries: data.entries ?? [],
      });
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

  if (!unlocked) {
    return (
      <form
        onSubmit={unlock}
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
      >
        <label className="mb-2 block t-xs text-[var(--text-tertiary)]">
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
        <p className="mb-4 text-xs leading-relaxed text-[var(--text-tertiary)]">
          Prefer a dedicated{" "}
          <code className="text-[var(--accent-ink)]">ADMIN_SECRET</code> in
          Vercel so a browser session cannot fire crons. Falls back to
          CRON_SECRET if ADMIN_SECRET is unset. This UI is read-only.
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
          className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 t-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
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
          className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 t-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
        >
          Lock
        </button>
        {state.status === "ok" && (
          <span className="font-mono text-xs text-[var(--text-tertiary)]">
            {state.entries.length} flagged
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
      {state.status === "ok" && !state.configured && (
        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 font-mono text-sm text-[var(--text-secondary)]">
          KV unset · the review queue is a no-op here.
        </p>
      )}
      {state.status === "ok" && state.configured && state.entries.length === 0 && (
        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 font-mono text-sm text-[var(--text-secondary)]">
          Queue empty. The nightly monitor has not flagged anyone.
        </p>
      )}
      {state.status === "ok" &&
        state.entries.map((e) => (
          <article
            key={e.key}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {e.name ?? e.handle}{" "}
                <span className="font-mono text-sm font-normal text-[var(--text-tertiary)]">
                  {e.handle}
                </span>
              </h2>
              <span
                className={`font-mono t-xs uppercase tracking-widest ${
                  e.priority === "high"
                    ? "text-[var(--warning)]"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {e.priority}
              </span>
            </div>
            <p className="mb-3 text-sm text-[var(--text-secondary)]">{e.reason}</p>
            <div className="flex flex-wrap gap-2">
              {e.slug ? (
                <a
                  href={`/v/${e.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 t-xs font-medium text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
                >
                  Open /v/{e.slug}
                </a>
              ) : (
                <span className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 t-xs text-[var(--text-tertiary)]">
                  Not in roster
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(e.cli);
                  setFlash(`CLI copied · ${e.cli}`);
                }}
                className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 t-xs font-medium text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
              >
                Copy re-verify CLI
              </button>
            </div>
            <pre className="mt-3 overflow-x-auto rounded bg-[var(--bg-elevated-2)] px-2 py-1.5 font-mono t-xs text-[var(--text-tertiary)]">
              {e.cli}
            </pre>
          </article>
        ))}
    </div>
  );
}
