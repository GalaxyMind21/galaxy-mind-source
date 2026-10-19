#!/usr/bin/env tsx
/* =====================================================================
 * badge-dm-kit · one-off / catch-up DMs for the badge flywheel.
 *
 * The daily path is the social-post-drafts email (3 paste-ready DMs
 * per morning, KV sent-state). This kit is for a single vendor
 * (`--handle`) or a laptop batch when you want to send more than the
 * drip. It does not write KV; marking here is local-only so it cannot
 * fight the cron.
 *
 * Usage:
 *   npx tsx scripts/badge-dm-kit.ts                 # next batch of 10
 *   npx tsx scripts/badge-dm-kit.ts --batch 25      # bigger batch
 *   npx tsx scripts/badge-dm-kit.ts --handle soapminer1   # one vendor
 *   npx tsx scripts/badge-dm-kit.ts --mark a,b,c    # record as sent (local)
 * ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VENDORS, getPlatform } from "../src/lib/vendors";
import {
  badgeDmText,
  badgeOutreachChannel,
  pickBadgeOutreachBatch,
  type BadgeOutreachVendor,
} from "../src/lib/badge-outreach";

const STATE_PATH = join(process.cwd(), "outreach", "badge-dm-state.json");

type SentState = Record<string, { sentAt: string }>;

function loadState(): SentState {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as SentState;
  } catch {
    return {};
  }
}

function saveState(s: SentState) {
  mkdirSync(join(process.cwd(), "outreach"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 1));
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function main() {
  const mark = arg("--mark");
  const state = loadState();

  if (mark) {
    const now = new Date().toISOString().slice(0, 10);
    for (const h of mark.split(",").map((x) => x.trim()).filter(Boolean)) {
      state[h] = { sentAt: now };
    }
    saveState(state);
    console.log(`✓ marked sent: ${mark}`);
    return;
  }

  const one = arg("--handle");
  const batchSize = Math.max(1, Number(arg("--batch")) || 10);

  if (one) {
    const v = VENDORS.find((x) => x.handle === one);
    if (!v) {
      console.log(`no vendor with handle ${one}`);
      return;
    }
    writeBatch([v], 1);
    return;
  }

  const sent = new Set(Object.keys(state));
  const batch = pickBadgeOutreachBatch(VENDORS, sent, batchSize);
  if (batch.length === 0) {
    console.log(
      "✓ every DM-able vendor is marked sent locally — the daily drip in the social-drafts email is the remaining path",
    );
    return;
  }

  writeBatch(batch, VENDORS.filter((v) => getPlatform(v) !== "lightning" && !sent.has(v.handle)).length);
}

function writeBatch(batch: BadgeOutreachVendor[], remaining: number) {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# Badge DM batch · ${date} · ${batch.length} vendors (${remaining} unsent locally)`,
    "",
    "Prefer the daily social-drafts email (3 DMs/morning, KV-backed).",
    "This file is a catch-up pack. Send from @GalaxyMind (X) or the site",
    "npub (Nostr), then record them:",
    "",
    "```",
    `npx tsx scripts/badge-dm-kit.ts --mark ${batch.map((v) => v.handle).join(",")}`,
    "```",
    "",
  ];
  for (const v of batch) {
    const channel = badgeOutreachChannel(v);
    lines.push(
      `## ${v.name} (${v.handle})`,
      `Channel: ${channel.href ?? channel.label}`,
      "",
      "```",
      badgeDmText(v),
      "```",
      "",
    );
  }

  mkdirSync(join(process.cwd(), "outreach"), { recursive: true });
  const outPath = join(process.cwd(), "outreach", `badge-dm-batch-${date}.md`);
  writeFileSync(outPath, lines.join("\n"));
  console.log(
    `✓ wrote ${outPath} (${batch.length} DMs, ${remaining} unsent remaining locally)`,
  );
}

main();
