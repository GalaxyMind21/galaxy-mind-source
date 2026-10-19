#!/usr/bin/env tsx
/* =====================================================================
 * mine-vendor-candidates · the supply engine's discovery half
 * (2026-08-04 · roadmap item 3 of the directory-#1 strategy).
 *
 * Two sources, one ranked candidate report:
 *
 *  1. Nostr NIP-99 classified listings (kind 30402) — merchants
 *     actively posting goods for sale on relays. Every event is
 *     signature-verified before trust (relays are untrusted infra,
 *     same doctrine as lib/nostr-activity), authors are resolved to
 *     kind-0 profiles, and existing roster members are deduped by
 *     PUBKEY (bech32 and NIP-05 handles both resolve to hex first,
 *     so a vendor listed under npub can never reappear as a
 *     "candidate" via their nprofile).
 *
 *  2. lightningnetworkstores.com's public API — filtered to
 *     digital_goods === "no, goods shipped" (their own physical-goods
 *     flag) with a positive community score, deduped against the
 *     roster by shop domain and name.
 *
 * READ-ONLY: this script never writes vendors.ts. It emits a report
 * (markdown + json under outreach/) for the operator to vet. The
 * listing bar stays what it is: an X or Nostr identity is REQUIRED
 * (operator rule 2026-07-16), every candidate gets the red-flag probe
 * kit (domain age, receiving-address reuse, unit-economics sanity)
 * before an add, and the operator's declined lists are checked first.
 *
 * Usage:
 *   npx tsx scripts/mine-vendor-candidates.ts              # full run
 *   npx tsx scripts/mine-vendor-candidates.ts --days 60    # tighter window
 *   npx tsx scripts/mine-vendor-candidates.ts --skip-nostr # LNS only
 * ===================================================================== */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { VENDORS } from "../src/lib/vendors";
import {
  NOSTR_DEFAULT_RELAYS,
  decodeNostrBech32ToPubkey,
  verifyNostrEvent,
  fetchNostrProfileMetadata,
  type RawNostrEvent,
} from "../src/lib/nostr-activity";
import { resolveNip05 } from "../src/lib/nostr-resolve";

const DAYS = (() => {
  const i = process.argv.indexOf("--days");
  return i >= 0 ? Math.max(7, Number(process.argv[i + 1]) || 120) : 120;
})();
const SKIP_NOSTR = process.argv.includes("--skip-nostr");

/** Handles the operator has declined — mirror of the memory-side lists
 *  (vendors-permanently-declined + vendor-rejections-log). The repo
 *  deliberately carries no trace of declines, so this constant is the
 *  script's own copy; keep it in sync when a decline happens. Matching
 *  is case-folded substring against candidate names/domains. */
const DECLINED = ["molonlabevc", "voltvault", "bitcoinkmu"];

/** Extra market-heavy relay on top of the house defaults · NIP-99
 *  listings cluster on aggregators. Script-only (no CSP concerns). */
const RELAYS = [...NOSTR_DEFAULT_RELAYS, "wss://relay.nostr.band"];

/** Signals that a 30402 listing is digital/service rather than a
 *  shipped physical good. Deliberately a NEGATIVE filter — a positive
 *  goods list would silently drop novel categories; a human reviews
 *  everything this script emits anyway. */
const DIGITAL_HINTS = [
  "ebook", "e-book", "digital download", "pdf", "template", "course",
  "consulting", "coaching", "subscription", "vpn", "hosting", "software",
  "license", "nft", "gift card", "voucher", "premium account",
];

type Listing = { title: string; summary: string; publishedAt: number };
type NostrCandidate = {
  pubkey: string;
  npubish: string;
  name: string;
  nip05: string | null;
  lud16: string | null;
  about: string;
  listings: Listing[];
  digitalHits: string[];
};

function tagValue(ev: RawNostrEvent, name: string): string | null {
  const tags = Array.isArray(ev.tags) ? (ev.tags as unknown[]) : [];
  const t = tags.find(
    (x): x is string[] => Array.isArray(x) && x[0] === name,
  );
  return t && typeof t[1] === "string" ? t[1] : null;
}

/** Generic one-shot REQ · collect events of a filter until EOSE or
 *  timeout, one socket per relay, all relays raced in parallel. Same
 *  shape as lib/nostr-activity's per-author queries, generalized. */
