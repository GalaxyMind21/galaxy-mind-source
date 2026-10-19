// Submit-door guardrails. Pure, isomorphic, no fetches, no Date, no KV.
//
// The API route is still the HTTP source of truth (honeypot, Turnstile,
// rate limit, duplicate check, LN-guard fetch, KV write). This module
// is the *content* gate that used to live inline in that route: handle
// shape, platform consistency, bitcoin-is-the-product, bait, website
// SSRF, the checkout attestation. The form imports the same functions
// so a genuine merchant sees the error before the POST; a crafted
// POST still hits the same function on the server.
//
// Trigger (2026-08-23): shop name "Kinka", handle a Gmail address
// with platform defaulting to X, description "im a good person pls
// dont hack me pls", website a Minecraft rank shop. It passed because
// `name@domain.tld` was a valid NIP-05 / Lightning handle, description
// only needed 30–300 chars, and nothing required the word bitcoin.
// That payload is the fixture in scripts/test-submit-guard.ts.

import { validateOutboundUrl } from "@/lib/safe-fetch";
import {
  CATEGORY_LABELS,
  type VendorCategory,
  type VendorPlatform,
} from "@/lib/vendors";

export type SubmitFlag =
  | "handle-email-mismatch"
  | "consumer-mail-handle"
  | "no-bitcoin-mention"
  | "bait-language"
  | "missing-bitcoin-attestation"
  | "suspicious-host"
  | "plea-only-description"
  | "controlled-substance"
  // Multi-shop (2026-10): the identity already owns a live listing and
  // this is a NEW storefront. Not a content problem · it puts the
  // submission behind the ownership-proof gate at approval.
  | "existing-handle";

export const SUBMIT_FLAGS: readonly SubmitFlag[] = [
  "handle-email-mismatch",
  "consumer-mail-handle",
  "no-bitcoin-mention",
  "bait-language",
  "missing-bitcoin-attestation",
  "suspicious-host",
  "plea-only-description",
  "controlled-substance",
  "existing-handle",
];

const VALID_CATEGORIES = new Set<VendorCategory>(
  Object.keys(CATEGORY_LABELS) as VendorCategory[],
);
const VALID_PLATFORMS = new Set<VendorPlatform>(["x", "nostr", "lightning"]);

const COUNTRY_RE = /^[A-Z]{2}$/;
const URL_RE = /^https:\/\/.+/;
const LN_ADDRESS_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NPUB_RE = /^npub1[a-z0-9]+$/;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const NPUB_OR_NPROFILE_RE = /^(npub1|nprofile1)[a-z0-9]+$/;
const NIP05_OR_LN_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const X_URL_RE =
  /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i;

const BIDI_INVISIBLE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

// Consumer mailboxes are never an X username, a NIP-05, or a Lightning
// Address. A Lightning Address has to host `/.well-known/lnurlp/`;
// Gmail does not. A NIP-05 has to host `/.well-known/nostr.json`;
// Gmail does not. Treating them as identity is the Kinka hole.
const CONSUMER_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "yandex.com",
  "yandex.ru",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "me.com",
  "mac.com",
  "inbox.com",
  "zoho.com",
  "tutanota.com",
  "tutamail.com",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "outlook.co.uk",
  "yahoo.es",
  "hotmail.es",
  "outlook.es",
  "yahoo.com.br",
  "hotmail.com.br",
  "yahoo.com.mx",
  "live.com.mx",
  "yahoo.com.ar",
  "hotmail.com.ar",
]);

// EN / ES / PT. Speakers of all three still write bitcoin / btc /
// lightning / sats; the accented form is the only extra we need.
const BITCOIN_MENTION_RE =
  /\b(bitcoin|bitcoins|bitc[oó]in|btc|lightning|lnurl|sats|satoshi|satoshis)\b/i;

