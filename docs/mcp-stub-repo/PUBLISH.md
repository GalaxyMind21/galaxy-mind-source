# Publishing the public MCP stub repo

**What this is.** `docs/mcp-stub-repo/` holds the contents of a small PUBLIC
GitHub repository that describes the remote MCP server. It contains no source
code — just a README and a copy of `server.json`.

**Why it exists.** Some directories key off a public GitHub repository, and a
private repo has nothing to point them at. The stub is one small public repo
that satisfies them without exposing any source.

Correction worth keeping (research 2026-08-07): a public repo is **not** the
universal blocker it first looked like. Per each directory's own copy:

| Directory | Actually needs |
|---|---|
| LobeHub | repo-oriented publish flow — **stub helps** |
| awesome-mcp-servers / mcpservers.org | a PR, and reviewers expect something public — **stub helps** |
| Smithery | a public repo for THEIR hosted Docker path; listing a bring-your-own remote URL is less clear — **stub probably helps** |
| mcp.so | submit opens a GitHub issue; connection info may be a remote URL — **stub optional** |
| PulseMCP | submit form accepts "GitHub repository, subfolder, **or standalone website**" — **stub NOT needed** |
| Glama | auto-ingests the official registry — **nothing needed** (already listed) |

So publish the stub for the repo-oriented ones, but do not treat it as a
prerequisite for PulseMCP or mcp.so.

## One-time setup (operator)

```bash
# 1. Create an EMPTY public repo on GitHub named galaxy-mind-mcp
#    (Settings: public, no README, no .gitignore, no license template)

# 2. From the galaxy-mind checkout:
cd /tmp && rm -rf galaxy-mind-mcp && mkdir galaxy-mind-mcp
cp -r <path-to-galaxy-mind>/docs/mcp-stub-repo/* /tmp/galaxy-mind-mcp/
rm /tmp/galaxy-mind-mcp/PUBLISH.md          # this file stays private
cd /tmp/galaxy-mind-mcp
git init -b main
git add -A
git commit -m "Galaxy Mind MCP server"
git remote add origin https://github.com/GalaxyMind21/galaxy-mind-mcp.git
git push -u origin main
```

Set the repo's About blurb to the `description` field from `server.json`, and
its website to `https://galaxymind.space/hashrate/agents`.

## Then submit

- **LobeHub** — `npx lhm plugin submit https://github.com/GalaxyMind21/galaxy-mind-mcp`
  (workflow: <https://market.lobehub.com/s/publish-mcp>)
- **Smithery** — <https://smithery.ai/new>, point it at the same repo
- **mcp.so** — <https://mcp.so/submit>, same repo URL

## Keeping it honest

The README's tool table and `server.json` are copies. When the tool surface
changes, update `docs/mcp-stub-repo/` in the same commit that bumps
`server.json`, then push the stub repo again — a stub that advertises a tool
the live server no longer serves is worse than no listing at all. The copy is
small enough to re-sync by hand; `server.json` should be a byte-for-byte copy
of the repo-root one.
