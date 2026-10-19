"use client";

import { useEffect, useRef, useState } from "react";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import { INDEPENDENCE_CLAIM } from "@/lib/listing";

// Lightning address payouts route here. To switch wallets later, change
// this single value — the QR regenerates and the deep link follows.
const LN_ADDRESS = "nebularkitty289@walletofsatoshi.com";
// `lightning:` prefix is the standard URI scheme that triggers wallet
// deep-linking on mobile and (with most camera apps) parses correctly
// when scanned. Modern wallets (Wallet of Satoshi, Phoenix, Strike,
// Cash App, Zeus, etc.) all handle the lightning-address form natively.
const LN_URI = `lightning:${LN_ADDRESS}`;

export function SupportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Generate the QR client-side, lazily, the first time the modal opens.
  // Dynamic import keeps the qrcode bundle out of the initial JS payload.
  useEffect(() => {
    if (!open || qrDataUrl) return;
    (async () => {
      try {
        const QRCode = await import("qrcode");
        const url = await QRCode.toDataURL(LN_URI, {
          width: 600,
          margin: 2,
          errorCorrectionLevel: "M",
          // Scanner value, not a brand value — it only has to be dark
          // enough for a reader to threshold (19.4:1 on white here, far
          // above what the QR reflectance rule needs). It matches the
          // page ground because that looks intentional in the modal, not
          // because the ramp requires it.
          color: { dark: "#12110F", light: "#FFFFFF" },
        });
        setQrDataUrl(url);
      } catch {
        // If qrcode fails (offline, blocked), the modal still shows the
        // address text + copy button as the fallback path.
      }
    })();
  }, [open, qrDataUrl]);

  // Focus contract + Escape · shared hook (a11y 2026-06-12) replaces
  // the old standalone Escape listener.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(open, panelRef, onClose);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(LN_ADDRESS);
      setCopied(true);
      track("support_copy_address");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older browsers / blocked clipboard — degrade silently.
    }
  }

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
            aria-labelledby="support-title"
            className="relative max-w-md w-full rounded-2xl glass-sheet p-6 sm:p-8"
            initial={{ y: 12, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
          >
            {/* Close (top-right) */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] transition-colors"
            >
              ×
            </button>

            {/* Header */}
            <div className="text-center mb-5">
              <h2
                id="support-title"
                className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]"
              >
                Support Galaxy Mind
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mx-auto">
                Everything here is free and stays free.{" "}
                {INDEPENDENCE_CLAIM} Nothing on this site for sale.
              </p>
            </div>

            {/* DEMOTED 2026-08-13 · this used to LEAD with a rent-hashrate
                card in the lottery register ("a real shot at finding a whole
                block", "See the odds and prices"), which made the site's
                support dialog a sales page for the house product. Zapping
                leads now, and the rental is a plain one-line footnote below
                the QR. See the register note in lib/hashrate-copy. */}
            <p className="mt-2 mb-3 text-center t-xs font-medium text-[var(--text-tertiary)]">
              ⚡ Zap a few sats
            </p>

            {/* QR card */}
            <div className="mx-auto rounded-xl bg-white p-3 w-fit border border-[var(--border-subtle)]">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={`Lightning QR for ${LN_ADDRESS}`}
                  width={168}
                  height={168}
                  className="block"
                />
              ) : (
                <div className="w-40 h-40 flex items-center justify-center text-[var(--text-tertiary)] text-xs font-mono">
                  generating QR…
                </div>
              )}
            </div>

            {/* Address row */}
            <div className="mt-5 flex items-stretch rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] overflow-hidden">
              <div
                className="flex-1 min-w-0 px-3 py-2.5 font-mono t-xs sm:text-xs text-[var(--text-primary)] truncate flex items-center"
                title={LN_ADDRESS}
              >
                {LN_ADDRESS}
              </div>
              <button
                onClick={handleCopy}
                className="px-3 sm:px-4 font-mono text-[12px] sm:text-[12px] uppercase tracking-widest text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 border-l border-[var(--border-subtle)] transition-colors"
                aria-label="Copy Lightning address"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Open in wallet (mobile-first deep link) */}
            <span aria-live="polite" className="sr-only">
              {copied ? "Lightning address copied" : ""}
            </span>

            <a
              href={LN_URI}
              onClick={() => track("support_open_wallet")}
              className="micro-label mt-3 flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--accent)] text-center font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent)]/10"
            >
              ⚡ Open in Wallet
            </a>

            <p className="micro-label mt-5 text-center text-[var(--text-tertiary)]">
              Payments settle wallet-to-wallet · we never see or hold your funds
            </p>

            {/* The rental, as a plain footnote rather than the lead. */}
            <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
              We also{" "}
              <a
                href="/hashrate"
                onClick={() => {
                  track("support_rent_hashrate");
                  onClose();
                }}
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                rent out ASIC hashrate by the day
              </a>
              , which is how the site covers its costs.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