// Tight on purpose. "please" once in a shipping sentence is normal;
// "pls" twice, or "dont hack me", is the Kinka class.
const BAIT_RE: readonly RegExp[] = [
  /\b(don'?t|do not|pls|please)\s+(hack|ddos|doxx?|swat)\b/i,
  /\b(hack|ddos|doxx?)\s+me\b/i,
  /\bi'?m a good person\b/i,
  /\b(i will|i'll)\s+(hack|kill|ddos)\b/i,
];

// Hostname tokens for rank-shops / gift-card / nitro mills. Small and
// high-confidence: a false positive only FLAGS the row for the
// reviewer, it does not reject a real merchant.
const SUSPICIOUS_HOST_RE =
  /(vbucks|robux|hypixel|minehut|namemc|cubecraft|minecraft|gift-?cards?|discord-?nitro|nitro-?gen|free-?nitro|rank-?shop|unban)/i;

const PLEA_STOP = new Set([
  "please",
  "pls",
  "plz",
  "beg",
  "begging",
  "add",
  "list",
  "listing",
  "thanks",
  "thank",
  "dont",
  "hack",
  "good",
  "person",
  "help",
  "just",
  "really",
  "want",
  "need",
  "shop",
  "store",
  "vendor",
  "directory",
  "submit",
  "submission",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "you",
  "our",
  "your",
  "are",
  "not",
]);

export function normalizeHandle(raw: string): string {
  const h = raw.trim();
  const url = h.match(X_URL_RE);
  if (url) return url[1];
  return h.startsWith("@") ? h.slice(1).trim() : h;
}

export function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(BIDI_INVISIBLE_RE, "");
}

export function validateAndInferHandle(
  handle: string,
):
  | { ok: true; platform: VendorPlatform | "ambiguous" }
  | { ok: false; reason: string } {
  if (NPUB_OR_NPROFILE_RE.test(handle)) {
    return { ok: true, platform: "nostr" };
  }
  if (NIP05_OR_LN_RE.test(handle)) {
    return { ok: true, platform: "ambiguous" };
  }
  if (X_HANDLE_RE.test(handle)) {
    return { ok: true, platform: "x" };
  }
  return {
    ok: false,
    reason:
      "handle must be an X username (1-15 chars, alphanumeric/underscore), npub1.../nprofile1..., or name@domain.tld",
  };
}

function emailDomain(handle: string): string | null {
  if (!NIP05_OR_LN_RE.test(handle)) return null;
  const at = handle.lastIndexOf("@");
  if (at < 0) return null;
  return handle.slice(at + 1).toLowerCase();
}

export function isConsumerMailHandle(handle: string): boolean {
  const domain = emailDomain(handle);
  if (!domain) return false;
  if (CONSUMER_MAIL_DOMAINS.has(domain)) return true;
  for (const mailbox of CONSUMER_MAIL_DOMAINS) {
    if (domain.endsWith("." + mailbox)) return true;
  }
  return false;
}

export function mentionsBitcoin(text: string): boolean {
  return BITCOIN_MENTION_RE.test(text);
}

export function hasBaitLanguage(text: string): boolean {
  const t = text.toLowerCase();
  if (BAIT_RE.some((re) => re.test(t))) return true;
  const pls = t.match(/\bpls\b/g);
  return Boolean(pls && pls.length >= 2);
}

// bitcoin.org spend-page clause 2 (operator 2026-09-14, Ground Up
// Genes): the directory must not promote illicit activity. Cannabis
// seed banks, dispensaries, and other controlled-substance shops
// stay off. Tight on purpose, same as BAIT_RE: hemp clothing or
// food is not this class, so "hemp" and "CBD" stay off the list.
const CONTROLLED_SUBSTANCE_RE =
  /\b(cannabis|marijuana|marihuana|ganja|dispensar(?:y|ies)|thc|delta-?8|delta-?9|delta-?10|kratom|psilocybin|psilocin|magic mushrooms?)\b/i;

export function hasControlledSubstanceCopy(text: string): boolean {
  return CONTROLLED_SUBSTANCE_RE.test(text);
}

export function isPleaOnlyDescription(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const content = words.filter((w) => !PLEA_STOP.has(w));
  return content.length < 2;
}

export function websiteHostname(url: string): string {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/\.+$/, "")
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSuspiciousStorefrontHost(host: string): boolean {
  return host.length > 0 && SUSPICIOUS_HOST_RE.test(host);
}

export type UntrustedWebsiteReview = {
  host: string;
  url: string;
  label: string;
  /** Reviewer surfaces must never render a first-party "open store" button. */
  cta: null;
  emailValue: string;
  cliLines: string[];
};

export function untrustedWebsiteReview(url: string): UntrustedWebsiteReview {
  const host = websiteHostname(url) || "(unparseable host)";
  return {
    host,
    url,
    label: "Website (untrusted)",
    cta: null,
    emailValue: `${host} · untrusted storefront, not a Galaxy Mind link. Full URL is in the review CLI.`,
    cliLines: [
      `Host:         ${host}  (untrusted storefront · not a Galaxy Mind link)`,
      `URL:          ${url}`,
      `Open:         paste the host into the URL bar yourself. Do not treat this as a first-party button.`,
    ],
  };
}

export type SubmitGuardFields = {
  handle: string;
  platform?: VendorPlatform;
  name: string;
  description: string;
  category: VendorCategory;
  country: string;
  website: string;
  lightningAddress?: string;
  nostrPubkey?: string;
  founderName?: string;
  shipsInternational?: boolean;
  tradeFriendly?: boolean;
  interestedIn?: VendorCategory[];
  submitterNote?: string;
  notifyEmail: string;
};

export type SubmitGuardResult = {
  ok: boolean;
  errors: string[];
  flags: SubmitFlag[];
  handle: string;
  name: string;
  platform?: VendorPlatform;
  fields?: SubmitGuardFields;
};

export function assessSubmitGuard(body: unknown): SubmitGuardResult {
  const errors: string[] = [];
  const flags: SubmitFlag[] = [];
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      errors: ["body must be JSON object"],
      flags,
      handle: "",
      name: "",
    };
  }
  const b = body as Record<string, unknown>;

  const handle =
    typeof b.handle === "string" ? sanitizeText(normalizeHandle(b.handle)) : "";
  let inferredPlatform: VendorPlatform | undefined;
  if (!handle) {
    errors.push("handle is required");
  } else if (handle.length > 200) {
    errors.push("handle too long");
  } else {
    const handleCheck = validateAndInferHandle(handle);
    if (!handleCheck.ok) errors.push(handleCheck.reason);
    else if (handleCheck.platform !== "ambiguous")
      inferredPlatform = handleCheck.platform;
  }

  const platformRaw =
    typeof b.platform === "string" ? b.platform.trim() : "";
  const claimedPlatform: VendorPlatform | undefined = VALID_PLATFORMS.has(
    platformRaw as VendorPlatform,
  )
    ? (platformRaw as VendorPlatform)
    : undefined;
  // Handle shape still wins when unambiguous (npub / X username).
  // `name@domain` stays claimed-platform-disambiguated — except the
  // default when the claim is missing is X, and an email is never an
  // X username. That is the Kinka hole closing.
  const platform: VendorPlatform | undefined =
    inferredPlatform ?? claimedPlatform;
  const effectivePlatform: VendorPlatform = platform ?? "x";

  if (handle && NIP05_OR_LN_RE.test(handle) && effectivePlatform === "x") {
    flags.push("handle-email-mismatch");
    errors.push(
      "X handles are a username (1-15 letters, numbers, underscore), not an email address.",
    );
  }
  if (handle && isConsumerMailHandle(handle)) {
    flags.push("consumer-mail-handle");
    errors.push(
      "Gmail, Hotmail, Outlook, Yahoo, iCloud, and other consumer mailboxes are not a valid X, Nostr, or Lightning identity. Use your X username or a Nostr npub / NIP-05.",
    );
  }
  if (
    handle &&
    effectivePlatform === "x" &&
    !X_HANDLE_RE.test(handle) &&
    !NIP05_OR_LN_RE.test(handle)
  ) {
    // Garbage that is not email-shaped: validateAndInferHandle already
    // pushed a reason. Don't double-speak.
  }
  if (
    handle &&
    claimedPlatform === "nostr" &&
    !inferredPlatform &&
    !NIP05_OR_LN_RE.test(handle) &&
    !NPUB_OR_NPROFILE_RE.test(handle)
  ) {
    errors.push(
      "Nostr handles are an npub1…/nprofile1… or a NIP-05 name@domain, not an X username.",
    );
  }

  const name = typeof b.name === "string" ? sanitizeText(b.name.trim()) : "";
  if (!name) errors.push("name is required");
  else if (name.length > 100) errors.push("name too long");

  const description =
    typeof b.description === "string"
      ? sanitizeText(b.description.trim())
      : "";
  if (description.length < 30)
    errors.push("description must be at least 30 chars");
  else if (description.length > 300)
    errors.push("description must be under 300 chars");

  if (description.length >= 30) {
    if (!mentionsBitcoin(description)) {
      flags.push("no-bitcoin-mention");
      errors.push(
        "Description must mention bitcoin, BTC, Lightning, or sats. This directory only lists shops that take bitcoin.",
      );
    }
    if (hasBaitLanguage(description)) {
      flags.push("bait-language");
      errors.push(
        "Description looks like a plea or bait, not a shop. Say what you actually sell.",
      );
    }
    if (isPleaOnlyDescription(description)) {
      flags.push("plea-only-description");
      errors.push(
        "Description must say what goods or services you sell, not only a request to be listed.",
      );
    }
  }

  if (b.acceptsBitcoinAtCheckout !== true) {
    flags.push("missing-bitcoin-attestation");
    errors.push("Confirm that this shop accepts bitcoin at checkout.");
  }

  const category =
    typeof b.category === "string" ? (b.category as VendorCategory) : "";
  if (!VALID_CATEGORIES.has(category as VendorCategory)) {
    errors.push(
      `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
    );
  }

  let country: string | undefined;
  if (typeof b.country === "string" && b.country.trim()) {
    const c = b.country.trim().toUpperCase();
    if (COUNTRY_RE.test(c)) country = c;
    else errors.push("country must be 2-letter ISO code");
  } else {
    errors.push("country is required");
  }

  const lightningAddress =
    typeof b.lightningAddress === "string" && b.lightningAddress.trim()
      ? b.lightningAddress.trim()
      : undefined;
  if (lightningAddress && !LN_ADDRESS_RE.test(lightningAddress)) {
    errors.push("lightningAddress must be name@domain.tld");
  }

  const nostrPubkey =
    typeof b.nostrPubkey === "string" && b.nostrPubkey.trim()
      ? b.nostrPubkey.trim()
      : undefined;
  if (nostrPubkey && !NPUB_RE.test(nostrPubkey)) {
    errors.push("nostrPubkey must be a bech32 npub (npub1...)");
  }

  const website =
    typeof b.website === "string" && b.website.trim()
      ? b.website.trim()
      : undefined;
  if (!website) {
    errors.push("website is required");
  } else if (!URL_RE.test(website)) {
    errors.push("website must be an https:// URL");
  } else {
    const safe = validateOutboundUrl(website);
    if (!safe.ok) {
      errors.push(`website rejected: ${safe.reason}`);
    } else if (isSuspiciousStorefrontHost(websiteHostname(website))) {
      flags.push("suspicious-host");
    }
  }

  const founderName =
    typeof b.founderName === "string" && b.founderName.trim()
      ? sanitizeText(b.founderName.trim()).slice(0, 60)
      : undefined;

  const shipsInternational =
    typeof b.shipsInternational === "boolean"
      ? b.shipsInternational
      : undefined;
  const tradeFriendly =
    typeof b.tradeFriendly === "boolean" ? b.tradeFriendly : undefined;
  let interestedIn: VendorCategory[] | undefined;
  if (Array.isArray(b.interestedIn)) {
    interestedIn = (b.interestedIn as unknown[])
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim().toLowerCase())
      .filter((c): c is VendorCategory =>
        VALID_CATEGORIES.has(c as VendorCategory),
      );
    if (interestedIn.length === 0) interestedIn = undefined;
  }

  const submitterNote =
    typeof b.submitterNote === "string" && b.submitterNote.trim()
      ? sanitizeText(b.submitterNote.trim()).slice(0, 500)
      : undefined;

  const notifyEmail =
    typeof b.notifyEmail === "string" && b.notifyEmail.trim()
      ? sanitizeText(b.notifyEmail.trim()).slice(0, 254)
      : "";
  if (!notifyEmail) {
    errors.push(
      "an email is required so we can send the listing outcome and, if you are listed, the verified-bitcoin badge",
    );
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    errors.push("notify email looks invalid");
  }

  if (
    hasControlledSubstanceCopy(
      [name, description, website ?? "", submitterNote ?? ""].join("\n"),
    )
  ) {
    flags.push("controlled-substance");
    errors.push(
      "Galaxy Mind does not list cannabis or other controlled-substance shops.",
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      flags,
      handle,
      name,
      ...(platform && platform !== "x" ? { platform } : {}),
    };
  }

  return {
    ok: true,
    errors: [],
    flags,
    handle,
    name,
    ...(platform && platform !== "x" ? { platform } : {}),
    fields: {
      handle,
      ...(platform && platform !== "x" ? { platform } : {}),
      name,
      description,
      category: category as VendorCategory,
      country: country as string,
      website: website as string,
      ...(lightningAddress ? { lightningAddress } : {}),
      ...(nostrPubkey ? { nostrPubkey } : {}),
      ...(founderName ? { founderName } : {}),
      ...(shipsInternational ? { shipsInternational: true } : {}),
      ...(tradeFriendly ? { tradeFriendly: true } : {}),
      ...(interestedIn && interestedIn.length > 0 ? { interestedIn } : {}),
      ...(submitterNote ? { submitterNote } : {}),
      notifyEmail,
    },
  };
}
