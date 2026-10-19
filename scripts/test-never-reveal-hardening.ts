// never-reveal guard hardening (security audit 2026-10-18, M1 a/c/d/e/f + F3a). In-process plus throwaway git repos.
// Test-only random keys and synthetic terms; never the private list.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NR from "../src/lib/never-reveal";
import { metadataText, decodeUtf16 } from "./lib/file-metadata";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const repo = process.cwd();

const key = randomBytes(32), keyHex = key.toString("hex");
const PHRASE = "Zzone Zztwo Zzthree";             // 3-word phrase
const PAIR = "Zzleft Zzright";                    // 2-word term (split across a line in the repo test)
const DOTTED = "zzhost.example.zz";               // hostname
const EMAIL = "zzowner@zzmail.com";               // email
const LONG_SUB = "zzlongblocked" + "k".repeat(60); // 73 chars: a blocked word over 64 chars, matched inside tokens
const META = "Zzmetaword";
const ALLOWED = "Zzallowedhere";
const groups = { output: [PHRASE, DOTTED, EMAIL], guard: [PHRASE, PAIR, DOTTED, EMAIL, LONG_SUB, META, ALLOWED], sub: [LONG_SUB], allow: [{ files: "^ok\\.ts$", terms: [ALLOWED] }] };
const json = NR.buildNeverRevealDigests(key, groups);
const cfg = NR.parseNeverReveal(keyHex, json);

console.log("parse: anchoring (F3) and compile-alone (F3a)");
assert("synthetic config parses", !!cfg);
const withAllow = (files: string) => JSON.stringify({ v: 1, allow: [{ files, d: [] }] });
for (const [n, files] of [["unanchored (no ^)", "src/x\\.ts$"], ["unanchored (no $)", "^src/x"], ["escaped $", "^src/x\\$"], ["F3a: '^a)|(b$' only compiles once wrapped", "^a)|(b$"], ["unbalanced (", "^(a$"]] as const) {
  assert(`refused: ${n}`, NR.parseNeverReveal(keyHex, withAllow(files)) === null);
}
assert("'^a)|(b$' really would compile inside ^(?:…)$ (why F3a matters)", (() => { try { new RegExp("^(?:^a)|(b$)$"); return true; } catch { return false; } })());
const alt = NR.parseNeverReveal(keyHex, withAllow("^src/a\\.ts|src/b\\.ts$"))?.allow[0].files;
assert("a top-level alternation can't escape the anchors", !!alt && alt.test("src/a.ts") && alt.test("src/b.ts") && !alt.test("src/a.ts.bak") && !alt.test("x/src/b.ts"));
const grp = NR.parseNeverReveal(keyHex, withAllow("^(public/llms\\.txt|src/c/[^/]+)$"))?.allow[0].files;
assert("anchored group matches exact paths only", !!grp && grp.test("public/llms.txt") && !grp.test("public/llms.txt.bak") && !grp.test("docs/public/llms.txt") && grp.test("src/c/p.tsx") && !grp.test("src/c/d/p.tsx"));

console.log("parse: window size");
assert("w defaults to 3 when absent", NR.parseNeverReveal(keyHex, '{"v":1}')?.words === 3);
for (const w of [1, 9, 2.5, "3"]) assert(`refused: w=${JSON.stringify(w)}`, NR.parseNeverReveal(keyHex, JSON.stringify({ v: 1, w })) === null);
assert("generator widens w for a 4-token term", NR.parseNeverReveal(keyHex, NR.buildNeverRevealDigests(key, { guard: ["za zb zc zd"] }))?.words === 4);
assert("generator never writes w over 8", NR.parseNeverReveal(keyHex, NR.buildNeverRevealDigests(key, { guard: ["a b c d e f g h i j"] }))?.words === 8);

console.log("matcher: dotted terms and 3+ word phrases (M1a)");
const hit = (t: string) => NR.containsNeverReveal(t, "guard", [cfg!]);
assert("3-word phrase written with spaces", hit("we said zzone zztwo zzthree today"));
assert("3-word phrase in snake/kebab/camel-ish forms", hit("zzone-zztwo-zzthree") && hit("Zzone_Zztwo_Zzthree"));
assert("3-word phrase split across lines (lib tokenizer)", hit("zzone zztwo\nzzthree"));
assert("dotted hostname as written", hit(`see ${DOTTED}/path`));
assert("dotted hostname with spaces instead of dots", hit("zzhost example zz"));
assert("dotted hostname inside a URL", hit(`https://${DOTTED}:443/x`));
assert("email as written", hit(`mail ${EMAIL} now`));
assert("email inside a mailto", hit(`mailto:${EMAIL}?subject=hi`));
assert("no false positive on partial phrase or partial host", !hit("zzone zztwo") && !hit("zzhost example") && !hit("zzmail.com"));
assert("IPv4 terms still match whole", NR.containsNeverReveal("at 192.0.2.44 now", "guard", [NR.parseNeverReveal(keyHex, NR.buildNeverRevealDigests(key, { guard: ["192.0.2.44"] }))!]));

