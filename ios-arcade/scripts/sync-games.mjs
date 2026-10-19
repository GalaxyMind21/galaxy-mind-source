/**
 * Copy the eight live arcade cabinets into www/ and bundle the five
 * React games so the iOS shell does not need the Next.js server.
 *
 * SIX DEEP stays out. It is an unlisted prototype.
 * Source files under public/ and src/ are read, never modified.
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repo = path.resolve(root, "..");
const www = path.join(root, "www");
const src = path.join(repo, "src");

const REACT = [
  ["wen", "entries/wen.jsx", "WEN"],
  ["gauntlet", "entries/gauntlet.jsx", "The Bitcoin Gauntlet"],
  ["runner", "entries/runner.jsx", "Node Runner"],
  ["horizon", "entries/horizon.jsx", "Timechain"],
  ["trail", "entries/trail.jsx", "The HODL Trail"],
];

function isFile(file) {
  return existsSync(file) && statSync(file).isFile();
}

function resolveExisting(base) {
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
  for (const ext of exts) {
    const file = base + ext;
    if (isFile(file)) return file;
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const file = path.join(base, "index" + ext);
    if (isFile(file)) return file;
  }
  throw new Error(`Cannot resolve ${base}`);
}

function plugin() {
  const shims = {
    "next/link": path.join(root, "shims/link.jsx"),
    "next/navigation": path.join(root, "shims/navigation.js"),
    "@vercel/analytics": path.join(root, "shims/analytics.js"),
  };
  const localRequire = createRequire(path.join(root, "package.json"));
  return {
    name: "gm-alias",
    setup(b) {
      /* Force one React. The site install sits above src/, and a second
         copy makes production useState crash during render. */
      b.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
        path: localRequire.resolve(args.path),
      }));
      b.onResolve({ filter: /^@\// }, (args) => ({
        path: resolveExisting(path.join(src, args.path.slice(2))),
      }));
      b.onResolve({ filter: /^(next\/link|next\/navigation|@vercel\/analytics)$/ }, (args) => ({
        path: shims[args.path],
      }));
    },
  };
}

function skipCopy(srcPath) {
  const rel = srcPath.split(path.sep).join("/");
  if (rel.endsWith(".map")) return false;
  if (rel.endsWith("/sw.js") || rel.endsWith("/sw.js.map")) return false;
  if (rel.includes("/qa/")) return false;
  return true;
}

async function copyTree(from, to) {
  await fs.cp(from, to, { recursive: true, filter: skipCopy });
}

