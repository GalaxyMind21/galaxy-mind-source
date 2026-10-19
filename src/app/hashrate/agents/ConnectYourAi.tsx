"use client";

import { useId, useState } from "react";
import { CopyButton } from "./CopyButton";
import {
  MCP_URL,
  CONNECT_EYEBROW,
  CONNECT_TITLE,
  CONNECT_LEAD,
  CONNECT_URL_LABEL,
  CLIENT_GUIDES,
  PROMPTS_TITLE,
  PROMPTS,
  NEXT_TITLE,
  NEXT_STEPS,
  CONNECT_FINE_PRINT,
  CONNECT_TERMS_LINK,
} from "@/lib/agent-connect-copy";

/**
 * "Connect your AI in 2 minutes" · the first thing on /hashrate/agents.
 * One copyable link, a tab per client with its real menu path, prompts to
 * paste, and the plain what-happens-next strip.
 */
export function ConnectYourAi() {
  const [tab, setTab] = useState<string>(CLIENT_GUIDES[0].id);
  const base = useId();
  const active = CLIENT_GUIDES.find((g) => g.id === tab) ?? CLIENT_GUIDES[0];

  return (
    <section id="connect" aria-labelledby={`${base}-title`} className="glass-stage mt-8 scroll-mt-24">
      <div className="glass-rest rounded-2xl p-5 sm:p-7">
        <p className="micro-label text-[var(--accent-ink)]">{CONNECT_EYEBROW}</p>
        <h2 id={`${base}-title`} className="mt-2 text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">
          {CONNECT_TITLE}
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] text-[var(--text-secondary)]">{CONNECT_LEAD}</p>

        {/* 1 · the link */}
        <p className="micro-label mt-6 text-[var(--text-tertiary)]">
          <span className="text-[var(--accent-ink)]">1</span>
          {" · "}
          {CONNECT_URL_LABEL}
        </p>
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-[var(--accent)]/35 bg-[var(--bg-base)]/50 p-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap px-2 py-2 font-mono text-[12px] tracking-tight text-[var(--text-primary)] min-[400px]:px-3 min-[400px]:text-[13px] sm:whitespace-normal sm:break-all sm:text-base sm:tracking-normal">
            {MCP_URL}
          </code>
          <CopyButton
            text={MCP_URL}
            label="Copy link"
            className="min-h-[44px] bg-[var(--accent)] px-6 text-black hover:bg-[var(--accent)]/90"
          />
        </div>

        {/* 2 · add it to your assistant */}
        <p className="micro-label mt-7 text-[var(--text-tertiary)]">
          <span className="text-[var(--accent-ink)]">2</span>
          {" · Add it to your assistant"}
        </p>
        <div role="tablist" aria-label="Choose your AI assistant" className="mt-2 flex flex-wrap gap-2">
          {CLIENT_GUIDES.map((g) => {
            const on = g.id === active.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                id={`${base}-tab-${g.id}`}
                data-tab={g.id}
                aria-selected={on}
                aria-controls={`${base}-panel-${g.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(g.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const i = CLIENT_GUIDES.findIndex((x) => x.id === g.id);
                  const n = CLIENT_GUIDES[(i + (e.key === "ArrowRight" ? 1 : CLIENT_GUIDES.length - 1)) % CLIENT_GUIDES.length];
                  setTab(n.id);
                  document.getElementById(`${base}-tab-${n.id}`)?.focus();
                }}
                className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  on
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)]"
                    : "border-[var(--nb-hair-2)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--text-primary)]"
                }`}
              >
                {g.tab}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          className="mt-3 rounded-xl border border-[var(--nb-hair-2)] bg-[var(--bg-base)]/40 p-4 sm:p-5"
        >
          <ol className="space-y-2.5">
            {active.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[15px] text-[var(--text-secondary)]">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--accent)]/50 font-mono text-[13px] text-[var(--accent-ink)]">
                  {i + 1}
                </span>
                <span className="text-[var(--text-primary)]">{s}</span>
              </li>
            ))}
          </ol>
          {active.snippet && (
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--nb-hair-2)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--nb-hair-2)] bg-[var(--bg-elevated)]/60 px-3 py-1.5">
                <span className="font-mono text-[13px] text-[var(--text-tertiary)]">{active.snippet.label}</span>
                <CopyButton text={active.snippet.code} label="Copy" className="min-h-[36px] px-3" />
              </div>
              <pre className="overflow-x-auto bg-[var(--bg-base)]/60 p-3 font-mono text-[13px] leading-relaxed text-[var(--text-primary)]">
                {active.snippet.code}
              </pre>
            </div>
          )}
          {active.note && <p className="mt-3 text-[13px] text-[var(--text-tertiary)]">{active.note}</p>}
        </div>

        {/* 3 · ask */}
        <p className="micro-label mt-7 text-[var(--text-tertiary)]">
          <span className="text-[var(--accent-ink)]">3</span>
          {" · "}
          {PROMPTS_TITLE}
        </p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <li
              key={p}
              className="flex items-start gap-2 rounded-xl border border-[var(--nb-hair-2)] bg-[var(--bg-base)]/40 p-3"
            >
              <span className="min-w-0 flex-1 text-[15px] text-[var(--text-primary)]">“{p}”</span>
              <CopyButton text={p} label="Copy" className="min-h-[36px] px-3" />
            </li>
          ))}
        </ul>

        {/* what happens next */}
        <p className="micro-label mt-7 text-[var(--text-tertiary)]">{NEXT_TITLE}</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {NEXT_STEPS.map((s, i) => (
            <li key={s.t} className="rounded-xl border border-[var(--nb-hair-2)] bg-[var(--bg-base)]/40 p-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                <span className="font-mono text-[var(--accent-ink)]">{i + 1}</span>
                {" "}
                {s.t}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{s.d}</p>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-[13px] text-[var(--text-tertiary)]">
          {CONNECT_FINE_PRINT}{" "}
          <a href="/terms/rental" className="text-[var(--accent-ink)] underline underline-offset-2">
            {CONNECT_TERMS_LINK}
          </a>
        </p>
      </div>
    </section>
  );
}
