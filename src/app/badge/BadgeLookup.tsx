"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VENDOR_BADGE } from "@/lib/vendors";
import { VendorBadgeEmbed } from "@/components/VendorBadgeEmbed";

export type BadgeRosterItem = {
  name: string;
  handle: string;
  slug: string;
  display: string;
};

function score(q: string, v: BadgeRosterItem): number {
  const n = q.toLowerCase().replace(/^@+/, "").trim();
  if (!n) return 0;
  const name = v.name.toLowerCase();
  const handle = v.handle.toLowerCase();
  const slug = v.slug.toLowerCase();
  if (handle === n || slug === n) return 100;
  if (name === n) return 95;
  if (handle.startsWith(n) || slug.startsWith(n) || name.startsWith(n))
    return 80;
  if (handle.includes(n) || slug.includes(n) || name.includes(n)) return 50;
  return 0;
}

/** HTML twin of the live SVG · preview-only, not the embed. */
function BadgeMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex overflow-hidden rounded-[3px] font-mono t-xs leading-none shadow-[0_1px_2px_rgba(0,0,0,0.12)] ${className ?? ""}`}
    >
      <span className="bg-[#1C1A16] px-2.5 py-[7px] text-[#F2EFE9]">
        {VENDOR_BADGE.label}
      </span>
      <span className="bg-[var(--accent)] px-2.5 py-[7px] font-bold text-black">
        {VENDOR_BADGE.live}
      </span>
    </span>
  );
}

/**
 * Typical merchant site is light. Hardcoded so our theme toggle
 * does not restyle "their" shop.
 */
function ShopFrame({ shopName }: { shopName: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] nb-seated">
      <div className="flex items-center gap-3 bg-[#1C1C21] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2 rounded-full bg-[#3a3a40]" />
          <span className="size-2 rounded-full bg-[#3a3a40]" />
          <span className="size-2 rounded-full bg-[#3a3a40]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-center font-sans t-xs text-[#F2EFE9]">
          {shopName}
        </span>
        <span className="hidden sm:inline shrink-0 t-xs font-medium text-[var(--text-tertiary)]">
          your site
        </span>
      </div>
      <div className="bg-[#f4f4f6] px-5 py-5">
        <div className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="size-10 shrink-0 rounded-md bg-[#ececf0]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2 w-2/3 rounded-full bg-[#d8d8de]" />
            <div className="h-2 w-1/3 rounded-full bg-[#e4e4ea]" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e4ea] bg-white px-5 py-3.5">
        <span className="micro-label text-[#6b6b76]">
          Pay with
        </span>
        <BadgeMark />
      </div>
    </div>
  );
}

const PITCH = [
  {
    k: "Visible",
    v: "Shoppers see they can pay with bitcoin without hunting through the page.",
  },
  {
    k: "Checkable",
    v: "A click opens your Galaxy Mind listing, so they can confirm a person here checked that you take bitcoin.",
  },
  {
    k: "Honest",
    v: "If a human has not re-checked you recently it flips to check listing, never a stale green.",
  },
] as const;

export function BadgeLookup({ roster }: { roster: BadgeRosterItem[] }) {
  const params = useSearchParams();
  const preset = (params.get("v") ?? params.get("q") ?? "").trim();
  const [query, setQuery] = useState(preset);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return roster
      .map((v) => ({ v, s: score(q, v) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
      .slice(0, 8)
      .map((x) => x.v);
  }, [query, roster]);

  const selected = matches[0] ?? null;

  return (
    <div className="mt-10">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5">
          <label
            htmlFor="badge-shop-search"
            className="block t-xs font-medium text-[var(--text-tertiary)] mb-2"
          >
            Find your shop
          </label>
          <input
            id="badge-shop-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Shop name or @handle"
            autoComplete="off"
            autoFocus={Boolean(preset)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
          />

          {!query.trim() && (
            <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed">
              Type the name on your listing. Copy the HTML. Paste it in
              your footer or next to checkout.
            </p>
          )}

          {query.trim() && matches.length === 0 && (
            <p className="mt-4 t-xs text-[var(--text-secondary)] leading-relaxed">
              No listed shop matches that. If you take bitcoin for an actual
              good,{" "}
              <a
                href="/submit"
                className="whitespace-nowrap text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                submit the shop
              </a>{" "}
              and we will send the badge when you go live.
            </p>
          )}

          {matches.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {matches.map((v) => (
                <li key={v.slug}>
                  <button
                    type="button"
                    onClick={() => setQuery(v.name)}
                    className={`rounded-full border px-3 py-1.5 font-mono t-xs ${
                      selected?.slug === v.slug
                        ? "border-[var(--accent)] text-[var(--accent-ink)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]"
                    }`}
                  >
                    {v.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <ShopFrame shopName={selected?.name ?? "Your shop"} />
          <p className="mt-2.5 t-xs font-medium text-[var(--text-tertiary)]">
            On a typical checkout
          </p>
        </div>
      </div>

      {selected && (
        <div className="mt-8">
          <VendorBadgeEmbed
            slug={selected.slug}
            name={selected.name}
            eyebrow={`${selected.name} · copy this`}
            showBenefits={false}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5"
          />
        </div>
      )}

      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        {PITCH.map((c) => (
          <div
            key={c.k}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="micro-label mb-2 text-[var(--accent-ink)]">
              {c.k}
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {c.v}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
