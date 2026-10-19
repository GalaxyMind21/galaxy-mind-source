/**
 * Phase 2 MCP tools. Registered only when phase2Enabled(); labelled
 * "STAGING ONLY" unless the signed-job env is mainnet.
 * Exactly four tools, so a renter's bot can rent and track end to end:
 * get_quote, create_rental, get_rental_status, cancel_rental.
 * Payment: USDC via x402 on Base (Sepolia by default).
 * B6: every error and every cancel/refund answer carries the support email.
 */
import { z } from "zod";
import { stagingDeps } from "./staging";
import { phase2Enabled, jobEnv, publicBaseUrl, isProductionDeploy } from "./flag";
import { MIN_DAYS, PILOT_MAX_DAYS, PILOT_CAP_RIGS } from "./pricing";
import { maxDaysNow } from "../limits";
import { RENTAL_TERMS_URL, RENTAL_TERMS_VERSION } from "./terms";
import { CATALOG_POOL_IDS, catalogForUi, POOL_NOTES } from "./pools";
import { getQuote, createRental, getRentalStatus, cancelRental, confirmPayment, reofferOrExpire } from "./service";
import { humanCheckoutFlag } from "./human";
import { payUrlFor, payOrigin } from "./human-wallet";
import { SUPPORT_EMAIL } from "../../support";
import { trackFunnel } from "../funnel";
import { assertCustomerSafe } from "../index";
import { marketplaceRedirect } from "../mode";
import { QUOTE_TOOL_DESCRIPTION_MRR } from "@/lib/mrr-page-copy";

