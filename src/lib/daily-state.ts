/* =====================================================================
 * daily-state.ts · ONE canonical read of "which dailies are done today"
 *
 * Four surfaces advertise the daily set (HeaderDailiesChip, the
 * MobileBottomNav Play badge, ReturnVisitorBand, /today's DailyLoop) and
 * each grew its own hand-copied localStorage block. When the HODL Trail
 * shipped, two copies gained it and two silently did not — the surfaces
 * disagreed about what "all done" meant. CHOP launched the same way.
 * This module ends that drift class: the daily roster and its keys live
 * here once. The Runner has no per-day completion state, so it stays
 * out of the count · DailyLoop still lists it as an extra row.
 *
 * The LS keys are deliberate string literals, hand-synced to the game
 * components — importing the game engines just for their key constants
 * would drag whole engines into the header/nav bundles (the same
 * bundle-splitting decision DailyLoop documents).
 *
 * Client-only: touches window.localStorage. Callers already run in
 * "use client" components inside try/effect contexts.
 * ===================================================================== */

export type DailyKey = "wen" | "chop" | "trail" | "gauntlet" | "summit" | "kart";

export type DailyDone = Record<DailyKey, boolean>;

/** Lowest-friction first. Play tab / header chip deep-link this order. */
export const DAILY_ORDER: {
  key: DailyKey;
  href: string;
  chip: (n: number) => string;
  title: (n: number) => string;
}[] = [
  {
    key: "wen",
    href: "/wen",
    chip: (n) => `WEN #${n} open`,
    title: (n) => `WEN #${n} is open · date today's tape`,
  },
  {
    key: "chop",
    href: "/chop",
    chip: (n) => `CHOP #${n} open`,
    title: (n) => `CHOP #${n} is open · slice today's block`,
  },
  {
    key: "trail",
    href: "/trail",
    chip: (n) => `Trail #${n} open`,
    title: (n) => `Trail #${n} is open · ride today's expedition`,
  },
  {
    key: "gauntlet",
    href: "/gauntlet",
    chip: (n) => `Gauntlet #${n} open`,
    title: (n) => `Gauntlet #${n} is open · play today's run`,
  },
  {
    key: "summit",
    href: "/super-saylor",
    chip: (n) => `Summit #${n} open`,
    title: (n) => `Daily Summit #${n} is open · race today's mountain`,
  },
  {
    key: "kart",
    href: "/bitcoin-kart",
    chip: (n) => `Circuit #${n} open`,
    title: (n) => `Daily Circuit #${n} is open · race today's combo`,
  },
];

export function emptyDailyDone(): DailyDone {
  return {
    wen: false,
    chop: false,
    trail: false,
    gauntlet: false,
    summit: false,
    kart: false,
  };
}

/** Read today's done-state per daily cabinet. Throws never — private
 *  mode or a malformed record reads as "open". */
export function readDailyDone(n: number): DailyDone {
  const done = emptyDailyDone();
  try {
    done.wen = !!window.localStorage.getItem(`gm:wen:res:${n}`);
    done.chop = !!window.localStorage.getItem(`gm:chop:res:${n}`);
    done.gauntlet = !!window.localStorage.getItem(`gm:g2:res:${n}`);
    // Summit "done" = a best climb saved for TODAY's mountain.
    const sraw = window.localStorage.getItem("gm:super-saylor:summit");
    if (sraw) {
      const sp = JSON.parse(sraw) as { day?: number };
      done.summit = sp?.day === n;
    }
    // Kart Daily Circuit "done" = a best time saved for TODAY's combo.
    done.kart = !!window.localStorage.getItem(`gm:bitcoin-kart:daily-best:${n}`);
    done.trail = !!window.localStorage.getItem(`gm:trail:res:${n}`);
  } catch {
    /* private mode · everything reads open */
  }
  return done;
}

/** Count of still-open dailies for day n. */
export function countOpenDailies(d: DailyDone): number {
  return DAILY_ORDER.reduce((nOpen, item) => nOpen + (d[item.key] ? 0 : 1), 0);
}

/** Other-tab completion. `storage` does not fire in the writing tab. */
export function subscribeDailyStorage(cb: () => void): () => void {
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** First still-open daily in friction order, or null when the set is clear. */
export function nextOpenDaily(
  d: DailyDone,
  n: number,
): { href: string; key: DailyKey; label: string; title: string } | null {
  const item = DAILY_ORDER.find((x) => !d[x.key]);
  if (!item) return null;
  return {
    href: item.href,
    key: item.key,
    label: item.chip(n),
    title: item.title(n),
  };
}
