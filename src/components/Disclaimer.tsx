"use client";

import { motion, AnimatePresence } from "framer-motion";
import { FooterMaxim } from "@/components/FooterMaxim";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { stripLocalePrefix } from "@/lib/i18n";
import { useT } from "@/components/LocaleProvider";

export const DISCLAIMER_TEXT = `Not Financial Advice. Galaxy Mind is an educational tool that maps user-stated preferences to publicly traded Bitcoin and Bitcoin-adjacent securities. Nothing here is investment advice, tax advice, or a solicitation to buy or sell any security. The author is not a registered investment advisor. Asset profiles are simplified models; actual risk, yield, and tax treatment depend on your specific circumstances and may change. Bitcoin and related securities can lose substantial value. Return-of-Capital dividend treatment is not guaranteed and depends on issuer reporting. Consult a licensed advisor and tax professional before making investment decisions.`;

function isFinancePath(path: string): boolean {
  return (
    path.startsWith("/stack") ||
    path.startsWith("/fit") ||
    path.startsWith("/treasuries") ||
    path.startsWith("/float") ||
    path.startsWith("/should-i-buy") ||
    path.startsWith("/is-it-too-late") ||
    path.startsWith("/ibit-vs-") ||
    path.startsWith("/mstr-vs-") ||
    path.startsWith("/gross-vs-net") ||
    path.startsWith("/what-is-amplification") ||
    path.startsWith("/cheapest-bitcoin-treasury") ||
    path.startsWith("/bitcoin-treasuries") ||
    path.startsWith("/is-")
  );
}

export function DisclaimerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 glass-scrim"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disc-title"
            className="relative max-w-xl w-full rounded-xl glass-sheet p-6"
            initial={{ y: 8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div
              className="absolute top-0 left-6 right-6 h-px"
              style={{ background: "var(--accent)" }}
            />
            <h2
              id="disc-title"
              className="text-sm font-semibold tracking-[0.18em] uppercase text-[var(--accent-ink)] glow-text mb-3"
            >
              Not Financial Advice
            </h2>
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
              {DISCLAIMER_TEXT.replace(/^Not Financial Advice\. /, "")}
            </p>
            <button
              onClick={onClose}
              className="mt-5 px-4 py-1.5 text-xs uppercase tracking-widest border border-[var(--border-subtle)] rounded-md hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FooterDisclaimer() {
  const pathname = stripLocalePrefix(usePathname() ?? "/");
  const { t } = useT();
  const body = isFinancePath(pathname)
    ? DISCLAIMER_TEXT.replace(/^Not Financial Advice\. /, "")
    : t("footer.directoryDisclaimer");
  return (
    <footer
      className="mt-24 border-t pt-6 pb-12 text-xs leading-relaxed text-[var(--text-secondary)]"
      style={{ borderColor: "rgba(247,147,26,0.18)" }}
    >
      <div className="max-w-3xl mx-auto px-4">
        {/* Cross-link strip: about + faq + nav. Lives ABOVE the
            disclaimer text so users see the "what is this?" answer
            before the legalese. Quiet styling · these are
            informational links, not CTAs. */}
        <nav
          aria-label="Site links"
          className="micro-label flex flex-wrap items-center gap-x-4 gap-y-0 mb-4"
        >
          <a
            href="/about"
            className="inline-flex items-center min-h-11 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            {t("footer.about")}
          </a>
          <a
            href="/faq"
            className="inline-flex items-center min-h-11 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            {t("footer.faq")}
          </a>
          <a
            href="/embed"
            className="inline-flex items-center min-h-11 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            {t("footer.embed")}
          </a>
          {/* Closes the /nostr-vendors orphan · it was in the sitemap with
              zero inbound internal links (SEO audit 2026-05-30). This
              global footer gives it a site-wide inbound edge. */}
          <a
            href="/nostr-vendors"
            className="inline-flex items-center min-h-11 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            {t("footer.nostr")}
          </a>
          <a
            href="https://x.com/GalaxyMind"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center min-h-11 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            X →
          </a>
        </nav>

        <FooterMaxim />

        <span className="text-[var(--accent-ink)] font-semibold tracking-wider uppercase">
          {t("footer.nfa")}
        </span>{" "}
        {body}
      </div>
    </footer>
  );
}
