// Hardening from the CodeQL review (2026-10). None of the 33 alerts was a
// live bug; these pin the defence-in-depth changes that came out of it so a
// later "simplification" fails loudly. DNS pinning for safeFetch is tested
// in test-safe-fetch.ts, the saved-order TTL in test-human-checkout.ts, and
// the CI key file in ios-arcade/scripts/test-asc-key-file.py.
//
// Run: npx tsx scripts/test-codeql-hardening.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { normalizeWebsite, trimTrailingSlashes, vendorSlug } from "../src/lib/vendors";
import { prodApiUrl, staticFilePath } from "./lib/local-static.mjs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

// ---------------------------------------------------------------
console.log("\nvendors.ts · trailing-slash trim is a loop, not a regex");
// ---------------------------------------------------------------
check("no slash unchanged", trimTrailingSlashes("/shop") === "/shop");
check("one slash trimmed", trimTrailingSlashes("/shop/") === "/shop");
check("many slashes trimmed", trimTrailingSlashes("/shop////") === "/shop");
check("only slashes -> empty", trimTrailingSlashes("////") === "");
check("empty stays empty", trimTrailingSlashes("") === "");
check("inner slashes kept", trimTrailingSlashes("/a//b/") === "/a//b");
{
  // The old /\/+$/ took seconds on ~100k slashes followed by a non-slash.
  const evil = "https://shop.example/" + "/".repeat(200_000) + "x" + "/".repeat(200_000);
  const t0 = Date.now();
  const out = normalizeWebsite(evil);
  const ms = Date.now() - t0;
  check(`200k-slash input normalizes in linear time (${ms} ms)`, ms < 500 && !out.endsWith("/"));
}
check("normalizeWebsite unchanged for normal input", normalizeWebsite("https://WWW.Shop.com/Store/") === "shop.com/store");
check("normalizeWebsite fallback still trims", normalizeWebsite("http://[bad/") === "http://[bad");
check("vendorSlug unchanged", vendorSlug({ name: "  Joe's  Coffee & Sats!! " }) === "joe-s-coffee-sats");
check("vendorSlug of punctuation only is empty", vendorSlug({ name: "!!!" }) === "");
{
  const t0 = Date.now();
  vendorSlug({ name: "a" + "-".repeat(200_000) + "!" });
  check("vendorSlug linear on long hyphen runs", Date.now() - t0 < 500);
}

// ---------------------------------------------------------------
console.log("\ncapture rigs · loopback static server stays inside public/");
// ---------------------------------------------------------------
const ROOT = resolve("public");
check("root maps to the chop index", staticFilePath(ROOT, "/") === join(ROOT, "chop/index.html"));
check("normal asset allowed", staticFilePath(ROOT, "/chop/js/main.js") === join(ROOT, "chop/js/main.js"));
check("../ traversal refused", staticFilePath(ROOT, "/../package.json") === null);
check("encoded %2e%2e traversal refused", staticFilePath(ROOT, "/%2e%2e/package.json") === null);
check("deep encoded traversal refused", staticFilePath(ROOT, "/chop/%2e%2e/%2e%2e/%2e%2e/etc/passwd") === null);
check("encoded slash traversal refused", staticFilePath(ROOT, "/..%2f..%2fpackage.json") === null);
check("backslash refused", staticFilePath(ROOT, "/..%5cpackage.json") === null);
check("NUL refused", staticFilePath(ROOT, "/chop%00.html") === null);
check("bad percent-encoding refused", staticFilePath(ROOT, "/%E0%A4%A") === null);
check("sibling-prefix dir refused", staticFilePath(ROOT, "/../public-evil/x") === null);
check("in-root .. that stays inside allowed", staticFilePath(ROOT, "/chop/../chop/index.html") === join(ROOT, "chop/index.html"));
{
  // S-6: a symlink inside the served root that points outside it is refused.
  const tmp = mkdtempSync(join(tmpdir(), "gm-static-"));
  try {
    const root = join(tmp, "public");
    mkdirSync(join(root, "chop"), { recursive: true });
    writeFileSync(join(root, "chop", "index.html"), "ok");
    writeFileSync(join(tmp, "secret.txt"), "outside");
    symlinkSync(join(tmp, "secret.txt"), join(root, "leak.txt"));
    symlinkSync(tmp, join(root, "up"));
    symlinkSync(join(root, "chop", "index.html"), join(root, "alias.html"));
    check("symlinked file pointing outside root refused", staticFilePath(root, "/leak.txt") === null);
    check("symlinked dir pointing outside root refused", staticFilePath(root, "/up/secret.txt") === null);
    check("symlink that stays inside root allowed", staticFilePath(root, "/alias.html") === join(root, "alias.html"));
    check("missing file still maps (read will 404)", staticFilePath(root, "/chop/nope.js") === join(root, "chop", "nope.js"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
check("api proxy keeps the production origin", prodApiUrl("/api/chop/block") === "https://galaxymind.space/api/chop/block");
check("api proxy refuses non-/api/ paths", prodApiUrl("/admin") === null);
check("api proxy refuses protocol-relative escape", prodApiUrl("//evil.example/api/x") === null);
check("api proxy refuses dot-segment escape", prodApiUrl("/api/../admin") === null);

// ---------------------------------------------------------------
console.log("\nios-arcade app.js · link scheme allowlist");
// ---------------------------------------------------------------
{
  const src = readFileSync("ios-arcade/shell/gm/app.js", "utf8");
  const m = src.match(/function linkPolicy\(url, loc\) \{[\s\S]*?\n  \}\n/);
  check("linkPolicy exists in app.js", !!m);
  check("click handler uses linkPolicy", src.includes("var policy = linkPolicy(url, location);"));
  check("old blob/data passthrough is gone", !src.includes('url.protocol === "data:") return;'));
  if (m) {
    const linkPolicy = new Function(`${m[0]}; return linkPolicy;`)() as (
      url: URL,
      loc: { protocol: string; host: string },
    ) => string;
    const loc = { protocol: "capacitor:", host: "localhost" };
    const at = (href: string) => linkPolicy(new URL(href, "capacitor://localhost/chop/index.html"), loc);
    check("https link routed", at("https://galaxymind.space/hashrate") === "route");
    check("http link routed", at("http://example.com/") === "route");
    check("relative link (same origin) routed", at("/wen/index.html") === "route");
    check("javascript: blocked", at("javascript:alert(1)") === "block");
    check("vbscript: blocked", at("vbscript:msgbox(1)") === "block");
    check("data: blocked", at("data:text/html,<b>x</b>") === "block");
    check("file: blocked", at("file:///etc/passwd") === "block");
    check("other app scheme blocked", at("otherapp://launch") === "block");
    check("same scheme, other host blocked", at("capacitor://evil/x") === "block");
    check("own blob: (screenshot save) passes through", at("blob:capacitor://localhost/1234-abcd") === "native");
    check("foreign blob: blocked", at("blob:https://evil.example/1234") === "block");
    const https = { protocol: "https:", host: "localhost" };
    check(
      "own blob: on an https origin passes through",
      linkPolicy(new URL("blob:https://localhost/1234"), https) === "native",
    );
    check("empty-host scheme never treated as local", linkPolicy(new URL("mailto:a@b.c"), https) === "block");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("✓ CodeQL hardening: slash trim, capture-rig paths, app link allowlist all green");
