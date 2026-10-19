/**
 * Nostr post content filter · used by VendorRecentPosts to skip
 * obscene, profane, or spammy content from public display on the
 * vendor detail page.
 *
 * SCOPE: this filter is a minimum-viable safety net, not a thought-
 * police tool. The aim is to catch posts that would visibly damage
 * the directory's reputation (slurs, scam pitches, spam) while
 * preserving the vendor's authentic voice (mild profanity, strong
 * opinions, political takes are deliberately NOT filtered · those
 * are part of why people are on Nostr in the first place).
 *
 * LAYERED CHECKS (in order, first-fail wins):
 *   1. Length sanity     · skip empty/test posts (<10 chars) and
 *                          oversize posts (>500 chars don't fit the
 *                          UI cleanly anyway)
 *   2. Strong profanity  · word-boundary match on a small list
 *   3. Slurs             · word-boundary match on a small list
 *   4. Spam phrases      · substring match on common scam patterns
 *   5. Shouting          · skip if >40% of letters are uppercase
 *                          AND content is >30 chars (avoid filtering
 *                          short legit acronyms)
 *   6. URL spam          · skip if >2 URLs (1 link is fine, 3+ is
 *                          usually a promo dump)
 *   7. Emoji density     · skip if >8 emoji (legitimate posts rarely
 *                          exceed this; spammers often do)
 *
 * INTERNAL LISTS · the filter terms below are detection only, not
 * endorsements. They're stored in source code (visible to repo
 * readers) because:
 *   · The site is open-source-friendly · no point obfuscating
 *   · Grep-ability matters · operator can find/extend the list
 *   · Hashing/encoding adds maintenance burden for zero security
 *     benefit (this is a moderation policy, not a secret)
 * Extend the lists as needed when real-world false-negatives
 * surface.
 */

// Strong profanity · word-boundary matched. Mild words ("damn",
// "hell", "crap") deliberately omitted · context matters and the
// filter would catch too many religious / expressive posts.
const PROFANITY_WORDS: readonly string[] = [
  "fuck",
  "fucking",
  "fucked",
  "fucker",
  "shit",
  "shitty",
  "bullshit",
  "bitch",
  "cock",
  "dick",
  "pussy",
  "cunt",
  "asshole",
  "motherfucker",
];

// Slurs · keep this list private + minimal. Word-boundary matched.
// Operator can extend; current set covers the most common patterns
// that would publicly damage the directory.
const SLUR_WORDS: readonly string[] = [
  // Racial / ethnic
  "nigger",
  "nigga",
  "chink",
  "spic",
  "kike",
  // Sexual orientation
  "faggot",
  "fag",
  "tranny",
  // Gendered
  "whore",
  "slut",
  // Religious
  "raghead",
];

// Spam phrases · substring match (case-insensitive). Common crypto
// scam patterns + general clickbait. Phrases here will skip ANY post
// containing them, even if the post is otherwise legitimate.
const SPAM_PHRASES: readonly string[] = [
  "click here to claim",
  "dm me to claim",
  "free crypto",
  "free bitcoin",
  "double your bitcoin",
  "double your btc",
  "send 0.1 btc",
  "send 1 btc",
  "send btc to",
  "guaranteed returns",
  "elon musk giveaway",
  "metamask support",
  "ledger support team",
  "trezor support team",
  "wallet recovery",
  "seed phrase",
  "claim airdrop",
  "limited time offer",
];

const URL_REGEX = /https?:\/\/\S+/gi;

// Emoji-detect range · covers most pictographic emoji used on Nostr.
// Not exhaustive (skin-tone modifiers + ZWJ sequences each count as
// multiple chars by this regex), which is fine · the threshold is
// liberal enough that legitimate-but-emoji-heavy posts still pass.
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

