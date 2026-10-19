/* Snapshot X-vendor avatars into the repo · the durable fix for the
 * unavatar.io hotlink problem (2026-07-11).
 *
 * WHY: the homepage renders ~80 X-vendor <img> tags. Every one used to
 * hotlink https://unavatar.io/x/<handle> from the VISITOR's browser,
 * and unavatar's free tier enforces a ~25-requests-per-IP rate window
 * (verified live: x-pricing-tier: free · x-rate-limit-limit: 25 ·
 * reset ~24h out). One first-time visitor scrolling the directory
 * exhausted their own quota mid-page, and an unavatar outage removed
 * every X vendor's face sitewide. This script resolves each avatar
 * ONCE, commits the bytes under public/avatars/x/, and records the
 * mapping in src/lib/avatar-manifest.json · xAvatarSrc() in
 * src/lib/avatars.ts serves the local copy first and only falls back
 * to unavatar for vendors added since the last run.
 *
 * THE SAME QUOTA BINDS THIS SCRIPT: ~25 fetches per IP per day means
 * the initial 78-vendor backfill cannot complete in one run. The
 * script is therefore RESUMABLE · files on disk are the progress
 * record. It fetches until unavatar cuts it off, reports what's left,
 * and you re-run it (next day, or from another network) until the
 * "still missing" count hits zero.
 *
 * Usage:
 *   npx tsx scripts/snapshot-avatars.ts                  # fetch all X vendors still missing a local avatar
 *   npx tsx scripts/snapshot-avatars.ts --handle <h>     # (re-)fetch one vendor, even if already snapshotted
 *   npx tsx scripts/snapshot-avatars.ts --refresh        # re-fetch everyone (quarterly · avatars go stale)
 *   npx tsx scripts/snapshot-avatars.ts --prune          # drop manifest entries + files for vendors no longer in vendors.ts
 *
 * ?fallback=false is load-bearing here: without it unavatar answers
 * HTTP 200 with a generic placeholder for dead/suspended handles and
 * we'd commit that placeholder as the vendor's "avatar". With it, a
 * dead handle 404s · reported below as a liveness signal (same
 * heuristic scripts/audit-vendors.ts probes).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { VENDORS, getPlatform } from "../src/lib/vendors";
import MANIFEST from "../src/lib/avatar-manifest.json";

const MANIFEST_PATH = "src/lib/avatar-manifest.json";
const AVATAR_DIR = "public/avatars/x";
const FETCH_TIMEOUT_MS = 10_000;
const POLITENESS_DELAY_MS = 300;
// Primary validity signal is the content-type; the byte floor only
// exists to reject empty/truncated bodies that slipped through.
const MIN_BYTES = 100;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Mutable working copy of the committed manifest · lowercase handle →
// site-absolute path ("/avatars/x/<file>"). Persisted after every
// change so a quota cut-off mid-run never loses completed work.
const manifest: Record<string, string> = { ...MANIFEST };

function saveManifest(): void {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function headerInt(r: Response, name: string): number | null {
  const raw = r.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type SnapshotResult =
  | { status: "saved"; file: string; bytes: number; quotaRemaining: number | null }
  | { status: "dead"; quotaRemaining: number | null } // unavatar 404 · handle likely dead/renamed
  | { status: "rate_limited"; resetAt: number | null }
  | { status: "error"; detail: string };

/** Fetch one X vendor's avatar from unavatar and commit it locally.
 * Exported for scripts/add-vendor.ts, which snapshots at add time so
 * new vendors never enter the hotlink fallback path. */
