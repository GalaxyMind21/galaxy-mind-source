#!/usr/bin/env tsx
/**
 * Snapshot shop-shelf images for directory cards.
 *
 * Prefer the shop's own og:image / twitter:image (a product or storefront
 * card they already publish). When that is missing or too small, fall
 * back to a screenshot of the live website. Bytes land under
 * public/vendor-shelves/ and src/lib/shelf-manifest.json, same local-first
 * pattern as snapshot-avatars.ts — visitors never hotlink 100 shops.
 *
 * Usage:
 *   npx tsx scripts/snapshot-vendor-shelves.ts              # missing only
 *   npx tsx scripts/snapshot-vendor-shelves.ts --og-only    # skip screenshots
 *   npx tsx scripts/snapshot-vendor-shelves.ts --shots-only # skip og:image
 *   npx tsx scripts/snapshot-vendor-shelves.ts --limit 20
 *   npx tsx scripts/snapshot-vendor-shelves.ts --handle soapminer1
 *   npx tsx scripts/snapshot-vendor-shelves.ts --handle 33_gamma --url https://33gamma.com/inventory
 *   npx tsx scripts/snapshot-vendor-shelves.ts --handle 33_gamma --image https://shop.example/product.jpg
 *   npx tsx scripts/snapshot-vendor-shelves.ts --recompress  # shrink existing files
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import puppeteer, { type Page } from "puppeteer-core";
import {
  HOUSE_HANDLE,
  VENDORS,
  vendorSlug,
  vendorKey,
  vendorWebsite,
  type Vendor,
} from "../src/lib/vendors";
import { safeFetch, validateOutboundUrl } from "../src/lib/safe-fetch";
import MANIFEST from "../src/lib/shelf-manifest.json";

type Kind = "og" | "shot";
type Entry = { src: string; kind: Kind; w?: number; h?: number };

const MANIFEST_PATH = "src/lib/shelf-manifest.json";
const SHELF_DIR = "public/vendor-shelves";
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const MIN_BYTES = 4_000;
const MIN_EDGE = 400;
const MAX_EDGE = 1280;
const MAX_BYTES = 100_000;
const FETCH_MS = 10_000;
const SHOT_MS = 18_000;

const args = new Set(process.argv.slice(2));
const ogOnly = args.has("--og-only");
const shotsOnly = args.has("--shots-only");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT =
  limitIdx >= 0 ? Math.max(1, Number(process.argv[limitIdx + 1]) || 40) : Infinity;
const handleIdx = process.argv.indexOf("--handle");
const ONLY =
  handleIdx >= 0 ? process.argv[handleIdx + 1]?.toLowerCase() ?? null : null;
const urlIdx = process.argv.indexOf("--url");
const URL_OVERRIDE =
  urlIdx >= 0 ? process.argv[urlIdx + 1] ?? null : null;
const imageIdx = process.argv.indexOf("--image");
const IMAGE_OVERRIDE =
  imageIdx >= 0 ? process.argv[imageIdx + 1] ?? null : null;

const manifest: Record<string, Entry> = { ...(MANIFEST as Record<string, Entry>) };

let persist: Promise<void> = Promise.resolve();
function saveManifest() {
  persist = persist.then(() => {
    const sorted = Object.fromEntries(
      Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n");
  });
  return persist;
}

// Manifest key = listing key (slug), not handle: one handle may run
// several shops and each storefront has its own picture.
function keyFor(v: Vendor): string {
  return vendorKey(v);
}

function fileStem(v: Vendor): string {
  return vendorSlug(v) || v.handle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
}

function absUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function pickMetaImage(html: string, base: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const url = absUrl(m[1].trim(), base);
      if (url) return url;
    }
  }
  return null;
}

function looksLikeTinyIcon(url: string): boolean {
  return /(\/favicon|apple-touch-icon|\/icon[-_/]|\.ico(?:\?|$)|32x32|16x16)/i.test(
    url,
  );
}

/** Full pixel size from the file header. The manifest records this so
 *  VendorCard can tell a 4:3 screenshot from a 1.905 og card and letterbox
 *  the latter instead of cropping through the shop's name — see shelfFits()
 *  in lib/shelves.ts. */
function imageSizePx(bytes: Uint8Array): { w: number; h: number } | null {
  // JPEG SOF0/SOF2: FF C0 / FF C2, then length, precision, height, width.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xc0 || marker === 0xc2) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return { w, h };
      }
      i += 2 + len;
    }
    return null;
  }
  // PNG IHDR
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const w =
      (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h =
      (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { w, h };
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const w = bytes[6] | (bytes[7] << 8);
    const h = bytes[8] | (bytes[9] << 8);
    return { w, h };
  }
  // WebP VP8X / VP8 / VP8L — skip a strict parse; byte-size already gated.
  return null;
}

