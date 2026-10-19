// Compute the SRI hash for public/embed.js and write it to
// public/embed.integrity.json.
//
// SRI (Subresource Integrity) lets embedders pin a specific version
// of our embed.js by including the hash in their <script integrity="…">
// attribute. If the hash on our CDN changes (legit update OR compromise),
// the embedder's browser refuses to execute the new file. Defense
// against supply-chain attacks for a script that, by design, runs on
// other people's sites.
//
// Run after every change to public/embed.js:
//   node scripts/embed-sri.mjs
//
// Output: public/embed.integrity.json
//   { "sha384": "sha384-XXXXX...", "byteLength": 7398, "computedAt": "..." }
//
// /embed page reads this file at build time and surfaces the hash in
// the copy-paste snippet for new embedders.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = resolve(process.cwd(), "public/embed.js");
const OUTPUT = resolve(process.cwd(), "public/embed.integrity.json");

const buf = readFileSync(SOURCE);
// sha384 is the SRI default — safer than sha256 (no collision concerns
// foreseeable), shorter than sha512 in the integrity attribute.
const digest = createHash("sha384").update(buf).digest("base64");
const integrity = `sha384-${digest}`;

const meta = {
  sha384: integrity,
  byteLength: buf.length,
  computedAt: new Date().toISOString(),
};

writeFileSync(OUTPUT, JSON.stringify(meta, null, 2) + "\n");
console.log(`✓ embed.js SRI computed`);
console.log(`  hash:  ${integrity}`);
console.log(`  bytes: ${buf.length}`);
console.log(`  written → public/embed.integrity.json`);
