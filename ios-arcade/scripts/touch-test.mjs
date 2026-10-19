/**
 * Headless iPhone pass over the bundled games. Reports touch, overflow,
 * and console errors. WebGL may be black in this environment. That is
 * recorded, not treated as a missing game.
 */
import { statSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { localRoute } from "./local-router.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "www");
const outDir = process.env.ARTIFACTS || "/opt/cursor/artifacts";

const PATHS = [
  ["/", "launcher"],
  ["/bitcoin-kart/", "kart"],
  ["/super-saylor/", "saylor"],
  ["/chop/", "chop"],
  ["/wen/", "wen"],
  ["/gauntlet/", "gauntlet"],
  ["/runner/", "runner"],
  ["/horizon/", "horizon"],
  ["/trail/", "trail"],
];

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".m4a")) return "audio/mp4";
  if (file.endsWith(".ogg")) return "audio/ogg";
  if (file.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const routed = localRoute(www, decodeURIComponent(url.pathname), (file) => {
        try { return statSync(file).isFile(); } catch { return false; }
      });
      const file = path.normalize(routed);
      if (!file.startsWith(www)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function chromePath() {
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try {
      await fs.access(p);
      return p;
    } catch { /* next */ }
  }
  throw new Error("chrome not found");
}

async function main() {
  await fs.access(path.join(www, "index.html"));
  await fs.mkdir(outDir, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const report = [];
  try {
    for (const [route, id] of PATHS) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err).slice(0, 300)));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
      });
      await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, id === "launcher" ? 400 : 2500));
      const probe = await page.evaluate(() => {
        const coarse = matchMedia("(pointer: coarse)").matches;
        const fine = matchMedia("(pointer: fine)").matches;
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return {
          coarse,
          fine,
          overflow,
          back: !!document.getElementById("gm-back"),
          saylorPads: document.querySelectorAll("#touch, .touch, [id*='pad']").length,
          kartTouch: !!document.getElementById("touch"),
          canvas: document.querySelectorAll("canvas").length,
          note: document.getElementById("gm-note") ? document.getElementById("gm-note").textContent : "",
        };
      });
      const shot = path.join(outDir, `iphone-${id}.png`);
      await page.screenshot({ path: shot });
      report.push({ id, route, ...probe, errors: errors.slice(0, 8), shot });
      await page.close();
      console.log(id, probe.coarse ? "coarse" : "FINE", "overflow", probe.overflow, "errors", errors.length);
    }
  } finally {
    await browser.close();
    server.close();
  }
  await fs.writeFile(path.join(outDir, "touch-report.json"), JSON.stringify(report, null, 2));
  const bad = report.filter((r) => r.id !== "launcher" && (!r.coarse || r.fine));
  if (bad.length) {
    console.error("pointer patch failed", bad.map((b) => b.id).join(","));
    process.exit(1);
  }
  console.log("touch-test wrote", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