// Pre-compiled regex tables · audit 2026-05-22 (M6 deferred from the
// 2026-05-21 security audit). Previously `new RegExp("\\b" + word +
// "\\b", "i")` was invoked INSIDE the per-word for-loop in
// shouldDisplayPost · 14 profanity + 13 slur = 27 regex compilations
// per call. With the moderation filter running on every Nostr post
// fetched (3-10 posts × N vendor pages × first-time-visit per cache
// miss), this was real waste. Hoisting to module scope = compile once
// per process. Functional behavior identical.
const PROFANITY_REGEXES: { word: string; re: RegExp }[] = PROFANITY_WORDS.map(
  (word) => ({ word, re: new RegExp(`\\b${word}\\b`, "i") }),
);
const SLUR_REGEXES: { word: string; re: RegExp }[] = SLUR_WORDS.map((word) => ({
  word,
  re: new RegExp(`\\b${word}\\b`, "i"),
}));

/**
 * Reusable word-boundary screen over the profanity + slur lists.
 * Returns the first hit (kind + word) or null. Exported so surfaces
 * beyond the Nostr post strip — e.g. arcade leaderboard handles, which
 * persist on public boards for up to 180 days — share these lists
 * instead of growing their own.
 */
export function matchProfanityOrSlur(
  text: string,
): { kind: "profanity" | "slur"; word: string } | null {
  for (const { word, re } of PROFANITY_REGEXES) {
    if (re.test(text)) return { kind: "profanity", word };
  }
  for (const { word, re } of SLUR_REGEXES) {
    if (re.test(text)) return { kind: "slur", word };
  }
  return null;
}

export type FilterResult =
  | { keep: true }
  | { keep: false; reason: string };

export function shouldDisplayPost(content: string): FilterResult {
  // ─── Length sanity ─────────────────────────────────────────
  if (content.length < 10) return { keep: false, reason: "too-short" };
  if (content.length > 500) return { keep: false, reason: "too-long" };

  // ─── URL-only posts ────────────────────────────────────────
  // Nostr image/video posts are frequently just a bare media URL
  // with no caption (the client renders the media inline; we only
  // render text). Strip all URLs and check what readable text is
  // left · if <10 non-whitespace chars remain, the post is
  // effectively contentless in a text strip. (Smoke-test finding
  // 2026-05-14 · a TitanDot post was just a blossom.band .jpg URL.)
  const withoutUrls = content.replace(URL_REGEX, "").trim();
  if (withoutUrls.replace(/\s+/g, "").length < 10) {
    return { keep: false, reason: "url-only" };
  }

  // ─── Profanity + slurs (word-boundary matched) ─────────────
  const hit = matchProfanityOrSlur(content);
  if (hit) return { keep: false, reason: `${hit.kind}:${hit.word}` };

  // ─── Spam phrases (substring) ──────────────────────────────
  const lower = content.toLowerCase();
  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      return { keep: false, reason: `spam:${phrase}` };
    }
  }

  // ─── Shouting (>40% uppercase letters in content >30 chars) ─
  // Short acronyms (like "BTC LFG" · 100% uppercase, 7 chars) pass
  // because the length floor protects them.
  if (content.length > 30) {
    const letters = content.match(/[A-Za-z]/g) ?? [];
    const upper = content.match(/[A-Z]/g) ?? [];
    if (letters.length > 0 && upper.length / letters.length > 0.4) {
      return { keep: false, reason: "shouting" };
    }
  }

  // ─── URL spam (>2 URLs) ────────────────────────────────────
  const urlCount = (content.match(URL_REGEX) ?? []).length;
  if (urlCount > 2) return { keep: false, reason: "url-spam" };

  // ─── Emoji density (>8 emoji) ──────────────────────────────
  const emojiCount = (content.match(EMOJI_REGEX) ?? []).length;
  if (emojiCount > 8) return { keep: false, reason: "emoji-density" };

  return { keep: true };
}

/**
 * Filter a list of posts and return the top N that pass. Useful
 * pattern: caller fetches 10 from relays, asks for 3 to display ·
 * filtered-out posts get replaced by next-most-recent post that
 * passes, so a couple of spam posts don't leave the section empty.
 */
export function filterAndSelectPosts<T extends { content: string }>(
  posts: T[],
  take: number,
): T[] {
  const out: T[] = [];
  for (const p of posts) {
    if (out.length >= take) break;
    if (shouldDisplayPost(p.content).keep) out.push(p);
  }
  return out;
}
