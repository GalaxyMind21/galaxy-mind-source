"use client";

import { useRef } from "react";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";

// Brand identities on each platform · kept for the fallback DM paths
// below. The primary route now goes through /submit, which is faster
// for vendors AND fits the new "paste handle, auto-enrich" UX.
const X_PROFILE_URL = "https://x.com/GalaxyMind";
const NOSTR_NPROFILE =
  "nprofile1qqspwnkez659yrnzx2fu4kzpngtkak7v3sdpuh6jw83key38xru5wrcny0sdm";
const NOSTR_PROFILE_URL = `https://primal.net/p/${NOSTR_NPROFILE}`;

export function SubmitVendorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Focus contract + Escape · shared hook (a11y 2026-06-12) replaces
  // the old standalone Escape listener.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(open, panelRef, onClose);

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
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-vendor-title"
            className="relative max-w-lg w-full rounded-2xl glass-sheet p-6 sm:p-8"
            initial={{ y: 12, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] transition-colors"
            >
              ×
            </button>

            <div className="text-center mb-5">
              <div
                className="inline-flex items-center gap-2 t-xs font-medium text-[var(--accent-ink)] glow-text mb-3"
                aria-hidden
              >
                <span>+</span>
                <span>Add a Vendor</span>
              </div>
              <h2
                id="submit-vendor-title"
                className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]"
              >
                Submit your shop
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mx-auto">
                Paste your handle · we auto-pull the rest from your public
                profile. 60-second onboarding. We review within 24-48 hours.
              </p>
            </div>

            {/* Primary path · /submit form. The big orange button. */}
            <a
              href="/submit"
              onClick={() => track("submit_vendor_open_form")}
              className="block w-full text-center font-mono text-sm uppercase tracking-[0.25em] font-semibold py-3.5 rounded-lg bg-[var(--accent)] text-black hover:bg-[var(--accent-hover)] hover:lit-primary transition-all mb-4"
            >
              Open the submit form →
            </a>

            {/* Fallback paths · for vendors who'd rather DM. Smaller,
                clearly secondary so the form is the obvious default. */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60 p-4">
              <div className="t-xs text-[var(--text-tertiary)] mb-2">
                Or DM us directly
              </div>
              <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                Tell us your handle, what you sell, and your country.
                We&apos;ll add you to the form on your behalf.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={X_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("submit_vendor_dm_x")}
                  className="micro-label text-center py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-colors"
                >
                  DM on X →
                </a>
                <a
                  href={NOSTR_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("submit_vendor_dm_nostr")}
                  className="micro-label text-center py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-colors"
                >
                  DM on Nostr →
                </a>
              </div>
            </div>

            <p className="micro-label mt-5 text-center text-[var(--text-tertiary)]">
              Manually verified · directory stays trustworthy
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
