// Social-post template generators.
//
// Two surfaces: X (Twitter) and Nostr. Both produce a "spotlight"
// draft featuring 2-3 vendors with category diversity, formatted
// per the platform's conventions:
//
// X · Bird-app idioms
//   · @ mentions for vendor X handles (so they get notification)
//   · 2-3 mentions max ("tag etiquette")
//   · ≤ 280 chars including URL (auto-shortened to 23 chars by t.co)
//   · Link to galaxymind.space (the directory · entry to the whole site)
//
// Nostr · longer-form, no @ mentions
//   · Vendor names in plain text · bech32/nprofile mentions would
//     clutter the post
//   · Per-vendor link to /v/[slug] so visitors land on the vendor
//     profile page · not the directory (Nostr clients tend to render
//     all links, so multiple direct links converts better)
//   · No hard char cap but we self-limit to ~500 for readability
//   · #Bitcoin / #Nostr hashtags at the end
//
// Variety: each platform has multiple lead-in lines · the cron
// picks one deterministically by day-of-week so the same lead
// doesn't fire two days in a row, but the rotation is predictable
// (operator can preview tomorrow's lead by checking the array).
//
// ── THE VOICE CONTRACT (operator rule 2026-08-04) ────────────────
// Every draft this module emits must read like a person typed it.
// Concretely, in POST TEXT (comments and email chrome are exempt):
//   · No interpunct "·", em/en dashes, or "≈". Those are the site's
//     UI typography; in a post they read as generated. Use commas,
//     periods, "about", and plain hyphens like a human would.
//   · No fragment-contrast tic: "That's X. Not Y." and the
//     "isn't just / not just / more than just" family are banned.
//   · Full sentences by default. Emojis are fine in small doses.
//   · One link per post, at the end. The first line is the hook and
//     never contains a URL.
// scripts/test-social-drafts.ts enforces the mechanical parts of
// this (the slop gate walks every drafter's output plus the full
// lead pools). If the gate blocks a phrasing you like, rewrite the
// sentence, don't loosen the gate.

import {
  CATEGORY_LABELS,
  HOUSE_HANDLE,
  REVERIFY_BATCH_SIZE,
  STALE_THRESHOLD_DAYS,
  getPlatform,
  vendorSlug,
  verifiedAtClusterStats,
  type Vendor,
  type VendorCategory,
  type VendorPlatform,
} from "./vendors";
import { TIER_LABEL, type StackVerdict } from "./stack";
import type { FloatData } from "./float-data";
import type { HashrateDesk } from "./hashrate";
import { summarizeOpenFleet } from "./open-fleet";
import { rentalCostBtc } from "./block-odds";
import {
  blockSubsidyAt,
  daysUntilNextHalving,
  nextHalvingHeight,
} from "./bitcoin-supply";
import { gauntletNumber, summitLevelFor, kartComboFor } from "./gauntlet-day";

// Vendors in the directory but unsuitable for social spotlights.
// The skip list for low-info bios · individual devs without a commercial
// surface, accounts with no website / shop, anyone where the
// "go shop here" framing of the spotlight tweet would feel wrong.
//
// These vendors still appear in the directory (their listing is
// useful as a Bitcoin-accepting reference) · they're just not
// included in the "Bitcoin merchants worth knowing about this week"
// rotation. Maintain this list as the rotation queue evolves;
// promoting a previously-skipped vendor is as simple as removing
// their handle here. Keys match `vendor.handle`.
const SOCIAL_SKIP_HANDLES = new Set<string>([
  // X · individual devs / no commercial site
  "afilini",
  "XXIWines",
  "IxTechCrypto",
  // The house listing (Block Shot · our own hashrate rental). It
  // belongs in the directory and it gets its own dedicated Block Shot
  // draft every day — but a "merchants worth knowing about this week"
  // spotlight that features US is astroturfing, not curation.
  HOUSE_HANDLE,
]);

/**
 * Filter out vendors flagged unsuitable for social spotlights. Apply
 * before pickWithCategoryDiversity. Stays case-sensitive on handle
 * since vendor.handle is canonical-cased in vendors.ts.
 */
export function filterSocialEligible(vendors: Vendor[]): Vendor[] {
  return vendors.filter((v) => !SOCIAL_SKIP_HANDLES.has(v.handle));
}

// ─────────────────────────────────────────────────────────────────
// Pool selection · pick N vendors from a candidate pool with
// category diversity. Prefers a different category per pick when
// the pool allows; falls back to "any non-duplicate" when not.
// ─────────────────────────────────────────────────────────────────

/**
 * Pick N vendors from `pool` with category diversity (one per
 * category where possible). Deterministic-seeded so the same input
 * + same date produces the same pick · makes the cron idempotent
 * within a day and lets the operator predict tomorrow's draft by
 * running it locally with the same seed.
 */
/**
 * Fisher-Yates, driven by a seeded rand.
 *
 * NOT `sort(() => rand() - 0.5)`, which is what this used to be, twice.
 * That comparator is INCONSISTENT — it answers differently for the same
 * pair — so it violates the total order `Array.prototype.sort` requires.
 * ECMA-262 says so in as many words: when the comparator is not a
 * consistent comparison function, "the sort order is
 * implementation-defined". V8 sorts with TimSort plus binary insertion
 * and treats arrays under ~64 elements as a single min-run, so the ORDER
 * in which it consumes the comparator's answers depends on both the
 * engine version and the array's LENGTH. The fallback pool here is ~75
 * vendors, right past that boundary — which is why this bit us at the
 * roster's current size and would have behaved differently when the
 * directory was smaller.
 *
 * That is not theoretical: CI on Node 22 and a dev machine on Node 26
 * produced DIFFERENT vendor picks from the same commit, the same roster
 * and the same day seed (2026-08-07), which is how a build went red with
 * a failure that would not reproduce locally. The docstring below
 * promised the operator could predict tomorrow's draft by running it
 * locally; that promise was false for as long as this used sort().
 *
 * The random-comparator shuffle is also measurably biased, so this is a
 * fairness fix for the vendor rotation as well as a determinism one.
 */
function shuffleSeeded<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickWithCategoryDiversity(
  pool: Vendor[],
  n: number,
  seed: number,
  opts?: { forceNewest?: boolean },
): Vendor[] {
  if (pool.length === 0) return [];
  // Mulberry32 PRNG · 32-bit seeded, no global state.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const picks: Vendor[] = [];
  const used = new Set<string>();
  const coveredCats = new Set<VendorCategory>();

  // Freshness guarantee · force the single newest vendor into the
  // batch. `addedAt` is a monotonic ORDINAL (higher = added later),
  // so the max is unambiguously the newest merchant in this pool.
  // Without this a brand-new vendor can wait weeks for the diversity
  // roll to surface it (operator flagged "the drafts never include
  // the newest vendors", 2026-07-09). Because the cron marks a 14-day
  // cooldown after each post, this naturally walks the catalog
  // newest-first — day 1 features the newest, day 2 the next-newest
  // available, and so on — instead of re-forcing the same vendor.
  if (opts?.forceNewest && n > 0) {
    const newest = pool.reduce((a, b) => (b.addedAt > a.addedAt ? b : a));
    picks.push(newest);
    used.add(newest.handle);
    coveredCats.add(newest.category);
  }

  // Group by category for the diversity pass.
  const byCategory = new Map<VendorCategory, Vendor[]>();
  for (const v of pool) {
    const list = byCategory.get(v.category) ?? [];
    list.push(v);
    byCategory.set(v.category, list);
  }

  // Sort each category's list by addedAt desc · newer vendors get
  // priority within a category (they benefit most from amplification).
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.addedAt - a.addedAt);
  }

  // Pass 1: one per category until we hit N or run out of categories.
  // Iterate categories in randomized order so we don't always pick
  // "apparel first". Skip categories the fresh seed already covered so
  // the batch stays diverse.
  const categories = shuffleSeeded([...byCategory.keys()], rand);
  for (const cat of categories) {
    if (picks.length >= n) break;
    if (coveredCats.has(cat)) continue;
    const list = byCategory.get(cat)!;
    // Within the category, pick a random vendor from the top half
    // (newer ones) · weights toward fresh without being deterministic.
    const sliceEnd = Math.max(1, Math.ceil(list.length / 2));
    const candidates = list.slice(0, sliceEnd);
    const pick = candidates[Math.floor(rand() * candidates.length)];
    if (!used.has(pick.handle)) {
      picks.push(pick);
      used.add(pick.handle);
      coveredCats.add(cat);
    }
  }

  // Pass 2: fill remaining slots from anywhere in the pool, still
  // honoring the "no duplicate" constraint.
  if (picks.length < n) {
    const fallback = shuffleSeeded(
      pool.filter((v) => !used.has(v.handle)),
      rand,
    );
    for (const v of fallback) {
      if (picks.length >= n) break;
      picks.push(v);
      used.add(v.handle);
    }
  }

  return picks;
}

