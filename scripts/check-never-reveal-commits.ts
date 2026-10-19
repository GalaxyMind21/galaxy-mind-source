// Commit-message guard (security audit 2026-10-18, M1f): fails when a NEW commit message (merge commits included),
// the PR title or body, or the branch name contains a word on the private never-reveal list. Same keyed list and
// matcher as the tree guard (src/lib/never-reveal.ts, "guard" scope). Per-file allow rules don't apply here.
// Output names the commit (short SHA) or the field only, never the matched text or digest.
//   CI:    npx tsx scripts/check-never-reveal-commits.ts --event [--require]
//          Reads the range, PR title, body and head ref from the event JSON at $GITHUB_EVENT_PATH, so none of that text
//          is ever a step env value (which the Actions log prints) or a shell argument.
//   Local: npx tsx scripts/check-never-reveal-commits.ts --range <base-sha>..<head-sha> [--require]
// Only hex SHAs are accepted as range ends (no ref names, nothing starting with "-").
// History before the range is not re-checked (older messages need a fresh-history export, not a CI failure).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findNeverReveal, neverRevealFromEnv, neverRevealStatus } from "../src/lib/never-reveal";

const args = process.argv.slice(2);
const requireCfg = args.includes("--require");
const ri = args.indexOf("--range");
const SHA = /^[0-9a-f]{7,40}$/i;

type Event = { before?: string; after?: string; ref?: string; pull_request?: { title?: string; body?: string | null; base?: { sha?: string }; head?: { sha?: string; ref?: string } } };
/** Range plus the free-text fields to check. Nothing here is printed. */
function inputs(): { base: string; head: string; fields: [string, string | undefined][] } {
  if (args.includes("--event")) {
    const path = process.env.GITHUB_EVENT_PATH ?? "";
    let ev: Event = {};
    try { ev = JSON.parse(readFileSync(path, "utf8")) as Event; } catch { console.error("check-never-reveal-commits: cannot read the event JSON at $GITHUB_EVENT_PATH"); process.exit(2); }
    const pr = ev.pull_request;
    if (pr) {
      return { base: pr.base?.sha ?? "", head: pr.head?.sha ?? "", fields: [["PR title", pr.title], ["PR body", pr.body ?? undefined], ["branch name", pr.head?.ref]] };
    }
    const branch = (ev.ref ?? "").replace(/^refs\/heads\//, "");
    return { base: ev.before ?? "", head: ev.after ?? process.env.GITHUB_SHA ?? "", fields: [["branch name", branch]] };
  }
  const range = ri >= 0 ? args[ri + 1] ?? "" : "";
  const m = range.match(/^([^.]*)\.\.([^.]*)$/);
  return { base: m?.[1] ?? "", head: m?.[2] ?? "", fields: [] };
}
const status = neverRevealStatus();
const cfg = neverRevealFromEnv();
if (!cfg) {
  const why = status === "invalid" ? "NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS are set but malformed" : "NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS are not available (fork PR or local run)";
  if (requireCfg || status === "invalid") { console.error(`check-never-reveal-commits: ${why}. Refusing to pass.`); process.exit(1); }
  const msg = `check-never-reveal-commits: skipped, ${why}.`;
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=never-reveal commit guard skipped::${msg}` : msg);
  process.exit(0);
}

const git = (a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const exists = (rev: string) => { try { git(["cat-file", "-e", "--end-of-options", `${rev}^{commit}`]); return true; } catch { return false; } };

/** Commits to check: base..head when both exist; just head when base is missing (new branch, force push, all zeros). */
function commits(base: string, head: string): string[] {
  if (!SHA.test(head)) { console.error("check-never-reveal-commits: head must be a hex commit SHA"); process.exit(2); }
  if (base && !SHA.test(base)) { console.error("check-never-reveal-commits: base must be a hex commit SHA"); process.exit(2); }
  if (!exists(head)) { console.error(`check-never-reveal-commits: head ${head.slice(0, 8)} is not in this checkout (fetch-depth?)`); process.exit(2); }
  // Merge commits are included: a merge message can carry text too.
  if (base && !/^0+$/.test(base) && exists(base)) return git(["rev-list", `${base}..${head}`]).split("\n").filter(Boolean);
  return [git(["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`]).trim()];
}

const problems: string[] = [];
const bad = (text: string | undefined) => !!text && findNeverReveal(text, "guard", [cfg]) !== null;
const inp = inputs();
const list = commits(inp.base, inp.head);
for (const sha of list) {
  const msg = git(["log", "-1", "--format=%B%n%an%n%ae", sha]); // message plus author name/email
  if (bad(msg)) problems.push(`commit ${sha.slice(0, 8)}: message or author`);
}
for (const [name, text] of inp.fields) if (bad(text)) problems.push(name);

if (problems.length) {
  console.error(`check-never-reveal-commits: ${problems.length} place(s) contain a never-reveal word. Reword them (amend or edit the PR):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`check-never-reveal-commits: ok (${list.length} commit message(s) plus ${inp.fields.map(([n]) => n).join(", ") || "no PR fields"} checked against the private list)`);
