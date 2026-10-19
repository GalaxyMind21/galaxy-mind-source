# Listing the MCP server in public registries

The remote MCP server (`src/app/api/mcp/[transport]/route.ts`, live at
`https://galaxymind.space/api/mcp/mcp`) is documented in `public/llms.txt` and
`/docs/api#mcp` — but documenting it on our own site is not distribution.
Agents and their users find MCP servers through **registries**, not search.
This doc is the runbook for getting listed, and the reusable copy for each one.

Our differentiator in every listing: it is a **remote** server (paste a URL —
no `npx`, no local install, no API key), and every tool wraps the SAME lib
calls the pages render, so an agent and a human can never see different
numbers. Almost every competing Bitcoin MCP server is a local stdio package.

---

## 1. The official MCP Registry

Docs: https://modelcontextprotocol.io/registry/authentication

We use **domain-based HTTP authentication**, not DNS and not GitHub:

- HTTP auth needs no registrar access — the proof file rides in this repo at
  `public/.well-known/mcp-registry-auth` and deploys with a normal push.
  `public/.well-known/security.txt` already proves that path serves correctly
  on our Vercel setup.
- Domain auth is what lets us own the `space.galaxymind/*` namespace (reverse
  DNS of `galaxymind.space`). GitHub auth would have forced
  `io.github.GalaxyMind21/*`, which is off-brand.

### Files

| File | Committed? | Purpose |
|---|---|---|
| `server.json` (repo root) | yes | The registry entry. `version` MUST match `serverInfo.version` in the MCP route. |
| `public/.well-known/mcp-registry-auth` | yes | Public half of the Ed25519 proof key. Safe to publish — it is a public key. |
| `key.pem` (repo root) | **NO** | Private key. Covered by the existing `*.pem` rule in `.gitignore` (line 25). Losing it means regenerating and re-deploying the well-known file before you can publish again. |

### macOS gotcha — LibreSSL has no Ed25519

The system `openssl` on macOS is LibreSSL and fails with
`Algorithm Ed25519 not found`. Every command below uses the Homebrew OpenSSL 3
explicitly. Do not drop the `$OSSL` prefix.

```bash
OSSL=/opt/homebrew/opt/openssl@3/bin/openssl
```

### Regenerating the keypair (only if key.pem is lost)

```bash
OSSL=/opt/homebrew/opt/openssl@3/bin/openssl
$OSSL genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$($OSSL pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
printf 'v=MCPv1; k=ed25519; p=%s\n' "$PUBLIC_KEY" > public/.well-known/mcp-registry-auth
```

Then commit + push the well-known file and wait for the deploy — the registry
fetches it live during login.

### Publishing

```bash
# 0. Confirm the proof file is actually served (must return the v=MCPv1 line)
curl -s https://galaxymind.space/.well-known/mcp-registry-auth

# 1. Install the CLI (not a project dependency — keep it out of package.json)
brew install mcp-publisher

# 2. Log in against the domain
OSSL=/opt/homebrew/opt/openssl@3/bin/openssl
PRIVATE_KEY="$($OSSL pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain galaxymind.space --private-key "$PRIVATE_KEY"

# 3. Publish (run from the repo root, where server.json lives)
mcp-publisher publish
```

`$PRIVATE_KEY` must come out as exactly 64 hex characters. If it is empty or
shorter, you are on LibreSSL — go back and set `$OSSL`.

### When to re-publish

Bump `version` in BOTH `server.json` and `serverInfo` in the MCP route, then
re-run `mcp-publisher publish`. Do this when the **tool surface** changes
(a tool added/removed/renamed, or a materially different response shape) —
not on every site deploy. The registry entry is a contract about capabilities,
not a build number.

---

## 2. The other registries

Status re-checked 2026-09-22:

- **Official registry** — listed, `space.galaxymind/galaxy-mind` v1.6.4
  is `isLatest`. Do not republish unless the tool surface changes.
- **Glama** — listed and healthy, auto-ingested from the official registry:
  https://glama.ai/mcp/connectors/space.galaxymind/galaxy-mind
- **PulseMCP** — still absent. Their directory says new submissions are
  paused. The 2026-08-04 email does not need a follow-up until that
  pause ends.
- **MCP Server Finder** — no functioning submission path. Nothing to do.
- **LobeHub** — not listed. The submit target is the public stub,
  https://github.com/GalaxyMind21/galaxy-mind-mcp. Submit that URL once the stub's
  `server.json` matches the live registry entry. Workflow:
  https://market.lobehub.com/s/publish-mcp

HEAD probes to /api/mcp/mcp used to hang 60s and 504 (fixed 2026-08-04).
Registry health checks read the server as down until that returned.

Each one is also a backlink from a high-authority domain to `galaxymind.space`,
which is the second reason to bother.

### Reusable copy

**Name:** Galaxy Mind

**One-liner (≤100 chars, matches `server.json`):**
> Live Bitcoin buying gauge, treasury mNAV, buyable float, and a verified merchant directory.

**Short description (2–3 sentences):**
> Galaxy Mind is a remote MCP server exposing live, independently-computed
> Bitcoin data: how much BTC is realistically left to buy, a 10-signal buying
> gauge, mNAV for the major public Bitcoin treasury companies, and a
> human-verified directory of merchants that accept bitcoin. Every tool wraps
> the same code that renders galaxymind.space, so an AI client and a human
> visitor can never see different numbers. No install and no API key — add the
> URL as a connector.

**Connection:**
> Streamable HTTP · `https://galaxymind.space/api/mcp/mcp` · no auth

**Tools (11, all read-only):**

| Tool | Returns |
|---|---|
| `get_bitcoin_price` | Live BTC spot in USD with asOf; null + degraded when the feed is down, never a stale value |
| `get_buying_gauge` | 0–100 buying score from 10 weighted signals, plus the best upcoming entry window |
| `get_gauge_history` | Daily gauge score history (30/90/180/365 days) |
| `get_treasuries` | mNAV scoreboard for MSTR, XXI, MPJPY, ASST — gross, EV, and CEBE net lenses |
| `get_treasury_history` | Daily mNAV history for one ticker |
| `get_bitcoin_float` | In-play BTC supply after lost, seized, ETF, and treasury cohorts |
| `get_halving_countdown` | Blocks remaining, estimated date, subsidy change |
| `search_vendors` | Merchants accepting bitcoin — filter by text, category, country |
| `get_glossary_term` | Definitions (mNAV, MVRV, Puell, in-play supply, …) with a ready-made citation string |
| `get_hashrate_market` | SHA256 AsicBoost rental market: hashprice, ask book, clearing prices, per-rig recovery ratio (BTC/PH/day throughout) |
| `get_rental_quote` | Rental quote for the Block Shot fleet — exact BTC/USD cost, block odds, current prize, and the zero-custody MiningRigRentals handoff |

**Points worth calling out in any listing that has room** — these are the real
differentiators, and all three are unusual in this category:

1. **Remote, not local.** Paste one URL. No `npx`, no runtime, no key.
2. **Honesty flags.** Gauge and float responses carry `degraded: true` when
   upstream feeds are down, so a client never quotes a neutral placeholder as
   a live reading. Vendor rows carry `verifiedAt` + a per-row `stale` flag and
   the response carries `staleMatches`, so the "verified within 90 days" claim
   is auditable rather than taken on faith.
3. **Handshake instructions.** The server sends MCP `instructions` telling the
   model when to prefer a live tool call over stale training data, that the
   gauge is our composite opinion rather than a market fact, and how to
   attribute — each tool returns a canonical `liveUrl` / `pageUrl` /
   `citation` to link rather than a derived URL.
