/**
 * /hashrate/agents · "Connect your AI in 2 minutes" (2026-10-16, the operator:
 * "do we make it super clear how a human can get their AI bot connected?").
 *
 * Written for a person, not a model. Every client path below was checked
 * against that client's own docs on 2026-10-16:
 *  - Claude: support.claude.com "Get started with custom connectors using
 *    remote MCP" (Customize > Connectors > + Add > Add custom connector;
 *    Team/Enterprise owners add it under Organization settings > Connectors).
 *  - ChatGPT: help.openai.com 12584461 and developers.openai.com
 *    "Add custom MCP server" (Plugins > + > Add custom MCP server; web only;
 *    plan and workspace rules decide who can add one and whether write tools run).
 *  - Cursor: cursor.com/docs/context/mcp (remote server = { "url": ... } in
 *    ~/.cursor/mcp.json or .cursor/mcp.json).
 * Menus move. If a client renames one, keep the step generic rather than guess.
 *
 * Pilot limits come from src/lib/rentals/limits.ts, never typed here.
 */
import { MAX_RIGS, PILOT_MAX_DAYS, RIG_TH } from "@/lib/rentals/limits";

/* ── Page head ──────────────────────────────────────────────────────── */
export const AGENTS_H1_LEAD = "Rent our miners";
export const AGENTS_H1_EM = "with your AI";
export const AGENTS_MASTHEAD =
  "Your AI assistant checks which rigs are free, quotes a price and sets up the rental. You approve it and pay in USDC on Base.";
export const AGENTS_META_DESCRIPTION =
  "Connect Claude, ChatGPT, Cursor or any MCP app to Galaxy Mind in 2 minutes. Your AI quotes and sets up a Bitcoin hashrate rental, and you pay in USDC on Base.";

export const MCP_URL = "https://galaxymind.space/api/mcp/mcp";
export const MCP_SERVER_NAME = "Galaxy Mind";

export const CONNECT_EYEBROW = "Connect your AI in 2 minutes";
export const CONNECT_TITLE = "Add Galaxy Mind to your AI assistant";
export const CONNECT_LEAD =
  "Paste one link into Claude, ChatGPT, Cursor or any app that supports MCP. Then just ask in plain words. No account and no API key.";
export const CONNECT_URL_LABEL = "Your Galaxy Mind link (MCP server URL)";

export type ClientGuide = {
  id: "claude" | "chatgpt" | "cursor" | "other";
  tab: string;
  steps: string[];
  /** Optional copyable config, shown under the steps. */
  snippet?: { label: string; code: string };
  note?: string;
};

export const CURSOR_SNIPPET = `{
  "mcpServers": {
    "galaxy-mind": {
      "url": "${MCP_URL}"
    }
  }
}`;

export const CLIENT_GUIDES: ClientGuide[] = [
  {
    id: "claude",
    tab: "Claude",
    steps: [
      "Open Claude on the web or in Claude Desktop and go to Customize, then Connectors.",
      "Click + Add, then Add custom connector.",
      `Name it ${MCP_SERVER_NAME} and paste the link above as the server URL. Click Continue.`,
      "If Claude asks how people sign in, choose No sign in. Click Add.",
      "In a new chat, click + then Connectors and switch Galaxy Mind on.",
    ],
    note: "Free plans allow one custom connector. On Team and Enterprise plans an owner adds it first under Organization settings, then Connectors.",
  },
  {
    id: "chatgpt",
    tab: "ChatGPT",
    steps: [
      "Open ChatGPT on the web (not the mobile app) and go to Plugins.",
      "Click the + button, then Add custom MCP server.",
      `Name it ${MCP_SERVER_NAME} and paste the link above as the server URL.`,
      "Set Authentication to No authentication, tick I understand and want to continue, then click Create as a plugin.",
      "Install the plugin, start a new chat, type @ and pick Galaxy Mind.",
    ],
    note: "Custom MCP servers depend on your ChatGPT plan and workspace settings, and some plans only allow read tools. If you do not see Add custom MCP server, use Claude or Cursor instead.",
  },
  {
    id: "cursor",
    tab: "Cursor",
    steps: [
      "Open ~/.cursor/mcp.json for every project, or .cursor/mcp.json inside one project. Create the file if it is not there.",
      "Paste the snippet below. If the file already has servers, add the galaxy-mind entry inside mcpServers.",
      "Save, then check Galaxy Mind is switched on under Customize in the Cursor sidebar.",
      "Ask the Cursor agent in chat. It asks before it runs each tool.",
    ],
    snippet: { label: "mcp.json", code: CURSOR_SNIPPET },
  },
  {
    id: "other",
    tab: "Any other MCP app",
    steps: [
      "Find the place to add a remote or custom MCP server. Apps call it a connector, an integration or a tool server.",
      "Paste the link above. If it asks for a transport, choose Streamable HTTP.",
      "Leave sign-in, API key and headers empty. Galaxy Mind needs none.",
      "Start a new chat and ask your assistant to use Galaxy Mind.",
    ],
    note: "Works with any assistant or agent that speaks MCP over HTTP, including Grok Bot and coding agents.",
  },
];

