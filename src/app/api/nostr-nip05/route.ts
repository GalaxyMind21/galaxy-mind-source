// NIP-05 verification endpoint for galaxymind.space.
//
// Per NIP-05 (https://github.com/nostr-protocol/nips/blob/master/05.md),
// a Nostr identity like `name@galaxymind.space` is verified when a
// Nostr client fetches:
//
//   https://galaxymind.space/.well-known/nostr.json?name=<name>
//
// and the response contains:
//
//   { "names": { "<name>": "<hex-pubkey>" } }
//
// Two requirements that trip up most setups:
//
//   1. CORS — Nostr clients fetch from cross-origin browsers/apps.
//      Without `Access-Control-Allow-Origin: *` the verification
//      silently fails.
//   2. Filtering — when the client passes `?name=foo`, the spec says
//      the server SHOULD return only that name. Some clients respect
//      this, some don't. We handle both: filter when `name` is
//      present, return the full set when it's absent.
//
// This route is reached via a rewrite in next.config.ts:
//   /.well-known/nostr.json  →  /api/nostr-nip05
//
// Keeping the actual route handler at `/api/nostr-nip05` (no
// dot-prefixed folder name) sidesteps any tooling quirks with
// `app/.well-known/...` directories.
import { NextResponse } from "next/server";

// Single hex pubkey — owned by GalaxyMind21 (the project's X / Nostr
// identity). Mapped under TWO names so both forms of the NIP-05
// address resolve:
//
//   • "_" → resolves the "anonymous" form, displayed by clients as
//     just `_@galaxymind.space` → which most clients render as
//     `galaxymind.space` (cleanest for a brand account).
//
//   • "galaxymind" → resolves the explicit form
//     `galaxymind@galaxymind.space`. Useful as a fallback or
//     alternate identity.
//
// Both keys point to the same pubkey, so either NIP-05 address
// verifies the same Nostr account.
const PUBKEY_HEX =
  "174ed916a8520e623293cad8419a176edbcc8c1a1e5f5271e36c922730f9470f";

const NAMES: Record<string, string> = {
  _: PUBKEY_HEX,
  galaxymind: PUBKEY_HEX,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  // Cache for 5 minutes at the edge — NIP-05 results change extremely
  // rarely (basically never), so aggressive caching is safe.
  "Cache-Control": "public, max-age=300, s-maxage=300",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");

  // Per NIP-05: when `?name=` is supplied, return only that name's
  // pubkey (or an empty `names` object if it doesn't match). When no
  // `name` is supplied, return the full set — some clients query
  // without the parameter.
  const responseNames = name
    ? NAMES[name]
      ? { [name]: NAMES[name] }
      : {}
    : { ...NAMES };

  return NextResponse.json({ names: responseNames }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
