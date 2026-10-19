"use client";

/* =====================================================================
 * useModalA11y · shared keyboard/focus contract for every dialog
 * (a11y 2026-06-12).
 *
 * Before this hook none of the four modals (SubmitVendorModal,
 * AssetDetailModal, VendorDetailModal, SupportModal) moved focus.
 * With aria-modal="true" telling the screen reader to hide the
 * background while DOM focus stayed ON that background, an AT user
 * was left focused inside content their reader refused to announce ·
 * effectively lost. Tab walked the entire hidden page before ever
 * reaching the dialog.
 *
 * On open:  remembers the trigger element, moves focus to the panel
 *           (give the panel tabIndex={-1}), locks body scroll.
 * While open: traps Tab/Shift+Tab inside the panel's focusables and
 *           closes on Escape (pass onClose; modals with their own
 *           Escape listener should drop it · one source of truth).
 * On close: restores body scroll and returns focus to the trigger.
 *
 * Plain hook, zero dependencies, by design · a focus-trap library is
 * overkill for four structurally identical dialogs.
 * ===================================================================== */

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

export function useModalA11y(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  // onClose lives in a ref, NOT in the effect deps (fixed 2026-07-25).
  //
  // Every call site passes a freshly-created inline arrow, so `onClose`
  // was a new identity on every parent render. With it in the dep array
  // the whole effect tore down and re-ran WHILE the dialog was open:
  // cleanup restored focus to the trigger, then setup re-ran
  // `panel.focus()`. Any parent re-render (a filter tick, a live-price
  // poll) therefore yanked focus off whatever the user was typing in or
  // tabbing to, back onto the panel — and the re-run also re-read
  // `document.activeElement` as the "trigger", so the remembered restore
  // target drifted to whatever happened to be focused mid-dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const p = panelRef.current;
      if (!p) return;
      const focusables = p.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) {
        // Nothing focusable · keep focus pinned to the panel itself.
        e.preventDefault();
        p.focus({ preventScroll: true });
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === p)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!p.contains(active)) {
        // Focus escaped (e.g. browser chrome round-trip) · pull it back.
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      // Return focus to whatever opened the dialog · skip if the
      // trigger left the DOM (e.g. filtered-out vendor card).
      if (trigger && document.contains(trigger)) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef]);
}