function imageEdgePx(bytes: Uint8Array): number | null {
  const size = imageSizePx(bytes);
  return size ? Math.min(size.w, size.h) : null;
}

async function compressShelf(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    let quality = 72;
    let out = await sharp(bytes)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();
    while (out.byteLength > MAX_BYTES && quality > 48) {
      quality -= 8;
      out = await sharp(bytes)
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true, progressive: true })
        .toBuffer();
    }
    return out.byteLength >= MIN_BYTES ? new Uint8Array(out) : null;
  } catch {
    return null;
  }
}

async function saveBytes(
  v: Vendor,
  bytes: Uint8Array,
  kind: Kind,
  _ext: string,
): Promise<Entry | null> {
  if (bytes.byteLength < MIN_BYTES) return null;
  if (kind === "og") {
    const edge = imageEdgePx(bytes);
    if (edge !== null && edge < MIN_EDGE) return null;
  }
  const compressed = (await compressShelf(bytes)) ?? bytes;
  const ext = compressed === bytes ? _ext : "jpg";
  mkdirSync(SHELF_DIR, { recursive: true });
  const name = `${fileStem(v)}.${ext}`;
  const dest = path.join(SHELF_DIR, name);
  const prev = manifest[keyFor(v)];
  writeFileSync(dest, compressed);
  if (prev?.src) {
    const oldPath = path.join("public", prev.src);
    if (oldPath !== dest && existsSync(oldPath)) {
      try {
        unlinkSync(oldPath);
      } catch {
        /* stale file left for check-vendors to name */
      }
    }
  }
  const size = imageSizePx(compressed);
  const entry: Entry = {
    src: `/vendor-shelves/${name}`,
    kind,
    ...(size ? { w: size.w, h: size.h } : {}),
  };
  manifest[keyFor(v)] = entry;
  await saveManifest();
  return entry;
}

