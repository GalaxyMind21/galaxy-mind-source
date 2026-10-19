import type { Metadata } from "next";
import { mrrOnly } from "@/lib/rentals/mode";
import { MarketplaceGuide } from "../components/MarketplaceGuide";
import { MRR_AGENTS_TITLE, MRR_AGENTS_DESCRIPTION, MRR_AGENTS_H1, MRR_AGENTS_LEDE, MRR_AGENTS_STEPS } from "@/lib/mrr-page-copy";
import { SiteHeader } from "@/components/SiteHeader";
import { getHashrateDesk } from "@/lib/hashrate";
import { composeRentalQuote } from "@/lib/rental-quote";
import { MIN_HOURS } from "@/lib/rental-limits";
import {
  AGENT_PAGE_TITLE,
  AGENT_PAGE_INTRO,
  AGENT_PAGE_SURFACES_TITLE,
  AGENT_PAGE_MACHINES_TITLE,
  AGENT_PAGE_SURFACE_NOTES,
  RIG_SYNCING_NOTE,
  BRAND_EYEBROW,
} from "@/lib/hashrate-copy";
import {
  AGENTS_H1_LEAD,
  AGENTS_H1_EM,
  AGENTS_MASTHEAD,
  AGENTS_META_DESCRIPTION,
  MCP_URL,
  MCP_TOOLS,
  SURFACE_MCP_NOTE,
  SURFACE_JSON_NOTE,
  MACHINES_HOWTO,
  MACHINES_SUMMARY,
  MACHINE_STATUS_LABEL,
  AGENT_SEQUENCE_TITLE,
  AGENT_SEQUENCE,
  AGENT_CUSTODY_LINE,
} from "@/lib/agent-connect-copy";
import { ConnectYourAi } from "./ConnectYourAi";
import { BayBoard } from "../components/BayBoard";
import { SupportLine } from "../components/SupportLine";
import { supportInfo } from "@/lib/support";
import { stagingDeps } from "@/lib/rentals/phase2/staging";
import { bayBoard } from "@/lib/rentals/phase2/service";
import { BAY_OPEN, BAY_RENTED, BAY_UNAVAILABLE } from "@/lib/hashrate-copy";

const SITE_URL = "https://galaxymind.space";

