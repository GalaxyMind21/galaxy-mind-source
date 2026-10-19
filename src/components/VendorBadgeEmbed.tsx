"use client";

import { useState } from "react";
import { vendorBadgeAlt, vendorBadgeSnippet } from "@/lib/vendors";
import { BADGE_BENEFITS } from "@/lib/badge-outreach";

/**
 * Merchant self-serve card · preview + paste snippet + why it exists.
 * Client for the copy button; safe to import from /v and the modal.
 */
export function VendorBadgeEmbed({
  slug,
  name,
  className,
  eyebrow,
  showBenefits = true,
}: {
  slug: string;
  name: string;
  className?: string;
  eyebrow?: string;
  showBenefits?: boolean;
}) {
  const snippet = vendorBadgeSnippet(slug);
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied · the pre is still select-all */
    }
  }

  return (
    <div
      id="badge"
      className={
        className ??
        "mb-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4 sm:p-5"
      }
    >
      <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
        {eyebrow ?? "Run this shop? Show you take bitcoin"}
      </div>
      <p className="t-xs font-sans text-[var(--text-secondary)] leading-relaxed mb-3">
        Paste this in your footer or next to checkout.
      </p>
      {showBenefits && (
        <ul className="mb-3 list-disc space-y-1 pl-5 t-xs text-[var(--text-secondary)] leading-relaxed">
          {BADGE_BENEFITS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/badge/vendor/${slug}`}
        alt={vendorBadgeAlt(name)}
        height={24}
        className="mb-3"
      />
      <div className="relative">
        <pre className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] px-4 py-4 pr-24 t-xs leading-relaxed text-[var(--cool-ink)] select-all">
{snippet}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          className="absolute top-2 right-2 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] t-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
          aria-label={copied ? "Copied to clipboard" : "Copy badge snippet"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
