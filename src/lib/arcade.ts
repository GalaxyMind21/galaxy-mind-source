"use client";

/* =====================================================================
 * Arcade identity + score client (2026-07-09).
 *
 * Every player gets a random bitcoin-culture handle, generated once
 * and kept in localStorage · no accounts, no PII, nothing typed. The
 * handle is the ONLY identity the public boards ever see. Format is
 * strict ("Adjective Noun #123") because the API validates against
 * the same pattern · loosening one side without the other silently
 * drops every submission.
 * ===================================================================== */

import { scoreToken } from "./arcade-token";

const K_HANDLE = "gm:arcade:handle";
const K_SENT_G = (n: number) => `gm:arcade:sent:g:${n}`;
const K_SENT_WEN = (n: number) => `gm:arcade:sent:wen:${n}`;
const K_SENT_TRAIL = (n: number) => `gm:arcade:sent:trail:${n}`;

// Must match the server's HANDLE_RE (api/arcade/score) · each part
// starts and ends with a letter so an all-dash / all-space name can't
// round-trip. A stored handle that fails this is regenerated on read.
const HANDLE_RE =
  /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;

// Two-list combinatorics · plenty of handles, in the culture's own
// voice. EVERY entry must satisfy the server's handle regex: the
// adjective is [A-Za-z-]{3,16}, the noun is [A-Za-z ]{3,16} (so
// spaces are allowed in nouns, hyphens in adjectives, both capped at
// 16 chars · keep new entries under that or the score post 400s).
const ADJECTIVES = [
  "Sovereign",
  "Orange-Pilled",
  "Diamond-Handed",
  "Laser-Eyed",
  "Cold-Storage",
  "Cypherpunk",
  "Hard-Money",
  "Non-Custodial",
  "Post-Fiat",
  "Genesis-Block",
  "Taproot",
  "Lightning",
  "Halving-Ready",
  "Time-Chain",
  "Low-Fee",
  "Multisig",
  "Unstoppable",
  "Stacking",
  // bitcoin humor
  "Number-Go-Up",
  "Never-Selling",
  "Infinite-EV",
  "Gigachad",
  "Ramen-Pilled",
  "No-Second-Best", // Saylor: "there is no second best"
  "Digital-Energy", // Saylor: "bitcoin is digital energy"
  "Ten-Bagger",
  "Rugproof",
  "Freegold",
] as const;

const NOUNS = [
  "Hodler",
  "Pleb",
  "Stacker",
  "Miner",
  "Whale",
  "Node Runner",
  "Maximalist",
  "Custodian",
  "Pioneer",
  "Prospector",
  "Sat Slinger",
  "Block Smith",
  "Key Holder",
  "Torch Bearer",
  "Chart Surfer",
  "Vault Keeper",
  "Coin Smith",
  "Signal Chaser",
  // exec + culture references (operator request 2026-07-09)
  "Saylor",
  "Phong Le",
  "Laser Ray",
  "Volcano Bond",
  "Corn Enjoyer",
  "Pizza Regret",
  "Moon Boi",
  "Timechain Monk",
  "Orange Coiner",
  "Full Node Chad",
] as const;

/** "Adjective Noun #123" · same shape the API's regex enforces. */
export function generateHandle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  // 100-999 · reroll any suffix containing "88" (house rule: never
  // single out that number, even by accident).
  let suffix = "";
  do {
    suffix = String(100 + Math.floor(Math.random() * 900));
  } while (suffix.includes("88"));
  return `${adj} ${noun} #${suffix}`;
}

/** The saved handle, minting one on first call. */
export function getHandle(): string {
  try {
    const cur = window.localStorage.getItem(K_HANDLE);
    if (cur && HANDLE_RE.test(cur)) return cur;
  } catch {
    /* private mode · session-scoped handle below */
  }
  const fresh = generateHandle();
  try {
    window.localStorage.setItem(K_HANDLE, fresh);
  } catch {
    /* best-effort */
  }
  return fresh;
}

/** Mint + persist a new handle (the "new name" button). */
export function rerollHandle(): string {
  const fresh = generateHandle();
  try {
    window.localStorage.setItem(K_HANDLE, fresh);
  } catch {
    /* best-effort */
  }
  return fresh;
}

export type ArcadeGame = "gauntlet" | "runner" | "horizon" | "wen" | "trail";

/** Games with ONE shared puzzle per UTC day · one post per day. */
function dailySentKey(game: ArcadeGame, day: number): string | null {
  if (game === "gauntlet") return K_SENT_G(day);
  if (game === "wen") return K_SENT_WEN(day);
  if (game === "trail") return K_SENT_TRAIL(day);
  return null;
}

export type BoardRow = {
  name: string;
  score: number;
  // X-linked rows (optional identity layer 2026-07-14): the API resolves
  // the "x:{userId}" board member into "@handle" + these flags.
  verified?: boolean;
  avatar?: string;
};
export type Board = {
  rows: BoardRow[];
  total: number;
  configured: boolean;
};