function extFromType(type: string | null): string {
  if (!type) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

async function fetchImage(v: Vendor, imgUrl: string): Promise<Entry | null> {
  const img = await safeFetch(imgUrl, {
    headers: { Accept: "image/*", "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!img || !img.ok) return null;
  const type = img.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const buf = new Uint8Array(await img.arrayBuffer());
  return saveBytes(v, buf, "og", extFromType(type));
}

async function fetchOg(v: Vendor, site: string): Promise<Entry | null> {
  const page = await safeFetch(site, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!page || !page.ok) return null;
  const html = await page.text();
  if (html.length < 200 || html.length > 2_000_000) return null;
  const imgUrl = pickMetaImage(html, page.url || site);
  if (!imgUrl || looksLikeTinyIcon(imgUrl)) return null;
  return fetchImage(v, imgUrl);
}

async function dismissConsent(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const re =
        /^(accept|aceptar|aceitar|agree|allow all|accept all|aceitar todos|aceptar todo|aceptar todas|got it|ok|i agree|accept cookies|allow cookies|aceitar todos os cookies|acceptar todas)/i;
      const els = [
        ...document.querySelectorAll(
          "button, [role=button], a, input[type=button], input[type=submit]",
        ),
      ];
      const hit = els.find((el) => {
        const label = (
          el.textContent ||
          (el as HTMLInputElement).value ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        return re.test(label);
      });
      if (hit) (hit as HTMLElement).click();
    });
  } catch {
    /* overlay may be cross-origin */
  }
}

async function shotSite(v: Vendor, site: string): Promise<Entry | null> {
  const gate = validateOutboundUrl(site);
  if (!gate.ok) return null;
  if (!existsSync(CHROME)) {
    console.warn("  no Chrome at expected path · skip screenshots");
    return null;
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
    await page.setUserAgent(UA);
    await page.goto(site, {
      waitUntil: "load",
      timeout: SHOT_MS,
    });
    await new Promise((r) => setTimeout(r, 2200));
    await dismissConsent(page);
    try {
      await page.keyboard.press("Escape");
    } catch {
      /* */
    }
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const s = getComputedStyle(el);
        if (s.position !== "fixed" && s.position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        const rightDrawer =
          r.width > 240 && r.height > 200 && r.left > window.innerWidth * 0.55;
        const cookieBar =
          r.width > window.innerWidth * 0.5 &&
          r.height > 80 &&
          r.height < 360 &&
          r.bottom > window.innerHeight * 0.65;
        if (rightDrawer || cookieBar) el.style.display = "none";
      }
    });
    await new Promise((r) => setTimeout(r, 700));
    const buf = await page.screenshot({
      type: "jpeg",
      quality: 64,
      clip: { x: 0, y: 0, width: 1280, height: 960 },
    });
    await page.close();
    return saveBytes(v, new Uint8Array(buf), "shot", "jpg");
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

function siteFor(v: Vendor): string | undefined {
  if (ONLY && URL_OVERRIDE) return URL_OVERRIDE;
  return vendorWebsite(v);
}

async function recompressExisting(): Promise<void> {
  const keys = Object.keys(manifest).sort();
  let n = 0;
  for (const key of keys) {
    const entry = manifest[key];
    const file = path.join("public", entry.src);
    if (!existsSync(file)) continue;
    const raw = new Uint8Array(readFileSync(file));
    if (raw.byteLength <= MAX_BYTES && entry.src.endsWith(".jpg")) continue;
    const vendor = VENDORS.find((v) => keyFor(v) === key);
    if (!vendor) continue;
    process.stdout.write(
      `  ${vendor.name} ${Math.round(raw.byteLength / 1024)}KB … `,
    );
    const got = await saveBytes(vendor, raw, entry.kind, "jpg");
    if (got) {
      n++;
      const next = readFileSync(path.join("public", got.src));
      console.log(`${Math.round(next.byteLength / 1024)}KB`);
    } else {
      console.log("skip");
    }
  }
  console.log(`recompressed ${n} · manifest ${Object.keys(manifest).length}`);
}

async function main() {
  if (args.has("--recompress")) {
    await recompressExisting();
    return;
  }
  // The house listing (website = galaxymind.space/hashrate) is never
  // snapshotted. Its og:image is the /hashrate share card, which carries
  // the live block-reward figure and on-page odds framing; that register
  // stays on /hashrate (lib/hashrate-copy, 2026-08-13). The directory
  // tile, /v banner and popup banner use the committed service still at
  // public/vendor-shelves/galaxy-mind-hashrate.jpg instead, so a
  // --refresh cannot copy the share card back onto the directory.
  let targets = VENDORS.filter(
    (v) =>
      v.handle !== HOUSE_HANDLE && (vendorWebsite(v) || (ONLY && URL_OVERRIDE)),
  );
  if (ONLY) {
    targets = targets.filter(
      (v) => v.handle.toLowerCase() === ONLY || vendorKey(v) === ONLY,
    );
  }
  const missing = (
    args.has("--refresh")
      ? targets
      : targets.filter((v) => !manifest[keyFor(v)])
  ).sort((a, b) => b.listedAt - a.listedAt);
  const work = missing.slice(0, LIMIT === Infinity ? missing.length : LIMIT);

  console.log(
    `shelves · ${Object.keys(manifest).length} on disk · ${missing.length} missing · doing ${work.length}`,
  );

  let og = 0;
  let shot = 0;
  let fail = 0;

  if (IMAGE_OVERRIDE && ONLY && work[0]) {
    process.stdout.write(`  img ${work[0].name} … `);
    const got = await fetchImage(work[0], IMAGE_OVERRIDE);
    if (got) {
      og++;
      console.log(`ok (${got.src})`);
    } else {
      console.log("none");
    }
  } else if (!shotsOnly) {
    await pool(work, 6, async (v) => {
      const site = siteFor(v);
      if (!site) return;
      process.stdout.write(`  og  ${v.name} … `);
      const got = await fetchOg(v, site);
      if (got) {
        og++;
        console.log(`ok (${got.src})`);
      } else {
        console.log("none");
      }
    });
  }

  const still =
    shotsOnly && args.has("--refresh")
      ? work
      : work.filter((v) => !manifest[keyFor(v)]);
  if (!ogOnly && still.length) {
    console.log(`screenshots · ${still.length}`);
    // Serial-ish: one Chrome per shop, two at a time. Sites are slow.
    await pool(still, 2, async (v) => {
      const site = siteFor(v);
      if (!site) return;
      process.stdout.write(`  shot ${v.name} … `);
      const got = await shotSite(v, site);
      if (got) {
        shot++;
        console.log(`ok`);
      } else {
        fail++;
        console.log("fail");
      }
    });
  }

  console.log(
    `done · og ${og} · shots ${shot} · failed ${fail} · manifest ${Object.keys(manifest).length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
