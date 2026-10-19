// Guard: no Supabase project ref in supabase/. A project ref is a 20-character lowercase token (it names the
// <ref>.supabase.co endpoint). Migration comments say "staging project" / "production project" instead.
// Prints file:line only, never the token.   npx tsx scripts/check-supabase-refs.ts   (part of npm run verify)
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

export const REF = /(?<![A-Za-z0-9_])[a-z]{20}(?![A-Za-z0-9_])/;
/** Reviewed exceptions: { file, line } for a 20-letter word that is not a project ref. Empty today. */
const ALLOW: readonly { file: string; line: number; why: string }[] = [];

const files = execFileSync("git", ["ls-files", "-z", "supabase"], { encoding: "utf8" }).split("\0").filter(Boolean);
const problems: string[] = [];
for (const f of files) {
  if (REF.test(f)) problems.push(`${f} (path)`);
  let st;
  try { st = statSync(f); } catch { continue; }
  if (!st.isFile()) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (REF.test(l) && !ALLOW.some((a) => a.file === f && a.line === i + 1)) problems.push(`${f}:${i + 1}`);
  });
}
if (problems.length) {
  console.error(`check-supabase-refs: ${problems.length} line(s) under supabase/ carry a 20-letter lowercase token (Supabase project ref?). Write "staging project" / "production project" instead:`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`check-supabase-refs: ok (${files.length} files under supabase/)`);
