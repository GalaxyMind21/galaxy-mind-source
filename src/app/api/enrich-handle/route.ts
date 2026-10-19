// GET /api/enrich-handle?handle=<handle> · server-side enrichment.
//
// Used by the /submit page to auto-fill the form when a vendor
// pastes their handle. Doing this server-side (rather than a direct
// browser-to-relay query) sidesteps CORS issues with arbitrary
// NIP-05 domains and Lightning Address services that don't set
// Access-Control-Allow-Origin.
//
// Returns whatever profile data we can pull · all fields optional.
// Empty response means "we couldn't enrich, vendor fills out manually."
//
// 5-minute edge cache · profile data changes infrequently and a
// vendor pasting their handle multiple times during form filling
// should hit the cache.

import { NextRequest, NextResponse } from "next/server";
import {
  fetchNostrProfileMetadata,
  type NostrProfile,
} from "@/lib/nostr-activity";
import { resolveNostrHandleToPubkey } from "@/lib/nostr-resolve";
import { safeFetch, validateOutboundUrl, readCappedJson } from "@/lib/safe-fetch";
import { firstPartyCorsHeaders } from "@/lib/first-party-origin";
import { isConsumerMailHandle } from "@/lib/submit-guard";
import { isKvConfigured, kvIncrWithTtl } from "@/lib/kv";
import { getClientIp } from "@/lib/client-ip";

export const revalidate = 300;
export const runtime = "nodejs";

// Per-IP rate limit · this endpoint fans out to ~5 outbound network
// operations (3 Nostr WebSocket relays + 1 LNURL HTTPS GET + 1 NIP-05
// well-known GET) each with a 5-second budget, so each request can
// consume up to 15 seconds of function time and amplify into 3
// connections at Nostr relays we don't operate. Without a rate limit
// the route is:
//   1. A function-quota burner (10 RPS for an hour = 36,000 outbound
//      ops at someone else's expense)
//   2. A Nostr-relay DDoS amplifier (each inbound HTTP fans into 3
//      simultaneous WSS connections to relay.damus.io / nos.lol /
//      relay.primal.net · the relays see traffic from us, not the
//      attacker)
//   3. An SSRF probe (the safe-fetch guard blocks private ranges,
//      but unfettered probing of the public internet under our IP
//      could trip abuse alarms at the targets)
//
// 30/hour per IP comfortably covers a real vendor pasting their
// handle, hitting "fill" a few times, and re-trying after a typo,
// while making automated abuse uneconomical (1 enrichment every 2
// minutes per IP). Higher than /api/submit-vendor's 20/hour because
// enrichment is the lookup phase that precedes a single submission ·
// users genuinely re-trigger it during form filling.
const RATE_LIMIT_PER_HOUR = 30;

// IP extraction via lib/client-ip.ts (now keyed on Vercel's
// platform-controlled x-vercel-forwarded-for · audit H2).

// 2026-05 adversarial audit (H3 · corroborated by THREE passes):
// enrich-handle did NO handle-shape validation (only length<=200),
// so any `attacker@anything` drove outbound fetches to a fully
// attacker-chosen host (SSRF probe + 3-WSS/2-HTTPS amplification
// cannon, billed to us, attacker-invisible). Reject anything that
// isn't one of the three legitimate handle shapes BEFORE any
// outbound work. Same shapes /api/submit-vendor enforces.
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const NPUB_OR_NPROFILE_RE = /^(npub1|nprofile1)[a-z0-9]{20,}$/;
const NIP05_OR_LN_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function isWellFormedHandle(h: string): boolean {
  return (
    X_HANDLE_RE.test(h) ||
    NPUB_OR_NPROFILE_RE.test(h) ||
    NIP05_OR_LN_RE.test(h)
  );
}

// CORS locked to first-party (apex + Vercel previews) · the ONLY
// legitimate caller is the same-origin /submit form. The old
// `ACAO: *` let any third-party page drive this SSRF-amplification
// endpoint from every visitor's browser (distributed-IP bypass).
// Mirrors /api/submit-vendor's ALLOWED_ORIGIN_RE.
function corsHeaders(req: NextRequest): Record<string, string> {
  return firstPartyCorsHeaders(req);
}

type EnrichResult = {
  detectedPlatform: "x" | "nostr" | "lightning" | "ambiguous";
  // What we managed to pull · all undefined when nothing found.
  name?: string;
  description?: string;
  lightningAddress?: string;
  website?: string;
  nip05?: string;
  picture?: string;
  // Diagnostic: where the enrichment data came from.
  source?: "nostr_kind0" | "lnurl_pay" | "none";
  // For X handles, we surface a clear note that we can't enrich.
  notes?: string[];
};

const KNOWN_LN_DOMAINS = new Set([
  "walletofsatoshi.com",
  "getalby.com",
  "strike.me",
  "primal.net",
  "stacker.news",
  "blink.sv",
  "coinos.io",
  "sparkwallet.me",
  "ln.tips",
  "bitnob.io",
]);