function injectShell(html) {
  if (!html.includes("/gm/app.js")) {
    html = html.replace(
      /<head[^>]*>/i,
      (m) => `${m}\n<script src="/gm/config.js"></script>\n<script src="/gm/app.js"></script>\n<link rel="stylesheet" href="/gm/app.css">`,
    );
  }
  html = html.replace(
    /<meta[^>]+name=["']viewport["'][^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">',
  );
  return html;
}

function reactHtml(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#12110F">
<title>${title}</title>
<script src="/gm/config.js"></script>
<script src="/gm/app.js"></script>
<link rel="stylesheet" href="/gm/app.css">
<link rel="stylesheet" href="/gm/cabinets.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="./app.js"></script>
</body>
</html>
`;
}

async function writeConfig() {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "app.config.json"), "utf8"));
  const pub = {
    bundleId: cfg.bundleId,
    displayName: cfg.displayName,
    gameCenterEnabled: cfg.gameCenterEnabled === true,
    leaderboards: cfg.leaderboards,
  };
  const js = `window.GM_CONFIG = ${JSON.stringify(pub)};\n`;
  await fs.writeFile(path.join(www, "gm/config.js"), js);
}

function patchSaylor(html) {
  const sizeFrom = "  const availW = window.innerWidth;\n  const availH = window.innerHeight - chromeH - 4;";
  const sizeTo = `  const box = document.getElementById("wrap");
  const availW = box && box.clientWidth > 40 ? box.clientWidth : window.innerWidth;
  const availH = (box && box.clientHeight > 40 ? box.clientHeight : window.innerHeight - chromeH) - 4;`;
  if (!html.includes(sizeFrom)) throw new Error("Super Saylor resize measure not found");
  const audioFrom = "else if (this.unlocked) { this.ctx.resume(); }";
  const audioTo = 'else if (this.unlocked && GAME.state === "play") { this.ctx.resume(); }';
  if (!html.includes(audioFrom)) throw new Error("Super Saylor audio resume not found");
  /* A phone is wider than 16:9 in landscape. Contain-fit leaves thick
     side bars. Cover, capped at 15% past fit, crops a thin strip of sky
     and floor instead. Integer scale only once the cabinet is large. */
  const scaleFrom = "  let s = Math.min(availW / VW, availH / VH);\n  if (s >= 2) s = Math.floor(s);";
  const scaleTo = `  const fit = Math.min(availW / VW, availH / VH);
  const cover = Math.max(availW / VW, availH / VH);
  let s = Math.min(cover, fit * 1.15);
  if (s >= 3) s = Math.floor(s);`;
  if (!html.includes(scaleFrom)) throw new Error("Super Saylor scale fit not found");
  return html.replace(sizeFrom, sizeTo).replace(audioFrom, audioTo).replace(scaleFrom, scaleTo);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function main() {
  await fs.rm(www, { recursive: true, force: true });
  await fs.mkdir(www, { recursive: true });

  await copyTree(path.join(root, "shell"), www);
  await writeConfig();

  await copyTree(path.join(repo, "public/bitcoin-kart"), path.join(www, "bitcoin-kart"));
  await copyTree(path.join(repo, "public/chop"), path.join(www, "chop"));
  await fs.mkdir(path.join(www, "super-saylor"), { recursive: true });
  const saylor = patchSaylor(await fs.readFile(path.join(repo, "public/super-saylor.html"), "utf8"));
  await fs.writeFile(path.join(www, "super-saylor/index.html"), injectShell(saylor));

  await fs.copyFile(path.join(repo, "public/arcade-open-browser.js"), path.join(www, "arcade-open-browser.js"));
  for (const name of ["super-saylor.webmanifest", "super-saylor-icon-180.png", "super-saylor-icon-192.png", "super-saylor-icon-512.png"]) {
    await fs.copyFile(path.join(repo, "public", name), path.join(www, name));
  }

  await fs.mkdir(path.join(www, "data"), { recursive: true });
  for (const name of ["btc-history.json", "chop-block.json", "heartbeat.json"]) {
    await fs.copyFile(path.join(root, "fixtures", name), path.join(www, "data", name));
  }

  const kartMain = path.join(www, "bitcoin-kart/js/main.js");
  let kart = await fs.readFile(kartMain, "utf8");
  const needle = 'if ("serviceWorker" in navigator) {';
  if (!kart.includes(needle)) throw new Error("Bitcoin Kart service worker guard not found");
  kart = kart.replace(needle, 'if ("serviceWorker" in navigator && !window.GM_NATIVE) {');
  await fs.writeFile(kartMain, kart);

  for (const dir of ["bitcoin-kart", "chop"]) {
    const indexPath = path.join(www, dir, "index.html");
    const html = await fs.readFile(indexPath, "utf8");
    await fs.writeFile(indexPath, injectShell(html));
  }

  for (const [name, entry, title] of REACT) {
    const outDir = path.join(www, name);
    await fs.mkdir(outDir, { recursive: true });
    await build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      outfile: path.join(outDir, "app.js"),
      minify: true,
      jsx: "automatic",
      target: ["safari17"],
      define: { "process.env.NODE_ENV": '"production"' },
      nodePaths: [path.join(root, "node_modules")],
      plugins: [plugin()],
      legalComments: "none",
    });
    await fs.writeFile(path.join(outDir, "index.html"), injectShell(reactHtml(title)));
  }

  const trailJs = path.join(www, "trail/app.js");
  const trailSrc = await fs.readFile(trailJs, "utf8");
  /* esbuild writes the middle dot as \xB7 inside the bundle string. */
  const trailFail = /Board post queued \\xB7 retries on your next visit/;
  if (!trailFail.test(trailSrc)) throw new Error("trail offline score line not found");
  await fs.writeFile(trailJs, trailSrc.replace(trailFail, "Best score saved on this device"));

  const tw = path.join(root, "node_modules/.bin/tailwindcss");
  await run(tw, ["-i", "styles/cabinets.css", "-o", "www/gm/cabinets.css", "--minify"]);

  const games = ["bitcoin-kart", "super-saylor", "chop", "wen", "gauntlet", "runner", "horizon", "trail"];
  for (const g of games) {
    const index = path.join(www, g, "index.html");
    await fs.access(index);
  }
  console.log("synced", games.length, "games into", www);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