function queryRelay(
  url: string,
  filter: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<RawNostrEvent[]> {
  return new Promise((resolve) => {
    const events: RawNostrEvent[] = [];
    let ws: WebSocket;
    const done = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(events);
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve(events);
      return;
    }
    const subId = `mine-${Math.floor(Math.random() * 1e9)}`;
    ws.onopen = () => ws.send(JSON.stringify(["REQ", subId, filter]));
    ws.onerror = () => {
      clearTimeout(timer);
      done();
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data));
        if (data[0] === "EVENT" && data[1] === subId) {
          events.push(data[2] as RawNostrEvent);
        } else if (data[0] === "EOSE" && data[1] === subId) {
          clearTimeout(timer);
          done();
        }
      } catch {
        /* malformed frame · ignore */
      }
    };
  });
}

async function rosterNostrPubkeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const v of VENDORS) {
    if ((v.platform ?? "x") !== "nostr") continue;
    if (v.handle.startsWith("npub1") || v.handle.startsWith("nprofile1")) {
      const pk = decodeNostrBech32ToPubkey(v.handle);
      if (pk) keys.add(pk);
    } else if (v.handle.includes("@")) {
      try {
        const pk = await resolveNip05(v.handle);
        if (pk) keys.add(pk);
      } catch {
        /* unreachable NIP-05 · name/domain dedupe still applies */
      }
    }
  }
  return keys;
}

async function mineNostr(): Promise<NostrCandidate[]> {
  const since = Math.floor(Date.now() / 1000) - DAYS * 86400;
  console.log(
    `· NIP-99 sweep · kind 30402 since ${DAYS}d ago across ${RELAYS.length} relays`,
  );
  const perRelay = await Promise.all(
    RELAYS.map((r) =>
      queryRelay(r, { kinds: [30402], since, limit: 500 }),
    ),
  );
  const all = perRelay.flat();
  console.log(`  ${all.length} raw events`);

  // Verify signatures + dedupe by event id, then bucket by author.
  const seen = new Set<string>();
  const byAuthor = new Map<string, Listing[]>();
  for (const ev of all) {
    if (!ev || typeof ev.id !== "string" || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const pubkey = typeof ev.pubkey === "string" ? ev.pubkey : null;
    if (!pubkey || !verifyNostrEvent(ev, pubkey)) continue;
    const content = typeof ev.content === "string" ? ev.content : "";
    const title = tagValue(ev, "title") ?? "";
    const summary = tagValue(ev, "summary") ?? content.slice(0, 160);
    if (!title && !summary) continue;
    const list = byAuthor.get(pubkey) ?? [];
    list.push({
      title,
      summary,
      publishedAt: typeof ev.created_at === "number" ? ev.created_at : 0,
    });
    byAuthor.set(pubkey, list);
  }
  console.log(`  ${byAuthor.size} distinct sellers after verification`);

  const known = await rosterNostrPubkeys();
  const candidates: NostrCandidate[] = [];
  for (const [pubkey, listings] of byAuthor) {
    if (known.has(pubkey)) continue;
    const profile = await fetchNostrProfileMetadata(pubkey).catch(() => null);
    const name = profile?.name ?? "";
    const hay = [
      name,
      profile?.about ?? "",
      ...listings.map((l) => `${l.title} ${l.summary}`),
    ]
      .join(" ")
      .toLowerCase();
    if (DECLINED.some((d) => hay.includes(d))) continue;
    const digitalHits = DIGITAL_HINTS.filter((h) => hay.includes(h));
    candidates.push({
      pubkey,
      npubish: pubkey.slice(0, 12) + "…",
      name: name || "(no kind-0 name)",
      nip05: profile?.nip05 ?? null,
      lud16: profile?.lud16 ?? null,
      about: (profile?.about ?? "").replace(/\s+/g, " ").slice(0, 140),
      listings: listings
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, 4),
      digitalHits,
    });
  }
  // Physical-goods first, then most-active sellers.
  candidates.sort(
    (a, b) =>
      a.digitalHits.length - b.digitalHits.length ||
      b.listings.length - a.listings.length,
  );
  return candidates;
}

type LnsCandidate = {
  name: string;
  href: string;
  rooturl: string;
  description: string;
  sector: string;
  score: number;
  rank: number;
};