function detectPlatform(
  handle: string,
): EnrichResult["detectedPlatform"] {
  if (handle.startsWith("npub1") || handle.startsWith("nprofile1")) {
    return "nostr";
  }
  if (handle.includes("@")) {
    const domain = handle.split("@")[1]?.toLowerCase() ?? "";
    if (KNOWN_LN_DOMAINS.has(domain)) return "lightning";
    return "ambiguous"; // could be NIP-05 OR Lightning · client should ask
  }
  return "x";
}

async function fetchLnurlPay(
  address: string,
): Promise<{ description?: string; ok: boolean }> {
  if (!address.includes("@")) return { ok: false };
  const [name, domain] = address.split("@");
  // SSRF guard · validate the resulting URL before fetching to a
  // user-controlled domain. Blocks IPv4 private ranges, IPv6
  // literals, custom ports, *.local, etc. See lib/safe-fetch.ts.
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  const validation = validateOutboundUrl(url);
  if (!validation.ok) {
    // H3 · log SSRF rejects so the operator can debug "vendor
    // says their LN address didn't enrich" without guessing.
    console.warn(
      `[enrich-handle:lnurl] ssrf reject · domain=${domain} · ${validation.reason}`,
    );
    return { ok: false };
  }
  try {
    // safeFetch, not fetch · re-validates every redirect hop. A bare
    // fetch follows 3xx by default, which let a validated attacker
    // domain bounce us to loopback / the metadata IP (2026-08 audit).
    const r = await safeFetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!r) {
      console.warn(`[enrich-handle:lnurl] fetch blocked or failed · ${address}`);
      return { ok: false };
    }
    if (!r.ok) {
      console.warn(
        `[enrich-handle:lnurl] http ${r.status} · ${address}`,
      );
      return { ok: false };
    }
    const parsed = await readCappedJson(r);
    const data = (parsed ?? {}) as { tag?: string; metadata?: string };
    if (data?.tag !== "payRequest") {
      console.warn(
        `[enrich-handle:lnurl] non-payRequest tag · ${address} · tag=${data?.tag ?? "<missing>"}`,
      );
      return { ok: false };
    }
    let description: string | undefined;
    try {
      const md = data.metadata ? JSON.parse(data.metadata) : null;
      if (Array.isArray(md)) {
        const desc = md.find(
          (e): e is [string, string] =>
            Array.isArray(e) && e[0] === "text/plain",
        );
        if (desc) description = desc[1];
      }
    } catch {
      // metadata parse failed · still OK · the LN endpoint is alive
      // and ok:true is the right answer · description just stays
      // undefined and the form doesn't auto-fill that field.
    }
    return { ok: true, description };
  } catch (e) {
    // H3 · network error / timeout / DNS failure all converge here ·
    // log so the operator can distinguish from "endpoint doesn't
    // exist" (which would have hit the !r.ok branch above).
    console.warn(
      `[enrich-handle:lnurl] fetch failed · ${address} · ${e instanceof Error ? e.message : e}`,
    );
    return { ok: false };
  }
}