// ─────────────────────────────────────────────────────────────────
// Vendor descriptor · a short human phrase for the post, sourced from
// the vendor's OWN description (first clean clause) so a line reads
// "@handle · Linen dresses and natural-fabric clothing" instead of
// the bare category word "apparel" (operator request 2026-07-09 · "a
// few words, not just 'collectibles'"). Falls back to a richer
// category phrase only when a vendor has no usable description.
// ─────────────────────────────────────────────────────────────────

const CATEGORY_PHRASE: Record<VendorCategory, string> = {
  apparel: "Bitcoin apparel & gear",
  "general-goods": "everyday goods sold for bitcoin",
  hardware: "hardware wallets & mining kit",
  consumables: "food, drink & everyday goods",
  collectibles: "art, prints & 3D collectibles",
  services: "Bitcoin-native services",
  books: "books & Bitcoin education",
};

/**
 * A short descriptor phrase for a vendor · the first clean clause of
 * their description, trimmed to `maxLen` at a word boundary, trailing
 * punctuation stripped. Falls back to the category phrase when the
 * description is empty. Deterministic · no randomness, safe to reuse
 * across X and Nostr.
 */
const DESCRIPTOR_CONNECTORS = new Set([
  "plus", "and", "with", "for", "the", "a", "an", "of", "to", "in", "on",
  "or", "by", "from", "at", "&", "including", "made", "featuring",
]);

/**
 * Cut a string to `maxLen` on a word boundary, never mid-parenthetical.
 *
 * Both truncation paths (the X descriptor and the Nostr fuller line)
 * used to cut blind, which left brackets hanging — "drink sticks
 * (variety packs", "hardware-wallet cases (Cold…" — and an unclosed
 * paren reads as a typo in a post the operator publishes under their
 * own name. Dropping back to before the orphaned "(" is safe because
 * the clause in front of it already stands alone; that is what made it
 * a parenthetical in the first place.
 */
export function draftFeaturedVendorPost(vendor: Vendor): {
  text: string;
  charCount: number;
} {
  const who =
    getPlatform(vendor) === "x" ? `@${vendor.handle}` : vendor.name;
  const desc = depunct(vendorDescriptor(vendor, 72));
  const url = `https://galaxymind.space/v/${vendorSlug(vendor)}`;
  const text = `This week's featured shop is ${who}. ${desc}.\n\n${url}`;
  return { text, charCount: text.length };
}

export function clipAtWord(s: string, maxLen: number): string {
  let out = s.length > maxLen ? s.slice(0, maxLen) : s;
  if (out.length < s.length) {
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace > 12) out = out.slice(0, lastSpace);
  }
  const opens = (out.match(/\(/g) ?? []).length;
  const closes = (out.match(/\)/g) ?? []).length;
  if (opens > closes) out = out.slice(0, out.lastIndexOf("("));
  return out.replace(/[.·;,\s]+$/, "").trim();
}