console.log("matcher: blocked word over 64 chars inside a longer token");
assert("config with a 73-char sub term parses", !!cfg && [...cfg.sub.keys()].includes(LONG_SUB.length));
assert("lib flags it embedded in a longer token", hit(`x = "aa${LONG_SUB}bb"`) && hit(`const pre_${LONG_SUB}_post = 1`));
assert("lib leaves a near miss alone", !hit("aazzlongblocked" + "k".repeat(59) + "bb"));

console.log("metadata extraction (M1d)");
const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra: Buffer[]) => Buffer.concat([PNG_SIG, pngChunk("IHDR", Buffer.alloc(13)), ...extra, pngChunk("IDAT", randomBytes(64)), pngChunk("IEND", Buffer.alloc(0))]);
const pngText = png([pngChunk("tEXt", Buffer.from(`Author\0${META}`, "latin1"))]);
const pngZ = png([pngChunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0", "latin1"), deflateSync(Buffer.from(`by ${META}`))]))]);
const pngI = png([pngChunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\x01\0\0\0", "latin1"), deflateSync(Buffer.from(`<dc:creator>${META}</dc:creator>`))]))]);
const seg = (marker: number, data: Buffer) => { const h = Buffer.from([0xff, marker, 0, 0]); h.writeUInt16BE(data.length + 2, 2); return Buffer.concat([h, data]); };
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0MM\0*", "latin1"), Buffer.from(`Artist ${META}\0`, "latin1"), Buffer.from(`XP ${META}`, "utf16le")])), seg(0xfe, Buffer.from("comment")), Buffer.from([0xff, 0xda]), randomBytes(64), Buffer.from([0xff, 0xd9])]);
const pdfHexAuthor = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(META, "utf16le").swap16()]).toString("hex");
const pdfDoc = Buffer.from(`%PDF-1.7\n1 0 obj << /Title (Report) /Author <${pdfHexAuthor}> >> endobj\ntrailer << /Info 1 0 R >>\n%%EOF`, "latin1");
const pdfLit = Buffer.from(`%PDF-1.4\n1 0 obj << /Creator (Made by ${META}\\051) >> endobj\n%%EOF`, "latin1");
const webp = (() => {
  const xmp = Buffer.from(`<x:xmpmeta><dc:creator>${META}</dc:creator></x:xmpmeta>`);
  const c = Buffer.concat([Buffer.from("XMP ", "latin1"), Buffer.alloc(4), xmp, Buffer.alloc(xmp.length & 1)]); c.writeUInt32LE(xmp.length, 4);
  const h = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]);
  return Buffer.concat([h, c]);
})();
const metaHit = (b: Buffer, p: string) => hit(metadataText(b, p) ?? "");
assert("PNG tEXt", metaHit(pngText, "a.png"));
assert("PNG zTXt (compressed)", metaHit(pngZ, "a.png"));
{
  // zTXt bomb: 64 MB of zeros deflates to ~64 KB. Inflate is capped, so the chunk is skipped without blowing up memory.
  const bomb = png([pngChunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0", "latin1"), deflateSync(Buffer.alloc(64 << 20))])), pngChunk("tEXt", Buffer.from(`Author\0by ${META}`, "latin1"))]);
  const before = process.memoryUsage().rss;
  const hit = metaHit(bomb, "bomb.png");
  assert("a zTXt bomb is capped (no 64 MB inflate) and other chunks still scan", hit && process.memoryUsage().rss - before < 48 << 20);
}
assert("PNG iTXt (compressed XMP)", metaHit(pngI, "a.png"));
assert("JPEG EXIF ASCII + UTF-16 (XP tags)", metaHit(jpg, "a.jpg") && /XP Zzmetaword/.test(metadataText(jpg, "a.jpg") ?? ""));
assert("JPEG pixel data after SOS is never read", !(metadataText(jpg, "a.jpg") ?? "").includes("\xff\xd9"));
assert("PDF Info hex string (UTF-16BE)", metaHit(pdfDoc, "a.pdf"));
assert("PDF Info literal string", metaHit(pdfLit, "a.pdf"));
assert("WebP XMP chunk", metaHit(webp, "a.webp"));
assert("clean PNG has no hit", !metaHit(png([pngChunk("tEXt", Buffer.from("Software\0Example", "latin1"))]), "a.png"));
assert("unknown type → null", metadataText(Buffer.from("GIF89a"), "a.gif") === null);
assert("UTF-16LE text with BOM decodes", decodeUtf16(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi zzone", "utf16le")])) === "hi zzone");
assert("UTF-16BE text with BOM decodes", decodeUtf16(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("hi", "utf16le").swap16()])) === "hi");

// ── repo guards, end to end, in throwaway git repos ───────────────────
const env = { ...process.env, NEVER_REVEAL_KEY: keyHex, NEVER_REVEAL_DIGESTS: json, GITHUB_ACTIONS: "" };
const run = (script: string, cwd: string, args: string[] = [], extra: Record<string, string> = {}) => {
  try {
    const out = execFileSync("npx", ["tsx", join(repo, "scripts", script), ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extra } });
    return { ok: true, out };
  } catch (e) { const x = e as { stdout?: string; stderr?: string }; return { ok: false, out: `${x.stdout ?? ""}${x.stderr ?? ""}` }; }
};
const gitIn = (cwd: string, a: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...a], { cwd, encoding: "utf8" });