async function mineLns(): Promise<LnsCandidate[]> {
  console.log("· Lightning Network Stores sweep · shipped-goods only");
  const rosterDomains = new Set(
    VENDORS.map((v) => {
      try {
        return v.shopUrl ? new URL(v.shopUrl).hostname.replace(/^www\./, "") : null;
      } catch {
        return null;
      }
    }).filter(Boolean) as string[],
  );
  const rosterNames = new Set(VENDORS.map((v) => v.name.toLowerCase()));

  const out: LnsCandidate[] = [];
  for (let page = 0; page < 6; page++) {
    const res = await fetch(
      `https://lightningnetworkstores.com/api/stores?sort=score&page=${page}`,
      { signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!res || !res.ok) break;
    const body = (await res.json()) as {
      data?: { stores?: Record<string, unknown>[]; pages?: number };
    };
    const stores = body.data?.stores ?? [];
    if (stores.length === 0) break;
    for (const s of stores) {
      if (s["digital_goods"] !== "no, goods shipped") continue;
      const score = Number(s["score"] ?? 0);
      if (score < 3) continue; // community-vetted floor
      const name = String(s["name"] ?? "");
      const rooturl = String(s["rooturl"] ?? "").replace(/^www\./, "");
      if (!name || !rooturl) continue;
      const hay = `${name} ${rooturl}`.toLowerCase();
      if (DECLINED.some((d) => hay.includes(d))) continue;
      if (rosterDomains.has(rooturl) || rosterNames.has(name.toLowerCase()))
        continue;
      out.push({
        name,
        href: String(s["href"] ?? `https://${rooturl}`),
        rooturl,
        description: String(s["description"] ?? "").slice(0, 140),
        sector: String(s["sector"] ?? ""),
        score,
        rank: Number(s["rank"] ?? 0),
      });
    }
    const pages = Number(body.data?.pages ?? 1);
    if (page >= pages - 1) break;
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const nostr = SKIP_NOSTR ? [] : await mineNostr();
  const lns = await mineLns();
  console.log(
    `  ${lns.length} LNS shipped-goods stores clear the score floor and dedupe`,
  );

  const lines: string[] = [
    `# Vendor candidates · mined ${date}`,
    "",
    "Read-only report. Nothing here is listed until it passes the full",
    "vetting bar: an X or Nostr identity (REQUIRED — operator rule),",
    "domain age, receiving-address reuse, and unit-economics sanity",
    "(see the vendor-vetting red-flags kit). Check the declined lists",
    "before any outreach.",
    "",
    `## Nostr NIP-99 sellers · ${nostr.length} candidates (last ${DAYS}d)`,
    "",
  ];
  for (const c of nostr.slice(0, 40)) {
    lines.push(
      `### ${c.name}`,
      `- pubkey: \`${c.pubkey}\``,
      `- nip05: ${c.nip05 ?? "none"} · lud16: ${c.lud16 ?? "none"}${c.digitalHits.length ? ` · ⚠ digital hints: ${c.digitalHits.join(", ")}` : ""}`,
      c.about ? `- about: ${c.about}` : "",
      ...c.listings.map(
        (l) =>
          `- listing: ${l.title || "(untitled)"} · ${new Date(l.publishedAt * 1000).toISOString().slice(0, 10)}${l.summary ? ` · ${l.summary.slice(0, 80)}` : ""}`,
      ),
      "",
    );
  }
  lines.push(`## Lightning Network Stores · ${lns.length} shipped-goods candidates`, "");
  for (const c of lns.slice(0, 60)) {
    lines.push(
      `- **${c.name}** · ${c.rooturl} · ${c.sector} · score ${c.score} · ${c.description}`,
    );
  }
  lines.push(
    "",
    "## Next actions",
    "- Pick candidates, find their X/Nostr identity (required to list).",
    "- Run the red-flag probes before outreach.",
    "- DM template: outreach/badge-dm-kit output has the voice.",
  );

  mkdirSync(join(process.cwd(), "outreach"), { recursive: true });
  const mdPath = join(process.cwd(), "outreach", `vendor-candidates-${date}.md`);
  const jsonPath = join(
    process.cwd(),
    "outreach",
    `vendor-candidates-${date}.json`,
  );
  writeFileSync(mdPath, lines.filter((l) => l !== null).join("\n"));
  writeFileSync(jsonPath, JSON.stringify({ date, nostr, lns }, null, 1));
  console.log(`\n✓ wrote ${mdPath}`);
  console.log(`✓ wrote ${jsonPath}`);
}

void main();
