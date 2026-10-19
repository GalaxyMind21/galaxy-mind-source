// CHOP arcade-card preview capture · poster + animated loop.
//
// Sibling of capture-chop-sizzle.mjs, and the same rig: system Chrome via
// puppeteer-core against a local static server, /api/* proxied to prod so
// the HUD shows a REAL block height. The difference is what it records —
// the sizzle uses canvas captureStream (canvas ONLY, no DOM), which is
// wrong for the arcade card: the sats counter, block chip and combo are
// DOM, and a preview of this game without its numbers reads as an empty
// corridor. So this one takes composited page.screenshot() frames, which
// is also what the other seven cabinets' previews were shot with (see the
// header of src/components/ArcadePreview.tsx).
//
//   node scripts/capture-chop-preview.mjs [frames] [everyMs]
//
// Writes raw frames to ./sizzle-out/preview-frames/. Cropping, scaling and
// the palettegen/paletteuse GIF assembly are ffmpeg steps run after this —
// choose the crop band by LOOKING at a frame, never by assuming, since the
// band that holds notes moves with the track.
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { prodApiUrl, staticFilePath } from "./lib/local-static.mjs";

const [, , FRAMES = "34", EVERY = "110"] = process.argv;
const frames = Math.max(4, Math.min(120, Number(FRAMES) | 0));
const everyMs = Math.max(40, Number(EVERY) | 0);
const ROOT = new URL("../public", import.meta.url).pathname;
const OUT = join(new URL("../sizzle-out", import.meta.url).pathname, "preview-frames");
mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".m4a": "audio/mp4" };

const server = createServer(async (req, res) => {
  const rawPath = new URL(req.url, "http://x").pathname;
  let path;
  try { path = decodeURIComponent(rawPath); } catch { res.writeHead(400); res.end(); return; }
  if (path.startsWith("/api/")) {
    try {
      const target = prodApiUrl(path);
      if (!target) { res.writeHead(404); res.end(); return; }
      const up = await fetch(target);
      const body = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  try {
    const file = staticFilePath(ROOT, rawPath);
    if (!file) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8192, "127.0.0.1", r));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=metal",
    "--window-size=430,932",
    "--disable-gpu-vsync",
  ],
  defaultViewport: { width: 430, height: 932, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });

// Veteran save, written before the module boots — runIdx/diff/tutorial
// gates are read at eval time. A veteran run is the right shot: HODLER
// density, no teach cards, no unfailable-run training wheels.
await page.evaluateOnNewDocument(() => {
  localStorage.clear();
  localStorage.setItem("gm:chop:tutseen", "3");
  localStorage.setItem("gm:chop:runs", "9");
  localStorage.setItem("gm:chop:diff", "hodler");
  localStorage.setItem("gm:chop:taught", "1");
  localStorage.setItem("gm:chop:c21", "1");
  localStorage.setItem("gm:chop:intg", "1");
  // Pre-seed the learned output latency. A cleared save makes the
  // estimator adopt a big correction mid-run and say so ("Timing tuned
  // to your device"), which is right for a player and wrong for a
  // poster — it is the one #teach line that fires on a veteran save.
  localStorage.setItem("gm:chop:lat", "-0.06");
  localStorage.setItem("gm:chop:last", String(Date.now()));
});

await page.goto("http://127.0.0.1:8192/chop/index.html", { waitUntil: "networkidle2" });
await page.waitForFunction(() => !!window.__CHOP, { timeout: 20000 });

// Belt and braces on the toast: #teach is transient chatter over live
// play, so it has no business freezing into a card that sits on /arcade
// for months. Suppressed for the capture only, never in the shipped CSS.
await page.addStyleTag({ content: "#teach{display:none!important}" });

// Start the run and autoplay through the REAL input path, so the frames
// carry a live combo, the chime ladder's glow and genuine debris — the
// same drive loop the sizzle uses.
await page.evaluate(() => {
  document.getElementById("boot-start").click();
  window.__capDrive = setInterval(() => {
    try {
      for (const n of window.__CHOP.inGate()) {
        if (Math.abs(n.dt) < 0.05) window.__CHOP.strokeCut();
      }
    } catch { /* between phases */ }
  }, 16);
});

// Let the intro ceremony clear and a real combo climb before the tape
// rolls. A preview shot in the first bars is a corridor with nothing in it.
await new Promise((r) => setTimeout(r, 22000));

for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: join(OUT, `f${String(i).padStart(3, "0")}.png`) });
  await new Promise((r) => setTimeout(r, everyMs));
}

await page.evaluate(() => clearInterval(window.__capDrive));
console.log(`captured ${frames} frames to ${OUT}`);

await browser.close();
server.close();