async function enrich(req: NextRequest, handle: string) {
  if (!handle) {
    return NextResponse.json(
      { error: "handle query param required" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  // Cap input size to prevent abuse via huge query strings.
  if (handle.length > 200) {
    return NextResponse.json(
      { error: "handle too long" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  // H3 · reject malformed handles BEFORE any outbound work. This is
  // the gate that stops enrich-handle being an arbitrary-host SSRF
  // probe / amplification cannon: only X-username, npub/nprofile, or
  // NIP-05/Lightning-address shapes proceed to the fetch fan-out.
  if (!isWellFormedHandle(handle)) {
    return NextResponse.json(
      {
        error:
          "handle must be an X username, npub1…/nprofile1…, or name@domain.tld",
      },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  // Consumer mail is never a NIP-05 or Lightning Address. Skip the
  // well-known fan-out so a pasted Gmail handle cannot spend our
  // egress probing gmail.com/.well-known/* (Kinka 2026-08-23).
  if (isConsumerMailHandle(handle)) {
    return NextResponse.json(
      {
        error:
          "Gmail, Hotmail, Outlook, Yahoo, iCloud, and other consumer mailboxes are not a valid X, Nostr, or Lightning identity.",
      },
      { status: 400, headers: corsHeaders(req) },
    );
  }

  // Per-IP rate limit · gates the expensive outbound fan-out below.
  //
  // FAIL CLOSED when KV is unconfigured OR a mid-call write fails.
  // This endpoint is an SSRF-amplification surface (per-request: up to
  // 3 Nostr WSS dials + 2 attacker-host HTTPS GETs). Unlike
  // submit-vendor (where fail-open trades a little spam for not
  // wedging legit users into a moderation queue that also needs KV),
  // enrichment is optional UX on /submit — refusing it is always
  // safer than running an unmetered outbound-fetch cannon. Production
  // always has KV; local dev without KV can fill the form manually.
  if (!isKvConfigured()) {
    console.error(
      "[enrich-handle:rl] KV not configured · FAILING CLOSED (SSRF-amplification surface)",
    );
    return NextResponse.json(
      { error: "enrichment temporarily unavailable · try again shortly" },
      {
        status: 503,
        headers: { ...corsHeaders(req), "Retry-After": "120" },
      },
    );
  }
  {
    const ip = getClientIp(req);
    const count = await kvIncrWithTtl(`enrich-handle:rl:${ip}`, 3600);
    if (count === null) {
      console.error(
        `[enrich-handle:rl] kv unavailable · FAILING CLOSED (SSRF-amplification surface) · ip=${ip}`,
      );
      return NextResponse.json(
        { error: "enrichment temporarily unavailable · try again shortly" },
        {
          status: 503,
          headers: { ...corsHeaders(req), "Retry-After": "120" },
        },
      );
    } else if (count > RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        {
          error: `rate limited · max ${RATE_LIMIT_PER_HOUR} enrichments/hour per IP. Try again in an hour.`,
        },
        {
          status: 429,
          headers: { ...corsHeaders(req), "Retry-After": "3600" },
        },
      );
    }
  }

  const platform = detectPlatform(handle);
  const result: EnrichResult = { detectedPlatform: platform, notes: [] };

  if (platform === "x") {
    result.notes!.push(
      "X profiles can't be auto-enriched (no public API). Fill the form manually.",
    );
  } else if (platform === "nostr" || platform === "ambiguous") {
    // Try Nostr first · if ambiguous and Nostr fails, fall through to LN.
    const pubkey = await resolveNostrHandleToPubkey(handle);
    if (pubkey) {
      const profile: NostrProfile | null = await fetchNostrProfileMetadata(
        pubkey,
      );
      if (profile) {
        result.source = "nostr_kind0";
        result.name = profile.display_name ?? profile.name;
        result.description = profile.about;
        result.lightningAddress = profile.lud16;
        result.website = profile.website;
        result.nip05 = profile.nip05;
        result.picture = profile.picture;
      }
    }
    // If Nostr enrichment found nothing AND it's ambiguous, try LN.
    if (!result.source && platform === "ambiguous") {
      const ln = await fetchLnurlPay(handle);
      if (ln.ok) {
        result.source = "lnurl_pay";
        result.description = ln.description;
        // Adjust the detected platform now that we know it's LN
        result.detectedPlatform = "lightning";
      }
    }
  } else if (platform === "lightning") {
    const ln = await fetchLnurlPay(handle);
    if (ln.ok) {
      result.source = "lnurl_pay";
      result.description = ln.description;
    }
  }

  if (!result.source) result.source = "none";

  return NextResponse.json(result, {
    headers: {
      ...corsHeaders(req),
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

/**
 * Browser cross-site calls are the amplification vector. A simple
 * request (GET, or POST with a text/plain body) sends no preflight,
 * so CORS cannot stop the server from doing the work. Sec-Fetch-Site
 * is set by the browser and is not script-settable. `none` (curl,
 * address-bar) and `same-origin` (the /submit form) stay allowed.
 */
function crossSiteFetchBlocked(req: NextRequest): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  return sfs === "cross-site" || sfs === "same-site";
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: firstPartyCorsHeaders(req, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }),
  });
}

export async function POST(req: NextRequest) {
  if (crossSiteFetchBlocked(req)) {
    return NextResponse.json(
      { error: "method not allowed" },
      { status: 405, headers: corsHeaders(req) },
    );
  }
  // application/json is not a CORS-safelisted content type, so a
  // foreign page cannot POST it without a preflight our CORS policy
  // will refuse. text/plain would skip that preflight.
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "unsupported media type" },
      { status: 415, headers: corsHeaders(req) },
    );
  }
  let handle = "";
  try {
    const raw = await req.text();
    if (raw.length > 512) {
      return NextResponse.json(
        { error: "body too large" },
        { status: 413, headers: corsHeaders(req) },
      );
    }
    const body = JSON.parse(raw) as { handle?: unknown };
    handle = typeof body.handle === "string" ? body.handle.trim() : "";
  } catch {
    return NextResponse.json(
      { error: "invalid JSON" },
      { status: 400, headers: corsHeaders(req) },
    );
  }
  return enrich(req, handle);
}

export async function GET(req: NextRequest) {
  // Simple cross-site GET is the amplification vector (no preflight).
  if (crossSiteFetchBlocked(req)) {
    return NextResponse.json(
      { error: "method not allowed" },
      { status: 405, headers: corsHeaders(req) },
    );
  }
  const handle = (new URL(req.url).searchParams.get("handle") ?? "").trim();
  return enrich(req, handle);
}
