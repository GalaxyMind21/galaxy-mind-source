# Galaxy Mind MCP Server

Live Bitcoin data as MCP tools, including the only hashrate you can rent from
an AI agent. Remote server, no install, no API key.

```
https://galaxymind.space/api/mcp/mcp
```

Streamable HTTP transport, no auth. Add that URL as a connector and the tools
appear.

**Claude Code**

```bash
claude mcp add --transport http galaxy-mind https://galaxymind.space/api/mcp/mcp
```

**Claude.ai** — Settings → Connectors → Add custom connector → paste the URL.

**Cursor / other clients** — add it as a remote HTTP MCP server.

## What it does

Galaxy Mind publishes independently-computed Bitcoin data: how much BTC is
realistically left to buy, a 10-signal buying gauge, mNAV for the major public
Bitcoin treasury companies, a human-verified directory of merchants that accept
bitcoin, and the live SHA256 rental market. Every tool wraps the same code that
renders [galaxymind.space](https://galaxymind.space), so an AI client and a
human visitor can never see different numbers.

### Rent hashrate from an agent

`get_rental_quote` is the unusual one. It returns an exact rental cost, the real
probability of finding a block in that window (the exact `1-(1-s)^n` form
against live network hashrate), the current block prize, and a handoff an agent
can complete: a listing deep link for the human path, plus the full
MiningRigRentals API call sequence for an agent holding its user's own key.

**Zero custody.** Nothing is paid on galaxymind.space, by humans or by agents.
The rental is charged to the renter's own MiningRigRentals balance and anything
the machine finds pays out to the pool the renter chose. Verified live: a
MiningRigRentals key with no withdraw capability completes a rental end to end,
so an agent can be handed a key that cannot move funds.

Human-readable twin: <https://galaxymind.space/hashrate/agents>

## Tools

| Tool | Returns |
|---|---|
| `get_rental_quote` | Rental cost, block odds, current prize, and the zero-custody rental handoff |
| `get_hashrate_market` | SHA256 AsicBoost rental market: hashprice, ask book, clearing prices, per-rig recovery ratio (BTC/PH/day throughout) |
| `get_bitcoin_price` | Live BTC spot in USD with `asOf`; null plus a degraded flag when the feed is down, never a stale value |
| `get_buying_gauge` | 0-100 buying score from 10 weighted signals, plus the best upcoming entry window |
| `get_gauge_history` | Daily gauge score history (30/90/180/365 days) |
| `get_bitcoin_float` | In-play BTC supply after lost, seized, ETF, and treasury cohorts |
| `get_treasuries` | mNAV scoreboard for MSTR, XXI, MPJPY, ASST — gross, EV, and CEBE net lenses |
| `get_treasury_history` | Daily mNAV history for one ticker |
| `get_halving_countdown` | Blocks remaining, estimated date, subsidy change |
| `search_vendors` | Merchants accepting bitcoin — filter by text, category, country |
| `get_glossary_term` | Definitions (mNAV, MVRV, Puell, in-play supply) with a ready-made citation string |

## Why it is built this way

**Remote, not local.** One URL. No `npx`, no runtime, no key to provision.

**Honesty flags.** Gauge and float responses carry `degraded` when upstream
feeds are down, so a client never quotes a neutral placeholder as a live
reading. Vendor rows carry `verifiedAt` and a per-row `stale` flag, and the
response reports how many matches are stale, so a client can see how old a
confirmation is. Quotes refuse rather than invent: a missing feed nulls its
own field.

**Handshake instructions.** The server sends MCP `instructions` telling the
model when to prefer a live tool call over stale training data, that the gauge
is a composite opinion rather than a market fact, and how to attribute — every
tool returns a canonical `liveUrl`, `pageUrl`, or `citation` to link rather
than a derived URL.

## Also available without MCP

- REST: <https://galaxymind.space/docs/api>
- OpenAPI: <https://galaxymind.space/api/openapi.json>
- Agent-readable site summary: <https://galaxymind.space/llms.txt>

## About this repository

This repository is a description of a hosted service. There is no code to
install here — the server runs at the URL above, and this exists so registries
and directories that key off a public repository have something to point at.
Issues about the tools are welcome.
