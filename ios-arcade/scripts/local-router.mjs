import { pathToFileURL } from "node:url";

/**
 * The same decision as GMLocalRouter in native/GMBridgeViewController.swift.
 * Capacitor's stock router returns the root index for every extensionless
 * path. localRoute serves that directory's index.html when the file exists.
 *
 * basePath is the web directory with no trailing slash. The URL path keeps
 * its leading slash. Do not path.join them: a leading slash makes the
 * second segment absolute and drops the directory.
 */

export function capacitorDefaultRoute(basePath, pathname) {
  const last = pathname.split("/").filter(Boolean).pop() || "";
  if (!last.includes(".")) return basePath + "/index.html";
  return basePath + pathname;
}

export function localRoute(basePath, pathname, hasFile) {
  const last = pathname.split("/").filter(Boolean).pop() || "";
  if (last.includes(".")) return basePath + pathname;
  const trimmed = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  if (!trimmed || trimmed === "/") return basePath + "/index.html";
  const nested = basePath + trimmed + "/index.html";
  if (hasFile(nested)) return nested;
  return basePath + "/index.html";
}

function selfTest() {
  const www = "/app/public";
  const hasFile = (file) =>
    file === www + "/bitcoin-kart/index.html" ||
    file === www + "/chop/index.html" ||
    file === www + "/index.html";
  const cases = [
    [capacitorDefaultRoute(www, "/bitcoin-kart/"), www + "/index.html"],
    [capacitorDefaultRoute(www, "/bitcoin-kart"), www + "/index.html"],
    [capacitorDefaultRoute(www, "/"), www + "/index.html"],
    [capacitorDefaultRoute(www, "/bitcoin-kart/js/main.js"), www + "/bitcoin-kart/js/main.js"],
    [localRoute(www, "/bitcoin-kart/", hasFile), www + "/bitcoin-kart/index.html"],
    [localRoute(www, "/bitcoin-kart", hasFile), www + "/bitcoin-kart/index.html"],
    [localRoute(www, "/chop/", hasFile), www + "/chop/index.html"],
    [localRoute(www, "/", hasFile), www + "/index.html"],
    [localRoute(www, "/index.html", hasFile), www + "/index.html"],
    [localRoute(www, "/missing/", hasFile), www + "/index.html"],
    [localRoute(www, "/bitcoin-kart/js/main.js", hasFile), www + "/bitcoin-kart/js/main.js"],
    [localRoute(www, "/bitcoin-kart/index.html", hasFile), www + "/bitcoin-kart/index.html"],
  ];
  for (const [got, want] of cases) {
    if (got !== want) {
      console.error("router mismatch", got, "!=", want);
      process.exit(1);
    }
  }
  console.log("local-router ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) selfTest();
