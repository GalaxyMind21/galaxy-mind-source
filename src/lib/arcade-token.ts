// Lightweight anti-casual-abuse token for arcade score posts.
//
// This is OBFUSCATION, not security. The salt ships in the client
// bundle, so a determined user who reads the JS can still forge a
// token. Its only job is to raise the bar past a one-line `curl` so a
// public "for fun" leaderboard can't be filled from the command line
// in seconds. Combined with tight score bounds, a per-IP rate limit,
// and top-N board pruning, this is enough for the threat model on the
// runner/horizon/saylor boards. WEN + Gauntlet go further: the server
// REPLAYS a submitted proof through the pure engine and rejects any
// score the sim doesn't reproduce (lib/arcade-replay · 2026-07-11) ·
// the token stays as the cheap first gate in front of that.
//
// Deterministic + synchronous + identical on client and server, so a
// value hashed in the browser verifies byte-for-byte in the route.

const SALT = "gm-arcade-v1-9f3c2a7e51";

/**
 * FNV-1a-style keyed hash of the score payload → 8 hex chars. `score`
 * is stringified with String() (stable across a JSON round-trip), and
 * `day` is normalized so runner (no day) and gauntlet (a day number)
 * both hash consistently on both sides.
 */
export function scoreToken(
  game: string,
  score: number,
  day: number | undefined | null,
  name: string,
): string {
  const msg = `${SALT}|${game}|${String(score)}|${day ?? ""}|${name}`;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // A reverse pass with a different multiplier adds diffusion so the
  // token isn't a trivially-extendable rolling hash.
  let g = (0xdeadbeef ^ h) >>> 0;
  for (let i = msg.length - 1; i >= 0; i--) {
    g ^= msg.charCodeAt(i);
    g = Math.imul(g, 0x85ebca6b) >>> 0;
  }
  return ((h ^ g) >>> 0).toString(16).padStart(8, "0");
}
