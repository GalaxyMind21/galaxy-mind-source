// First-party Origin allow for browser CORS.
//
// The previous pattern echoed ANY `*.vercel.app` origin. Anyone with a
// free Vercel deploy could then read JSON from /api/submit-vendor and
// /api/enrich-handle. Preview deploys only need THIS deployment's host
// (`VERCEL_URL`), plus the production apex.

const APEX = "https://galaxymind.space";

export function firstPartyAllowOrigin(req: { headers: Headers }): string {
  const origin = req.headers.get("origin") ?? "";
  if (origin === APEX) return origin;
  const vercelHost = process.env.VERCEL_URL;
  if (vercelHost && origin === `https://${vercelHost}`) return origin;
  return APEX;
}

export function firstPartyCorsHeaders(
  req: { headers: Headers },
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": firstPartyAllowOrigin(req),
    Vary: "Origin",
    ...extra,
  };
}
