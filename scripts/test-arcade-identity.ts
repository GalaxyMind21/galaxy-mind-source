// Arcade X-identity invariants (2026-07-14) · the optional link-your-X
// layer over the anonymous culture handles. Contract under test:
//   · session HMAC is deterministic, tamper-evident, expiring, and
//     FAIL-CLOSED when ARCADE_SESSION_SECRET is unset or trivial
//   · the "x:{userId}" board-member scheme can never satisfy HANDLE_RE
//     (that non-collision is what makes the layer version-bump-free)
//   · return paths can't become open redirects
//   · the score/scores routes keep their member-swap + enrichment wiring
//     (source drift guards, same style as test-bitcoin-kart)
//
// Run: npx tsx scripts/test-arcade-identity.ts   (wired into `npm run verify`)

import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("  ✗ " + msg);
  }
}

async function main() {
  // ── fail-closed: no secret configured ─────────────────────────────
  delete process.env.ARCADE_SESSION_SECRET;
  const idNoSecret = await import("../src/lib/arcade-identity");
  ok(idNoSecret.mintSessionValue("12345") === null, "mint fails closed without a secret");
  ok(
    idNoSecret.readXSession("gm_xs=12345.9999999999.abc") === null,
    "read fails closed without a secret",
  );
  process.env.ARCADE_SESSION_SECRET = "short"; // < 16 chars = trivial
  ok(idNoSecret.mintSessionValue("12345") === null, "trivially short secrets are refused");

  // ── round-trip + tamper with a real secret ────────────────────────
  process.env.ARCADE_SESSION_SECRET = "test-secret-0123456789abcdef";
  const id = idNoSecret; // same module · secret is read per call, not cached
  const now = 1_784_000_000_000;
  const v = id.mintSessionValue("44196397", now);
  ok(typeof v === "string" && v!.split(".").length === 3, "mint produces userId.exp.mac");
  const cookie = `${id.SESSION_COOKIE}=${encodeURIComponent(v!)}`;
  ok(id.readXSession(cookie, now)?.userId === "44196397", "round-trip returns the user id");
  ok(id.readXSession(cookie, now + 200 * 24 * 3600 * 1000) === null, "expired sessions are refused");
  const tampered = cookie.slice(0, -2) + (cookie.endsWith("A") ? "BB" : "AA");
  ok(id.readXSession(tampered, now) === null, "a tampered MAC is refused");
  const otherUser = cookie.replace("44196397", "44196398");
  ok(id.readXSession(otherUser, now) === null, "swapping the user id breaks the MAC");
  ok(id.readXSession(null, now) === null, "no cookie header reads as logged out");
  ok(id.mintSessionValue("not-a-number-id") === null, "non-numeric user ids are refused");

  // ── the x:{id} member scheme can never collide with HANDLE_RE ─────
  const scoreSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "arcade", "score", "route.ts"),
    "utf8",
  );
  const reMatch = scoreSrc.match(/const HANDLE_RE =\s*\n?\s*(\/.*\/);/);
  ok(!!reMatch, "HANDLE_RE found in the score route (drift guard)");
  if (reMatch) {
    const HANDLE_RE = new RegExp(reMatch[1].slice(1, -1));
    for (const m of ["x:1", "x:44196397", "x:9999999999999999999999999"]) {
      ok(!HANDLE_RE.test(m), `board member "${m}" can never satisfy HANDLE_RE`);
    }
    ok(HANDLE_RE.test("Orange Racer #123"), "sanity: a real culture handle still matches");
  }

  // ── open-redirect guard ────────────────────────────────────────────
  ok(id.safeReturnPath("/wen") === "/wen", "site paths pass through");
  ok(id.safeReturnPath("/wen?tab=board") === "/wen?tab=board", "query-bearing site paths pass through");
  ok(id.safeReturnPath("//evil.example") === "/arcade", "protocol-relative is refused");
  ok(id.safeReturnPath("https://evil.example") === "/arcade", "absolute URLs are refused");
  ok(id.safeReturnPath("/a\\b") === "/arcade", "backslash tricks are refused");
  ok(id.safeReturnPath(null) === "/arcade", "missing return defaults to the arcade");
  ok(id.safeReturnPath("/..//evil.example") === "/arcade", "embedded // is refused");
  ok(id.safeReturnPath("///evil.example") === "/arcade", "triple-slash is refused");
  ok(
    id.safeReturnPath("/\r\nLocation: https://evil.example") === "/arcade",
    "CRLF injection is refused",
  );
  ok(id.safeReturnPath("/\u0000foo") === "/arcade", "NUL is refused");
  ok(id.safeReturnPath("/\t//evil.example") === "/arcade", "tab + // is refused");

  const tmp = id.mintOAuthTmpValue("st", "ver", "/wen");
  ok(typeof tmp === "string" && tmp!.split(".").length >= 4, "oauth tmp cookie is payload.mac");
  const tmpCookie = `${id.OAUTH_TMP_COOKIE}=${encodeURIComponent(tmp!)}`;
  ok(id.readOAuthTmpCookie(tmpCookie)?.ret === "/wen", "oauth tmp round-trip");
  ok(id.readOAuthTmpCookie(tmpCookie)?.state === "st", "oauth tmp preserves state");
  const badTmp = tmpCookie.slice(0, -2) + (tmpCookie.endsWith("A") ? "BB" : "AA");
  ok(id.readOAuthTmpCookie(badTmp) === null, "tampered oauth tmp is refused");
  ok(
    id.readOAuthTmpCookie(`${id.OAUTH_TMP_COOKIE}=%zz`) === null,
    "malformed percent-encoding does not throw",
  );

  // ── PKCE helper shape ──────────────────────────────────────────────
  const ch = id.pkceChallenge("test-verifier");
  ok(/^[A-Za-z0-9_-]{43}$/.test(ch), "S256 challenge is 43 base64url chars");
  ok(ch === id.pkceChallenge("test-verifier"), "challenge is deterministic");

  // ── route wiring drift guards (source-level, suite style) ──────────
  ok(scoreSrc.includes("resolveLinkedSession"), "score route resolves linked session via profile hash");
  ok(
    scoreSrc.includes('link.kind === "linked" ? `x:${link.userId}` : name'),
    "score route swaps the board member only when still linked",
  );
  const zaddsAfterSwap = scoreSrc.split("const member =")[1] ?? "";
  ok(!/kvZAddGt\([^)]*, name\)/.test(zaddsAfterSwap), "every ZADD after the swap writes `member`, never `name`");
  ok(!/kvZRevRank\([^)]*, name\)/.test(zaddsAfterSwap), "every rank read after the swap uses `member`");
  const scoresSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "arcade", "scores", "route.ts"),
    "utf8",
  );
  ok(scoresSrc.includes("X_PROFILE_HASH") && scoresSrc.includes('startsWith("x:")'), "scores route enriches x: members");
  ok(scoresSrc.includes("kvHMGet"), "enrichment is one HMGET, not N GETs");
  const meSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "auth", "x", "me", "route.ts"),
    "utf8",
  );
  ok(meSrc.includes("no-store"), "/api/auth/x/me is no-store (viewer state must never share the CDN cache)");
  const logoutSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "auth", "x", "logout", "route.ts"),
    "utf8",
  );
  // ── __Host- session cookie (security audit 2026-10-18, L9) ────────
  ok(id.SESSION_COOKIE === "__Host-gm_xs", "HTTPS session cookie carries the __Host- prefix");
  const setSecure = id.sessionSetCookie(v!, true);
  ok(setSecure.startsWith("__Host-gm_xs=") && /; Path=\/;/.test(setSecure) && /; Secure/.test(setSecure) && !/Domain=/i.test(setSecure) && /HttpOnly/.test(setSecure),
    "__Host- cookie is Secure, Path=/, HttpOnly, no Domain");
  ok(id.sessionSetCookie(v!, false).startsWith("gm_xs="), "plain-HTTP dev keeps the bare name (browsers refuse __Host- without Secure)");
  ok(id.readXSession(`other=1; ${id.LEGACY_SESSION_COOKIE}=${encodeURIComponent(v!)}`, now)?.userId === "44196397", "a legacy gm_xs session still reads until it expires");
  ok(id.readXSession(`__Host-gm_xs=${encodeURIComponent(v!)}; gm_xs=junk`, now)?.userId === "44196397", "the __Host- cookie wins over a legacy one");
  // Legacy sunset (review follow-up): production stops reading the bare name after 2027-01-31.
  {
    const after = id.LEGACY_SESSION_SUNSET_MS + 24 * 3600_000;
    ok(id.LEGACY_SESSION_SUNSET_MS === Date.UTC(2027, 0, 31, 6), "legacy sunset is 2027-01-31 00:00 CT");
    ok(id.legacySessionReadable(id.LEGACY_SESSION_SUNSET_MS - 1, "production") && !id.legacySessionReadable(id.LEGACY_SESSION_SUNSET_MS, "production"), "production reads the legacy name only before the sunset");
    ok(id.legacySessionReadable(after, "development") && id.legacySessionReadable(after, undefined), "plain-HTTP dev keeps the bare name after the sunset");
    const late = id.mintSessionValue("44196397", after - 24 * 3600_000)!;
    const pe = process.env as Record<string, string | undefined>;
    const keepEnv = pe.NODE_ENV;
    pe.NODE_ENV = "production";
    ok(id.readXSession(`gm_xs=${encodeURIComponent(late)}`, after) === null, "after the sunset a production deploy ignores a bare gm_xs session");
    ok(id.readXSession(`gm_xs=${encodeURIComponent(late)}; __Host-gm_xs=${encodeURIComponent(late)}`, after)?.userId === "44196397", "after the sunset the __Host- session still reads");
    ok(id.readXSession(`gm_xs=${encodeURIComponent(late)}`, id.LEGACY_SESSION_SUNSET_MS - 1000)?.userId === "44196397", "before the sunset a production deploy still reads the bare session");
    if (keepEnv === undefined) delete pe.NODE_ENV; else pe.NODE_ENV = keepEnv;
  }
  const clears = id.sessionClearCookies(true);
  ok(clears.length === 2 && clears.some((c) => c.startsWith("__Host-gm_xs=;")) && clears.some((c) => c.startsWith("gm_xs=;")), "logout clears both names on HTTPS");
  ok(logoutSrc.includes("sessionClearCookies(secure)") && logoutSrc.includes('headers.append("Set-Cookie"'), "logout appends every clearing cookie");
  const cbSrc = readFileSync(join(process.cwd(), "src", "app", "api", "auth", "x", "callback", "route.ts"), "utf8");
  ok(cbSrc.includes("legacySessionClearCookie(true)"), "a new link retires the legacy cookie");
  ok(logoutSrc.includes("export async function POST") && !logoutSrc.includes("export async function GET"), "logout is POST-only (GET must never mutate)");

  console.log(fail === 0 ? `test-arcade-identity: ${pass}/${pass + fail} invariants hold ✓` : `test-arcade-identity: ${fail} FAILED of ${pass + fail}`);
  if (fail > 0) process.exit(1);
}

void main();