export async function snapshotXAvatar(handle: string): Promise<SnapshotResult> {
  const key = handle.toLowerCase();
  let r: Response;
  try {
    // size=192 (added 2026-07-25): unavatar defaults to the largest
    // original X asset, so snapshots were committed full-size (~2.78 MB
    // across the fleet) and served into 40x40 / 48x48 card slots —
    // bytes every homepage visitor pays for pixels nobody can see. 192
    // is 4x the largest rendered slot, so it still looks right on a 3x
    // DPR screen and leaves headroom for a bigger avatar treatment
    // later. Re-snapshot with `--refresh` to shrink existing files (the
    // unavatar free tier is ~25 req/IP/day, so that lands over several
    // days · the script is resumable and stops cleanly at the wall).
    r = await fetch(
      `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false&size=192`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "GalaxyMindAvatarBot/1.0 (+https://galaxymind.space)" },
      },
    );
  } catch (e) {
    return { status: "error", detail: `fetch failed · ${(e as Error).message}` };
  }

  // Observed live 2026-07-11: unavatar answers the LAST in-quota
  // request normally (remaining: 0 header), then 403 — not only 429 —
  // once the window is spent. Treat both as the quota wall.
  const quotaRemaining = headerInt(r, "x-rate-limit-remaining");
  if (r.status === 429 || (r.status === 403 && quotaRemaining !== null && quotaRemaining <= 0)) {
    return { status: "rate_limited", resetAt: headerInt(r, "x-rate-limit-reset") };
  }
  if (r.status === 404) return { status: "dead", quotaRemaining };
  if (!r.ok) return { status: "error", detail: `HTTP ${r.status}` };

  const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT_BY_TYPE[type];
  if (!ext) return { status: "error", detail: `unexpected content-type '${type}'` };

  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length < MIN_BYTES) {
    return { status: "error", detail: `body too small (${bytes.length} bytes)` };
  }

  mkdirSync(AVATAR_DIR, { recursive: true });
  // Extension may change across refreshes (X re-encodes avatars) ·
  // drop the previous file so the dir never holds two per handle.
  const prev = manifest[key];
  const file = `${key}.${ext}`;
  if (prev && path.basename(prev) !== file) {
    const prevPath = path.join(AVATAR_DIR, path.basename(prev));
    if (existsSync(prevPath)) unlinkSync(prevPath);
  }
  writeFileSync(path.join(AVATAR_DIR, file), bytes);
  manifest[key] = `/avatars/x/${file}`;
  saveManifest();
  return { status: "saved", file, bytes: bytes.length, quotaRemaining };
}