export const PHASE2_TOOL_NAMES = ["get_quote", "create_rental", "get_rental_status", "cancel_rental"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = (v: unknown) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Kill switch state for customer copy: true = paused (phase2 off, deps missing,
 * RENTALS_KILL=1 or rentals_enabled not true), false = open, null = could not
 * tell within the timeout (callers then use neutral copy). Never throws.
 */
export async function rentalsPaused(env: Record<string, string | undefined> = process.env, timeoutMs = 2000): Promise<boolean | null> {
  if (!phase2Enabled(env)) return true;
  const d = stagingDeps(env);
  if (!d) return true;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([d.killSwitch(), new Promise<null>((r) => { t = setTimeout(() => r(null), timeoutMs); })]);
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

/**
 * Additive: a fresh create_rental (the only answer that carries creatorSecret) gets a human payUrl,
 * /hashrate/rent?pay=<rentalId>#s=<creatorSecret>, while the browser checkout is on. The secret is
 * in the fragment, so it never reaches a server log. Replays never repeat the secret, so no payUrl.
 */
/**
 * The pay link's origin, server side (review S4, S4'): publicBaseUrl() from flag.ts, the same base
 * the x402 resource uses. Production never falls back to VERCEL_URL, and http://localhost is only
 * accepted outside production. A value that isn't a clean origin gives null: no payUrl at all.
 */
export function payLinkOrigin(env: Record<string, string | undefined> = process.env): string | null {
  return payOrigin(publicBaseUrl(env), { allowLocalhost: !isProductionDeploy(env) });
}

export function withPayUrl<T extends { ok: boolean }>(out: T, env: Record<string, string | undefined> = process.env): T {
  if (!out.ok || !humanCheckoutFlag(env)) return out;
  const r = (out as unknown as { result?: { rentalId?: unknown; creatorSecret?: unknown; payment?: { rail?: unknown } | null } }).result;
  if (!r || typeof r.rentalId !== "string" || typeof r.creatorSecret !== "string" || r.payment?.rail !== "x402_usdc") return out;
  const payUrl = payUrlFor(r.rentalId, r.creatorSecret, payLinkOrigin(env), { allowLocalhost: !isProductionDeploy(env) });
  return payUrl ? ({ ...out, result: { ...r, payUrl } } as T) : out;
}

/**
 * opts.mrrOnly (RENTALS_MODE=mrr_only, the default since 2026-10-17): create_rental and cancel_rental are NOT registered
 * and get_quote returns the marketplace redirect (no price). get_rental_status stays so past renters can look up a rental.
 */
export function registerPhase2Tools(server: any, json: Json, toolError: (e: string, m: string, u: string | null) => unknown, fallbackUrl: string | null, opts: { mrrOnly?: boolean } = {}) {
  const mrr = opts.mrrOnly === true;
  const live = jobEnv() === "mainnet";
  // Day cap follows the pilot flag, the same rule createRental (maxDaysFor) and the quotes use.
  const capDays = maxDaysNow();
  const capNote = capDays === PILOT_MAX_DAYS ? " in the pilot" : "";
  const tag = live ? "" : "STAGING ONLY. ";
  // Review #101 S5: name Solana to agents only when the rail is on (same switch as the page, RENTALS_SOLANA_ENABLED=1).
  const solanaNote = process.env.RENTALS_SOLANA_ENABLED === "1"
    ? " If payment.accepts is present it also lists USDC on Solana for the same amount (memo = rental ID, exact amount only); send back the one entry you pay, unchanged."
    : "";
  const title = (t: string) => (live ? t : `${t} (staging)`);
  const notConfigured = () => json(toolError("not_configured", "Paid rentals are not configured.", fallbackUrl));
  type Out = { ok: true; result: unknown } | { ok: false; error: string; message: string };
  const reply = (out: Out) => (out.ok ? json(out.result) : json({ ...(toolError(out.error, out.message, fallbackUrl) as object), support: SUPPORT_EMAIL }));
  const replyWithSupport = (out: Out) => (out.ok ? json({ ...(out.result as object), support: SUPPORT_EMAIL }) : reply(out));
  const secret = { rental_id: z.string().max(32).describe("rentalId from create_rental."), creator_secret: z.string().max(64).describe("creatorSecret from create_rental. Shown once; keep it private.") };

  if (mrr) {
    server.tool(
      "get_quote",
      QUOTE_TOOL_DESCRIPTION_MRR,
      { rigs: z.union([z.number(), z.string()]).optional().describe("Ignored: direct rentals are closed."), days: z.union([z.number(), z.string()]).optional().describe("Ignored: direct rentals are closed.") },
      { title: title("Get Quote"), readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => json(assertCustomerSafe(marketplaceRedirect())),
    );
  } else server.tool(
    "get_quote",
    `${tag}Price whole S21 XP rigs (270 TH each, 1 to ${PILOT_CAP_RIGS} rigs, ${MIN_DAYS} to ${capDays} days${capNote}). The one Galaxy Mind price (get_rental_quote is an identical alias), never below the daily floor; create_rental charges the same number within 15 minutes. Pay in USDC on Base via x402.`,
    { rigs: z.number().int().min(1).max(PILOT_CAP_RIGS).describe("Number of rigs, 270 TH each."), days: z.number().int().min(MIN_DAYS).max(capDays).describe("Whole days.") },
    { title: title("Get Quote"), readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async (a: { rigs: number; days: number }) => {
      const d = stagingDeps(); if (!d) return notConfigured();
      const q = await getQuote(d, a);
      if (q.ok) await trackFunnel("rental_quote_viewed", { channel: "mcp", rigs: a.rigs, days: a.days });
      return reply(q);
    },
  );
  if (!mrr) server.tool(
    "create_rental",
    `${tag}Start a rental. You must read the Rental Terms (${RENTAL_TERMS_URL}) and pass accept_terms=true with terms_version="${RENTAL_TERMS_VERSION}". Pool: give pool_id (catalog: ${CATALOG_POOL_IDS.join(", ")}) OR custom_url (host:port of any other public pool), plus username (your worker or payout address, in the pool's format). No password: it is set for you. Catalog pools start right after payment. A custom pool needs manual approval after payment, which can take up to about 2 hours; if it is not approved the payment is refunded. Returns an x402 USDC payment request on Base that expires in 15 minutes, plus a creatorSecret for status and cancel. A human or an x402-capable agent wallet pays it; this tool never spends funds. To pay, send accepts[0] back unchanged as \`accepted\` (extra.orderRef is checked, so an edited or reused requirement is refused before any money moves). A 409 no_capacity from the pay URL means the rigs were just taken: nothing was charged, retry later or with fewer rigs.${solanaNote} A 200 with outcome 'retry' means you have paid and the rental is being finished: don't pay again, check get_rental_status instead. When browser checkout is on, the result also has payUrl: give it to the human unchanged and they can pay this order in their own browser with MetaMask or Coinbase Wallet. It carries the creatorSecret after the # (never sent to the server), so share it only with that human. An x402-capable agent wallet can also pay the request directly.`,
    {
      rigs: z.number().int().min(1).max(PILOT_CAP_RIGS).describe("Number of rigs, 270 TH each."),
      days: z.number().int().min(MIN_DAYS).max(capDays).describe(`Whole days, ${MIN_DAYS} to ${capDays}${capNote}.`),
      pool_id: z.enum(CATALOG_POOL_IDS as [string, ...string[]]).optional().describe(`A catalog pool (auto-approved). Username format per pool: ${catalogForUi().map((p) => `${p.id}=${p.usernameFormat}`).join("; ")}. Give pool_id or custom_url, not both.${Object.entries(POOL_NOTES).map(([id, n]) => ` Note for ${id}: ${n}`).join("")}`),
      custom_url: z.string().max(300).optional().describe("Any other pool, as host:port or stratum+tcp://host:port (public hostname only; no IPs, logins, paths or other schemes). Needs manual approval after payment, up to about 2 hours; refunded if not approved."),
      username: z.string().max(64).optional().describe("Required. Your pool worker or payout address: account[.worker], btc_address[.worker] or nicehash_address[.worker] for catalog pools; 1 to 64 of A-Z a-z 0-9 . _ - for custom pools."),
      pool_url: z.string().max(300).optional().describe("Deprecated alias of custom_url (same rules)."),
      worker: z.string().max(64).optional().describe("Deprecated alias of username."),
      accept_terms: z.boolean().describe(`Must be true: you accept the Rental Terms at ${RENTAL_TERMS_URL}.`),
      terms_version: z.string().max(40).describe(`The Rental Terms version you accepted. Current: ${RENTAL_TERMS_VERSION}.`),
      idempotency_key: z.string().min(16).max(64).describe("Client-chosen key; retries with the same key return the same rental."),
      // Review #106 N6: a plain string, so "lightning" (or any other rail) reaches createRental and gets rail_unavailable /
      // invalid_input with a message, not a -32602 schema error.
      rail: z.string().max(20).optional().describe("x402_usdc (default and the only rail). Anything else answers rail_unavailable."),
    },
    { title: title("Create Rental"), readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    async (a: Parameters<typeof createRental>[1]) => {
      const d = stagingDeps(); if (!d) return notConfigured();
      const out = await createRental(d, a);
      if (out.ok && !out.replay) await trackFunnel("rental_order_created", { channel: "mcp", rigs: Number(a.rigs), days: Number(a.days) });
      return reply(withPayUrl(out));
    },
  );
  server.tool(
    "get_rental_status",
    `${tag}Same data as rental_status (which takes the access code instead): rental state, start and end times, and delivered TH reported by the rigs. awaitingPoolApproval=true while a custom pool waits for manual approval (up to 2 hours, refunded if not approved); rejectedReason names why a pool was refused (refund queued). Needs rental_id and creator_secret. Not read-only: while unpaid it re-checks the payment, which can start the rental or queue a refund, and it re-sends a stalled pool switch.`,
    secret,
    { title: title("Get Rental Status"), readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    async (a: { rental_id: string; creator_secret: string }) => {
      const d = stagingDeps(); if (!d) return notConfigured();
      const first0 = await getRentalStatus(d, a);
      if (first0.ok && (first0.result as { status: string }).status === "delivering") {
        const o = await d.store.getOrderByPublicId(a.rental_id);
        if (o) await reofferOrExpire(d, o); // re-offer an expired unapplied job, or expire after 30 min
      }
      const first = first0.ok && (first0.result as { status: string }).status === "delivering" ? await getRentalStatus(d, a) : first0;
      if (first.ok && (first.result as { status: string }).status === "awaiting_payment") {
        const o = await d.store.getOrderByPublicId(a.rental_id);
        if (o) for (const ref of await d.store.refsForOrder(o.id)) await confirmPayment(d, ref); // outcome only
        return reply(await getRentalStatus(d, a));
      }
      return reply(first);
    },
  );
  if (!mrr) server.tool(
    "cancel_rental",
    `${tag}Cancel a rental. Unpaid: nothing is owed. Paid: a pro-rata refund of the unused paid time, per the Rental Terms (${RENTAL_TERMS_URL}), reviewed and sent manually; a full refund if the rigs never switched. While a custom pool awaits approval it answers awaiting_pool_approval: it can't be cancelled then, and it is refunded in full if not approved. Needs rental_id and creator_secret.`,
    secret,
    { title: title("Cancel Rental"), readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    async (a: { rental_id: string; creator_secret: string }) => { const d = stagingDeps(); if (!d) return notConfigured(); return replyWithSupport(await cancelRental(d, a)); },
  );
}
