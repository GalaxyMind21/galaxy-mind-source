/**
 * Sync www, then serve it the way GMLocalRouter does: a directory URL
 * loads that folder's index.html, and a URL with an extension loads that
 * file. Stock Capacitor would serve the menu for every extensionless path.
 * A check that only looks for #gm-back is a false pass, because the menu
 * HTML served at /bitcoin-kart/ still mounts that button.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capacitorDefaultRoute, localRoute } from "./local-router.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "www");
const outDir = process.env.ARTIFACTS || "/opt/cursor/artifacts";
const LEDE = "Eight games on this device.";

const GAMES = [
  ["bitcoin-kart", "BITCOIN KART", "/bitcoin-kart/js/main.js"],
  ["super-saylor", "SUPER SAYLOR", null],
  ["chop", "CHOP", "/chop/js/main.js"],
  ["wen", "WEN", "/wen/app.js"],
  ["gauntlet", "The Bitcoin Gauntlet", "/gauntlet/app.js"],
  ["runner", "Node Runner", "/runner/app.js"],
  ["horizon", "Timechain", "/horizon/app.js"],
  ["trail", "The HODL Trail", "/trail/app.js"],
];

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function exists(file) {
  return fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false);
}

function routedFile(pathname) {
  const target = localRoute(www, pathname, (file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
  if (!target.startsWith(www + "/") && target !== www) {
    throw new Error("route escaped www: " + target);
  }
  return target;
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = routedFile(decodeURIComponent(url.pathname));
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

function syncGames() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/sync-games.mjs"], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("sync-games " + code))));
  });
}

async function text(base, pathname) {
  const res = await fetch(base + pathname);
  const body = await res.text();
  return { status: res.status, type: res.headers.get("content-type") || "", body };
}

async function chromePath() {
  for (const p of [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ]) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  return "";
}

async function clickLabel(page, label) {
  await page.waitForFunction(
    (text) => {
      const nodes = document.querySelectorAll("button, a, [role='button']");
      for (const node of nodes) {
        // innerText follows text-transform, so a .micro-label reads as
        // uppercase even when the source says "Show me the tape".
        const shown = ((node.innerText || "") + "\n" + (node.textContent || "")).toLowerCase();
        if (!shown.includes(String(text).toLowerCase())) continue;
        const box = node.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        node.click();
        return true;
      }
      return false;
    },
    { timeout: 20000 },
    label,
  );
}

async function enterPlay(page, id) {
  if (id === "bitcoin-kart") {
    await clickLabel(page, "PRESS START");
    await clickLabel(page, "QUICK RACE");
    // The Games / mute chrome sits over the top of the picker, so a hit-test
    // at the card's top edge never sees the card. The button's own click
    // listener starts the race; it does not need a pointer hit.
    await page.waitForSelector(".track-card:not(.locked)", { timeout: 20000 });
    await page.evaluate(() => document.querySelector(".track-card:not(.locked)").click());
    await page.waitForFunction(() => {
      const stage = document.getElementById("stage");
      return stage && stage.dataset.race === "1";
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 800));
    return;
  }
  if (id === "super-saylor") {
    await clickLabel(page, "START");
    // Level 1 opens the timeline card first. The world only simulates,
    // and only pauses, once that card has started the level.
    await clickLabel(page, "LET'S RIDE");
    await page.waitForFunction(() => {
      return window.__SS && window.__SS.state && window.__SS.state().state === "play";
    }, { timeout: 20000 });
    return;
  }
  if (id === "chop") {
    await page.waitForSelector("#boot-start");
    await page.click("#boot-start");
    await page.waitForFunction(() => {
      const boot = document.getElementById("boot");
      return boot && boot.classList.contains("gone");
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 800));
    return;
  }
  if (id === "wen") {
    await clickLabel(page, "Show me the tape");
    await new Promise((r) => setTimeout(r, 400));
    return;
  }
  if (id === "gauntlet") {
    await clickLabel(page, "Enter the gauntlet");
    await new Promise((r) => setTimeout(r, 600));
    return;
  }
  if (id === "runner") {
    await clickLabel(page, "Run");
    await new Promise((r) => setTimeout(r, 700));
    return;
  }
  if (id === "horizon") {
    await clickLabel(page, "Stack");
    await new Promise((r) => setTimeout(r, 700));
    return;
  }
  if (id === "trail") {
    await clickLabel(page, "Hitch the wagon");
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function shoot(base) {
  const chrome = await chromePath();
  if (!chrome) {
    console.log("screenshots skipped: chrome not installed");
    return;
  }
  const puppeteer = (await import("puppeteer-core")).default;
  await fs.mkdir(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const external = [];
    page.on("pageerror", (err) => pageErrors.push(String(err && err.message ? err.message : err)));
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "127.0.0.1") {
          external.push(u.href);
        }
      } catch {
        /* ignore */
      }
    });
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(base + "/index.html", { waitUntil: "networkidle0" });
    await page.click("#accept");
    await page.waitForSelector(".card");
    const cards = await page.$$eval(".card", (els) => els.map((el) => el.getAttribute("href")));
    if (cards.length !== 8) throw new Error("menu cards " + cards.length);
    await page.screenshot({ path: path.join(outDir, "ios-menu.png") });
    for (let i = 0; i < GAMES.length; i++) {
      const [id, title] = GAMES[i];
      if (process.env.ONLY && id !== process.env.ONLY) continue;
      pageErrors.length = 0;
      external.length = 0;
      const landscape = id === "bitcoin-kart" || id === "super-saylor";
      await page.setViewport({
        width: landscape ? 852 : 393,
        height: landscape ? 393 : 852,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await page.goto(base + cards[i], { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (lede, expected) => document.title.includes(expected) && !document.body.innerText.includes(lede),
        { timeout: 20000 },
        LEDE,
        title,
      );
      const back = await page.$("#gm-back");
      const mute = await page.$("#gm-mute");
      if (!back) throw new Error(id + " has no Games button");
      if (!mute) throw new Error(id + " has no mute button");
      await page.screenshot({ path: path.join(outDir, "ios-" + id + ".png") });
      await enterPlay(page, id);
      await page.screenshot({ path: path.join(outDir, "ios-play-" + id + ".png") });
      const sharp = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c || c.clientWidth < 20) return null;
        return {
          w: c.width,
          h: c.height,
          cw: c.clientWidth,
          ch: c.clientHeight,
          dpr: window.devicePixelRatio || 1,
        };
      });
      // Kart's auto quality drops the buffer to 0.85 or 0.62 of device pixels
      // when frames are slow. A 1x CSS buffer on a 2x screen is the failure.
      if (sharp) {
        const ratio = sharp.w / sharp.cw;
        const floor = Math.min(sharp.dpr, 2) * 0.62;
        if (ratio + 0.05 < floor) {
          throw new Error(id + " canvas is not retina-sized " + JSON.stringify(sharp));
        }
        const fullBleed = id === "bitcoin-kart" || id === "super-saylor" || id === "chop" || id === "runner" || id === "horizon";
        if (fullBleed && sharp.ch < 200) {
          throw new Error(id + " canvas collapsed " + JSON.stringify(sharp));
        }
      }
      if (pageErrors.length) throw new Error(id + " pageerror: " + pageErrors.join(" | "));
      if (external.length) throw new Error(id + " called the network: " + external.slice(0, 4).join(" "));
      if (id === "wen") {
        const slider = await page.$eval('input[type="range"]', (el) => el.getBoundingClientRect().height);
        if (slider < 44) throw new Error("wen timeline hit target is " + slider + "px");
      }
      const covered = await page.evaluate((game) => {
        function box(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return null;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
          return r;
        }
        function hits(a, b) {
          if (!a || !b) return false;
          return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        }
        const chrome = box(document.getElementById("gm-back"));
        if (game === "chop" && hits(box(document.getElementById("hud-sats")), chrome)) return "sats";
        if (game === "bitcoin-kart" && hits(box(document.querySelector(".hud-lap")), chrome)) return "lap";
        if (game === "super-saylor") {
          const canvas = box(document.querySelector("canvas"));
          if (canvas && chrome && canvas.top < chrome.bottom - 4) return "canvas";
        }
        return "";
      }, id);
      if (covered) throw new Error(id + " Games covers " + covered);
      if (id === "wen") {
        const saved = await page.evaluate(async () => {
          await fetch("/api/arcade/score", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ game: "wen", score: 42 }),
          });
          await fetch("/api/arcade/score", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ game: "wen", score: 7 }),
          });
          return localStorage.getItem("gm:native:scores");
        });
        const scores = JSON.parse(saved || "{}");
        if (!scores.wen || scores.wen.score !== 42) throw new Error("local high score " + saved);
      }
      if (id === "super-saylor") {
        const paused = await page.evaluate(() => {
          const desc = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
          const vis = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
          const state = window.__SS && window.__SS.state ? window.__SS.state().state : "";
          if (desc) Object.defineProperty(document, "hidden", desc);
          else delete document.hidden;
          if (vis) Object.defineProperty(document, "visibilityState", vis);
          else delete document.visibilityState;
          return state;
        });
        if (paused !== "pause") {
          throw new Error("saylor did not pause in the background (" + paused + ")");
        }
      }
      const hit = await page.evaluate(() => {
        const btn = document.getElementById("gm-back");
        if (!btn) return "missing";
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top !== btn && !(btn.contains && btn.contains(top))) return top ? (top.id || top.className || top.tagName) : "none";
        return "";
      });
      if (hit) throw new Error(id + " Games button is covered by " + hit);
      // A WebGL canvas can steal a CDP mouse event even when DOM hit
      // testing says the button is on top. The hit test above is the
      // iPhone check. Activation goes through the same pointerup path
      // a tap on that button uses.
      await page.evaluate(() => {
        const btn = document.getElementById("gm-back");
        btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      });
      await page.waitForFunction((lede) => document.body.innerText.includes(lede), { timeout: 15000 }, LEDE);
      const homeTitle = await page.title();
      if (homeTitle !== "Bitcoin Games") throw new Error(id + " back landed on " + homeTitle);
    }
    console.log("play and back ok, screenshots in", outDir);
  } finally {
    await browser.close();
  }
}