function listAvatarFiles(): string[] {
  if (!existsSync(AVATAR_DIR)) return [];
  return readdirSync(AVATAR_DIR).filter((f) => !f.startsWith("."));
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const prune = args.includes("--prune");
  const handleArg = (() => {
    const i = args.indexOf("--handle");
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  })();
  // --refresh-oldest N (2026-08-04 · the CI cadence mode): re-fetch the
  // N snapshots whose committed files are OLDEST BY GIT HISTORY. Plain
  // --refresh restarts alphabetically every run, so a quota-capped
  // weekly job would polish the same first ~25 forever; ordering by
  // each file's last-commit date makes the refresh a true round-robin
  // across runs with zero new state files. Requires full git history
  // (CI: fetch-depth 0) — a shallow checkout dates everything today.
  const refreshOldest = (() => {
    const i = args.indexOf("--refresh-oldest");
    return i >= 0 ? Math.max(1, Number(args[i + 1]) || 20) : null;
  })();

  const xVendors = VENDORS.filter((v) => getPlatform(v) === "x");
  const activeKeys = new Set(xVendors.map((v) => v.handle.toLowerCase()));

  if (prune) {
    let removed = 0;
    for (const key of Object.keys(manifest)) {
      if (activeKeys.has(key)) continue;
      const p = path.join(AVATAR_DIR, path.basename(manifest[key]));
      if (existsSync(p)) unlinkSync(p);
      delete manifest[key];
      console.log(`  − pruned ${key} (no longer an X vendor)`);
      removed++;
    }
    // Orphan files with no manifest entry (interrupted runs, hand
    // edits) go too · check-vendors.ts fails on them.
    for (const f of listAvatarFiles()) {
      const key = f.replace(/\.[^.]+$/, "");
      if (manifest[key] && path.basename(manifest[key]) === f) continue;
      unlinkSync(path.join(AVATAR_DIR, f));
      console.log(`  − pruned orphan file ${f}`);
      removed++;
    }
    saveManifest();
    console.log(`${removed} pruned · manifest now ${Object.keys(manifest).length} entries.`);
    return;
  }

  let targets = xVendors;
  if (handleArg) {
    targets = xVendors.filter(
      (v) => v.handle.toLowerCase() === handleArg.toLowerCase(),
    );
    if (targets.length === 0) {
      console.error(`No X vendor with handle '${handleArg}' in vendors.ts.`);
      process.exit(1);
    }
  } else if (refreshOldest !== null) {
    const { execFileSync } = await import("node:child_process");
    const aged = xVendors
      .map((v) => {
        const entry = manifest[v.handle.toLowerCase()];
        if (!entry) return null; // missing snapshots belong to the plain run
        const file = path.join(AVATAR_DIR, path.basename(entry));
        if (!existsSync(file)) return null;
        let ts = 0;
        try {
          ts = Number(
            execFileSync(
              "git",
              ["log", "-1", "--format=%ct", "--", file],
              { encoding: "utf8" },
            ).trim(),
          );
        } catch {
          /* untracked/odd file · treat as oldest so it gets refreshed */
        }
        return { v, ts: Number.isFinite(ts) ? ts : 0 };
      })
      .filter((x): x is { v: (typeof xVendors)[number]; ts: number } => !!x)
      .sort((a, b) => a.ts - b.ts);
    targets = aged.slice(0, refreshOldest).map((x) => x.v);
    console.log(
      `--refresh-oldest ${refreshOldest} · oldest snapshot dates: ${aged
        .slice(0, 3)
        .map((x) => new Date(x.ts * 1000).toISOString().slice(0, 10))
        .join(", ")}…`,
    );
  } else if (!refresh) {
    targets = xVendors.filter((v) => {
      const entry = manifest[v.handle.toLowerCase()];
      return !entry || !existsSync(path.join(AVATAR_DIR, path.basename(entry)));
    });
  }

  console.log(
    `${xVendors.length} X vendors · ${Object.keys(manifest).length} already snapshotted · ${targets.length} to fetch\n`,
  );

  let saved = 0;
  const dead: string[] = [];
  const errors: string[] = [];
  let cutOff: { resetAt: number | null } | null = null;

  for (const v of targets) {
    const res = await snapshotXAvatar(v.handle);
    if (res.status === "saved") {
      saved++;
      console.log(
        `  ✓ ${v.handle.padEnd(18)} · ${res.file} · ${(res.bytes / 1024).toFixed(1)}KB` +
          (res.quotaRemaining !== null ? ` · quota left ${res.quotaRemaining}` : ""),
      );
    } else if (res.status === "dead") {
      dead.push(v.handle);
      console.log(
        `  ☠ ${v.handle.padEnd(18)} · unavatar 404 · handle may be dead/renamed · verify https://x.com/${v.handle}`,
      );
    } else if (res.status === "rate_limited") {
      cutOff = res;
      break;
    } else {
      errors.push(`${v.handle} · ${res.detail}`);
      console.log(`  ! ${v.handle.padEnd(18)} · ${res.detail}`);
    }
    if ("quotaRemaining" in res && res.quotaRemaining === 0) {
      cutOff = { resetAt: null };
      break;
    }
    await sleep(POLITENESS_DELAY_MS);
  }

  const stillMissing = xVendors.filter((v) => {
    const entry = manifest[v.handle.toLowerCase()];
    return (
      (!entry || !existsSync(path.join(AVATAR_DIR, path.basename(entry)))) &&
      !dead.includes(v.handle)
    );
  }).length;

  console.log(
    `\n${saved} snapshotted · ${dead.length} dead · ${errors.length} errors · ${stillMissing} still missing`,
  );
  if (dead.length > 0) {
    console.log(
      `dead handles (spot-check, then remove from vendors.ts or leave on the initials chip):\n  ${dead.join(", ")}`,
    );
  }
  if (cutOff) {
    const when = cutOff.resetAt
      ? new Date(cutOff.resetAt).toISOString()
      : "the quota window resets (~24h)";
    console.log(
      `unavatar quota exhausted for this IP · re-run after ${when} (or from another network) to continue.`,
    );
  } else if (stillMissing > 0) {
    console.log("re-run to retry the remaining vendors.");
  }
}

// Import-safe · add-vendor.ts pulls in snapshotXAvatar without
// triggering the CLI. argv-based (not import.meta / require.main) so
// it behaves identically whether tsx runs the scripts as CJS or ESM.
if (process.argv[1] && /snapshot-avatars\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("snapshot-avatars failed:", e);
    process.exit(1);
  });
}