console.log("tree guard (scripts/check-never-reveal.ts)");
{
  const dir = mkdtempSync(join(tmpdir(), "nr-tree-"));
  try {
    gitIn(dir, ["init", "-q"]);
    writeFileSync(join(dir, "split.md"), ["intro line", "the zzleft", "zzright word", "end"].join("\n"));
    writeFileSync(join(dir, "phrase.ts"), `// zzone zztwo zzthree\n`);
    writeFileSync(join(dir, "host.ts"), `const u = "https://${DOTTED}/";\n`);
    writeFileSync(join(dir, "long.ts"), `const k = "aa${LONG_SUB}bb";\n`);
    writeFileSync(join(dir, "ok.ts"), `const a = "${ALLOWED}";\n`);
    writeFileSync(join(dir, "xok.ts"), `const a = "${ALLOWED}";\n`);
    writeFileSync(join(dir, "pic.png"), pngText);
    writeFileSync(join(dir, "doc.pdf"), pdfDoc);
    writeFileSync(join(dir, "clean.png"), png([]));
    writeFileSync(join(dir, "u16.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`hello\n${PHRASE}\n`, "utf16le")]));
    writeFileSync(join(dir, "clean.ts"), "const zzleft = 1;\nconst other = zzright_value;\n");
    gitIn(dir, ["add", "-A"]);
    const r = run("check-never-reveal.ts", dir, ["--require"]);
    const lines = r.out.split("\n").map((l) => l.trim());
    assert("guard fails", !r.ok);
    assert("a two-word term split across lines is flagged on its first line", lines.includes("split.md:2"));
    assert("a 3-word phrase is flagged", lines.includes("phrase.ts:1"));
    assert("a dotted hostname is flagged", lines.includes("host.ts:1"));
    assert("a blocked word over 64 chars inside a longer token is flagged", lines.includes("long.ts:1"));
    assert("an anchored allow rule exempts exactly its file", !lines.some((l) => l.startsWith("ok.ts")) && lines.includes("xok.ts:1"));
    assert("PNG metadata is flagged", lines.includes("pic.png (metadata)"));
    assert("PDF metadata is flagged", lines.includes("doc.pdf (metadata)"));
    assert("UTF-16 text is decoded and flagged", lines.includes("u16.txt:2"));
    assert("clean files are not flagged", !lines.some((l) => l.startsWith("clean.")));
    assert("output never carries a term", !/zzleft|zzone|zzhost|zzlongblocked|zzmetaword|zzallowed/i.test(r.out.replace(/^.*check-never-reveal.*$/m, "").split("\n").filter((l) => !/\.(md|ts|png|pdf|txt)/.test(l)).join("\n")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("commit guard (scripts/check-never-reveal-commits.ts)");
{
  const dir = mkdtempSync(join(tmpdir(), "nr-commits-"));
  try {
    gitIn(dir, ["init", "-q"]);
    writeFileSync(join(dir, "a.txt"), "1");
    gitIn(dir, ["add", "-A"]); gitIn(dir, ["commit", "-q", "-m", `old commit about ${DOTTED}`]);
    const base = gitIn(dir, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(dir, "a.txt"), "2");
    gitIn(dir, ["add", "-A"]); gitIn(dir, ["commit", "-q", "-m", "clean change"]);
    const clean = gitIn(dir, ["rev-parse", "HEAD"]).trim();
    let r = run("check-never-reveal-commits.ts", dir, ["--range", `${base}..${clean}`, "--require"]);
    assert("clean new commits pass (history before the range is not re-checked)", r.ok && /ok \(1 commit/.test(r.out), r.out);
    writeFileSync(join(dir, "a.txt"), "3");
    gitIn(dir, ["add", "-A"]); gitIn(dir, ["commit", "-q", "-m", "fix", "-m", `body mentions ${PHRASE}`]);
    const dirty = gitIn(dir, ["rev-parse", "HEAD"]).trim();
    r = run("check-never-reveal-commits.ts", dir, ["--range", `${base}..${dirty}`, "--require"]);
    assert("a blocked phrase in a new commit body fails, naming the commit only", !r.ok && r.out.includes(`commit ${dirty.slice(0, 8)}`) && !/zzone/i.test(r.out), r.out);
    const evFile = join(dir, "..", `ev-${Date.now()}.json`);
    const prEvent = (title: string, body: string | null, ref: string, b = base, h = clean) => {
      writeFileSync(evFile, JSON.stringify({ pull_request: { title, body, base: { sha: b }, head: { sha: h, ref } } }));
      return { GITHUB_EVENT_PATH: evFile };
    };
    r = run("check-never-reveal-commits.ts", dir, ["--event"], prEvent(`Ship ${EMAIL}`, "fine", "feat/ok"));
    assert("event JSON: a blocked word in the PR title fails", !r.ok && r.out.includes("PR title") && !r.out.includes("PR body"), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--event"], prEvent("ok", "split\nzzleft\nzzright", "zzone-zztwo-zzthree"));
    assert("event JSON: PR body (split across lines) and branch name are checked", !r.ok && r.out.includes("PR body") && r.out.includes("branch name"), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--event", "--require"], prEvent("ok", null, "feat/ok"));
    assert("event JSON: clean PR passes (null body ok)", r.ok && /ok \(1 commit/.test(r.out), r.out);
    assert("event text is never echoed", !r.out.includes("feat/ok"));
    writeFileSync(evFile, JSON.stringify({ before: base, after: clean, ref: "refs/heads/zzone-zztwo-zzthree" }));
    r = run("check-never-reveal-commits.ts", dir, ["--event"], { GITHUB_EVENT_PATH: evFile });
    assert("event JSON (push): range from before/after, branch from ref", !r.ok && r.out.includes("branch name") && !r.out.includes("PR title"), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--event"], prEvent("ok", "ok", "feat/ok", "main", clean));
    assert("a non-hex base (ref name) is refused", !r.ok && /base must be a hex commit SHA/.test(r.out), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--range", `${base}..--output=x`]);
    assert("a head starting with '-' is refused", !r.ok && /head must be a hex commit SHA/.test(r.out), r.out);
    rmSync(evFile, { force: true });
    // Merge commits are checked too.
    gitIn(dir, ["switch", "-q", "-c", "side", base]);
    writeFileSync(join(dir, "b.txt"), "1");
    gitIn(dir, ["add", "-A"]); gitIn(dir, ["commit", "-q", "-m", "side change"]);
    gitIn(dir, ["switch", "-q", "-"]);
    gitIn(dir, ["merge", "-q", "--no-ff", "side", "-m", `merge note ${PHRASE}`]);
    const merged = gitIn(dir, ["rev-parse", "HEAD"]).trim();
    r = run("check-never-reveal-commits.ts", dir, ["--range", `${dirty}..${merged}`, "--require"]);
    assert("a blocked phrase in a merge commit message fails", !r.ok && r.out.includes(`commit ${merged.slice(0, 8)}`), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--range", `${"0".repeat(40)}..${clean}`, "--require"]);
    assert("an all-zero base (new branch push) checks just the head", r.ok && /ok \(1 commit/.test(r.out), r.out);
    r = run("check-never-reveal-commits.ts", dir, ["--range", `${base}..${clean}`], { NEVER_REVEAL_KEY: "", NEVER_REVEAL_DIGESTS: "" });
    assert("no secrets: skips with a notice unless --require", r.ok && /skipped/.test(r.out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
