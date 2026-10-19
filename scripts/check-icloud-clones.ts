// Guard against iCloud's "name 2.ext" clone files.
//
// This repo lives on an iCloud-synced Desktop, and iCloud periodically
// duplicates a file as "name 2.ext" (sometimes "name 3.ext"). The clones
// are byte-identical to their originals and untracked, so they look
// harmless in `git status` — but they get picked up by anything that
// walks the filesystem instead of asking git, and the resulting failure
// never mentions iCloud.
//
// It has already cost real time twice:
//
//   · `.next/types/routes.d 2.ts` broke `tsc --noEmit` with phantom
//     "Duplicate identifier" errors. That one is handled — tsconfig.json
//     excludes `**/* ?.ts` / `**/* ??.ts` and the .tsx equivalents.
//     (TypeScript globs support only * ? **, not [0-9] character
//     classes, which silently match nothing.)
//
//   · `public/avatars/x/galaxymind 2.jpg` turned `npm run verify` red on
//     2026-08-08 via check-vendors' avatar-manifest drift check, whose
//     advice ("run --prune") was the wrong remedy entirely.
//
// tsconfig only protects TypeScript. The clones that actually bite are
// the other ones: images the avatar checker reads, `public/*/js/*.js`
// game bundles that check-game-bindings compiles, audio, JSON. So this
// names the pattern directly and tells you to delete them, which is
// always the right answer — they are duplicates of tracked files, so
// nothing is lost.
//
// Deliberately scoped to directories the build and the checkers read.
// It does NOT scan docs/ or outreach/ · a stray clone in a notes folder
// is untidy, not a build hazard, and failing the build over it would
// train people to ignore this check.

import { readdirSync, statSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const SCAN_DIRS = ["src", "scripts", "public"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

// `--clean` deletes what the scan finds instead of just naming it. The
// advice was always "delete them", and typing 28 rm lines by hand is how
// people stop running the check.
//
// It also sweeps GENERATED_DIRS, which the default scan deliberately does
// NOT: a clone under .next is not a build FAILURE (it is regenerable), so
// failing verify over one would be noise. But it is still a real hazard —
// `.next/types/routes.d 2.ts` is the tsc break named at the top of this
// file, and a sweep on 2026-08-26 found 28 more (`BUILD_ID 2`,
// `routes-manifest 2.json`, a whole `turbopack 2/` directory) that
// tsconfig's excludes cannot cover because they are not TypeScript.
// Everything under .next is regenerable, so deleting a clone whose
// original exists is always safe there.
const GENERATED_DIRS = [".next"];
const CLEAN = process.argv.includes("--clean");

/** "name 2.ext" / "name 10.ext" — a space, digits, then the extension. */
const CLONE_RE = / \d+(\.[A-Za-z0-9]+)$/;

type Clone = { path: string; identical: boolean; origExists: boolean; dir?: boolean };

/** Extensionless twin of CLONE_RE — `BUILD_ID 2`, `turbopack 2`.
 *  Applied to DIRECTORIES anywhere, and to FILES only inside
 *  GENERATED_DIRS: matching bare names in source would flag a
 *  legitimately-named "Chapter 2". */
const CLONE_RE_DIR = / \d+$/;

function walk(dir: string, out: Clone[], generated = false): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // `.next/turbopack 2` is a clone DIRECTORY — the file-only walk
      // recursed into it and never reported it. Only ever treated as a
      // clone under GENERATED_DIRS, where everything is regenerable;
      // a source directory is never deleted by this script.
      if (CLONE_RE_DIR.test(name) && existsSync(join(dir, name.replace(CLONE_RE_DIR, "")))) {
        out.push({ path: full, identical: true, origExists: true, dir: true });
        continue;
      }
      walk(full, out, generated);
      continue;
    }
    // Inside generated output an extensionless clone is still garbage.
    const isClone = CLONE_RE.test(name) || (generated && CLONE_RE_DIR.test(name));
    if (!isClone) continue;
    const original = join(
      dir,
      CLONE_RE.test(name)
        ? name.replace(CLONE_RE, "$1")
        : name.replace(CLONE_RE_DIR, ""),
    );
    // Report whether the original exists and matches, so a genuine file
    // that merely LOOKS like a clone ("Figure 2.png") is distinguishable
    // from an actual duplicate.
    let identical = false;
    const origExists = existsSync(original);
    if (origExists) {
      try {
        identical = readFileSync(full).equals(readFileSync(original));
      } catch {
        identical = false;
      }
    }
    out.push({ path: full, identical, origExists });
  }
}

const found: Clone[] = [];
for (const d of SCAN_DIRS) walk(d, found);

if (CLEAN) {
  // Generated output is only swept in clean mode — see GENERATED_DIRS.
  const gen: Clone[] = [];
  for (const d of GENERATED_DIRS) walk(d, gen, true);
  const removable = [
    ...found.filter((f) => f.identical),
    ...gen.filter((f) => f.origExists),
  ];
  for (const c of removable) {
    try {
      rmSync(c.path, { recursive: c.dir === true, force: true });
    } catch (e) {
      console.error(`  could not remove ${c.path}: ${String(e)}`);
    }
  }
  const kept = found.filter((f) => !f.identical);
  console.log(
    removable.length
      ? `✓ removed ${removable.length} iCloud clone(s) (${found.filter((f) => f.identical).length} in source, ${gen.filter((f) => f.origExists).length} in ${GENERATED_DIRS.join(", ")})`
      : `✓ no iCloud clones to remove`,
  );
  if (kept.length) {
    console.warn(
      `⚠ ${kept.length} file(s) match the clone pattern but are NOT duplicates (left alone):\n` +
        kept.map((s) => `  - ${s.path}`).join("\n"),
    );
  }
  process.exit(0);
}

const dupes = found.filter((f) => f.identical);
const suspects = found.filter((f) => !f.identical);

if (dupes.length > 0) {
  console.error(
    `✗ ${dupes.length} iCloud clone file(s) in build directories:\n` +
      dupes.map((d) => `  - ${d.path}`).join("\n") +
      `\n\nEach is byte-identical to the file it shadows. Delete them:\n` +
      `  ${dupes.map((d) => `rm "${d.path}"`).join("\n  ")}\n`,
  );
}
if (suspects.length > 0) {
  // Not a failure: a real file can legitimately be named "thing 2.png".
  console.warn(
    `⚠ ${suspects.length} file(s) match the clone pattern but are NOT duplicates (left alone):\n` +
      suspects.map((s) => `  - ${s.path}`).join("\n"),
  );
}

if (dupes.length > 0) process.exit(1);

console.log(
  `✓ no iCloud clone files in ${SCAN_DIRS.join(", ")}${suspects.length ? ` (${suspects.length} similarly-named real file(s) ignored)` : ""}`,
);
