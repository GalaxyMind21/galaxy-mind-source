// MCP transport smoke test (review S1 + S2 on #99), in-process: imports the real route
// handlers and drives them with Request objects. No server, no network, ~2s.
//
// S1: initialize, tools/list (with phase 2 off and on), a malformed create_rental gives
//     -32602 before any handler runs, and the retired /sse and /message paths give 404.
// S2: the @modelcontextprotocol/sdk override in package.json deliberately overrides
//     mcp-handler's EXACT peer pin (1.26.0) to clear GHSA-6qxp-vccf-f47h. This test fails the
//     moment mcp-handler's declared SDK dependency (or its version) changes, so every
//     mcp-handler or SDK bump forces someone to revisit, and ideally drop, the override.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// ── S2: the SDK override is tied to mcp-handler's exact pin ─────────────────
{
  const pkg = readJson("package.json");
  const handler = readJson("node_modules/mcp-handler/package.json");
  const sdk = readJson("node_modules/@modelcontextprotocol/sdk/package.json");
  const declared = { ...handler.dependencies, ...handler.peerDependencies }["@modelcontextprotocol/sdk"];
  const why = "mcp-handler's SDK pin changed. Revisit the @modelcontextprotocol/sdk override in package.json "
    + "(added in #99 for GHSA-6qxp-vccf-f47h): drop it if mcp-handler now allows a fixed SDK, otherwise "
    + "re-test /api/mcp and update this expectation.";
  assert.equal(handler.version, "1.1.0", why);
  assert.equal(declared, "1.26.0", why);
  assert.equal(pkg.dependencies["mcp-handler"], "^1.1.0", why);
  assert.equal(pkg.overrides["@modelcontextprotocol/sdk"], "~1.31.0", why);
  const [maj, min] = sdk.version.split(".").map(Number);
  assert.ok(maj === 1 && min >= 31, `installed SDK ${sdk.version} must be >= 1.31.0 (GHSA-6qxp-vccf-f47h)`);
  console.log(`  ✓ SDK override tied to mcp-handler ${handler.version} (pins ${declared}, installed ${sdk.version})`);
}

type Rpc = { result?: Record<string, unknown> & { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: { code: number; message: string } };
const URL_BASE = "http://localhost/api/mcp";

async function rpc(post: (r: Request) => Promise<Response>, method: string, params: unknown): Promise<{ status: number; type: string | null; body: Rpc }> {
  const res = await post(new Request(`${URL_BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
  return { status: res.status, type: res.headers.get("content-type"), body: JSON.parse(line.replace(/^data: /, "")) };
}

(async () => {
  // KV/Supabase are absent here on purpose: the limiter falls back to its local window and
  // nothing below reaches a tool body, so no network is touched.
  delete process.env.RENTALS_PHASE2_ENABLED;
  const route = await import("../src/app/api/mcp/[transport]/route");

  const init = await rpc(route.POST, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "1" } });
  assert.equal(init.status, 200);
  assert.match(init.type ?? "", /text\/event-stream/, "Streamable HTTP answers as SSE");
  assert.equal((init.body.result?.serverInfo as { name: string }).name, "galaxy-mind");
  console.log("  ✓ initialize · 200 text/event-stream · galaxy-mind");

  const off = await rpc(route.POST, "tools/list", {});
  const offNames = (off.body.result?.tools ?? []).map((t) => t.name);
  for (const n of ["get_rental_quote", "rental_status", "list_available_rigs", "get_hashrate_market"]) assert.ok(offNames.includes(n), `${n} listed`);
  assert.ok(!offNames.includes("create_rental"), "create_rental hidden while phase 2 is off");
  console.log(`  ✓ tools/list · ${offNames.length} tools, no create_rental with phase 2 off`);

  process.env.RENTALS_PHASE2_ENABLED = "1";
  process.env.RENTALS_PHASE2_MODE = "staging";
  // create/cancel register only in RENTALS_MODE=direct (mrr_only is the default since 2026-10-17; see test-mrr-only.tsx).
  process.env.RENTALS_MODE = "direct";
  try {
    const on = await rpc(route.POST, "tools/list", {});
    const onNames = (on.body.result?.tools ?? []).map((t) => t.name);
    for (const n of ["get_quote", "create_rental", "get_rental_status", "cancel_rental"]) assert.ok(onNames.includes(n), `${n} listed with phase 2 on`);
    console.log(`  ✓ tools/list · ${onNames.length} tools with phase 2 staging on`);

    // Malformed: wrong types and a too-short idempotency key. Schema validation must refuse it
    // with -32602 before createRental (and its DB/pricing calls) ever runs.
    const bad = await rpc(route.POST, "tools/call", { name: "create_rental", arguments: { rigs: "lots", idempotency_key: "short" } });
    const msg = bad.body.error?.message ?? bad.body.result?.content?.[0]?.text ?? "";
    assert.ok(bad.body.error?.code === -32602 || (bad.body.result?.isError === true && /-32602/.test(msg)), `malformed create_rental → -32602, got ${JSON.stringify(bad.body).slice(0, 200)}`);
    assert.match(msg, /Input validation error/);
    console.log("  ✓ malformed create_rental · -32602 input validation");
  } finally {
    delete process.env.RENTALS_PHASE2_ENABLED;
    delete process.env.RENTALS_PHASE2_MODE;
    delete process.env.RENTALS_MODE;
  }

  for (const p of ["sse", "message"]) {
    const g = await route.GET(new Request(`${URL_BASE}/${p}`));
    assert.equal(g.status, 404, `GET /${p} retired`);
    const q = await route.POST(new Request(`${URL_BASE}/${p}`, { method: "POST", body: "{}" }));
    assert.equal(q.status, 404, `POST /${p} retired`);
  }
  console.log("  ✓ /sse and /message · 404");
  assert.equal(route.HEAD().status, 200, "HEAD probe");

  console.log("test-mcp-smoke: ok");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
