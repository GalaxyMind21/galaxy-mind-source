// Helpers for the loopback-only capture rigs (capture-chop-*.mjs).
//
// CodeQL review 2026-10: the rigs served `join(ROOT, decodeURIComponent(path))`,
// so a request for `/%2e%2e/...` could read files outside public/ (loopback
// only, but still wrong), and proxied `"https://galaxymind.space" + path`
// straight from the request. Both now go through these checks.
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export const PROD_ORIGIN = "https://galaxymind.space";

/**
 * Map a request path to a file under `root`, or null if it would escape
 * `root` (via `..`, an encoded `%2e%2e`, a backslash or a NUL byte).
 */
export function staticFilePath(root, rawPath, index = "/chop/index.html") {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  if (path === "/") path = index;
  const base = resolve(root);
  const file = resolve(base, "." + (path.startsWith("/") ? path : "/" + path));
  if (!inside(base, file)) return null;
  // Symlinks (PR #188 S-6): the lexical check above can't see a link inside
  // public/ that points outside it, so compare real paths too. A path that
  // doesn't exist yet is fine here (the read will 404); one that resolves
  // outside the real root is refused.
  let realBase;
  try {
    realBase = realpathSync(base);
  } catch {
    return null;
  }
  let realFile;
  try {
    realFile = realpathSync(file);
  } catch {
    return file;
  }
  return inside(realBase, realFile) ? file : null;
}

function inside(base, file) {
  return file === base || file.startsWith(base + sep);
}

/**
 * Build the production URL for a proxied `/api/...` request, or null if
 * the result would leave the production origin or the /api/ prefix.
 */
export function prodApiUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/api/")) return null;
  let url;
  try {
    url = new URL(path, PROD_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROD_ORIGIN || !url.pathname.startsWith("/api/")) return null;
  return url.toString();
}
