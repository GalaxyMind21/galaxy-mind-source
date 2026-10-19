import { CopyMcpUrl } from "./CopyMcpUrl";
import {
  MCP_URL,
  TEASER_EYEBROW,
  TEASER_TITLE,
  TEASER_BODY,
  TEASER_STEPS,
  TEASER_CTA,
} from "@/lib/agent-connect-copy";

// The #rent-with-ai section on /hashrate is a short teaser (2026-10-16).
// The full how-to (client tabs, prompts, what happens next) lives once, on
// /hashrate/agents#connect, and this links there in the same tab.

/** Same-tab destination of the teaser CTA. */
export const AGENTS_CONNECT_PATH = "/hashrate/agents#connect";

/** https only; anything else (javascript:, http:, junk) renders no link. */
export function safeHttpsUrl(v: string | undefined): string {
  const u = (v ?? "").trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(u)) return "";
  try { return new URL(u).protocol === "https:" ? u : ""; } catch { return ""; }
}

/** Browser checkout path, linked only when humanCheckoutLinkable() (phase 2 on, kill env off, RENTALS_HUMAN_CHECKOUT=1). */
export const BROWSER_RENT_PATH = "/hashrate/rent";
/** The one action on /hashrate: same tab, 1 rig × 1 day pre-filled. Never back to /hashrate. */
export const HERO_RENT_HREF = `${BROWSER_RENT_PATH}?rigs=1&days=1`;

/** quiet: outline CTA, for pages whose one primary action is already the browser rental (/hashrate). */
export function RentWithAiBot({ browserCheckout = false, quiet = false }: { browserCheckout?: boolean; quiet?: boolean } = {}) {
  return (
    <section id="rent-with-ai" className="glass-stage scroll-mt-24">
      <div className="glass-rest rounded-2xl p-5 sm:p-6">
        <p className="micro-label text-[var(--accent-ink)]">{TEASER_EYEBROW}</p>
        <h2 className="mt-2 text-lg font-semibold text-[var(--text-primary)] sm:text-xl">{TEASER_TITLE}</h2>
        <p className="mt-2 max-w-xl text-[15px] text-[var(--text-secondary)]">{TEASER_BODY}</p>

        <ol className="mt-4 flex flex-wrap gap-2">
          {TEASER_STEPS.map((t, i) => (
            <li
              key={t}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--nb-hair-2)] bg-[var(--bg-base)]/40 px-3 py-1.5 text-sm text-[var(--text-primary)]"
            >
              <span className="font-mono text-[var(--accent-ink)]">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href={AGENTS_CONNECT_PATH}
            className={
              quiet
                ? "inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--accent)]/50 px-6 text-[15px] font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]"
                : "inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black"
            }
          >
            {TEASER_CTA} →
          </a>
          <div className="min-w-0 sm:flex-1">
            <CopyMcpUrl url={MCP_URL} />
          </div>
        </div>

        {browserCheckout && (
          <div className="mt-4 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">No AI bot? Rent in your browser.</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Choose rigs and days, add your pool and pay with USDC on Base from your own wallet.
            </p>
            <a
              href={BROWSER_RENT_PATH}
              className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black"
            >
              Rent in your browser →
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
