"use client";

/* =====================================================================
 * CommandPalette · the ⌘K jump-anywhere layer (B5 · 2026-07-07)
 *
 * The site's aesthetic is "premium fintech meets BT command-line" ·
 * this is the feature that pays the command-line promise off. One
 * keystroke from any page: fuzzy-jump to any vendor, any tool page,
 * any glossary term.
 *
 * Architecture · two files on purpose:
 *   - THIS file is the featherweight always-mounted shell: the ⌘K /
 *     Ctrl+K listener and an open/close flag. It imports nothing
 *     heavy, so mounting it in the root layout costs every page a
 *     few hundred bytes, not the vendor roster.
 *   - CommandPaletteBody (dynamic import, ssr:false) carries the
 *     real weight: VENDORS (~120 entries), the glossary index, and
 *     the fuzzy scorer from lib/vendor-filter. It loads on FIRST
 *     open and stays warm after.
 *
 * The trigger ALSO listens for a custom "gm:palette" event so the
 * SiteHeader search button can open it without prop-drilling through
 * the server layout.
 * ===================================================================== */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { track } from "@vercel/analytics";

const CommandPaletteBody = dynamic(
  () => import("@/components/CommandPaletteBody").then((m) => m.CommandPaletteBody),
  { ssr: false },
);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  // Once opened, keep the body mounted (hidden) so re-opening is
  // instant and the input keeps focus behavior predictable.
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) track("palette_open", { via: "keyboard" });
          return !v;
        });
        setEverOpened(true);
      }
    }
    function onCustom() {
      setOpen(true);
      setEverOpened(true);
      track("palette_open", { via: "button" });
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("gm:palette", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gm:palette", onCustom);
    };
  }, []);

  if (!everOpened) return null;
  return <CommandPaletteBody open={open} onClose={() => setOpen(false)} />;
}
