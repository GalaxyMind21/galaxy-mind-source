/* Throwaway script · fetches kind:0 picture URL for every Nostr
   vendor in vendors.ts and writes the URL back as `pictureUrl`.
   Run once after adding new Nostr vendors · output is committed
   so the runtime never needs to do a relay query. */
import { readFileSync, writeFileSync } from "node:fs";
import { VENDORS, getPlatform, type Vendor } from "../src/lib/vendors";
import { validateOutboundUrl } from "../src/lib/safe-fetch";
import {
  decodeNostrBech32ToPubkey,
  fetchNostrProfileMetadata,
  resolveNip05,
} from "../src/lib/nostr-activity";

async function resolveHandle(v: Vendor): Promise<string | null> {
  if (v.handle.startsWith("npub1") || v.handle.startsWith("nprofile1")) {
    return decodeNostrBech32ToPubkey(v.handle);
  }
  // NIP-05 form: name@domain
  if (v.handle.includes("@")) {
    return await resolveNip05(v.handle);
  }
  return null;
}

async function main() {
  const nostrVendors = VENDORS.filter((v) => getPlatform(v) === "nostr");
  console.log(`${nostrVendors.length} Nostr vendors to enrich\n`);

  const enrichments: Record<string, string> = {};

  for (const v of nostrVendors) {
    if (v.pictureUrl) {
      console.log(`  · skip (has pictureUrl) · ${v.name}`);
      continue;
    }
    const pubkey = await resolveHandle(v);
    if (!pubkey) {
      console.log(`  ! could not resolve · ${v.name}`);
      continue;
    }
    try {
      const profile = await fetchNostrProfileMetadata(pubkey);
      const pic = profile?.picture;
      if (
        typeof pic === "string" &&
        validateOutboundUrl(pic).ok
      ) {
        enrichments[v.handle] = pic;
        console.log(`  + ${v.name.padEnd(32)} · ${pic.slice(0, 70)}`);
      } else {
        console.log(`  - no picture       · ${v.name}`);
      }
    } catch (e) {
      console.log(`  ! fetch error      · ${v.name} · ${(e as Error).message}`);
    }
  }

  // Apply enrichments to vendors.ts via line-by-line state machine.
  // (Same approach as scripts/_enrich-websites.py · avoids regex
  // catastrophic backtracking on the multiline vendor blocks.)
  const path = "src/lib/vendors.ts";
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");
  const out: string[] = [];
  let added = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    const handleMatch = line.match(/^(\s+)handle:\s*$/);
    let handle: string | null = null;
    let indent = "";
    if (handleMatch) {
      // Multi-line handle: "handle:\n  \"npub1...\""
      indent = handleMatch[1];
      const next = lines[i + 1];
      const valMatch = next?.match(/^\s*"([^"]+)"/);
      if (valMatch) handle = valMatch[1];
    } else {
      const inlineMatch = line.match(/^(\s+)handle:\s*"([^"]+)"/);
      if (inlineMatch) {
        indent = inlineMatch[1];
        handle = inlineMatch[2];
      }
    }
    if (!handle || !(handle in enrichments)) {
      i += 1;
      continue;
    }
    // Walk to end of vendor block
    let j = i + 1;
    const blockLines: string[] = [];
    while (j < lines.length) {
      blockLines.push(lines[j]);
      if (/^\s*\},?\s*$/.test(lines[j])) break;
      j += 1;
    }
    const blockStr = blockLines.join("\n");
    if (blockStr.includes("pictureUrl:")) {
      out.push(...blockLines);
      i = j + 1;
      continue;
    }
    // Insert pictureUrl before closing `},`
    const newLine = `${indent}pictureUrl: ${JSON.stringify(enrichments[handle])},`;
    const closing = blockLines.pop()!;
    out.push(...blockLines);
    out.push(newLine);
    out.push(closing);
    added += 1;
    i = j + 1;
  }

  writeFileSync(path, out.join("\n"));
  console.log(`\n${added} pictureUrl fields written to ${path}`);
}

main();