async function main() {
  await syncGames();
  const menu = await fs.readFile(path.join(www, "index.html"), "utf8");
  if (!menu.includes(LEDE)) throw new Error("launcher lede missing");

  for (const [id] of GAMES) {
    const slash = "/" + id + "/";
    const stock = capacitorDefaultRoute(www, slash);
    const fixed = localRoute(www, slash, (file) => file.endsWith("/" + id + "/index.html") || file.endsWith("/index.html"));
    if (stock !== www + "/index.html") throw new Error("stock route changed for " + slash);
    if (fixed !== path.join(www, id, "index.html")) throw new Error("fixed route " + fixed);
    const gameHtml = await fs.readFile(path.join(www, id, "index.html"), "utf8");
    if (gameHtml.includes(LEDE)) throw new Error(id + " index is the menu");
  }
  const artNames = ["kart", "saylor", "chop", "wen", "gauntlet", "runner", "horizon", "trail"];
  for (const name of artNames) {
    const art = await fs.readFile(path.join(www, "art", name + ".svg"), "utf8");
    if (!art.includes("<svg")) throw new Error(name + " art missing");
  }

  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const home = await text(base, "/");
    if (home.status !== 200 || !home.body.includes(LEDE)) throw new Error("menu / failed");
    const homeFile = await text(base, "/index.html");
    if (homeFile.body !== home.body) throw new Error("/ and /index.html differ");

    for (const [id, title, asset] of GAMES) {
      for (const pathname of ["/" + id + "/", "/" + id, "/" + id + "/index.html"]) {
        const res = await text(base, pathname);
        if (res.status !== 200) throw new Error(pathname + " " + res.status);
        if (res.body.includes(LEDE)) throw new Error(pathname + " served the menu");
        if (!res.body.includes("<title>") || !res.body.includes(title)) {
          throw new Error(pathname + " title is not " + title);
        }
        const disk = await fs.readFile(path.join(www, id, "index.html"), "utf8");
        if (res.body !== disk) throw new Error(pathname + " is not the bundled index");
      }
      if (asset) {
        const res = await text(base, asset);
        if (res.status !== 200) throw new Error(asset + " " + res.status);
        if (res.type.includes("text/html") || res.body.includes(LEDE)) throw new Error(asset + " served html");
        if (res.body.length < 200) throw new Error(asset + " too small");
      }
    }

    const art = await text(base, "/art/kart.svg");
    if (art.status !== 200 || !art.body.includes("<svg")) throw new Error("kart art missing");
    console.log("static routes ok for", GAMES.length, "games");
    await shoot(base);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
