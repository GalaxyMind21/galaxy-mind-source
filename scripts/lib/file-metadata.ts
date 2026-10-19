// Metadata text from images and PDFs for the never-reveal repo guard (security audit 2026-10-18, M1d).
// Reads only metadata regions, never pixel data, so random compressed bytes can't produce chance matches:
//   JPEG  APP1..APP15 (EXIF, XMP, Photoshop/IPTC) and COM segments, up to the start of scan
//   PNG   tEXt, zTXt, iTXt (inflated when compressed) and eXIf chunks
//   WebP  EXIF and "XMP " chunks
//   PDF   Info dictionary strings (literal and hex, UTF-16BE aware) and uncompressed XMP packets
// Binary payloads (EXIF) are reduced to printable runs, ASCII and UTF-16LE (Windows XP* tags).
// Not covered: compressed PDF object streams, GIF comments, AVIF/HEIC. Pure Node, no dependencies.
import { inflateSync } from "node:zlib";

/** Cap for one compressed PNG text chunk. A zTXt/iTXt "bomb" can't blow up the scan; over the cap the chunk is skipped. */
export const INFLATE_MAX = 1 << 20;
function inflateBounded(buf: Buffer): Buffer {
  try { return inflateSync(buf, { maxOutputLength: INFLATE_MAX }); } catch { return Buffer.alloc(0); }
}

const PRINTABLE = /[\x20-\x7e]{4,}/g;

/** Printable ASCII runs plus UTF-16LE runs (both alignments) from a binary payload, one per line. */
export function printableRuns(buf: Buffer): string {
  const out: string[] = [];
  out.push(...(buf.toString("latin1").match(PRINTABLE) ?? []));
  for (const off of [0, 1]) {
    const b = buf.subarray(off, off + ((buf.length - off) & ~1));
    out.push(...(b.toString("utf16le").match(PRINTABLE) ?? []));
  }
  return out.join("\n");
}

function jpeg(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const m = buf[i + 1];
    if (m === 0xd9 || m === 0xda) break; // end of image / start of scan: pixel data follows
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    const seg = buf.subarray(i + 4, Math.min(buf.length, i + 2 + len));
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) out.push(printableRuns(seg));
    i += 2 + len;
  }
  return out;
}

function png(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, Math.min(buf.length, i + 8 + len));
    try {
      if (type === "tEXt") out.push(data.toString("latin1").replace(/\0/g, "\n"));
      else if (type === "zTXt") {
        const z = data.indexOf(0);
        out.push(data.toString("latin1", 0, z), inflateBounded(data.subarray(z + 2)).toString("latin1"));
      } else if (type === "iTXt") {
        const z = data.indexOf(0);
        const compressed = data[z + 1] === 1;
        let p = z + 3;
        const lang = data.indexOf(0, p); p = lang + 1;
        const tk = data.indexOf(0, p);
        const text = data.subarray(tk + 1);
        out.push(data.toString("latin1", 0, z), data.toString("utf8", p, tk), (compressed ? inflateBounded(text) : text).toString("utf8"));
      } else if (type === "eXIf") out.push(printableRuns(data));
    } catch { out.push(printableRuns(data)); } // malformed chunk: still look at what's there
    if (type === "IEND") break;
    i += 12 + len;
  }
  return out;
}

function webp(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString("latin1", i, i + 4), len = buf.readUInt32LE(i + 4);
    const data = buf.subarray(i + 8, Math.min(buf.length, i + 8 + len));
    if (type === "EXIF") out.push(printableRuns(data));
    else if (type === "XMP ") out.push(data.toString("utf8"));
    i += 8 + len + (len & 1);
  }
  return out;
}

function pdfLiteral(s: string): string {
  const body = s.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) =>
    /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e);
  return body.startsWith("\xfe\xff") ? Buffer.from(body.slice(2), "latin1").swap16().toString("utf16le") : body;
}
function pdfHex(s: string): string {
  const hex = s.slice(1, -1).replace(/\s+/g, "");
  const b = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
  return b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString("utf16le") : b.toString("latin1");
}

function pdf(buf: Buffer): string[] {
  const s = buf.toString("latin1");
  const out: string[] = [];
  const re = /\/(Title|Author|Subject|Keywords|Creator|Producer)\s*(\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/g;
  for (const m of s.matchAll(re)) { try { out.push(m[2].startsWith("(") ? pdfLiteral(m[2]) : pdfHex(m[2])); } catch { out.push(m[2]); } }
  for (const m of s.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g)) out.push(Buffer.from(m[0], "latin1").toString("utf8"));
  return out;
}

/** Metadata text for a file, or null when the type isn't one we read. */
export function metadataText(buf: Buffer, path: string): string | null {
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (["jpg", "jpeg"].includes(ext) || (buf[0] === 0xff && buf[1] === 0xd8)) return jpeg(buf).join("\n");
  if (ext === "png" || buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return png(buf).join("\n");
  if (ext === "webp" || (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP")) return webp(buf).join("\n");
  if (ext === "pdf" || buf.toString("latin1", 0, 5) === "%PDF-") return pdf(buf).join("\n");
  return null;
}

/** UTF-16 text (BOM-marked) decoded to a JS string, or null when the buffer isn't UTF-16 text. */
export function decodeUtf16(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2, 2 + ((buf.length - 2) & ~1)).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16().toString("utf16le");
  return null;
}