export const PROMPTS_TITLE = "Then ask it";
export const PROMPTS: string[] = [
  "Using Galaxy Mind, show me the available rigs and quote 1 rig for 1 day.",
  "Using Galaxy Mind, rent 1 rig for 1 day pointed at my own pool with my Bitcoin address bc1q… and show me the payment request.",
  "Using Galaxy Mind, quote 2 rigs for 3 days and tell me the total in USDC.",
  "Check my Galaxy Mind rental. The rental ID is gm_… and the secret is ….",
];

export const NEXT_TITLE = "What happens next";
export const NEXT_STEPS: { t: string; d: string }[] = [
  { t: "Your AI quotes", d: `Rigs free right now and the price for whole ${RIG_TH} TH rigs. Up to ${MAX_RIGS} rigs, 1 to ${PILOT_MAX_DAYS} days.` },
  { t: "You approve", d: "Tell it your pool and worker or Bitcoin address. It accepts the Rental Terms only when you say so." },
  { t: "You pay", d: "It hands you a USDC payment request on Base. Approve it in an x402-ready wallet within 15 minutes." },
  { t: "Hashrate starts", d: "Rigs point at your pool right after payment. A pool outside our list needs a manual check of up to about 2 hours, refunded in full if not approved." },
  { t: "Check any time", d: "Ask your AI for the status with your rental ID and secret. Save both, the secret is shown once." },
];

export const CONNECT_FINE_PRINT =
  "Galaxy Mind never holds your coins or touches your wallet. Your AI asks before it places an order, and you pay the request yourself.";
export const CONNECT_TERMS_LINK = "Read the Rental Terms";

/* ── Machines list · status only, the how-to said once ─────────────── */
export const MACHINES_HOWTO =
  "To rent, connect your AI above and ask it. It picks free rigs for you, so you never choose a machine by hand.";
export const MACHINES_SUMMARY = "{FREE} of {TOTAL} rigs free right now";
export const MACHINE_STATUS_LABEL: Record<string, string> = {
  available: "Available",
  rented: "Rented",
  offline: "Offline",
  "coming-online": "Coming online",
};

/* ── Three ways in · the MCP tool list, all current tools ──────────── */
export const MCP_TOOLS: { name: string; does: string }[] = [
  { name: "list_available_rigs", does: "rig types and how many are free now" },
  { name: "get_rental_quote", does: "a priced quote, valid 15 minutes" },
  { name: "get_quote", does: "a quick USDC price for rigs and days" },
  { name: "create_rental", does: "places the order and returns the x402 USDC payment request" },
  { name: "get_rental_status", does: "order state, times and delivered TH (rental ID and secret)" },
  { name: "cancel_rental", does: "cancels, with a pro-rata refund per the Rental Terms" },
  { name: "rental_status", does: "live rig health by access code" },
];
export const SURFACE_MCP_NOTE = "Every rental tool, for any MCP client:";
export const SURFACE_JSON_NOTE = `the same quote over plain HTTP · hours ${24} to ${PILOT_MAX_DAYS * 24} in whole days during the pilot`;

/* ── For agents · the exact sequence, replaces the pre-launch handoff ─ */
export const AGENT_SEQUENCE_TITLE = "For agents: the exact sequence";
export const AGENT_SEQUENCE: string[] = [
  "list_available_rigs, then get_rental_quote with rigs and days.",
  "create_rental with rigs, days, pool_id or custom_url, username, accept_terms=true and terms_version. Read the Rental Terms first.",
  "Hand the x402 payment request to your human. Send accepts[0] unchanged and do not pay twice after a retry outcome.",
  "get_rental_status with rental_id and creator_secret until it is active, then rental_status with the access code.",
];
export const AGENT_CUSTODY_LINE =
  "Galaxy Mind never moves funds or touches a wallet. A human pays every rental, and anything the rigs find pays out to the pool they chose.";

/* ── /hashrate #rent-with-ai teaser ─────────────────────────────────── */
export const TEASER_EYEBROW = "Rent with your AI";
export const TEASER_TITLE = "Let your AI assistant rent it for you";
export const TEASER_BODY =
  "Connect Claude, ChatGPT, Cursor or any MCP app in about 2 minutes. Ask in plain words, approve, and pay in USDC on Base.";
export const TEASER_STEPS: string[] = ["Connect", "Ask for a quote", "Approve and pay", "Hashrate starts"];
export const TEASER_CTA = "Connect your AI in 2 minutes";