/** Viewer link state from the no-store /api/auth/x/me probe. */
export type ArcadeIdentity = {
  enabled: boolean;
  linked: boolean;
  handle?: string | null;
  avatar?: string | null;
};

/**
 * Fetch the viewer's X-link state. Never throws · a network problem
 * reads as "feature off" so UI simply hides the link affordance.
 */
export async function fetchIdentity(): Promise<ArcadeIdentity> {
  try {
    const r = await fetch("/api/auth/x/me", { cache: "no-store" });
    if (!r.ok) return { enabled: false, linked: false };
    const j = (await r.json()) as Partial<ArcadeIdentity>;
    return {
      enabled: j.enabled === true,
      linked: j.linked === true,
      handle: typeof j.handle === "string" ? j.handle : null,
      avatar: typeof j.avatar === "string" ? j.avatar : null,
    };
  } catch {
    return { enabled: false, linked: false };
  }
}

/** Log out of (and optionally fully unlink) the X identity. */
export async function unlinkIdentity(unlink: boolean): Promise<boolean> {
  try {
    const r = await fetch("/api/auth/x/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlink }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Post a score. Never throws, never blocks the game · a failed post
 * costs a board entry, not a run. Resolves with the player's rank on
 * the board (1-based) when the API returns it, so a caller can put it
 * in the share text; resolves null on a skipped/failed post. Callers
 * that don't need the rank can ignore the promise (fire-and-forget).
 *
 * `proof` is MANDATORY for wen + gauntlet (server-side replay
 * verification · lib/arcade-replay): WEN sends the guess-timestamp
 * list, the Gauntlet its [day, kind, value] action log. The server
 * re-runs it and rejects any score the sim doesn't reproduce.
 */
export async function submitScore(
  game: ArcadeGame,
  score: number,
  day?: number,
  proof?: unknown,
): Promise<{ rank: number | null } | null> {
  // Gauntlet + WEN: one shared puzzle per day means ONE post per day.
  // Read the "sent" flag to skip repeats, but do NOT set it until the
  // post is verified below · setting it before the fetch made a
  // 429/offline/KV-down fail closed with no retry that day (2026-07-10
  // bug audit · H1).
  const sentKey = day != null ? dailySentKey(game, day) : null;
  if (sentKey != null) {
    try {
      if (window.localStorage.getItem(sentKey) === "1") return null;
    } catch {
      /* localStorage unavailable · still attempt the post */
    }
  }
  try {
    const name = getHandle();
    const token = scoreToken(game, score, day, name);
    const r = await fetch("/api/arcade/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        proof === undefined
          ? { game, score, day, name, token }
          : { game, score, day, name, token, proof },
      ),
      keepalive: true,
    });
    // Nudge any mounted scoreboard to refetch.
    try {
      window.dispatchEvent(new CustomEvent("gm:arcade-score"));
    } catch {
      /* no window · ignore */
    }
    if (!r.ok) return null;
    // A KV-down / unconfigured response is HTTP 200 with { ok: false }, so
    // the status alone is not proof of a write · require a verified success
    // before we call it sent (2026-07-10 bug audit · M12).
    const data = (await r.json()) as { ok?: boolean; rank?: number | null };
    if (data.ok !== true) return null;
    if (sentKey != null) {
      try {
        window.localStorage.setItem(sentKey, "1");
      } catch {
        /* best-effort · GT semantics make a repeat harmless */
      }
    }
    return { rank: typeof data.rank === "number" ? data.rank : null };
  } catch {
    /* never let the board break the game */
    return null;
  }
}

/**
 * Cross-device cloud save for X-linked players (2026-07-18). POSTs this
 * game's local save; the server best-of merges it into the stored save and
 * returns the merged result the caller should adopt. Bidirectional in one
 * call — uploads this device's unique progress and downloads the cloud's.
 * Resolves null when disabled / anonymous / offline (stay local-only). The
 * React twin of Bitcoin Kart's board.js cloudSyncKart.
 */
export async function cloudSync(game: string, save: unknown): Promise<unknown | null> {
  try {
    const r = await fetch("/api/arcade/cloud", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, save }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok?: boolean; merged?: unknown };
    return j && j.ok === true && j.merged != null ? j.merged : null;
  } catch {
    return null;
  }
}

export async function fetchBoard(
  game: ArcadeGame,
  day?: number,
): Promise<Board | null> {
  try {
    const qs = new URLSearchParams({ game });
    if (day != null) qs.set("day", String(day));
    const r = await fetch(`/api/arcade/scores?${qs}`);
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<Board>;
    // Validate the shape at the network boundary · a malformed 200
    // body must not reach `rows.map` in the scoreboard.
    if (!Array.isArray(j.rows)) return null;
    return {
      rows: j.rows.filter(
        (x): x is BoardRow =>
          !!x && typeof x.name === "string" && typeof x.score === "number",
      ),
      total: typeof j.total === "number" ? j.total : 0,
      configured: j.configured !== false,
    };
  } catch {
    return null;
  }
}
