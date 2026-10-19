"use client";

/* =====================================================================
 * CommandPaletteBody · the heavy half of the ⌘K palette.
 *
 * Loaded via dynamic import on first open (see CommandPalette.tsx) so
 * the vendor roster + glossary index never ride in a page's initial
 * bundle. Reuses searchScore from lib/vendor-filter · the SAME fuzzy
 * scorer the homepage grid uses, guards and all, so palette results
 * can never disagree with directory search.
 *
 * Result model: one flattened, keyboard-navigable list built from
 * three groups (Tools & pages / Vendors / Glossary). ArrowUp/Down
 * walk entries only. Enter (or click) navigates via next/router.
 * Escape or backdrop click closes.
 *
 * A11y (review 2026-07-07): the palette follows the combobox pattern
 * strictly · DOM focus NEVER leaves the input. Options are
 * non-tabbable divs (role="option") tracked via aria-activedescendant,
 * wrapped in labelled role="group" sections so AT announces the
 * grouping sighted users see. useModalA11y · the same contract as
 * every other dialog · traps Tab (the input is the only focusable),
 * closes on Escape at the document level, and returns focus to the
 * trigger (SiteHeader ⌕ button) on close.
 * ===================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import { VENDORS, vendorSlug, getDisplayHandle } from "@/lib/vendors";
import { searchScore, SEARCH_THRESHOLD } from "@/lib/vendor-filter";
import { ALL_TERMS } from "@/lib/glossary";
import { NAV_SUB } from "@/lib/hashrate-copy";
import { useModalA11y } from "@/lib/use-modal-a11y";

type Entry = {
  id: string;
  group: "Tools & pages" | "Vendors" | "Glossary";
  label: string;
  sub?: string;
  href: string;
};

// Static page index · label + extra match keywords. Kept to the
// pages a visitor plausibly wants to JUMP to (not every catalyst
// permalink · those surface through search engines, not navigation).
const PAGES: { label: string; href: string; keywords: string; sub?: string }[] = [
  { label: "Vendor directory", href: "/", keywords: "spend home merchants directory shop", sub: "Spend bitcoin" },
  { label: "Today in Bitcoin", href: "/today", keywords: "daily briefing numbers today", sub: "The daily briefing" },
  { label: "Merchants Map", href: "/map", keywords: "map atlas countries merchants world", sub: "Circular economy atlas" },
  { label: "Buying Gauge", href: "/stack", keywords: "should i buy stack gauge score signals", sub: "Should I buy?" },
  { label: "Bitcoin Float", href: "/float", keywords: "supply left clock float remaining", sub: "How much is left?" },
  { label: "Treasuries", href: "/treasuries", keywords: "mnav mstr metaplanet xxi asst treasury", sub: "mNAV head-to-head" },
  { label: "Bitcoin Fit", href: "/fit", keywords: "allocation engine portfolio how much to own", sub: "Allocation engine" },
  { label: "Submit your shop", href: "/submit", keywords: "add vendor submit listing", sub: "Get listed" },
  { label: "Spend and replace", href: "/spend-and-replace", keywords: "circular economy replace time machine", sub: "The thesis + calculator" },
  { label: "Online stores that accept bitcoin", href: "/online-stores-that-accept-bitcoin", keywords: "online stores accept bitcoin list websites take shops", sub: "The full verified list" },
  { label: "Rent hashrate", href: "/hashrate", keywords: "rent hashrate mining miner rig block solo prize sha256 shot block shot hashrate desk s21 asic rental usa hardware pool wallet", sub: NAV_SUB },
  { label: "How to rent hashrate", href: "/hashrate/how-to-rent", keywords: "how to rent hashrate first time setup pool access code", sub: "Step-by-step first rental" },
  { label: "Rent as an agent", href: "/hashrate/agents", keywords: "agent mcp quote rental api get_rental_quote", sub: "Quote + handoff for AI agents" },
  { label: "Solo mining odds", href: "/solo-mining-calculator", keywords: "solo mining calculator odds block chance hashrate", sub: "Odds of finding a block" },
  { label: "The Arcade", href: "/arcade", keywords: "games arcade play cabinets daily", sub: "Eight bitcoin games, one door" },
  { label: "WEN", href: "/wen", keywords: "wen daily puzzle chart date guess arcade", sub: "Date the tape · 30 seconds" },
  { label: "Bitcoin Kart", href: "/bitcoin-kart", keywords: "kart racer 3d race daily circuit ghost arcade game", sub: "Full 3D kart racer" },
  { label: "The HODL Trail", href: "/trail", keywords: "trail expedition daily plebs history arcade game", sub: "The daily expedition" },
  { label: "CHOP", href: "/chop", keywords: "chop slice block beat saber fruit ninja rhythm arcade game", sub: "Slice the live chain" },
  { label: "Weekly Pulse", href: "/pulse", keywords: "weekly pulse archive snapshot week", sub: "What happened this week" },
  { label: "The Bitcoin Gauntlet", href: "/gauntlet", keywords: "game play arcade gauntlet daily trade history hodl", sub: "Beat the DCA bot" },
  { label: "Super Saylor", href: "/super-saylor", keywords: "saylor mario platformer game arcade schiff 21 rules one chair flagship", sub: "The flagship · 21 levels of bitcoin history" },
  { label: "Node Runner", href: "/runner", keywords: "runner arcade tape surf jump dino game", sub: "One tap · to the moon" },
  { label: "Timechain", href: "/horizon", keywords: "game timechain blocks stack halving arcade", sub: "One-tap block stacker" },
  { label: "Halving countdown", href: "/bitcoin-halving-countdown", keywords: "halving countdown blocks", sub: "Days + blocks" },
  { label: "Embed widgets", href: "/embed", keywords: "embed widget gauge clock badge", sub: "Gauge + Supply Clock" },
  { label: "Verified badge", href: "/badge", keywords: "badge verified merchant embed shop accepts bitcoin", sub: "For listed shops" },
  { label: "Glossary", href: "/glossary", keywords: "definitions terms vocabulary", sub: "Bitcoin vocabulary" },
  { label: "How to buy bitcoin", href: "/how-to-buy-bitcoin", keywords: "buy beginner exchange dca wallet seed books p2p", sub: "Beginner guide" },
  { label: "How to accept bitcoin", href: "/how-to-accept-bitcoin", keywords: "merchant accept btcpay lightning", sub: "For merchants" },
  { label: "System status", href: "/status", keywords: "status health uptime signals", sub: "Radical transparency" },
  { label: "About", href: "/about", keywords: "about mission who", sub: "What this is" },
  { label: "FAQ", href: "/faq", keywords: "questions faq help", sub: "Common questions" },
  { label: "Methodology", href: "/methodology", keywords: "methodology how calculated sources", sub: "Check the math" },
];

function pageMatches(q: string, p: (typeof PAGES)[number]): boolean {
  const hay = (p.label + " " + p.keywords).toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

export function CommandPaletteBody({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape + focus-restore-to-trigger · one contract for
  // every dialog on the site. The hook focuses the panel; the rAF
  // focus below then lands on the input, which stays the single tab
  // stop (options are deliberately not focusable).
  useModalA11y(open, panelRef, onClose);

  // Reset + focus on every open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // rAF so the element exists before focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim();
    const out: Entry[] = [];

    // Pages · empty query shows the core five as the "menu".
    const pages = q
      ? PAGES.filter((p) => pageMatches(q, p)).slice(0, 5)
      : PAGES.slice(0, 6);
    for (const p of pages) {
      out.push({
        id: `p:${p.href}`,
        group: "Tools & pages",
        label: p.label,
        sub: p.sub,
        href: p.href,
      });
    }

    // Vendors · fuzzy via the directory's own scorer. Empty query
    // shows nothing here (120 rows of noise otherwise).
    if (q) {
      const scored = VENDORS.map((v) => ({ v, s: searchScore(v, q) }))
        .filter((x) => x.s >= SEARCH_THRESHOLD)
        .sort((a, b) => b.s - a.s)
        .slice(0, 6);
      for (const { v } of scored) {
        out.push({
          id: `v:${v.handle}`,
          group: "Vendors",
          label: v.name,
          sub: getDisplayHandle(v),
          href: `/v/${vendorSlug(v)}`,
        });
      }
    }

    // Glossary · substring on term names.
    if (q) {
      const ql = q.toLowerCase();
      const terms = ALL_TERMS.filter((t) =>
        t.term.toLowerCase().includes(ql),
      ).slice(0, 4);
      for (const t of terms) {
        out.push({
          id: `g:${t.slug}`,
          group: "Glossary",
          label: t.term,
          sub: "Definition",
          href: `/glossary/${t.slug}`,
        });
      }
    }

    return out;
  }, [query]);

  // Clamp highlight when the result set shrinks.
  useEffect(() => {
    if (highlight >= entries.length) setHighlight(0);
  }, [entries.length, highlight]);

  function go(entry: Entry) {
    track("palette_go", { group: entry.group, href: entry.href });
    onClose();
    router.push(entry.href);
  }

  // Escape is handled by useModalA11y at the document level · one
  // source of truth, and it works even if focus somehow leaves the
  // input. Arrows/Enter live here because focus is always the input.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (entries.length ? (h + 1) % entries.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) =>
        entries.length ? (h - 1 + entries.length) % entries.length : 0,
      );
    } else if (e.key === "Enter" && entries[highlight]) {
      e.preventDefault();
      go(entries[highlight]);
    }
  }

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!open) return null;

  // Group for rendering while PRESERVING each entry's flat index ·
  // the keyboard highlight walks the flat list.
  const groups: { name: Entry["group"]; items: { entry: Entry; idx: number }[] }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tail = groups[groups.length - 1];
    if (!tail || tail.name !== entry.group) {
      groups.push({ name: entry.group, items: [{ entry, idx: i }] });
    } else {
      tail.items.push({ entry, idx: i });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Jump anywhere"
    >
      <div
        className="absolute inset-0 glass-scrim"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-xl glass-sheet overflow-hidden focus:outline-none"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 border-b border-[var(--border-subtle)]">
          <span
            aria-hidden
            className="font-mono text-sm text-[var(--accent-ink)]"
          >
            ›
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a vendor, tool, or term..."
            aria-label="Search vendors, pages, and glossary terms"
            role="combobox"
            aria-expanded={entries.length > 0}
            aria-controls="gm-palette-list"
            aria-activedescendant={
              entries[highlight] ? `gm-opt-${entries[highlight].id}` : undefined
            }
            className="flex-1 min-w-0 bg-transparent py-3.5 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          <kbd className="hidden sm:inline t-xs text-[var(--text-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          id="gm-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto py-2"
        >
          {entries.length === 0 && (
            <div className="px-4 py-6 font-mono text-xs text-[var(--text-tertiary)] text-center">
              No matches · try a vendor name, page, or metric
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div
                className="px-4 pt-3 pb-1 t-xs font-medium text-[var(--text-tertiary)]"
                aria-hidden
              >
                {group.name}
              </div>
              {group.items.map(({ entry, idx }) => (
                /* Options are non-tabbable divs, not buttons · DOM
                   focus stays on the input (combobox pattern) and the
                   focus trap has exactly one stop. */
                <div
                  key={entry.id}
                  id={`gm-opt-${entry.id}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === highlight}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => go(entry)}
                  className={`w-full text-left px-4 py-2 flex items-baseline justify-between gap-3 transition-colors cursor-pointer ${
                    idx === highlight
                      ? "bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  <span className="text-sm font-medium truncate">
                    {entry.label}
                  </span>
                  {entry.sub && (
                    <span className="font-mono t-xs text-[var(--text-tertiary)] shrink-0 truncate max-w-[45%]">
                      {entry.sub}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--border-subtle)] t-xs text-[var(--text-tertiary)] flex justify-between">
          <span>↑↓ navigate · enter go</span>
          <span>⌘K anywhere</span>
        </div>
      </div>
    </div>
  );
}
