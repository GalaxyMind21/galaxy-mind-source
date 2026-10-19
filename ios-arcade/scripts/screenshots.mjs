/**
 * Captioned store screenshots from the bundled games.
 * 6.9" and 6.5" iPhone, 13" iPad. First three frames get a caption bar.
 */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "www");
const dest = path.join(root, "store/screenshots/en-US");
const artifacts = process.env.ARTIFACTS || "/opt/cursor/artifacts";

const FRAMES = [
  ["/", "Eight bitcoin games. Offline."],
  ["/bitcoin-kart/", "Race Bitcoin Kart."],
  ["/super-saylor/", "No ads. Scores are play points."],
  ["/chop/", ""],
  ["/wen/", ""],
  ["/trail/", ""],
];

const DEVICES = [
  { name: "iPhone 6.9-inch", width: 440, height: 956, scale: 3 },
  { name: "iPhone 6.5-inch", width: 428, height: 926, scale: 3 },
  { name: "iPad Pro (13-inch)", width: 1032, height: 1376, scale: 2 },
];

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.normalize(path.join(www, rel));
      if (!file.startsWith(www)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { "content-type": contentType(file) });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function captionSvg(width, height, text) {
  const bar = Math.round(height * 0.11);
  const font = Math.round(bar * 0.34);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${bar}" fill="#12110F"/>
    <rect x="0" y="${bar - 8}" width="${width}" height="8" fill="#F7931A"/>
    <text x="${Math.round(width * 0.06)}" y="${Math.round(bar * 0.64)}" fill="#F2EFE9" font-family="sans-serif" font-size="${font}" font-weight="500">${escaped}</text>
  </svg>`);
}

async function chromePath() {
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]) {
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  throw new Error("chrome not found");
}

async function main() {
  await fs.mkdir(dest, { recursive: true });
  await fs.mkdir(artifacts, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    for (const device of DEVICES) {
      for (let i = 0; i < FRAMES.length; i++) {
        const [route, caption] = FRAMES[i];
        const page = await browser.newPage();
        await page.setViewport({
          width: device.width,
          height: device.height,
          deviceScaleFactor: device.scale,
          isMobile: true,
          hasTouch: true,
        });
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, route === "/" ? 500 : 2200));
        let buf = await page.screenshot({ type: "png" });
        await page.close();
        const img = sharp(buf);
        const meta = await img.metadata();
        if (caption) {
          buf = await sharp(buf)
            .composite([{ input: captionSvg(meta.width, meta.height, caption) }])
            .png()
            .toBuffer();
        }
        const file = `${device.name}-${String(i + 1).padStart(2, "0")}.png`;
        await fs.writeFile(path.join(dest, file), buf);
        if (device.name.startsWith("iPhone 6.9")) {
          await fs.writeFile(path.join(artifacts, file.replace(/ /g, "-")), buf);
        }
        console.log(file, meta.width, meta.height);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