const DIRECT_METADATA: Metadata = {
  title: AGENT_PAGE_TITLE,
  description: AGENTS_META_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/hashrate/agents` },
  openGraph: {
    type: "website",
    title: AGENT_PAGE_TITLE,
    description: AGENTS_META_DESCRIPTION,
    url: `${SITE_URL}/hashrate/agents`,
    // Reuses the desk's own card — same offering, same art.
    images: [
      {
        url: "/hashrate/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Rent Bitcoin hashrate from Galaxy Mind · live block odds",
      },
    ],
  },
};

export const revalidate = 300;

const SURFACES: { label: string; value: string; note: string }[] = [
  { label: "MCP", value: MCP_URL, note: SURFACE_MCP_NOTE },
  {
    label: "JSON",
    value: "https://galaxymind.space/api/hashrate/quote?machine=all&hours=6",
    note: SURFACE_JSON_NOTE,
  },
  { label: "Human", value: "https://galaxymind.space/hashrate", note: AGENT_PAGE_SURFACE_NOTES[2] },
];

const STATUS_DOT: Record<string, string> = {
  available: "bg-[var(--accent)]",
  rented: "bg-[var(--text-tertiary)]",
  offline: "bg-[var(--text-tertiary)]/50",
  "coming-online": "bg-[var(--accent)]/40",
};

// RENTALS_MODE=mrr_only (default): the marketplace guide replaces the direct-rental page; direct content stays below.
export function generateMetadata(): Metadata {
  if (!mrrOnly()) return DIRECT_METADATA;
  return {
    ...DIRECT_METADATA,
    title: MRR_AGENTS_TITLE,
    description: MRR_AGENTS_DESCRIPTION,
    openGraph: { ...DIRECT_METADATA.openGraph, title: MRR_AGENTS_TITLE, description: MRR_AGENTS_DESCRIPTION },
  };
}

export default async function AgentRentPage() {
  if (mrrOnly()) return <MarketplaceGuide h1={MRR_AGENTS_H1} lede={MRR_AGENTS_LEDE} steps={MRR_AGENTS_STEPS} />;
  const desk = await getHashrateDesk();
  const out = composeRentalQuote(desk, undefined, MIN_HOURS);
  const quote = out.ok ? out.result : null;
  const free = quote ? quote.machines.filter((m) => m.machine.status === "available").length : 0;
  // B3: the direct bay grid (same bayBoard as list_available_rigs) when the direct desk is configured.
  const d = stagingDeps();
  const board = d ? await bayBoard(d).catch(() => null) : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="micro-label mb-3 text-[var(--text-tertiary)]">{BRAND_EYEBROW}</p>
        <h1 className="display-title">
          {AGENTS_H1_LEAD} <span className="headline-gradient">{AGENTS_H1_EM}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-[var(--text-secondary)]">{AGENTS_MASTHEAD}</p>

        <ConnectYourAi />

        <h2 className="mt-12 text-lg font-semibold text-[var(--text-primary)]">{AGENT_PAGE_MACHINES_TITLE}</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">{MACHINES_HOWTO}</p>
        {board ? (
          <div className="mt-4"><BayBoard board={board} title={AGENT_PAGE_MACHINES_TITLE} openLabel={BAY_OPEN} rentedLabel={BAY_RENTED} unavailableLabel={BAY_UNAVAILABLE} /></div>
        ) : quote ? (
          <>
            <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
              {MACHINES_SUMMARY.replace("{FREE}", String(free)).replace("{TOTAL}", String(quote.machines.length))}
            </p>
            {/* Status only. The how-to is the one line above, not repeated per row. */}
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {quote.machines.map((m) => (
                <li
                  key={m.machine.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-2 t-xs"
                >
                  <span className="font-mono text-[var(--text-secondary)]">
                    {m.machine.advertisedPh != null ? `${Math.round(m.machine.advertisedPh * 1000)} TH` : "SHA256 ASIC"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[m.machine.status] ?? "bg-[var(--text-tertiary)]"}`} />
                    {MACHINE_STATUS_LABEL[m.machine.status] ?? m.machine.status}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 text-sm text-[var(--text-tertiary)]">{RIG_SYNCING_NOTE}</p>
        )}

        <h2 className="mt-12 text-lg font-semibold text-[var(--text-primary)]">{AGENT_PAGE_SURFACES_TITLE}</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">{AGENT_PAGE_INTRO}</p>
        <div className="mt-4 space-y-3">
          {SURFACES.map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="rounded border border-[var(--accent)]/40 px-2 py-0.5 t-xs uppercase tracking-widest text-[var(--accent-ink)]">
                  {s.label}
                </span>
                <code className="min-w-0 basis-full break-all t-xs text-[var(--text-primary)] sm:basis-auto">{s.value}</code>
              </div>
              <p className="mt-2 t-xs text-[var(--text-tertiary)]">{s.note}</p>
              {s.label === "MCP" && (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {MCP_TOOLS.map((t) => (
                    <li key={t.name} className="t-xs text-[var(--text-secondary)]">
                      <code className="text-[var(--text-primary)]">{t.name}</code>
                      {" · "}
                      {t.does}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-lg font-semibold text-[var(--text-primary)]">{AGENT_SEQUENCE_TITLE}</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--text-secondary)]">
          {AGENT_SEQUENCE.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <p className="mt-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-secondary)]">
          {AGENT_CUSTODY_LINE}
        </p>
        <SupportLine support={supportInfo()} className="mt-8" />
      </main>
    </>
  );
}