export function vendorDescriptor(v: Vendor, maxLen = 40): string {
  const raw = (v.description ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return CATEGORY_PHRASE[v.category];
  // Cut at the first strong boundary · the site uses " · " as its
  // separator; a sentence end or semicolon closes a thought cleanly.
  let seg = raw.split(/ · |; |\. (?=[A-Z0-9])/)[0].trim();
  // If that clause is still too long, prefer the first comma-clause
  // when it's substantial enough to stand alone (turns "Colombian
  // specialty coffee (340g), plus chocolate" into "Colombian specialty
  // coffee (340g)" rather than a mid-phrase cut).
  if (seg.length > maxLen) {
    const firstComma = seg.split(",")[0].trim();
    if (firstComma.length >= 20) seg = firstComma;
  }
  seg = seg.replace(/[.·;,\s]+$/, "").trim();
  if (!seg) return CATEGORY_PHRASE[v.category];
  // Word-trim to budget (no ellipsis · a clean phrase reads better),
  // dropping trailing punctuation and any orphaned parenthetical.
  seg = clipAtWord(seg, maxLen);
  // Then any dangling connector word the cut left behind
  // ("...coffee (340g), plus" → "...coffee (340g)").
  const words = seg.split(" ");
  while (
    words.length > 2 &&
    DESCRIPTOR_CONNECTORS.has(
      words[words.length - 1].toLowerCase().replace(/[^a-z&]/g, ""),
    )
  ) {
    words.pop();
  }
  return words.join(" ").replace(/[.·;,\s]+$/, "") || CATEGORY_PHRASE[v.category];
}

// ─────────────────────────────────────────────────────────────────
// X post drafting
// ─────────────────────────────────────────────────────────────────

// X allows 280 chars; URLs auto-shorten to 23 (t.co). We aim for a
// comfortable 250-char target so emoji width + line breaks don't
// push us over.
const X_TARGET_LENGTH = 280;
const URL_TCO_LENGTH = 23;

// A big lead pool + a hashed per-day pick (below) means the intro
// line rarely repeats and — unlike the old dayOfYear % 7 — is NOT the
// same on every same weekday. Variety is the point: a stale, on-a-
// timer feed reads as automated and the algorithm notices.
// Exported so the voice gate in scripts/test-social-drafts.ts can walk
// EVERY lead, not just the one today's seed happens to pick.
export const X_LEADS: string[] = [
  // Insight-led leads · frame the spotlight as one circular-economy
  // observation with the vendors as the proof, not a bare promo list
  // (keeps the vendor-mention post Bier-aligned).
  "The Bitcoin circular economy is bigger than the ETF headlines. A few shops taking sats for everyday goods 🟧",
  "Everyone watches the treasuries. Meanwhile independent merchants quietly take bitcoin every day 🟧",
  "Spending bitcoin is the other half of the thesis. These shops make it tangible 🟧",
  "The strongest proof bitcoin is money is people using it as money. These do 🟧",
  "Bitcoin merchants worth knowing about this week 🟧",
  "Where to actually spend your sats 🟧",
  "Everyday goods for bitcoin. These shops take BTC 🟧",
  "Bitcoin commerce out in the wild 🟧",
  "Your sats are welcome here 🟧",
  "Shops you might not know take bitcoin 🟧",
  "A little circular economy roll call 🟧",
  "Spend bitcoin and keep stacking. Start here 🟧",
  "Merchants who chose Bitcoin over the card networks 🟧",
  "The sats-accepting corner of the internet 🟧",
  "Proof the Bitcoin economy is working 🟧",
  "Shops that quietly take bitcoin every day 🟧",
  "Add these to your spend-and-replace list 🟧",
  "Verified merchants who gladly take sats 🟧",
  "Small businesses stacking sats instead of dollars 🟧",
  "This is what a Bitcoin economy looks like 🟧",
];

// When a genuinely-new vendor is in the batch, a distinct lead + a 🆕
// marker on their line. Doubles as the "newest vendors actually show
// up" fix (operator flagged both) · the freshness-boosted pick puts a
// recent add in the batch, and this shape spotlights it.
export const X_NEW_ARRIVAL_LEADS: string[] = [
  "Just verified on Galaxy Mind 🟧",
  "New shop, now taking bitcoin 🟧",
  "Fresh on the directory this week 🟧",
  "New to the circular economy 🟧",
  "Just added another merchant taking sats 🟧",
];

/** Deterministic per-day RNG · same date ⇒ same sequence (idempotent
 *  cron) but consecutive days/weekdays diverge (mulberry32 mixing). */
function daySeedRng(date: Date): () => number {
  let s = (Math.floor(date.getTime() / 86_400_000) * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Voice-contract scrub for DATA quoted into a post. Vendor
 *  descriptions legitimately use the site's typography (· and dashes);
 *  a post must not, so quoted text swaps them for plain punctuation
 *  at compose time. The vendor data itself is untouched. */
function depunct(s: string): string {
  return s
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/≈/g, "about ");
}

function vendorLine(v: Vendor, marker = ""): { line: string; mentioned: string | null } {
  const platform: VendorPlatform = v.platform ?? "x";
  const label = platform === "x" ? `@${v.handle}` : v.name;
  return {
    // Plain hyphen, the way a person types a list. The interpunct is
    // site typography and reads generated in a post (voice contract).
    line: `${marker}${label} - ${depunct(vendorDescriptor(v))}`,
    mentioned: platform === "x" ? v.handle : null,
  };
}

/**
 * Compose an X post featuring the given vendors. The post SHAPE varies
 * by day for feed variety: a plain spotlight list most days, and a
 * "new arrival" shape (distinct lead + 🆕 on the fresh vendor's line)
 * when `opts.freshHandles` says one of the picks was recently added.
 *
 * `used` is the set of vendors actually featured in the returned text
 * (the caller marks cooldowns on exactly these · not on picks the
 * shape dropped).
 */
export function draftXPost(
  vendors: Vendor[],
  date: Date,
  opts?: { freshHandles?: ReadonlySet<string> },
): {
  text: string;
  charCount: number;
  mentionedHandles: string[];
  used: Vendor[];
} {
  if (vendors.length === 0) {
    return { text: "", charCount: 0, mentionedHandles: [], used: [] };
  }

  const rng = daySeedRng(date);
  const url = "galaxymind.space";
  const fresh = opts?.freshHandles;
  const freshIdx = fresh
    ? vendors.findIndex((v) => fresh.has(v.handle))
    : -1;

  const mentionedHandles: string[] = [];
  const pushMention = (h: string | null) => {
    if (h) mentionedHandles.push(h);
  };

  let body: string;
  let used: Vendor[];

  // Shape · "new arrival" when a fresh vendor is present (55% of the
  // time, so it still varies), else the rotating spotlight list.
  const shapeRoll = rng();
  const leadRoll = rng();

  if (freshIdx >= 0 && shapeRoll < 0.55) {
    // Order: fresh vendor first (🆕), then up to two others.
    const freshVendor = vendors[freshIdx];
    const rest = vendors.filter((_, i) => i !== freshIdx).slice(0, 2);
    used = [freshVendor, ...rest];
    const lead =
      X_NEW_ARRIVAL_LEADS[Math.floor(leadRoll * X_NEW_ARRIVAL_LEADS.length)];
    const firstLine = vendorLine(freshVendor, "🆕 ");
    pushMention(firstLine.mentioned);
    const restLines = rest.map((v) => {
      const l = vendorLine(v);
      pushMention(l.mentioned);
      return l.line;
    });
    body = [
      lead,
      "",
      firstLine.line,
      ...(restLines.length ? ["", "also taking sats:", ...restLines] : []),
      "",
      url,
    ].join("\n");
  } else {
    // Spotlight list · rotating lead + a descriptor per vendor.
    used = vendors;
    const lead = X_LEADS[Math.floor(leadRoll * X_LEADS.length)];
    const vendorLines = vendors.map((v) => {
      const l = vendorLine(v);
      pushMention(l.mentioned);
      return l.line;
    });
    body = [lead, "", ...vendorLines, "", url].join("\n");
  }

  // X URL char accounting · plain text length minus the URL plus 23
  // (t.co always renders URLs as 23 chars). Our `url` is plain
  // "galaxymind.space" (16 chars) which X auto-links, so the count
  // becomes (body length - 16 + 23) = body + 7.
  const effectiveLength = body.length - url.length + URL_TCO_LENGTH;

  return {
    text: body,
    charCount: effectiveLength,
    mentionedHandles,
    used,
  };
}

/**
 * Convenience · returns true if the draft fits inside X's 280-char
 * cap with comfortable headroom. Cron uses this to decide whether
 * to re-pick (e.g. if a long vendor description blew the budget,
 * pick a different vendor).
 */
export function xDraftFits(draft: { charCount: number }): boolean {
  return draft.charCount <= X_TARGET_LENGTH;
}

/**
 * The draft that actually gets emailed · drafts, and on an over-budget
 * result drops the lowest-priority pick and re-drafts (up to 2 retries,
 * never below one vendor).
 *
 * This exists because `draftXPost` alone does NOT promise to fit: a
 * long vendor name or descriptor can blow the budget, and the contract
 * is that the CALLER re-picks. That retry used to live inline in the
 * cron, so nothing else could exercise it — and the drift showed up as
 * a test that asserted the raw drafter fits and therefore failed on
 * whichever days the daily seed happened to pick long vendors (observed
 * 2026-08-06: 289/280), blocking unrelated deploys on a coin flip while
 * production was fine. One implementation, used by the cron and the
 * gate, is the fix: the gate now tests the path that ships.
 */
export function draftXPostFitted(
  vendors: Vendor[],
  date: Date,
  opts?: { freshHandles?: ReadonlySet<string> },
): ReturnType<typeof draftXPost> & { retries: number } {
  let draft = draftXPost(vendors, date, opts);
  let picks = vendors;
  let retries = 0;
  while (!xDraftFits(draft) && retries < 2 && picks.length > 1) {
    picks = picks.slice(0, -1);
    draft = draftXPost(picks, date, opts);
    retries++;
  }
  return { ...draft, retries };
}

// ─────────────────────────────────────────────────────────────────
// Nostr post drafting
// ─────────────────────────────────────────────────────────────────

const SITE_URL = "https://galaxymind.space";

export const NOSTR_LEADS: string[] = [
  "This week's Bitcoin merchant spotlight on Galaxy Mind:",
  "Everyday-goods Bitcoin vendors worth knowing about:",
  "Bitcoin merchants accepting BTC for actual things:",
  "Featured Bitcoin shops on Galaxy Mind this week:",
  "Spend bitcoin on everyday things from these vendors:",
  "A few vendors taking Bitcoin for everyday goods:",
  "Galaxy Mind featured Bitcoin merchants:",
  "The circular economy is working and these shops prove it:",
  "Where your sats are welcome this week:",
  "Verified Bitcoin merchants worth a follow:",
  "Proof of a working Bitcoin economy:",
  "Spend and replace, starting with these shops:",
  "Small businesses stacking sats instead of dollars:",
  "Bitcoin flows here. Human-verified merchants:",
];

export const NOSTR_NEW_ARRIVAL_LEADS: string[] = [
  "Just verified on Galaxy Mind, welcome the newest merchant:",
  "New shop in the directory, now taking bitcoin:",
  "Fresh on Galaxy Mind this week, a new sats-accepting merchant:",
];

/**
 * Compose a Nostr note featuring the given vendors. Returns the draft
 * text and the vendors actually used (all of them · Nostr lists the
 * full set). Uses the new-arrival lead when a fresh vendor is present.
 */
export function draftNostrPost(
  vendors: Vendor[],
  date: Date,
  opts?: { freshHandles?: ReadonlySet<string> },
): { text: string; charCount: number; used: Vendor[] } {
  if (vendors.length === 0) {
    return { text: "", charCount: 0, used: [] };
  }

  const rng = daySeedRng(date);
  const fresh = opts?.freshHandles;
  const hasFresh = fresh
    ? vendors.some((v) => fresh.has(v.handle))
    : false;
  const leadRoll = rng();
  const lead =
    hasFresh && rng() < 0.55
      ? NOSTR_NEW_ARRIVAL_LEADS[
          Math.floor(leadRoll * NOSTR_NEW_ARRIVAL_LEADS.length)
        ]
      : NOSTR_LEADS[Math.floor(leadRoll * NOSTR_LEADS.length)];

  // Per-vendor block · name + a few-words descriptor + the fuller
  // description + direct profile link. Nostr clients render every line;
  // the direct /v/[slug] link is what turns reads into click-throughs.
  const vendorBlocks = vendors.map((v) => {
    const slug = vendorSlug(v);
    const marker = fresh && fresh.has(v.handle) ? "🆕 " : "→ ";
    const descriptor = depunct(vendorDescriptor(v, 46));
    const full = depunct((v.description ?? "").replace(/\s+/g, " ").trim());
    const desc = full.length > 120 ? clipAtWord(full, 117) + "…" : full;
    const lines = [`${marker}${v.name} - ${descriptor}`];
    // Only add the fuller description line when it says more than the
    // descriptor already did (avoids a duplicated one-clause vendor).
    if (desc && desc.toLowerCase() !== descriptor.toLowerCase()) {
      lines.push(`   ${desc}`);
    }
    lines.push(`   ${SITE_URL}/v/${slug}`);
    return lines.join("\n");
  });

  const body = [
    lead,
    "",
    ...vendorBlocks,
    "",
    `Browse all vendors who accept BTC:`,
    SITE_URL,
    "",
    "#Bitcoin #Nostr",
  ].join("\n");

  return {
    text: body,
    charCount: body.length,
    used: vendors,
  };
}

// ─────────────────────────────────────────────────────────────────
// Gauge + float drafts · the site's two most non-replicable assets,
// turned into a recurring post cadence (weekly gauge, monthly float).
// Both are short enough for X and read fine on Nostr, and reuse data
// the cron already fetches · no new infrastructure. Plain voice, no
// em dashes, per the house style.
// ─────────────────────────────────────────────────────────────────

const GAUGE_URL = "galaxymind.space/stack";
const FLOAT_URL = "galaxymind.space/float";
const RUNNER_URL = "galaxymind.space/runner";
const GAUNTLET_URL = "galaxymind.space/gauntlet";
const SAYLOR_URL = "galaxymind.space/super-saylor";
const WEN_URL = "galaxymind.space/wen";
const KART_URL = "galaxymind.space/bitcoin-kart";

/**
 * Weekly "weather report" draft from the live Buying Gauge verdict.
 * Leads with the score + tier word, names the single most extreme
 * signal as the driver, and links the frozen per-verdict snapshot
 * card (/stack?s=..&t=..&d=..) so each share is its own OG billboard.
 */
export function draftGaugePost(
  verdict: StackVerdict,
  date: Date,
): { text: string; charCount: number } {
  const dateStr = date.toISOString().slice(0, 10);
  const tierWord = TIER_LABEL[verdict.tier];

  // Biggest driver · the signal furthest from neutral (50) among those
  // with live data. Furthest-from-neutral = strongest pull on the score
  // right now, which is the honest "what moved it" answer without
  // needing a prior snapshot to diff against.
  const live = verdict.signals.filter((s) => s.raw != null);
  const top = live.length
    ? live.reduce((a, b) =>
        Math.abs(b.normalized - 50) > Math.abs(a.normalized - 50) ? b : a,
      )
    : null;
  const driver = top
    ? `${top.name} ${top.normalized >= 50 ? "is leaning toward stacking" : "is flashing caution"}`
    : "ten signals, all roughly neutral";

  const url = `${GAUGE_URL}?s=${verdict.score}&t=${verdict.tier}&d=${dateStr}`;
  const text = [
    `The Bitcoin Buying Gauge reads ${verdict.score}/100 today. That's ${tierWord} territory.`,
    "",
    `Biggest driver right now: ${driver}.`,
    "",
    `Ten signals, one number, updated live: ${url}`,
  ].join("\n");

  // X char accounting · the URL renders as 23 chars (t.co) regardless
  // of its query-string length.
  const charCount = text.length - url.length + URL_TCO_LENGTH;
  return { text, charCount };
}

/**
 * Monthly "State of the Float" draft · how much bitcoin is realistically
 * left to buy, the ~30-day change, and the structural scarcity framing.
 * Sourced from the live float snapshot the /float page already serves.
 */
export function draftFloatPost(
  data: FloatData,
  date: Date,
): { text: string; charCount: number } {
  void date; // signature parity with the other drafters; float is date-agnostic
  const inPlay = data.current.inPlay;
  const inPlayM = (inPlay / 1_000_000).toFixed(1);

  // ~30-day change · history is newest-first. Only state a delta when
  // there is genuinely about a month of history; otherwise omit rather
  // than guess (accuracy over completeness).
  let deltaLine = "";
  const hist = data.history;
  if (hist.length > 30) {
    const monthAgo = hist[30].inPlay;
    const drop = monthAgo - inPlay; // positive = float shrank
    if (drop > 0) {
      deltaLine = `About ${Math.round(drop).toLocaleString()} BTC left the open market in the last 30 days.`;
    }
  }

  const text = [
    `About ${inPlayM}M BTC is realistically left to buy on the open market.`,
    "",
    `${deltaLine ? deltaLine + "\n\n" : ""}ETFs and treasuries keep absorbing more bitcoin than miners create, and the next halving cuts new supply again.`,
    "",
    `Here's how much is left, live: ${FLOAT_URL}`,
  ].join("\n");

  const charCount = text.length - FLOAT_URL.length + URL_TCO_LENGTH;
  return { text, charCount };
}

/**
 * Daily arcade draft · a paste-ready X line for the games, the site's
 * viral surface (2026-07-10). Rotates through six angles by UTC day so
 * the operator gets variety without repeating the same line: the moon
 * hook, today's Gauntlet, WEN, the same-tape daily race, the Summit,
 * and the Kart Daily Circuit (named concretely · track, class, mirror ·
 * via the kartComboFor mirror). Uses the live gauntlet number for
 * "today's" freshness. Each carries exactly one link so it stays a
 * clean single-CTA post.
 */
export function draftArcadePost(
  date: Date,
  opts?: {
    /** Whether today's world-best kart ghost is actually seated in KV.
     *  The kart angle used to promise "the world best ghost is on
     *  track" unconditionally — on a zero-post day the evergreen link
     *  booted challengers into an empty promise. Callers with KV pass
     *  the real answer; default true preserves the old copy for
     *  callers without KV access. */
    kartGhostSeated?: boolean;
  },
): { text: string; charCount: number } {
  const gNum = gauntletNumber(date.getTime());
  const ghostSeated = opts?.kartGhostSeated ?? true;
  const angles: { text: string; url: string }[] = [
    {
      url: RUNNER_URL,
      text: [
        "Node Runner just got a new ending: reach the present and you go TO THE MOON.",
        "",
        "Surf bitcoin price history as the terrain, then keep running in low-gravity lunar overtime that never ends. One tap, no signup.",
        "",
        `Today's tape, the same for everyone: ${RUNNER_URL}`,
      ].join("\n"),
    },
    {
      url: GAUNTLET_URL,
      text: [
        `The Bitcoin Gauntlet #${gNum} is open.`,
        "",
        "Trade a hidden window of actual history, blind, against the DCA bot. One scored run today, the same window for everyone. Can you beat just buying and holding?",
        "",
        `Take today's run: ${GAUNTLET_URL}`,
      ].join("\n"),
    },
    {
      url: WEN_URL,
      text: [
        "wen moon? wen dip? wen was THIS?",
        "",
        `WEN #${gNum}: an actual 90 day slice of the bitcoin chart, dates redacted. 5 guesses, scored in sats, same puzzle for the whole world today.`,
        "",
        `Prove you lived the tape: ${WEN_URL}`,
      ].join("\n"),
    },
    {
      url: RUNNER_URL,
      text: [
        "Everyone runs the exact same bitcoin tape today in Node Runner, so today's board is a live race.",
        "",
        "Dodge the crashes at their true dates, stack sats, catch the present and launch to the moon. One tap.",
        "",
        `Where do you land? ${RUNNER_URL}`,
      ].join("\n"),
    },
    {
      url: SAYLOR_URL,
      text: [
        `Daily Summit #${gNum}: today the arcade picks level ${summitLevelFor(gNum)} of the bitcoin timeline and the whole world races it.`,
        "",
        "One life per attempt, retries all day, fastest climb tops the board. New mountain at UTC midnight.",
        "",
        `Race today's mountain: ${SAYLOR_URL}`,
      ].join("\n"),
    },
    {
      // ?ghost=daily boots straight into today's circuit with the world
      // best ghost on track · the evergreen dare link for the daily post.
      // When nobody has seated a ghost yet, the honest line is the
      // stronger one anyway: an unclaimed crown.
      url: `${KART_URL}?ghost=daily`,
      text: (() => {
        const c = kartComboFor(gNum);
        return [
          `Today's Bitcoin Kart circuit is ${c.track} in ${c.klass}${c.mirror ? ", mirrored" : ""}. Same combo for everyone, one board.`,
          "",
          "Full 3D kart racer in the browser. Team Bitcoin vs Team Fiat, one tap, no signup.",
          "",
          ghostSeated
            ? `The world best ghost is on track. Race it: ${KART_URL}?ghost=daily`
            : `Nobody has claimed today's best ghost yet. Be first: ${KART_URL}?ghost=daily`,
        ].join("\n");
      })(),
    },
  ];

  // Rotate by UTC day-of-year so consecutive days differ.
  const dayOfYear = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  const pick = angles[dayOfYear % angles.length];
  const charCount = pick.text.length - pick.url.length + URL_TCO_LENGTH;
  return { text: pick.text, charCount };
}

// ─────────────────────────────────────────────────────────────────
// Email rendering · the operator-facing daily digest. HTML + plain
// for email clients that strip styles.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Daily "one expert insight" draft · the growth engine (Nikita Bier's
// rule: post ONE unexpected, data-backed insight a day in the lane you
// know better than anyone, with the site as soft proof and never the
// headline). Rotates a bank of angles by UTC day so the operator gets
// a fresh non-replicable take each morning; each angle self-skips when
// its live number is missing, so the post is never empty as long as
// ANY data is available. Plain voice, no em dashes, one link, under
// five sentences · everything the treasury/float/circular-economy lane
// gives us that a generic Bitcoin account cannot replicate.
// ─────────────────────────────────────────────────────────────────

export type InsightData = {
  treasuries: {
    ticker: string;
    name: string;
    mNav: number | null;
    amplification: number | null;
  }[];
  totalTreasuries: number;
  btcPrice: number | null;
  gauge: { score: number; tier: string; driver: string } | null;
  /** BTC that left the open market over ~30 days (positive = float shrank). */
  floatDrain30d: number | null;
  vendorCount: number;
  countryCount: number;
  /** Live desk ticket. Present only when prize + an open machine exist.
   *  The insight wheel skips this slot on a sold-out or degraded day. */
  blockShot?: {
    prizeK: number;
    openTh: number;
    usd3: string;
    oneIn24: string;
  } | null;
};

const INSIGHT_URLS = {
  cheapest: "galaxymind.space/cheapest-bitcoin-treasury",
  belowNav: "galaxymind.space/bitcoin-treasuries-below-nav",
  amplification: "galaxymind.space/what-is-amplification",
  float: "galaxymind.space/float",
  gauge: "galaxymind.space/stack",
  mstr: "galaxymind.space/mstr-vs-bitcoin",
  circular: "galaxymind.space",
  blockshot: "galaxymind.space/hashrate",
} as const;

// Stable topic wheel · the same UTC day always PREFERS the same slot
// (steady cadence), then falls through to the next angle that has data.
const INSIGHT_WHEEL = [
  "cheapest",
  "belowNav",
  "amplification",
  "float",
  "gauge",
  "blockshot",
  "mstr",
  "circular",
] as const;

function insightAngles(
  d: InsightData,
): { key: string; body: string; url: string }[] {
  const angles: { key: string; body: string; url: string }[] = [];
  const withMnav = d.treasuries.filter((t) => t.mNav != null);

  if (withMnav.length) {
    const c = withMnav.reduce((a, b) => (b.mNav! < a.mNav! ? b : a));
    const x = c.mNav!;
    const eff = d.btcPrice != null ? d.btcPrice * x : null;
    const disc =
      eff != null && d.btcPrice != null && d.btcPrice > 0
        ? Math.round((1 - eff / d.btcPrice) * 100)
        : null;
    const body =
      x < 1 && disc != null
        ? `The cheapest way to own bitcoin through the stock market right now is ${c.name} (${c.ticker}) at ${x.toFixed(2)}x mNAV. You are paying about ${disc}% less than the bitcoin it holds. Most lists update weekly; we recompute this every 5 minutes.`
        : `The cheapest bitcoin treasury stock right now is ${c.name} (${c.ticker}) at ${x.toFixed(2)}x mNAV, the smallest premium of the ones tracked. mNAV is market cap over the value of the bitcoin held. Live ranking, refreshed every 5 minutes.`;
    angles.push({ key: "cheapest", body, url: INSIGHT_URLS.cheapest });
  }

  const below = withMnav.filter((t) => t.mNav! < 1.0);
  if (below.length) {
    angles.push({
      key: "belowNav",
      body: `${below.length} of the ${d.totalTreasuries} bitcoin treasuries tracked ${below.length === 1 ? "is" : "are"} trading below the value of the bitcoin they hold right now. The market is handing out bitcoin at a discount through equities, and almost nobody is watching. Here is the live list.`,
      url: INSIGHT_URLS.belowNav,
    });
  }

  const amp = d.treasuries
    .filter((t) => t.amplification != null && t.amplification > 1.05)
    .sort((a, b) => b.amplification! - a.amplification!)[0];
  if (amp) {
    angles.push({
      key: "amplification",
      body: `${amp.name} (${amp.ticker}) shares carry about ${amp.amplification!.toFixed(2)}x the bitcoin they net after senior claims. That hidden leverage is the lever that can beat bitcoin or trail it, and almost no tracker prices it. The math, live.`,
      url: INSIGHT_URLS.amplification,
    });
  }

  if (d.floatDrain30d != null && d.floatDrain30d > 0) {
    angles.push({
      key: "float",
      body: `About ${Math.round(d.floatDrain30d).toLocaleString("en-US")} BTC left the open market in the last 30 days. ETFs and treasuries keep absorbing more than miners create, and the next halving cuts new supply again. How much is realistically left to buy.`,
      url: INSIGHT_URLS.float,
    });
  }

  if (d.gauge) {
    angles.push({
      key: "gauge",
      body: `Bitcoin Buying Gauge: ${d.gauge.score}/100, ${d.gauge.tier}. ${d.gauge.driver}. Ten on-chain and market signals compressed into one honest number, updated live.`,
      url: INSIGHT_URLS.gauge,
    });
  }

  const mstr = d.treasuries.find((t) => t.ticker === "MSTR" && t.mNav != null);
  if (mstr) {
    const prem = Math.round((mstr.mNav! - 1) * 100);
    angles.push({
      key: "mstr",
      body:
        mstr.mNav! >= 1
          ? `The market pays about $${mstr.mNav!.toFixed(2)} for every $1 of bitcoin inside MSTR right now, a ${prem}% premium. Whether that is genuine accretion or just hype is the whole treasury-stock debate. Three honest ways to read it.`
          : `MSTR is trading at ${mstr.mNav!.toFixed(2)}x mNAV right now, below the value of the bitcoin it holds. The flagship treasury at a discount to its own coin is rare. Three honest ways to read it.`,
      url: INSIGHT_URLS.mstr,
    });
  }

  if (d.vendorCount > 0) {
    angles.push({
      key: "circular",
      body: `${d.vendorCount} merchants across ${d.countryCount} countries now take bitcoin for everyday goods, not speculation. The spending economy is compounding quietly next to the saving one, and it barely makes headlines. The live directory.`,
      url: INSIGHT_URLS.circular,
    });
  }

  if (
    d.blockShot &&
    d.blockShot.openTh > 0 &&
    d.blockShot.usd3 &&
    d.blockShot.oneIn24
  ) {
    const bs = d.blockShot;
    angles.push({
      key: "blockshot",
      body: `${bs.openTh.toLocaleString("en-US")} TH/s of our USA ASICs is open to rent. The machines are already hashing. Point them at your pool. A 3 hour run is about $${bs.usd3}.`,
      url: INSIGHT_URLS.blockshot,
    });
  }

  return angles;
}

export function draftInsightPost(
  date: Date,
  data: InsightData,
): { text: string; charCount: number; angle: string } | null {
  const angles = insightAngles(data);
  if (angles.length === 0) return null;
  const dayIndex = Math.floor(date.getTime() / 86_400_000);
  const start = ((dayIndex % INSIGHT_WHEEL.length) + INSIGHT_WHEEL.length) %
    INSIGHT_WHEEL.length;
  let fallback: { text: string; charCount: number; angle: string } | null = null;
  for (let i = 0; i < INSIGHT_WHEEL.length; i++) {
    const key = INSIGHT_WHEEL[(start + i) % INSIGHT_WHEEL.length];
    const a = angles.find((x) => x.key === key);
    if (!a) continue;
    const text = `${a.body}\n${a.url}`;
    const charCount = text.length - a.url.length + URL_TCO_LENGTH;
    if (charCount <= X_TARGET_LENGTH) {
      return { text, charCount, angle: a.key };
    }
    if (!fallback) fallback = { text, charCount, angle: a.key };
  }
  // Every available angle overshot the target (very unlikely) · post the
  // first one anyway rather than skip the day.
  return fallback;
}

export type DraftBundle = {
  x: { text: string; charCount: number; mentionedHandles: string[] };
  nostr: { text: string; charCount: number };
  picksX: Vendor[];
  picksNostr: Vendor[];
  // The daily Bier-style expert insight · the primary growth post.
  insight?: { text: string; charCount: number; angle: string } | null;
  // Optional weekly/monthly extras · present only when the cron's
  // cadence gate fires (gauge on Mondays, float on the 1st of the
  // month) or in dry-run. Null/absent on ordinary days.
  gauge?: { text: string; charCount: number } | null;
  float?: { text: string; charCount: number } | null;
  // Daily arcade line · the games are the viral surface, so this ships
  // every day (unlike the weekly/monthly gauge/float extras).
  arcade?: { text: string; charCount: number } | null;
  // Daily Block Shot line · the revenue surface (operator ask
  // 2026-08-04). Null whenever the desk feeds cannot support the
  // numbers — absent beats invented.
  blockShot?: { text: string; charCount: number } | null;
  // The topical line (operator ask 2026-08-08). Present ONLY on a day
  // when one of draftTopicalPost's gated hooks fires; null on an
  // ordinary day, which is the designed outcome rather than a gap.
  topical?: TopicalDraft | null;
  // Monday-only: this ISO week's FeaturedVendor pick, so the homepage
  // rotation actually gets a draft. Null on other days.
  featured?: { text: string; charCount: number } | null;
  // Daily badge-DM drip · paste-ready messages for the operator to
  // send to listed merchants. Null when the KV read failed (do not
  // draft a repeating set). Empty array when the campaign is done.
  badgeOutreach?: {
    name: string;
    handle: string;
    channelHref: string | null;
    channelLabel: string;
    dm: string;
  }[] | null;
  // One public launch post so the roster can self-serve at /badge
  // instead of 131 DMs. Present for 7 days after first drafts email.
  badgeLaunch?: { text: string; charCount: number } | null;
  // Monday-only operator card: this week's oldest verifiedAt batch.
  // Not a social post. Never writes verifiedAt.
  reverifyBatch?: {
    text: string;
    largestDate: string;
    largestCount: number;
    batchSize: number;
  } | null;
};

/**
 * Monday operator card: this week's oldest verifiedAt batch.
 * Not a tweet. Never writes verifiedAt. A bulk bump just moves the wall.
 */
export function draftReverifyBatchCard(
  vendors: readonly Vendor[],
  now: Date,
): {
  text: string;
  largestDate: string;
  largestCount: number;
  batchSize: number;
} {
  const stats = verifiedAtClusterStats(vendors, now.getTime() / 1000);
  const largestDate = stats.largest?.date ?? "none";
  const largestCount = stats.largest?.count ?? 0;
  const daysUntilStale = stats.largest?.daysUntilStale;
  const wallLine =
    daysUntilStale == null
      ? `${largestCount} of ${stats.total} listings share verifiedAt ${largestDate}.`
      : daysUntilStale < 0
        ? `${largestCount} of ${stats.total} listings share verifiedAt ${largestDate}. That cohort is ${-daysUntilStale} days past the ${STALE_THRESHOLD_DAYS}-day human-touch backstop.`
        : `${largestCount} of ${stats.total} listings share verifiedAt ${largestDate}. That cohort hits the ${STALE_THRESHOLD_DAYS}-day backstop in ${daysUntilStale} days.`;
  const lines = [
    wallLine,
    "Never bulk-bump verifiedAt to silence it.",
    "",
    `This week's oldest ${REVERIFY_BATCH_SIZE}. Spot-check they still take bitcoin, then run:`,
    `npx tsx scripts/reverify-vendors.ts --limit ${REVERIFY_BATCH_SIZE}`,
    "",
  ];
  if (stats.nextBatch.length === 0) {
    lines.push("Pool is empty. Everyone was re-checked in the last 30 days.");
  } else {
    for (const v of stats.nextBatch) {
      lines.push(`${v.handle}  ${v.ageDays}d  ${v.date}`);
    }
  }
  return {
    text: lines.join("\n"),
    largestDate,
    largestCount,
    batchSize: stats.nextBatch.length,
  };
}

const HASHRATE_URL = "galaxymind.space/hashrate";

/**
 * Daily Block Shot draft · the revenue surface, in the daily email
 * (operator ask 2026-08-04). Live numbers only: open capacity and the
 * 3-hour entry ticket. Returns null when the feeds cannot support the
 * claims (a drafted number from a fallback is exactly the failure mode
 * the snapshot-quality gate exists for). This draft describes the
 * SERVICE (USA machines, already hashing, pointed at the renter's pool).
 * Block odds stay on /hashrate.
 */
export function draftBlockShotPost(
  desk: HashrateDesk,
): { text: string; charCount: number } | null {
  if (
    desk.blockRewardBtc == null ||
    desk.btcUsd == null ||
    desk.networkPhs == null
  ) {
    return null;
  }
  const prizeUsd = desk.blockRewardBtc * desk.btcUsd;
  // Round the prize DOWN to the nearest $1k — a drafted number that
  // overstates the live prize even briefly is a claim we never make.
  const prizeK = Math.floor(prizeUsd / 1000);

  // Same pure summary the strip + calculator use — never re-derive open
  // TH with a different rounding path (sum-then-round vs round-then-sum
  // can disagree by 1 TH on edge floats).
  const open = summarizeOpenFleet(desk.ourRigs);

  // Entry ticket from the best single open machine · same cost math
  // the page quotes. Odds stay on /hashrate itself.
  let usd3: string | null = null;
  if (open.bestPh != null && open.bestAsk != null) {
    const c3 = rentalCostBtc({
      ph: open.bestPh,
      hours: 3,
      askBtcPerPhDay: open.bestAsk,
    });
    if (c3 != null) {
      usd3 = (c3 * desk.btcUsd).toFixed(2);
    }
  }

  // When machines are open, lead with the instrument numbers people
  // screenshot (prize · $ cost · 1-in-N · open TH). Ticket math can
  // fail independently of availability — never fall through to the
  // sold-out line while openCount > 0 (that was a real false claim).
  // When sold out, keep the scarcity line without inventing a ticket.
  let body: string;
  if (open.openCount > 0 && open.openTh > 0) {
    const openLine = `${open.openTh.toLocaleString("en-US")} TH/s is open right now.`;
    const ticketLine =
      usd3 != null
        ? `A 3 hour run is about $${usd3}.`
        : "Point them at your pool. Any block they find pays you.";
    body = [
      `${openLine} USA machines, already hashing. Point them at your pool.`,
      "",
      ticketLine,
      "",
      HASHRATE_URL,
    ].join("\n");
  } else if (open.comingCount > 0) {
    body = [
      `The next bitcoin block pays about $${prizeK.toLocaleString("en-US")},000 to whoever finds it.`,
      "",
      `Nothing is open to rent right now. ${open.comingCount} more machines are still being brought online.`,
      "",
      HASHRATE_URL,
    ].join("\n");
  } else {
    body = [
      `The next bitcoin block pays about $${prizeK.toLocaleString("en-US")},000 to whoever finds it.`,
      "",
      "We rent named USA miners by the day, 1 to 30 days. Every machine is rented out at the moment, and they free up on a rolling basis.",
      "",
      HASHRATE_URL,
    ].join("\n");
  }

  const charCount = body.length - HASHRATE_URL.length + URL_TCO_LENGTH;
  return { text: body, charCount };
}

/* ── THE DAILY TOPICAL LINE (operator ask 2026-08-08) ─────────────────
 *
 * "See if you can add at least one topical post or element to the daily
 * posts draft email I get every day."
 *
 * The whole design rests on one lesson this repo already paid for in
 * CHOP's blockfacts.js: every candidate fact is BORING in its common
 * case, so an ungated hook prints the same true sentence every morning
 * and becomes wallpaper the operator scrolls past. Each hook here
 * therefore carries a numeric CONDITION describing when its number is
 * genuinely unusual, and the drafter returns null when nothing is.
 *
 * A quiet day producing NO topical line is the correct output, not a
 * gap to paper over. The other five drafts still ship.
 *
 * Composed entirely from data the cron ALREADY fetched — desk, market
 * snapshot, float, gauge verdict. Zero new upstream calls and zero new
 * KV reads, the same discipline /today runs on.
 *
 * Adding a hook: give it a condition that is FALSE on an ordinary day.
 * If you cannot state one, the fact belongs in the evergreen drafts
 * instead. scripts/test-social-drafts.ts asserts every hook stays
 * silent on a deliberately dull day.
 */
export type TopicalCtx = {
  desk: HashrateDesk | null;
  /** Live block height, for subsidy and halving math. */
  blockHeight: number | null;
  /** Yesterday's height, so a milestone CROSSING can be detected. */
  prevBlockHeight: number | null;
  /** Cheapest tracked treasury mNAV, when the snapshot carried one. */
  cheapestMNav: { ticker: string; mNav: number } | null;
  gauge: { score: number; tier: string } | null;
  now: Date;
};

export type TopicalDraft = {
  text: string;
  charCount: number;
  /** Which hook fired, shown in the email so the operator knows why. */
  hook: string;
  /** Plain-English statement of the condition that fired. */
  because: string;
};

const CALC_URL = "galaxymind.space/solo-mining-calculator";

/** Days-to-halving markers worth marking. Crossed, never matched. */
const HALVING_MILESTONES = [365, 200, 100, 50, 30, 14, 7, 1];

/** Fees this far above subsidy mean the mempool is genuinely busy. */
const FEE_SPIKE_SHARE = 0.05;

/**
 * Pick today's topical draft, or null on an ordinary day.
 * Hooks are tried in order and the FIRST one that fires wins, so the
 * list is ranked by how much a bitcoiner would care, not by how often
 * it fires.
 */
export function draftTopicalPost(ctx: TopicalCtx): TopicalDraft | null {
  const nowMs = ctx.now.getTime();
  const desk = ctx.desk;

  const withCount = (
    text: string,
    hook: string,
    because: string,
    url: string,
  ): TopicalDraft => ({
    text,
    charCount: text.length - url.length + URL_TCO_LENGTH,
    hook,
    because,
  });

  // 1 · HALVING MILESTONE. Rare and unambiguously worth marking.
  //     Detected as a CROSSING against yesterday's height, because block
  //     times wander and an exact-match on a rounded day count silently
  //     skips a milestone whenever the chain runs fast.
  if (ctx.blockHeight != null && ctx.prevBlockHeight != null) {
    const today = daysUntilNextHalving(ctx.blockHeight);
    const prev = daysUntilNextHalving(ctx.prevBlockHeight);
    const crossed = HALVING_MILESTONES.find((m) => prev > m && today <= m);
    if (crossed != null) {
      const text = [
        `${crossed === 1 ? "One day" : `${crossed} days`} to the halving.`,
        "",
        `Block subsidy drops to ${(blockSubsidyAt(nextHalvingHeight(ctx.blockHeight)) ).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} BTC and every miner on earth takes a pay cut on the same block. The countdown and what it does to supply is here: galaxymind.space/bitcoin-halving-countdown`,
      ].join("\n");
      return withCount(
        text,
        "halving milestone",
        `crossed ${crossed} days to halving`,
        "galaxymind.space/bitcoin-halving-countdown",
      );
    }
  }

  // 2 · FEE SPIKE. Fees normally round to under 1% of the block reward,
  //     so a 5% read means the mempool is doing something people are
  //     already arguing about.
  if (
    desk?.blockRewardBtc != null &&
    desk.btcUsd != null &&
    ctx.blockHeight != null
  ) {
    const subsidy = blockSubsidyAt(ctx.blockHeight);
    const fees = desk.blockRewardBtc - subsidy;
    const share = fees / desk.blockRewardBtc;
    if (fees > 0 && share >= FEE_SPIKE_SHARE) {
      const feeUsd = Math.round(fees * desk.btcUsd);
      const text = [
        `Fees are running at ${Math.round(share * 100)}% of the block reward right now.`,
        "",
        `That is about $${feeUsd.toLocaleString("en-US")} of every block coming from fees instead of subsidy, on a day most blocks pay under 1%. Whoever finds the next one gets the whole thing: ${HASHRATE_URL}`,
      ].join("\n");
      return withCount(
        text,
        "fee spike",
        `fees are ${Math.round(share * 100)}% of the block reward (normal is under 1%)`,
        HASHRATE_URL,
      );
    }
  }

  // (Hook 3, the solo-pool block post, was removed 2026-10-17: we are not
  //  affiliated with any pool, so we do not post another pool's blocks.)

  // 4 · GAUGE EXTREME. Same thresholds the email alerts fire on, so if
  //     this hook trips the operator is already hearing about it.
  if (ctx.gauge != null && (ctx.gauge.score >= 80 || ctx.gauge.score <= 20)) {
    const hot = ctx.gauge.score >= 80;
    const text = [
      `The buying gauge just hit ${ctx.gauge.score} out of 100.`,
      "",
      `That is ${ctx.gauge.tier} territory, and it only reads this ${hot ? "hot" : "cold"} a few times a year. Ten signals, all shown with their weights: galaxymind.space/stack`,
    ].join("\n");
    return withCount(
      text,
      "gauge extreme",
      `gauge score ${ctx.gauge.score} is past the ${hot ? "80" : "20"} alert threshold`,
      "galaxymind.space/stack",
    );
  }

  // 5 · TREASURY BELOW NAV. A public company holding bitcoin worth more
  //     than the whole company is genuinely strange, and it does not
  //     last long when it happens.
  if (ctx.cheapestMNav != null && ctx.cheapestMNav.mNav < 1) {
    const { ticker, mNav } = ctx.cheapestMNav;
    const discount = Math.round((1 - mNav) * 100);
    const text = [
      `${ticker} is trading at ${mNav.toFixed(2)} times the bitcoin it holds.`,
      "",
      `You are paying ${discount}% less than the coins are worth, before counting the rest of the business. It rarely stays there. Live mNAV on every tracked treasury: galaxymind.space/treasuries`,
    ].join("\n");
    return withCount(
      text,
      "treasury below NAV",
      `${ticker} mNAV ${mNav.toFixed(2)} is under 1.00`,
      "galaxymind.space/treasuries",
    );
  }

  // 6 · FLEET SOLD OUT. Real scarcity, never manufactured: this fires
  //     only when every machine we list is genuinely rented.
  const rigs = desk?.ourRigs ?? [];
  if (rigs.length > 0 && rigs.every((r) => r.status === "rented")) {
    const text = [
      "Every machine we rent out is booked right now.",
      "",
      `${rigs.length} of ${rigs.length} out working for other people, all of them pointed at whatever pool the renter picked. They come back on a rolling basis, and you can see the odds before you book: ${CALC_URL}`,
    ].join("\n");
    return withCount(
      text,
      "fleet sold out",
      `all ${rigs.length} listed machines are rented`,
      CALC_URL,
    );
  }

  // Ordinary day. Silence is the correct answer.
  return null;
}

const ACCENT = "#F7931A";

/**
 * One draft card in the email.
 *
 * Every section used to carry its own copy of this ~15-line block, which
 * is how the arcade card ended up with different label spacing than the
 * rest and why adding a section meant pasting markup. Returns "" for an
 * absent draft so a caller can drop it in unconditionally — the null
 * checks live here, not at seven call sites.
 */
function draftCard(o: {
  label: string;
  text: string | null | undefined;
  /** Grey line between the label and the draft (what the section is for). */
  note?: string;
  /** Grey line under the draft (mentions, cooldowns). */
  footnote?: string;
  /** Accent ring. The insight post is the growth post, so it wears it. */
  highlight?: boolean;
  /** Nostr drafts have no X composer to open. */
  composer?: boolean;
  /** Attribution on the composer link. */
  via?: boolean;
}): string {
  if (!o.text) return "";
  const border = o.highlight ? ACCENT : "#26262C";
  const labelGap = o.note ? "6px" : "10px";
  const composer =
    o.composer === false
      ? ""
      : `
      <div style="margin-top:14px;">
        <a href="https://x.com/intent/tweet?text=${encodeURIComponent(o.text)}${o.via ? "&via=GalaxyMind" : ""}" style="display:inline-block;background:${ACCENT};color:#12110F;text-decoration:none;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;padding:10px 18px;border-radius:6px;">
          Open in X composer →
        </a>
      </div>`;
  return `
    <div style="border:1px solid ${border};border-radius:12px;padding:20px;margin-bottom:20px;background:#1C1A16;">
      <div style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${ACCENT};margin-bottom:${labelGap};">
        ${o.label}
      </div>${
        o.note
          ? `
      <div style="font-size:11px;color:#8C8C96;margin:0 0 10px;">${o.note}</div>`
          : ""
      }
      <pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;color:#F2EFE9;white-space:pre-wrap;margin:0;padding:12px;background:#1C1C21;border-radius:8px;">${escapeHtml(o.text)}</pre>${
        o.footnote
          ? `
      <div style="font-size:11px;color:#8C8C96;margin-top:10px;">${o.footnote}</div>`
          : ""
      }${composer}
    </div>`;
}

/**
 * Render the daily drafts as an email body. Returns subject + HTML.
 * The HTML wraps each draft in a copy-friendly <pre> block so the
 * operator can paste cleanly into the X composer / Damus client.
 */
export function renderDraftsEmail(bundle: DraftBundle, date: Date): {
  subject: string;
  html: string;
} {
  const accent = ACCENT;
  const dateStr = date.toISOString().slice(0, 10);
  const subject = `Galaxy Mind · daily social drafts · ${dateStr}`;
  const badgeOutreach = bundle.badgeOutreach;
  const badgeOutreachCount = badgeOutreach?.length ?? 0;

  const xMentions = bundle.x.mentionedHandles
    .map((h) => `@${h}`)
    .join(", ");

  // HTML-escape the drafts before injecting into <pre> blocks · the
  // text comes from server-controlled VENDORS data but defense-in-
  // depth · same pattern as the rest of our email renders.
  const xEscaped = escapeHtml(bundle.x.text);
  const nostrEscaped = escapeHtml(bundle.nostr.text);

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#12110F;color:#F2EFE9;font-family:ui-sans-serif,system-ui,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#A5A096;margin-bottom:8px;">
      Galaxy Mind · Daily social drafts
    </div>
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 8px;color:${accent};font-weight:600;">
      Drafts for ${dateStr}
    </h1>
    <p style="font-size:13px;line-height:1.55;color:#A5A096;margin:8px 0 32px;">
      ${bundle.picksX.length} X vendor${bundle.picksX.length === 1 ? "" : "s"} ·
      ${bundle.picksNostr.length} Nostr vendor${bundle.picksNostr.length === 1 ? "" : "s"} ·
      ${badgeOutreachCount} badge DM${badgeOutreachCount === 1 ? "" : "s"} ·
      14-day cooldown enforced. Copy &amp; post, or edit first. Marked
      used in KV when this email was sent.
    </p>

${draftCard({
  label: `★ X post 1 · Daily insight (grow the account) · ${bundle.insight?.charCount}/280 chars`,
  text: bundle.insight?.text,
  note: `One unexpected, data-backed insight in your lane · the Bier growth cadence. Today's angle: ${escapeHtml(bundle.insight?.angle ?? "")}.`,
  highlight: true,
  via: true,
})}${draftCard({
  label: `⚡ Topical · ${bundle.topical?.hook ?? ""} · ${bundle.topical?.charCount}/280 chars`,
  text: bundle.topical?.text,
  note: `Fired because ${escapeHtml(bundle.topical?.because ?? "")}. Post this one FIRST, while it is still true.`,
  highlight: true,
  via: true,
})}${draftCard({
  label: `★ X post 2 · Vendor spotlight · ${bundle.x.charCount}/280 chars`,
  text: bundle.x.text,
  footnote: xMentions ? `Mentioned: ${escapeHtml(xMentions)}` : undefined,
})}${draftCard({
  label: `★ Nostr · ${bundle.nostr.charCount} chars`,
  text: bundle.nostr.text,
  composer: false,
})}${draftCard({
  label: `★ Daily arcade · the games · ${bundle.arcade?.charCount}/280 chars`,
  text: bundle.arcade?.text,
})}${draftCard({
  label: `★ Block Shot · the rental desk · ${bundle.blockShot?.charCount}/280 chars`,
  text: bundle.blockShot?.text,
  note: "Open TH, USA machines already hashing, 1-day price. Post while the open-TH figure is still true.",
  highlight: true,
  via: true,
})}${draftCard({
  label: `★ This week's featured merchant · ${bundle.featured?.charCount}/280 chars`,
  text: bundle.featured?.text,
  note: "The homepage spotlight, as a post. ISO week pick. Skip if you already posted them.",
})}${draftCard({
  label: `Re-verify batch · ${bundle.reverifyBatch?.batchSize ?? 0} oldest listings`,
  text: bundle.reverifyBatch?.text,
  note: "Operator work, not a post. Spot-check they still take bitcoin, then run the command. Never bulk-bump verifiedAt.",
  composer: false,
  highlight: true,
})}${draftCard({
  label: `★ Weekly gauge weather report · ${bundle.gauge?.charCount}/280 chars`,
  text: bundle.gauge?.text,
})}${draftCard({
  label: `★ Monthly State of the Float · ${bundle.float?.charCount}/280 chars`,
  text: bundle.float?.text,
})}${draftCard({
  label: `★ Badge launch · post ONCE · ${bundle.badgeLaunch?.charCount}/280 chars`,
  text: bundle.badgeLaunch?.text,
  note: "This is how the whole roster hears about the badge without 131 DMs. Post it, then skip. The card drops off after a week.",
  highlight: true,
  via: true,
})}${badgeOutreachCards(badgeOutreach)}

    <hr style="border:none;border-top:1px solid #26262C;margin:32px 0;">
    <p style="font-size:11px;color:#8C8C96;line-height:1.6;">
      Generated by /api/cron/social-post-drafts. To pause this digest,
      set SOCIAL_AUTOMATION_DISABLED=1 in Vercel. To preview without
      marking-as-used, set DRY_RUN_SOCIAL=1.
    </p>
  </div>
</body></html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function badgeOutreachCards(
  items: DraftBundle["badgeOutreach"],
): string {
  if (items == null) return "";
  if (items.length === 0) {
    return `
    <div style="border:1px solid #26262C;border-radius:12px;padding:20px;margin-bottom:20px;background:#1C1A16;">
      <div style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${ACCENT};margin-bottom:10px;">
        Badge DMs
      </div>
      <div style="font-size:13px;color:#A5A096;line-height:1.55;">Every listed merchant has already been drafted a badge DM.</div>
    </div>`;
  }
  const heading = `
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#A5A096;margin:8px 0 16px;">
      Badge DMs to send today · paste into X or Nostr, not a public post
    </div>`;
  const cards = items
    .map((item, i) =>
      draftCard({
        label: `Badge DM ${i + 1}/${items.length} · ${item.name} · ${item.channelLabel}`,
        text: item.dm,
        note: "Paste into a DM. The HTML snippet is the badge they put on their shop. A click lands on their listing.",
        footnote: item.channelHref
          ? `Open their profile: ${escapeHtml(item.channelHref)}`
          : undefined,
        composer: false,
      }),
    )
    .join("");
  return heading + cards;
}

/**
 * Recipients for the daily social-drafts email.
 *
 * One address only: SOCIAL_DRAFTS_EMAIL (repointed to a direct inbox
 * on 2026-09-11 after the previous address bounced).
 * Dual-send to SUBMISSION_NOTIFY_EMAIL was removed 2026-09-04 after
 * both addresses landed as duplicate copies in one inbox.
 * Pure — unit-testable without live env.
 */
export function buildSocialDraftRecipients(opts: {
  primary?: string | null;
  /** Second inbox, used ONLY as failover. See `useFallback`. */
  fallback?: string | null;
  /**
   * Add `fallback` alongside `primary` for THIS send.
   *
   * Dual-send was the default until 2026-09-04 and was reverted because
   * both addresses reach the same inbox and every draft arrived
   * twice. That revert is why a bounce is now total loss: there is a
   * single primary address, and when it rejected on 2026-09-03 and
   * 2026-09-11 there was no second path.
   *
   * So this is not a return to dual-send. It is off on every normal
   * run and switches on only for the run FOLLOWING a confirmed bounce —
   * failover, not routine duplication.
   */
  useFallback?: boolean;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    const email = (raw ?? "").trim();
    if (!email) return;
    // Case-fold for the dedupe only; the address is sent as written.
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(email);
  };
  push(opts.primary);
  if (opts.useFallback) push(opts.fallback);
  return out;
}