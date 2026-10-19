/**
 * Human browser-wallet checkout · pure helpers shared by /hashrate/rent and
 * its tests. No Node or DOM imports, so the client bundle can use it.
 *
 * The wallet signs the USDC EIP-3009 TransferWithAuthorization exactly as
 * the x402 v2 "exact" scheme expects, built only from the PaymentRequired
 * that GET /api/rentals/pay/<ref> returns. X402Provider.verifyAndSettle then
 * checks it unchanged: accepted == requirements (scheme, network, amount,
 * asset, payTo), to == payTo, value == amount, a 32-byte nonce, and
 * validAfter <= now < validBefore - 5.
 * Chain ids are parsed from the CAIP-2 network in the requirements, never
 * hard-coded here.
 */

export type WireRequirements = {
  scheme: string; network: string; amount: string; asset: string; payTo: string;
  maxTimeoutSeconds: number; extra: { orderRef?: string; name?: string; version?: string };
};
export type PaymentRequiredBody = {
  x402Version: number; error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: WireRequirements[];
};
export type Authorization = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type TypedData = {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: "TransferWithAuthorization";
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  message: Authorization;
};
export type HumanPaymentPayload = {
  x402Version: 2; resource?: PaymentRequiredBody["resource"]; accepted: WireRequirements;
  payload: { signature: string; authorization: Authorization };
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
/** Seconds of clock slack before now for validAfter (the x402 reference client uses 600). */
export const VALID_AFTER_SLACK_SEC = 600;

/** "eip155:<n>" -> n. Null for anything else. */
export function chainIdFromCaip2(network: string): number | null {
  const m = /^eip155:(\d{1,12})$/.exec(String(network ?? ""));
  return m ? Number(m[1]) : null;
}
export const chainIdHex = (id: number) => "0x" + id.toString(16);

export type Expected = { network: string; payTo: string; asset: string };
const sameAddr = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * The one requirement this checkout can pay, or a reason it cannot. Network,
 * payTo and the USDC contract must equal the values the page was rendered
 * with (pinned server-side: the verified payTo and the configured network's USDC).
 * Anything else is refused BEFORE the wallet is asked to sign.
 */
export function pickRequirement(pr: unknown, expect: Expected): { ok: true; req: WireRequirements } | { ok: false; error: "bad_request" | "wrong_network" | "pinned_mismatch" } {
  const b = pr as PaymentRequiredBody | null;
  // With Solana offered too, accepts[] has one entry per network: take this page's network (Base is first anyway).
  const ex = b && b.x402Version === 2 && Array.isArray(b.accepts) ? b.accepts.filter((a) => a?.scheme === "exact") : [];
  const r = ex.find((a) => a?.network === expect.network) ?? ex[0];
  if (!r || !ADDR.test(String(r.payTo)) || !ADDR.test(String(r.asset)) || !/^[1-9]\d{0,15}$/.test(String(r.amount))) return { ok: false, error: "bad_request" };
  if (!r.extra?.name || !r.extra?.version || !(r.maxTimeoutSeconds > 0) || chainIdFromCaip2(r.network) == null) return { ok: false, error: "bad_request" };
  if (r.network !== expect.network) return { ok: false, error: "wrong_network" };
  if (!sameAddr(r.payTo, expect.payTo) || !sameAddr(r.asset, expect.asset)) return { ok: false, error: "pinned_mismatch" };
  return { ok: true, req: r };
}

/** 32 random bytes as 0x-hex. Pass `bytes` in tests. */
export function randomNonce(bytes?: Uint8Array): string {
  const b = bytes ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
  if (b.length !== 32) throw new Error("nonce_length");
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * EIP-712 typed data for USDC transferWithAuthorization.
 * validBefore = min(now + maxTimeoutSeconds, payBy) so a signature never
 * outlives the order's pay window.
 */
export function buildTransferAuthorization(req: WireRequirements, from: string, nowSec: number, nonce: string, payBySec?: number): { typedData: TypedData; authorization: Authorization } {
  if (!ADDR.test(from)) throw new Error("bad_from");
  if (!B32.test(nonce)) throw new Error("bad_nonce");
  const chainId = chainIdFromCaip2(req.network);
  if (chainId == null) throw new Error("bad_network");
  const until = Math.floor(nowSec + req.maxTimeoutSeconds);
  const validBefore = payBySec && payBySec > nowSec ? Math.min(until, Math.floor(payBySec)) : until;
  const authorization: Authorization = {
    from, to: req.payTo, value: String(req.amount),
    validAfter: String(Math.max(0, Math.floor(nowSec) - VALID_AFTER_SLACK_SEC)), validBefore: String(validBefore), nonce,
  };
  return {
    authorization,
    typedData: {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      domain: { name: String(req.extra.name), version: String(req.extra.version), chainId, verifyingContract: req.asset },
      message: authorization,
    },
  };
}

/**
 * A wallet signature: 65 bytes from a plain wallet, or longer from a smart wallet (the Base app's
 * Base Account signs with an ERC-1271 / ERC-6492 contract signature, often 1 to 2 KB). USDC v2.2's
 * transferWithAuthorization(bytes) and the facilitator check it; we only bound its size and shape.
 */
export const SIGNATURE_RE = /^0x(?:[0-9a-fA-F]{2}){65,3072}$/;

/** ERC-6492 magic suffix: the signing smart wallet isn't deployed on-chain yet. */
const ERC6492_SUFFIX = "6492".repeat(16);
export const isCounterfactualSignature = (sig: string) => typeof sig === "string" && sig.toLowerCase().endsWith(ERC6492_SUFFIX);
/** verify_failed for a not-yet-deployed smart wallet: say so instead of blaming the balance. */
export const COUNTERFACTUAL_VERIFY_COPY = {
  title: "Your new wallet needs one more step",
  body: "Your Base Account is new and isn't active on Base yet, and the payment check didn't accept it. Nothing was charged. Make any small transaction from it first (for example, send yourself $1 of USDC in the Base app), then come back and pay. Or check that it holds enough USDC on Base.",
  charged: "no" as const,
};

export function buildPaymentPayload(pr: PaymentRequiredBody, req: WireRequirements, authorization: Authorization, signature: string): HumanPaymentPayload {
  if (!SIGNATURE_RE.test(signature)) throw new Error("bad_signature");
  return { x402Version: 2, ...(pr.resource ? { resource: pr.resource } : {}), accepted: req, payload: { signature, authorization } };
}

/** Base64 of ASCII JSON for the PAYMENT-SIGNATURE header. */
export function encodePaymentHeader(p: HumanPaymentPayload): string {
  const s = JSON.stringify(p);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64");
}

/** ERC-20 balanceOf(address) call data. */
export function balanceOfData(owner: string): string {
  if (!ADDR.test(owner)) throw new Error("bad_owner");
  return "0x70a08231" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** "12345678" atomic USDC -> "12.35" (rounded up to the cent for display only). */
export function usdcDisplay(atomic: string | number): string {
  const n = BigInt(String(atomic));
  const cents = (n + BigInt(9_999)) / BigInt(10_000);
  const whole = cents / BigInt(100), frac = cents % BigInt(100);
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
}

/** action "start_over": show a Start over button (never "reload", which would loop on the same answer). */
type Copy = { title: string; body: string; charged: "no" | "maybe" | "refund"; action?: "start_over" };
/** Plain-English copy for every PayError the pay route can return. */
export const PAY_ERROR_COPY: Record<string, Copy> = {
  unknown_ref: { title: "We couldn't find this payment", body: "This payment request is no longer on file. Nothing was charged. Please start a new rental.", charged: "no" },
  payment_expired: { title: "The payment window closed", body: "Prices are held for 15 minutes and this one ran out before payment arrived. Nothing was charged. Start again for a fresh price.", charged: "no" },
  invalid_payload: { title: "Your wallet's approval didn't come through", body: "The signed approval arrived in a form we can't use. Nothing was charged. Please try again.", charged: "no" },
  requirements_mismatch: { title: "The payment details didn't match", body: "What your wallet signed doesn't match this order. Nothing was charged. Please start a new rental.", charged: "no" },
  wrong_payto: { title: "The payment details didn't match", body: "The approval was addressed to the wrong account. Nothing was charged. Please start a new rental.", charged: "no" },
  wrong_amount: { title: "The amount didn't match", body: "The approved amount isn't the price of this order. Nothing was charged. Please try again.", charged: "no" },
  bad_window: { title: "Your device clock looks off", body: "The approval was outside its valid time. Check your date and time settings, then try again. Nothing was charged.", charged: "no" },
  verify_failed: { title: "The payment wasn't approved", body: "The most common reason is not enough USDC on Base in this wallet. Nothing was charged. Top up or switch wallets, then try again.", charged: "no" },
  // The settle step was reached, so money may have moved: the page checks instead of saying "nothing was charged".
  settle_failed: { title: "We're checking your payment", body: "The transfer didn't confirm cleanly, so we're checking whether it went through. Please don't pay again yet. Keep your rental ID handy.", charged: "maybe" },
  facilitator_unavailable: { title: "We're checking your payment", body: "Our payment service didn't answer in time, so we're checking whether your payment went through. Please don't pay again yet. Keep your rental ID handy.", charged: "maybe" },
  onchain_check_failed: { title: "We couldn't confirm your payment yet", body: "Your payment may have gone through, but we couldn't confirm it on Base. Please don't pay again. Keep your rental ID and message us so we can check it for you.", charged: "maybe" },
  record_failed: { title: "We couldn't save your payment", body: "Your payment may have gone through, but we couldn't record it. Please don't pay again. Keep your rental ID and message us so we can sort it out.", charged: "maybe" },
  store_unavailable: { title: "We couldn't check this order just now", body: "Our records didn't answer, so we stopped before any money moved. Nothing was charged. Please try again in a minute.", charged: "no" },
  // B7 G3: the free rigs were taken between the quote and the payment (GET 409 or POST 409). Nothing moved; the order stays open.
  no_capacity: { title: "Those rigs were just taken", body: "Another renter took the free rigs a moment ago, so we stopped before any money moved. Nothing was charged. Your order is still open: try again in a minute, or start over with fewer rigs.", charged: "no" },
  order_not_payable: { title: "This order can't take a payment", body: "It was cancelled or its time ran out, so we refused the payment before anything moved. Nothing was charged. Start again for a fresh price.", charged: "no" },
};
/** Client-side refusals (nothing was signed). */
export const CLIENT_PAY_COPY: Record<string, Copy> = {
  // 409 order_not_payable on the payment-request GET (before signing): the order was cancelled,
  // expired or moved on. Reloading gets the same 409, so the only way forward is a new order.
  order_closed: { title: "This order can't be paid anymore", body: "It was cancelled or its payment window closed, so there's nothing to pay here. Nothing was charged. Start over to get a fresh price and a new order.", charged: "no", action: "start_over" },
  // 503 on the payment-request GET: we couldn't read the order just now. Nothing signed; the order stays saved.
  request_unavailable: { title: "We couldn't load your payment just now", body: "Our server didn't answer in time. Your order is still saved on this device and nothing was charged. Please reload the page in a moment.", charged: "no" },
  pinned_mismatch: { title: "We stopped this payment", body: "The payment request didn't match Galaxy Mind's receiving account, so we didn't ask your wallet to sign. Nothing was charged. Please reload the page.", charged: "no" },
  wrong_network: { title: "Wrong network", body: "This payment request is for a different network than this page. Nothing was charged. Please reload the page.", charged: "no" },
  bad_request: { title: "We couldn't load the payment", body: "The payment request was incomplete, so we didn't ask your wallet to sign. Nothing was charged. Please reload the page.", charged: "no" },
};
export const PAY_ERROR_FALLBACK: Copy = { title: "Something went wrong", body: "The payment didn't complete. Nothing was charged. Please try again.", charged: "no" };
/**
 * Copy for a pay error. net = the network this payment was made on (review #101 S3): the stored copy says
 * "on Base", which is wrong for a Solana payment, so it is rewritten for "solana". Same object when unchanged.
 */
export const payErrorCopy = (code: string | undefined | null, net?: string | null): Copy => {
  const c = (code && (PAY_ERROR_COPY[code] ?? CLIENT_PAY_COPY[code])) || PAY_ERROR_FALLBACK;
  const sol = net === "solana" || (typeof net === "string" && net.startsWith("solana:"));
  return sol && /\bon Base\b/.test(c.body) ? { ...c, body: c.body.replace(/\bon Base\b/g, "on Solana") } : c;
};

/** Settlement outcomes from confirmPayment that mean money arrived but no rental started. */
export const REFUND_OUTCOMES = new Set(["kill_switch", "cap_exceeded", "late", "underpaid", "duplicate"]);

/** Order-route error codes in plain English. */
export const ORDER_ERROR_COPY: Record<string, string> = {
  rentals_paused: "Rentals are paused right now. Nothing was charged. Please check back soon.",
  cap_exceeded: "Not enough rigs are free for that order right now. Try fewer rigs, or check back later.",
  no_capacity: "Not enough rigs are free for that order right now. Try fewer rigs, or check back later. Nothing was charged.",
  pricing_unavailable: "We can't price a rental right now. Please try again in a few minutes.",
  ask_out_of_band: "Market prices are moving too fast to quote safely. Please try again later.",
  terms_not_accepted: "Please tick the box to accept the Rental Terms.",
  terms_version_mismatch: "The Rental Terms were just updated. Reload the page to review the latest version.",
  idempotency_conflict: "This order changed after it was started. Reload the page and start again.",
  open_order: "You already have an unpaid order open from this connection. Finish paying it, or wait up to 15 minutes for it to expire.",
  rate_limited: "Too many orders from your connection in a short time. Please wait a few minutes and try again.",
  rate_limit_unavailable: "We can't take new orders for a moment. Please try again shortly.",
  not_found: "Browser checkout isn't open right now.",
  not_configured: "Browser checkout isn't open right now.",
  invalid_input: "Please check the pool and username, then try again.",
  pool_user: "Usernames can use 1 to 64 letters, numbers, dots, dashes or underscores.",
  pool_user_btc_address: "This pool pays your username directly, so it needs a valid bitcoin address (starting with 1, 3, bc1q or bc1p). You can add a dot and a rig name after it.",
  pool_user_account_format: "This pool needs your pool account name: 2 to 40 letters, numbers, dashes or underscores. You can add a dot and a rig name after it.",
  pool_user_worker_format: "Only one rig name is allowed after the dot, using up to 32 letters, numbers, dashes or underscores.",
  pool_user_nicehash_address: "NiceHash needs your NiceHash mining address (starting with NHb) or a bitcoin address.",
  pool_user_reserved: "That username is reserved. Please use your own pool account name or payout address.",
  pool_port: "The port must be a number from 1 to 65535.",
  server_error: "Something went wrong on our side. Nothing was charged. Please try again.",
};
const POOL_HOST_COPY = "Please enter your pool's public address as host:port, for example stratum.example.com:3333. IP addresses and private network names can't be used.";
export const orderErrorCopy = (code: string | undefined): string =>
  (code && ORDER_ERROR_COPY[code]) || (code?.startsWith("pool_host_") ? POOL_HOST_COPY : ORDER_ERROR_COPY.server_error);

/** Wallet (EIP-1193) error -> plain English. 4001 = user rejected. */
export function walletErrorCopy(e: unknown): { code: "rejected" | "pending" | "unsupported_chain" | "other"; text: string } {
  const c = (e as { code?: number })?.code;
  if (c === 4001) return { code: "rejected", text: "You cancelled the request in your wallet. Nothing was charged." };
  if (c === -32002) return { code: "pending", text: "Your wallet already has a request open. Open your wallet to finish or cancel it." };
  if (c === 4902) return { code: "unsupported_chain", text: "Your wallet doesn't have this network yet. Approve adding it, then try again." };
  return { code: "other", text: "Your wallet couldn't complete that step. Nothing was charged. Please try again." };
}

/**
 * Instant hints for the pool step. The server (pools.ts, the node's own rules)
 * is the final word, including bitcoin address checksums; these only catch typos.
 */
export function customUrlHint(url: string): string | null {
  const m = /^(?:stratum\+tcp:\/\/)?([A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(url.trim());
  if (!m) return "Use host:port, as shown by your pool, for example stratum.example.com:3333.";
  const host = m[1].toLowerCase(), port = Number(m[2]);
  if (/^[0-9.]+$/.test(host) || !/\.[a-z]{2,63}$/.test(host)) return "Use the pool's public hostname, not an IP address or a local name.";
  if (!(port >= 1 && port <= 65535)) return "The port must be a number from 1 to 65535.";
  return null;
}
export const WORKER_HINT = "Use 1 to 64 letters, numbers, dots, dashes or underscores.";
export function usernameHint(format: string | null, user: string): string | null {
  const u = user.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(u)) return WORKER_HINT;
  if (!format) return null; // custom pool: the charset is the only rule
  const i = u.indexOf("."), head = i < 0 ? u : u.slice(0, i), w = i < 0 ? null : u.slice(i + 1);
  if (w !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(w)) return "Only one rig name is allowed after the dot, using up to 32 letters, numbers, dashes or underscores.";
  if (format === "account[.worker]" && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(head)) return "Enter your pool account name, 2 to 40 letters, numbers, dashes or underscores.";
  const btcLike = /^(1|3)[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(head) || /^(bc1|BC1)[02-9ac-hj-np-zAC-HJ-NP-Z]{11,87}$/.test(head);
  if (format === "btc_address[.worker]" && !btcLike) return "Enter your bitcoin payout address (it starts with 1, 3 or bc1).";
  if (format === "nicehash_address[.worker]" && !btcLike && !/^NHb[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(head)) return "Enter your NiceHash mining address (it starts with NHb) or a bitcoin address.";
  return null;
}
export const workerOk = (w: string) => /^[A-Za-z0-9._-]{1,64}$/.test(w);

/** mm:ss until `untilMs`. */
export function countdown(untilMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((untilMs - nowMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Explorer link only for a well-formed 32-byte tx hash. */
export function txLink(explorer: string, tx: unknown): string | null {
  return typeof tx === "string" && /^0x[0-9a-f]{64}$/i.test(tx) ? `${explorer}/tx/${tx}` : null;
}
/** A settled tx id this page may keep and link: Base 0x hex, or a Solana base58 signature (64-88 chars). */
export function safeTxId(tx: unknown): string | null {
  return typeof tx === "string" && (/^0x[0-9a-f]{64}$/i.test(tx) || /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(tx)) ? tx : null;
}

/**
 * The order the page keeps in localStorage until the access code is
 * actually collected (review M2). It holds the creator secret, which is
 * the only way to derive the access code, so it is never dropped early.
 */
export type SavedOrder = {
  v: 2; rentalId: string; paymentRef: string; payBy: string; totalUsdc: string | null;
  rigs: number; th: number; days: number; pool: { host: string; port: number; worker: string; approval?: "auto" | "manual" };
  creatorSecret: string; sig: string;
  /** Server confirmed the payment. */
  paid?: boolean;
  /** The wallet signed and the payment was (or may have been) submitted; outcome not yet known. */
  signed?: boolean;
  tx?: string | null; savedAt: number;
  /** Placed by the renter's AI (create_rental), paid here: the pay step asks them to check the pool and username (S3). */
  fromAi?: boolean;
  /** Network the renter paid on (progress ring copy after a reload). */
  net?: "base" | "solana";
};

/** Pay-step check for an order someone else (an AI, or whoever sent the link) filled in. security review S3. */
export const AI_POOL_CHECK_COPY = "Check that the pool and username are yours before you pay.";
export const AI_POOL_CHECK_WHY = "This order came from a pay link or a rental ID, not this page. Your rigs mine to this pool and username, so if you or your AI didn't choose them, or a pay link came from anyone else, don't pay.";
export const SAVED_ORDER_KEY = "gm-rent-order-v2";

export function parseSaved(raw: string | null): SavedOrder | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as SavedOrder;
    if (o?.v !== 2 || !/^gm_[A-Za-z0-9_-]{8,20}$/.test(String(o.rentalId)) || typeof o.creatorSecret !== "string" || !o.creatorSecret
      || !/^x402_[0-9a-f]{32}$/.test(String(o.paymentRef)) || !Number.isFinite(Date.parse(o.payBy))) return null;
    return o;
  } catch { return null; }
}

/**
 * Unpaid, unsigned saved orders older than this are dropped. A paid or signed
 * (maybe-paid) order holds the only copy of the creator secret, so it is kept
 * much longer: a signed-but-unpaid order is never dropped by age (review #84
 * S2), and a paid one only after savedOrderExpiresAt AND server confirmation.
 */
export const SAVED_MAX_AGE_MS = 8 * 86_400_000;

/** Longest rental window the TTL will honour, so a tampered `days` can't make a token immortal. */
const SAVED_MAX_RENTAL_DAYS = 90;

/**
 * Expiry for a PAID saved order (CodeQL review, 2026-10): the rental window
 * plus SAVED_MAX_AGE_MS of grace. Past that the page asks the server whether
 * the rental has ended (expiredOrderVerdict) and clears the creator secret only
 * if it has. Signed-but-unpaid orders never use this: their outcome is unknown,
 * so they stay on "collect" (overdue + Dismiss) until the server resolves them
 * or the renter dismisses (review #84 S2, PR #188 M-1).
 */
export function savedOrderExpiresAt(saved: Pick<SavedOrder, "savedAt" | "days">): number {
  const days = Number.isFinite(saved.days) && saved.days > 0 ? Math.min(Math.ceil(saved.days), SAVED_MAX_RENTAL_DAYS) : 1;
  const savedAt = Number.isFinite(saved.savedAt) ? saved.savedAt : 0;
  return savedAt + days * 86_400_000 + SAVED_MAX_AGE_MS;
}

/** Server states that mean a paid rental is over and its code can no longer be collected. */
const ENDED_STATES: ReadonlySet<string> = new Set(["completed", "refunded"]);

/**
 * Decide, from one POST /api/rentals/access answer (rental_id + creator_secret),
 * whether an expired paid saved order may be cleared. Only a clear "this rental
 * is over" answer clears it: HTTP 200, the authenticated view (it carries
 * `rigs`, the same test the cancel and pay paths use), an ended state, and no
 * access code still on offer. Anything else (offline, 429, 5xx, not_found, a
 * running state, a code still collectable, or the coarse unauthenticated
 * {rentalId, status} view a wrong or corrupted secret gets) keeps the order,
 * so the local clock alone can never drop the only copy of the secret.
 */
export function expiredOrderVerdict(status: number, body: { accessCode?: unknown; status?: unknown; rigs?: unknown; error?: unknown } | null): "clear" | "keep" {
  if (status !== 200 || !body || typeof body !== "object") return "keep";
  // Review S5-a: a 200 without `rigs` is the coarse view (the secret did not authenticate).
  if (!("rigs" in body)) return "keep";
  if (typeof body.accessCode === "string" && body.accessCode) return "keep";
  return typeof body.status === "string" && ENDED_STATES.has(body.status) ? "clear" : "keep";
}

/**
 * What to do with a saved order on page load.
 * - collect: payment went through (or may have); fetch the access code, patiently.
 * - expire-check: a paid order past savedOrderExpiresAt; ask the server once
 *   (expiredOrderVerdict) and clear it only if the rental has ended, else collect.
 * - pay: still unpaid and inside the pay window; resume step 3.
 * - check: the window passed without a recorded payment; ask the server once
 *   (a payment may have landed while the tab was closed), then collect or drop.
 * - none: nothing usable.
 */
export function resumePlan(saved: SavedOrder | null, nowMs: number): "none" | "collect" | "expire-check" | "pay" | "check" {
  if (!saved) return "none";
  if (saved.paid) return nowMs > savedOrderExpiresAt(saved) ? "expire-check" : "collect";
  if (saved.signed) return "collect";
  if (nowMs - (saved.savedAt || 0) > SAVED_MAX_AGE_MS) return "none";
  return Date.parse(saved.payBy) > nowMs ? "pay" : "check";
}

/** Backoff for access-code retries: 2 s, 3 s, 5 s, 8 s ... capped at 60 s. Never gives up while the page is open. */
export function collectDelayMs(attempt: number): number {
  const seq = [2, 3, 5, 8, 13, 20, 30, 45];
  return (attempt < seq.length ? seq[attempt] : 60) * 1000;
}

/** What one /api/rentals/access answer means while collecting. */
export function collectStep(status: number, body: { accessCode?: unknown; status?: unknown; error?: unknown } | null):
  { kind: "done"; code: string } | { kind: "wait"; note: "pending" | "paused" | "busy" } | { kind: "unpaid" } | { kind: "refund" } {
  if (status === 200 && typeof body?.accessCode === "string" && body.accessCode) return { kind: "done", code: body.accessCode };
  if (status === 200 && (body?.status === "awaiting_payment" || body?.status === "expired")) return { kind: "unpaid" };
  if (status === 200 && (body?.status === "refund_pending" || body?.status === "refunded" || body?.status === "expired_unapplied")) return { kind: "refund" };
  if (status === 503 && body?.error === "rentals_paused") return { kind: "wait", note: "paused" };
  if (status === 429 || status >= 500 || status === 0) return { kind: "wait", note: "busy" };
  return { kind: "wait", note: "pending" };
}

/**
 * What one POST /api/rentals/pay/<ref> answer means. Only a fixed error code the
 * server returns BEFORE money can move (charged: "no") counts as unpaid. Anything
 * else (network error = status 0, non-JSON body, unknown 5xx, an unknown code,
 * or a "maybe" code) is treated as maybe-paid: the page switches to checking.
 */
export type PayOutcome =
  | { kind: "paid"; tx: string | null; outcome: string }
  | { kind: "refund"; tx: string | null; outcome: string }
  | { kind: "refused"; code: string }
  | { kind: "maybe" };
export function payOutcome(status: number, body: unknown): PayOutcome {
  const j = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (status >= 200 && status < 300 && j?.success === true) {
    const tx = typeof j.transaction === "string" ? j.transaction : null;
    const outcome = typeof j.outcome === "string" ? j.outcome : "settled";
    return REFUND_OUTCOMES.has(outcome) ? { kind: "refund", tx, outcome } : { kind: "paid", tx, outcome };
  }
  const code = typeof j?.error === "string" ? j.error : null;
  if ([400, 402, 404, 409].includes(status) && code && Object.prototype.hasOwnProperty.call(PAY_ERROR_COPY, code) && PAY_ERROR_COPY[code].charged === "no") return { kind: "refused", code };
  return { kind: "maybe" };
}

/**
 * Cancel-and-start-over answer. "cleared" only on a confirmed cancelled:true.
 * not_cancellable = the order already moved on (maybe paid): check it.
 * awaiting_pool_approval = paid, custom pool waiting for approval (refunded in full if not
 * approved): also "check", which keeps the saved order and shows its progress.
 * Anything else (network, paused, 5xx): keep the saved order.
 */
export function cancelResult(status: number, body: unknown): "cleared" | "check" | "keep" {
  const j = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (status === 200 && j?.cancelled === true) return "cleared";
  if (status === 409 && (j?.error === "not_cancellable" || j?.error === "awaiting_pool_approval")) return "check";
  return "keep";
}

/** After a signed payment whose outcome is unknown, the pay window plus this grace is the normal checking time. */
export const SIGNED_GRACE_MS = 3 * 60_000;
export const signedStillChecking = (nowMs: number, payBy: string) => nowMs < Date.parse(payBy) + SIGNED_GRACE_MS;
/**
 * The server still says unpaid for an order this device signed a payment for.
 * Inside window + grace: keep checking quietly. After it: "overdue", meaning we
 * keep checking and show the rental ID with a way to reach us and an explicit
 * Dismiss. There is deliberately no "clear" answer: a settle-then-record_failed
 * payment would otherwise lose the creator secret (review PR #84 S2).
 */
export function signedUnpaidAction(nowMs: number, payBy: string): "checking" | "overdue" {
  return signedStillChecking(nowMs, payBy) ? "checking" : "overdue";
}

/**
 * What one GET /api/rentals/pay/<ref> answer (the payment request) means.
 * 409 order_not_payable gets its own code, "order_closed", whose copy offers
 * Start over. It used to fall through to bad_request ("reload"), which looped.
 */
export function requestOutcome(status: number, body: unknown): "paid" | "payable" | "order_closed" | "no_capacity" | "unknown_ref" | "request_unavailable" | "bad_request" {
  const j = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (status === 200 && j?.status === "paid") return "paid";
  if (status === 402) return "payable";
  if (status === 409 && j?.error === "order_not_payable") return "order_closed";
  // B7 G3: the rigs were taken; the order stays payable (retry), nothing was signed.
  if (status === 409 && j?.error === "no_capacity") return "no_capacity";
  if (status === 404) return "unknown_ref";
  // 503 (store_unavailable): transient. Keep the order; never Start over or clear it (review #88 S1).
  if (status === 503) return "request_unavailable";
  return "bad_request";
}

// ── Pay an order your AI placed ─────────────────────────────────────────
// create_rental (MCP) returns a payUrl so the human behind the AI can pay in
// the browser: /hashrate/rent?pay=<rentalId>#s=<creatorSecret>. The secret
// rides in the URL FRAGMENT, which browsers never send to the server (not in
// the request line, not in Referer), so it never lands in access logs. The
// page reads it, strips it from the address bar, and only ever sends it in
// the POST body to /api/rentals/access, exactly like a pasted secret.

export const RENTAL_ID_RE = /^gm_[A-Za-z0-9_-]{8,20}$/;
/** creatorSecret is 24 random bytes, base64url (32 chars). Accept a little slack, never other characters. */
export const CREATOR_SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Path of the pay page. The origin comes from the server (payLinkOrigin in mcp.ts), never hard-coded. */
export const PAY_LINK_PATH = "/hashrate/rent";

/**
 * Normalise a deployment origin: https only, no path, query or fragment kept. http://localhost (or
 * 127.0.0.1) only with allowLocalhost, which the server sets outside production only.
 */
export function payOrigin(raw: string | null | undefined, opts: { allowLocalhost?: boolean } = {}): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(opts.allowLocalhost === true && local && u.protocol === "http:")) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}

/** The human pay link for an order on this deployment's origin. The secret is in the fragment only. */
export function payUrlFor(rentalId: string, creatorSecret: string, origin: string | null | undefined, opts: { allowLocalhost?: boolean } = {}): string | null {
  const o = payOrigin(origin, opts);
  if (!o || !RENTAL_ID_RE.test(rentalId) || !CREATOR_SECRET_RE.test(creatorSecret)) return null;
  return `${o}${PAY_LINK_PATH}?pay=${rentalId}#s=${creatorSecret}`;
}

/** The slice of window that scheduleFragmentStrip touches (a fake one in tests). */
export type StripWindow = {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: (data: unknown, unused: string, url?: string | URL | null) => void };
  setTimeout: (fn: () => void, ms?: number) => unknown;
};

/**
 * Strip the #s= fragment from the address bar once the page has read it (review S1, S1').
 * Runs on the next tick, after Next has patched history.replaceState, and passes null state on
 * purpose: Next's patch returns early (no router sync) when the state already carries __NA, but
 * with null it copies its own internal state (__NA, the tree) in and applies the new URL, so the
 * router's canonicalUrl drops #s= and Back keeps working. Returns true when a strip was scheduled.
 */
export function scheduleFragmentStrip(w: StripWindow): boolean {
  if (!w.location.hash) return false;
  w.setTimeout(() => {
    try { w.history.replaceState(null, "", w.location.pathname + w.location.search); } catch { /* ignore */ }
  }, 0);
  return true;
}

/** Read ?pay=<rentalId> and #s=<secret> from the page URL. Junk is ignored, never echoed. */
export function parsePayLink(search: string, hash: string): { rentalId: string; secret: string | null } | null {
  let rid = "", secret: string | null = null;
  try { rid = new URLSearchParams(search).get("pay") ?? ""; } catch { return null; }
  if (!RENTAL_ID_RE.test(rid)) return null;
  try {
    const s = new URLSearchParams(hash.replace(/^#/, "")).get("s") ?? "";
    secret = CREATOR_SECRET_RE.test(s) ? s : null;
  } catch { secret = null; }
  return { rentalId: rid, secret };
}

/** What the page does with the { action: "pay" } answer. Only a complete, well-formed payable order becomes a SavedOrder. */
export function payLookup(status: number, body: unknown, secret: string, nowMs: number):
  | { kind: "pay"; order: SavedOrder }
  | { kind: "not_payable"; status: string; accessCode: string | null }
  | { kind: "error"; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status !== 200) return { kind: "error", error: typeof b.error === "string" ? b.error : "server_error" };
  if (b.payable !== true) {
    return { kind: "not_payable", status: typeof b.status === "string" ? b.status : "unknown", accessCode: typeof b.accessCode === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(b.accessCode) ? b.accessCode : null };
  }
  const pool = (b.pool && typeof b.pool === "object" ? b.pool : {}) as Record<string, unknown>;
  const rigs = Number(b.rigs), days = Number(b.days), th = Number(b.th);
  const ok = typeof b.rentalId === "string" && RENTAL_ID_RE.test(b.rentalId) && typeof b.paymentRef === "string" && /^x402_[0-9a-f]{32}$/.test(b.paymentRef)
    && typeof b.payBy === "string" && Date.parse(b.payBy) > nowMs && Number.isInteger(rigs) && rigs >= 1 && Number.isInteger(days) && days >= 1 && Number.isFinite(th)
    && typeof pool.host === "string" && Number.isInteger(Number(pool.port)) && typeof pool.worker === "string" && CREATOR_SECRET_RE.test(secret);
  if (!ok) return { kind: "error", error: "server_error" };
  return { kind: "pay", order: {
    v: 2, rentalId: b.rentalId as string, paymentRef: b.paymentRef as string, payBy: b.payBy as string,
    totalUsdc: typeof b.totalUsdc === "string" ? b.totalUsdc : null, rigs, th, days,
    pool: { host: pool.host as string, port: Number(pool.port), worker: pool.worker as string, ...(pool.approval === "manual" ? { approval: "manual" as const } : pool.approval === "auto" ? { approval: "auto" as const } : {}) },
    creatorSecret: secret, sig: `ai:${b.rentalId as string}`, savedAt: nowMs,
  } };
}

/** Plain-English copy for an AI-placed order that can't be paid here. */
export function notPayableCopy(status: string): string {
  if (status === "expired" || status === "cancelled") return "This order can no longer be paid: its 15-minute payment window closed. Ask your AI to place a new order, then open the new pay link.";
  if (status === "awaiting_payment") return "This order's payment window has just closed. Ask your AI to place a new order, then open the new pay link.";
  if (status === "refund_pending" || status === "refunded" || status === "expired_unapplied") return "This order was paid and a refund is queued. You don't need to do anything.";
  return "This order is already paid. Use Check a rental below with your rental ID and secret to see its status.";
}

// ── Phone hand-off to a wallet app ──────────────────────────────────────
// A phone browser (Safari, Chrome) has no wallet inside it, so there is nothing to connect.
// These links reopen this checkout inside the wallet app's own browser, where the wallet is
// built in. They carry only the checkout path and the rigs, days or pay=<rentalId> params:
// never the #s= secret. go.cb-w.com and link.metamask.io are web links first, so if the app
// doesn't catch the tap, their servers see the whole link (cb_url is in the query).

/** Phone or tablet (iPadOS reports as a Mac with touch). */
export function isMobileDevice(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** Tablets: iPad (including iPadOS reporting as a touch Mac) and Android without "Mobile". */
export function isTabletDevice(ua: string, maxTouchPoints = 0): boolean {
  if (/iPad/.test(ua)) return true;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true;
  return /Android/i.test(ua) && !/Mobile/i.test(ua);
}

/**
 * Whether to show (and only then load qrcode for) the "Pay on your phone" card: a wide viewport
 * (>= 768px, the md breakpoint) on a desktop or a tablet. Phones never get it, even in landscape.
 */
export function wantsPhoneQr(ua: string, maxTouchPoints: number, wide: boolean): boolean {
  if (!wide) return false;
  if (isTabletDevice(ua, maxTouchPoints)) return true;
  return !isMobileDevice(ua, maxTouchPoints);
}

/**
 * The checkout URL to reopen in a wallet app: same origin, PAY_LINK_PATH, and only rigs, days
 * (small positive integers) and pay (a rental ID). Everything else, including the fragment, is dropped.
 */
export function handoffUrl(origin: string, params: { rigs?: number; days?: number; pay?: string }): string | null {
  const o = payOrigin(origin);
  if (!o) return null;
  const q = new URLSearchParams();
  if (params.pay !== undefined) {
    if (!RENTAL_ID_RE.test(params.pay)) return null;
    q.set("pay", params.pay);
  } else {
    if (Number.isInteger(params.rigs) && params.rigs! >= 1 && params.rigs! <= 999) q.set("rigs", String(params.rigs));
    if (Number.isInteger(params.days) && params.days! >= 1 && params.days! <= 365) q.set("days", String(params.days));
  }
  const qs = q.toString();
  return `${o}${PAY_LINK_PATH}${qs ? `?${qs}` : ""}`;
}

export type WalletAppLink = { id: "base" | "metamask"; name: string; href: string };

/** Deep links that open `url` in each wallet app's browser. `url` must come from handoffUrl. */
export function walletAppLinks(url: string): WalletAppLink[] {
  let u: URL;
  try { u = new URL(url); } catch { return []; }
  if (u.protocol !== "https:" || u.hash || u.username || u.password) return [];
  return [
    // Base app (was Coinbase Wallet): https://go.cb-w.com/dapp?cb_url=<percent-encoded URL>
    { id: "base", name: "Base app", href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u.href)}` },
    // MetaMask: https://link.metamask.io/dapp/<host + path + query>, no scheme.
    { id: "metamask", name: "MetaMask", href: `https://link.metamask.io/dapp/${u.host}${u.pathname}${u.search}` },
  ];
}

// ── Pay on your phone (desktop QR) ──────────────────────────────────────
/**
 * What the desktop "pay on your phone" QR encodes: this page's origin, PAY_LINK_PATH and
 * ?pay=<rentalId>. Never the #s= secret and never a payment address: the phone opens the
 * normal checkout, the renter pastes the secret, and the payment still goes through the
 * pinned, order-bound payment request. localhost is allowed because the origin is always
 * the page's own (dev only in practice).
 */
export function phonePayUrl(origin: string, rentalId: string): string | null {
  const o = payOrigin(origin, { allowLocalhost: true });
  if (!o || !RENTAL_ID_RE.test(rentalId)) return null;
  return `${o}${PAY_LINK_PATH}?pay=${rentalId}`;
}
