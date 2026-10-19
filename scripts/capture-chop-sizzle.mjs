// CHOP sizzle capture · real gameplay, real audio, one take.
//
// Drives system Chrome (puppeteer-core, no bundled browser) against a
// local static server, plays CHOP for real — the game's own clock, its
// own soundtrack, autoplayed cuts through the SAME feedSample path a
// thumb uses — and records canvas+audio in-page with MediaRecorder.
// The webm lands in ./sizzle-out/, then ffmpeg makes the X-ready mp4.
//
//   node scripts/capture-chop-sizzle.mjs <name> <profile> <seconds>
//   profile: fresh | veteran   (veteran = HODLER, ramps, drop by ~30s)
//
// Audio in headless Chrome needs --autoplay-policy=no-user-gesture-required;
// WebGL2 headless works (the kart capture rig proved it on this machine).
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { prodApiUrl, staticFilePath } from "./lib/local-static.mjs";

const [, , NAME = "sizzle", PROFILE = "veteran", SECS = "26"] = process.argv;
const seconds = Math.max(8, Math.min(60, Number(SECS) | 0));
const ROOT = new URL("../public", import.meta.url).pathname;
const OUT = new URL("../sizzle-out", import.meta.url).pathname;
if (!existsSync(OUT)) mkdirSync(OUT);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".m4a": "audio/mp4" };

const server = createServer(async (req, res) => {
  const rawPath = new URL(req.url, "http://x").pathname;
  let path;
  try { path = decodeURIComponent(rawPath); } catch { res.writeHead(400); res.end(); return; }
  // proxy the live-world endpoints to production: the sizzle must show a
  // REAL block height and pool in the HUD, not "practice block"
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
await new Promise((r) => server.listen(8191, "127.0.0.1", r));

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

// profile BEFORE the module boots — runIdx/diff/tutorial gates read at eval
await page.evaluateOnNewDocument((profile) => {
  localStorage.clear();
  if (profile === "veteran") {
    localStorage.setItem("gm:chop:tutseen", "3");
    localStorage.setItem("gm:chop:runs", "9");
    localStorage.setItem("gm:chop:diff", "hodler");
    localStorage.setItem("gm:chop:taught", "1");
    localStorage.setItem("gm:chop:c21", "1");
    localStorage.setItem("gm:chop:last", String(Date.now()));
  } else {
    // fresh player but tutorial pre-seen: the sizzle shows PLAY, not cards
    localStorage.setItem("gm:chop:tutseen", "3");
    localStorage.setItem("gm:chop:taught", "1");
    localStorage.setItem("gm:chop:diff", "pleb");
    localStorage.setItem("gm:chop:last", String(Date.now()));
  }
}, PROFILE);

await page.goto("http://127.0.0.1:8191/chop/index.html", { waitUntil: "networkidle2" });
await page.waitForFunction(() => !!window.__CHOP, { timeout: 20000 });

const b64 = await page.evaluate(async (secs) => {
  const S = window.__CHOP;
  document.getElementById("boot-start").click();          // real Music.start()
  await new Promise((r) => setTimeout(r, 400));
  // recorder: canvas 60fps + the game's own master mix
  const stream = document.getElementById("gl").captureStream(60);
  const tap = S.music.tapForCapture && S.music.tapForCapture();
  if (tap && tap.getAudioTracks().length) stream.addTrack(tap.getAudioTracks()[0]);
  const rec = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9,opus",
    videoBitsPerSecond: 14_000_000, audioBitsPerSecond: 192_000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // skip most of the note-free lead-in before the tape rolls
  await new Promise((r) => setTimeout(r, 6000));
  rec.start(1000);
  // autoplay through the REAL input path — strokes, trail, chime ladder
  const drive = setInterval(() => {
    try { for (const n of S.inGate()) if (Math.abs(n.dt) < 0.05) S.strokeCut(); } catch { /* */ }
  }, 16);
  await new Promise((r) => setTimeout(r, secs * 1000));
  clearInterval(drive);
  rec.stop();
  await new Promise((r) => { rec.onstop = r; });
  const blob = new Blob(chunks, { type: "video/webm" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  // base64 in 32KB slices to keep the string builder sane
  let s = "";
  for (let i = 0; i < buf.length; i += 32768) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
  }
  return btoa(s);
}, seconds);

const webm = join(OUT, `${NAME}.webm`);
writeFileSync(webm, Buffer.from(b64, "base64"));
console.log(`captured ${webm} (${(Buffer.from(b64, "base64").length / 1e6).toFixed(1)} MB)`);

await browser.close();
server.close();
