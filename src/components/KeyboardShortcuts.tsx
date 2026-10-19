"use client";

/* =====================================================================
 * KeyboardShortcuts · global power-user navigation layer
 *
 * Listens for keypresses on the document and provides:
 *   ?          → toggle the help modal
 *   g h        → navigate to /
 *   g s        → navigate to /stack
 *   g f        → navigate to /float
 *   g t        → navigate to /treasuries
 *   g i        → navigate to /fit (i for "investments" · g f is taken)
 *   g v        → focus the vendor search on / (if present)
 *   Escape     → close the modal
 *
 * Mounted once in the root layout. Skips when the user is typing in
 * an input/textarea/contenteditable so it never hijacks typing.
 *
 * The `g _` two-step is the GitHub-style "leader key" pattern · feels
 * natural to keyboard-heavy users and avoids single-letter conflicts.
 *
 * Why: power users (the kind who'd retweet a tool to other power
 * users, the most viral kind of visitor) reward keyboard navigation
 * heavily. The cost is one tiny client bundle add; the upside is
 * making the site feel "real" to the segment most likely to share it.
 *
 * No analytics on individual presses (would be noisy); we fire one
 * event the first time the help modal opens per session as a coarse
 * adoption signal.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import { useModalA11y } from "@/lib/use-modal-a11y";

// Window inside which a `g` press waits for the second key. After
// this elapses the "leader" state resets · prevents stale state if
// the user wandered off mid-sequence.
const LEADER_TIMEOUT_MS = 1500;

type Jump = {
  key: string;
  href?: string;
  action?: "search";
  label: string;
};

const JUMPS: Jump[] = [
  { key: "h", href: "/", label: "Home · vendor directory" },
  { key: "s", href: "/stack", label: "Buying Gauge" },
  { key: "f", href: "/float", label: "Bitcoin Float" },
  { key: "t", href: "/treasuries", label: "Treasury scoreboard" },
  { key: "i", href: "/fit", label: "Allocation engine (Fit)" },
  { key: "v", action: "search", label: "Focus vendor search (on /)" },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [trackedThisSession, setTrackedThisSession] = useState(false);

  const openModal = useCallback(() => {
    setModalOpen(true);
    if (!trackedThisSession) {
      track("keyboard_shortcuts_opened");
      setTrackedThisSession(true);
    }
  }, [trackedThisSession]);

  // a11y (2026-07-25): this dialog declared role="dialog" aria-modal="true"
  // but did NOTHING that aria-modal promises — no focus move, no Tab trap,
  // no focus restore, no scroll lock. A screen reader was told to hide the
  // background while DOM focus stayed ON it, so an AT user was stranded in
  // content their reader refused to announce (the exact problem
  // useModalA11y was extracted to solve for the other four dialogs).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeModal = useCallback(() => setModalOpen(false), []);
  useModalA11y(modalOpen, panelRef, closeModal);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let leaderActive = false;
    let leaderTimer: number | null = null;

    function clearLeader() {
      leaderActive = false;
      if (leaderTimer !== null) {
        window.clearTimeout(leaderTimer);
        leaderTimer = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      // Never hijack while typing.
      if (isTypingTarget(e.target)) return;
      // Modifier keys mean the user is doing something else (cmd+S
      // save, ctrl+R refresh, etc.) · stay out of the way.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      // Escape closes the modal.
      if (e.key === "Escape") {
        if (modalOpen) {
          setModalOpen(false);
          e.preventDefault();
        }
        clearLeader();
        return;
      }

      // "?" toggles the help modal · `?` is shift+/ on US keyboards
      // so we check both the key value and e.shiftKey for resilience.
      if (e.key === "?" || (e.shiftKey && key === "/")) {
        if (modalOpen) setModalOpen(false);
        else openModal();
        e.preventDefault();
        return;
      }

      // GATE the jump shortcuts while the help dialog is open (2026-07-25).
      // An aria-modal dialog must own interaction; `g h` firing behind it
      // navigated the page out from under an open modal (and for an AT
      // user, out of the only region their reader was announcing).
      // Escape and `?` above stay live — those are how you leave.
      if (modalOpen) {
        clearLeader();
        return;
      }

      // Leader-key sequence: `g` then a destination letter.
      if (!leaderActive && key === "g") {
        leaderActive = true;
        leaderTimer = window.setTimeout(clearLeader, LEADER_TIMEOUT_MS);
        e.preventDefault();
        return;
      }

      if (leaderActive) {
        const jump = JUMPS.find((j) => j.key === key);
        clearLeader();
        if (jump) {
          if (jump.href) {
            router.push(jump.href);
          } else if (jump.action === "search") {
            // Try to focus the homepage search input. If not on /,
            // navigate to / and then the search will be discoverable
            // via the normal UI.
            const input = document.querySelector<HTMLInputElement>(
              "input[type='search'], input[placeholder*='Search' i]",
            );
            if (input) {
              input.focus();
              input.select();
            } else {
              router.push("/");
            }
          }
          e.preventDefault();
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearLeader();
    };
  }, [modalOpen, openModal, router]);

  if (!modalOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-scrim"
      onClick={() => setModalOpen(false)}
    >
      <div
        ref={panelRef}
        // tabIndex -1 so useModalA11y can move focus here on open (the
        // panel is the trap's anchor, same as the other four dialogs).
        tabIndex={-1}
        className="w-full max-w-md rounded-xl glass-sheet p-5 sm:p-6 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="t-xs font-medium text-[var(--accent-ink)] mb-1">
              ⌬ Keyboard
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Quick navigation
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <ul className="space-y-2.5">
          {JUMPS.map((j) => (
            <li
              key={j.key}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm text-[var(--text-secondary)]">
                {j.label}
              </span>
              <span className="flex items-center gap-1 font-mono t-xs tracking-widest text-[var(--text-tertiary)] shrink-0">
                <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] text-[var(--text-primary)]">
                  g
                </kbd>
                <span>then</span>
                <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] text-[var(--text-primary)]">
                  {j.key}
                </kbd>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--text-secondary)]">
            Show this menu
          </span>
          <kbd className="font-mono t-xs tracking-widest px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] text-[var(--text-primary)]">
            ?
          </kbd>
        </div>

        <p className="micro-label mt-4 text-[var(--text-tertiary)] text-center">
          Press <kbd className="px-1 py-0.5 border border-[var(--border-subtle)] rounded text-[var(--text-secondary)] tracking-normal">Esc</kbd> to dismiss
        </p>
      </div>
    </div>
  );
}
