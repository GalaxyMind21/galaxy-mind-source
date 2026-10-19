"use client";

// The three-step human checkout: 1 Choose, 2 Pool, 3 Pay.
// Wallets: injected EIP-1193 only (MetaMask, Coinbase Wallet extension or
// in-app browser), found through EIP-6963 with a window.ethereum fallback.
// A phone browser has no wallet inside it, so on a phone with none found the
// page offers links that reopen this checkout inside the Base app or MetaMask
// (their in-app browsers have the wallet built in). The links never carry the
// rental secret.
// Base Account (Coinbase Smart Wallet) works in any browser, phone included:
// a passkey popup at keys.coinbase.com, through @coinbase/wallet-sdk with
// smartWalletOnly (no QR relay; 4.4.0 has no telemetry switch and loads no
// telemetry script). The SDK loads only on the Pay step.
// The wallet signs one USDC transfer approval for exactly the order amount,
// built from the payment request the pay route returns, and the signed
// approval is posted back to that same route. No WalletConnect.
// Solana (when the rail is on): a frosted-glass network picker (Base / Solana) on the Pay step.
// Solana wallets (Phantom, Solflare, Backpack, ...) are found through the Wallet Standard; the
// page builds the x402 "exact" SVM transfer (exact amount, memo = rental ID) and the wallet adds
// the payer's signature only. The facilitator pays the network fee. On a phone with no Solana
// wallet in the browser, the page gives the order link to open in the wallet app's browser.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckoutView } from "@/lib/rentals/phase2/human";
import type { SupportInfo } from "@/lib/support";
import { funnelProps } from "@/lib/rentals/funnel";
import { track } from "@vercel/analytics";
import { GlowProgress } from "../components/GlowProgress";
import { SupportLine } from "../components/SupportLine";
import {
  pickRequirement, randomNonce, buildTransferAuthorization, buildPaymentPayload, encodePaymentHeader,
  balanceOfData, usdcDisplay, payErrorCopy, orderErrorCopy, walletErrorCopy, customUrlHint, usernameHint,
  countdown, txLink, parseSaved, resumePlan, collectDelayMs, collectStep, SAVED_ORDER_KEY,
  payOutcome, cancelResult, signedUnpaidAction, requestOutcome,
  parsePayLink, scheduleFragmentStrip, payLookup, AI_POOL_CHECK_COPY, AI_POOL_CHECK_WHY, notPayableCopy, RENTAL_ID_RE, CREATOR_SECRET_RE,
  isMobileDevice, handoffUrl, walletAppLinks, isCounterfactualSignature, chainIdFromCaip2, COUNTERFACTUAL_VERIFY_COPY,
  phonePayUrl, wantsPhoneQr, safeTxId,
  type PaymentRequiredBody, type WireRequirements, type SavedOrder,
} from "@/lib/rentals/phase2/human-wallet";
import {
  pickSolanaRequirement, buildSolanaPayment, solanaPaymentHeader, solanaTxLink,
  discoverSolanaWallets, connectSolana, signSolana, type SolanaRequirement, type SolanaWalletOpt,
} from "@/lib/rentals/phase2/solana-wallet";
import { PayWithEthereum } from "./PayWithEthereum";
import { ETH_COPY } from "@/lib/rentals/phase2/eth/client";

import { PayWithBitcoin, RailPicker } from "./PayWithBitcoin";
import { useBtcRail, btcMarked } from "./useBtcRail";

type OpenView = Extract<CheckoutView, { open: true }>;
type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, f: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, f: (...a: unknown[]) => void) => void;
  isMetaMask?: boolean; isCoinbaseWallet?: boolean; providers?: Eip1193[];
};
type WalletOpt = { id: string; name: string; provider: Eip1193; note?: string };
type Quote = { rigs: number; th: number; days: number; totalUsdc: string };
type Order = SavedOrder;
type Problem = { title: string; body: string; charged: "no" | "maybe" | "refund"; action?: "start_over" };
type Done = { tx: string | null; accessCode: string | null; endsAt: string | null; refund: boolean; outcome: string; held?: boolean };
type PayNet = "base" | "solana" | "ethereum";
const OTHER = "other";
const HELD_COPY = "Pools that aren't on this list need a quick manual check before your rigs switch. It can take up to about 2 hours, and if it isn't approved you get a full refund.";

// The saved order (with the creator secret) lives in localStorage until the access code is collected.
const saveOrder = (o: Order) => { try { localStorage.setItem(SAVED_ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
const clearSaved = () => { try { localStorage.removeItem(SAVED_ORDER_KEY); } catch { /* ignore */ } };
const readSaved = () => { try { return parseSaved(localStorage.getItem(SAVED_ORDER_KEY)); } catch { return null; } };
const ALLOWED_RDNS = ["io.metamask", "io.metamask.flask", "com.coinbase.wallet"];

const money = (usdc: string | null | undefined) =>
  usdc == null ? "·" : Number(usdc).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thLabel = (th: number) => `${th.toLocaleString("en-US")} TH/s`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const newKey = () => randomNonce().slice(2, 34);

// Frosted-glass panels from the site's Night Bench recipe (.rent-glass in globals.css:
// --nb-surface + --nb-wash, --nb-hair-2 edge, --nb-rim bevel, --nb-glass-soft blur).
const ring = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]";
const card = "rent-glass rounded-xl p-5 sm:p-6";
const cardAccent = "rent-glass rent-glass-accent rounded-xl p-5 sm:p-6";
const primary = `inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black lit-primary transition-opacity motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45 ${ring}`;
const secondary = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[var(--nb-hair-2)] bg-[var(--nb-surface)] px-5 text-[15px] text-[var(--text-primary)] transition-colors motion-reduce:transition-none hover:border-[var(--accent)]/45 disabled:opacity-45 ${ring}`;
const quiet = `min-h-[44px] rounded px-3 text-[14px] text-[var(--text-tertiary)] underline underline-offset-2 hover:text-[var(--text-secondary)] ${ring}`;
const field = "min-h-[52px] w-full rounded-lg border border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/70 px-4 font-mono text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors motion-reduce:transition-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25";
const label = "micro-label block text-[var(--text-tertiary)]";

/** Honest steps for the wait between "approve in your wallet" and "you're mining". */
const PAY_STEPS = (chain: string, gate = false) => [
  // B7 G3: with the availability gate on, the page re-checks the rigs are still free before the wallet signs
  // (the payment-request GET answers 409 no_capacity if not), and the server checks again before any money moves.
  ...(gate ? [{ label: "Checking your rigs are still free" }] : []),
  { label: "Payment approved" }, { label: `Confirming on ${chain}` }, { label: "Reserving your rigs" }, { label: "Switching to your pool" },
];

export function RentCheckout({ view, support }: { view: OpenView; support: SupportInfo }) {
  const maxRigs = Math.max(1, Math.min(view.maxRigs, view.freeRigs || view.maxRigs));
  const soldOut = view.freeRigs < 1;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [rigs, setRigs] = useState(1);
  const [days, setDays] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [poolId, setPoolId] = useState("");
  const [poolUrl, setPoolUrl] = useState("");
  const [worker, setWorker] = useState("");
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState({ pool: false, worker: false });
  const [order, setOrder] = useState<Order | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [wallets, setWallets] = useState<WalletOpt[]>([]);
  // Wallet discovery has finished (so "no wallet here" is a real answer), and whether this is a phone.
  const [discovered, setDiscovered] = useState(false);
  const [mobile, setMobile] = useState(false);
  // Any injected provider at all (even one we don't list): then we are already inside a wallet app.
  const [injected, setInjected] = useState(false);
  const [wallet, setWallet] = useState<{ opt: WalletOpt; address: string } | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [req, setReq] = useState<WireRequirements | null>(null);
  const [phase, setPhase] = useState<"idle" | "connecting" | "switching" | "checking" | "signing" | "confirming">("idle");
  const gate = view.availGate === true, off = gate ? 1 : 0;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // paidKnown: server confirmed payment. signed: we submitted a signed payment whose outcome is unknown.
  const [collecting, setCollecting] = useState<null | { paidKnown: boolean; signed: boolean; tx: string | null; outcome: string }>(null);
  const [collectNote, setCollectNote] = useState<"pending" | "paused" | "busy" | "overdue">("pending");
  const [retryNow, setRetryNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // "Pay an order your AI placed": from a payUrl (?pay=<id>#s=<secret>) or pasted by hand.
  const [aiLink, setAiLink] = useState<{ rentalId: string; secret: string | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Base Account (passkey smart wallet) provider, created on the Pay step so its popup opens straight from the tap.
  const [baseAcct, setBaseAcct] = useState<WalletOpt | null>(null);
  // The last signature came from a smart wallet that isn't on-chain yet (ERC-6492 wrapped).
  const counterfactualSig = useRef(false);
  // Network picker (Base / Solana). Solana shows only when the rail is on and this order's request offers it.
  const [net, setNet] = useState<PayNet>("base");
  const [solReq, setSolReq] = useState<SolanaRequirement | null>(null);
  const [solWallets, setSolWallets] = useState<SolanaWalletOpt[]>([]);
  const [solWallet, setSolWallet] = useState<{ opt: SolanaWalletOpt; account: Awaited<ReturnType<typeof connectSolana>> } | null>(null);
  const sol = view.chain.solana ?? null;
  // USDC on Ethereum (direct transfer, customer pays gas): only when that rail is on. ethBusy = a transfer is confirming.
  const ethOffer = view.chain.eth ?? null;
  const [ethBusy, setEthBusy] = useState(false);
  const ethPaidTx = useRef<string | null>(null);
  // The Ethereum quote's EXACT amount (price + its cent tag). The headline shows it, so nobody sends the untagged price.
  const [ethAmount, setEthAmount] = useState<string | null>(null);
  // Resume: an Ethereum transfer claimed on this device goes straight back to its progress ring (even past payBy).
  useEffect(() => {
    if (!ethOffer || !order || order.paid) return;
    let tx: string | null = null;
    try { tx = localStorage.getItem(`gm-rent-eth-tx:${order.rentalId}`); } catch { tx = null; }
    if (tx) { setNet("ethereum"); setEthBusy(true); }
  }, [ethOffer, order]);
  /** Explorer link for a settled tx on whichever network it landed (Base hex or Solana base58). */
  /** Rails the page offers right now (Solana only when its picker is on, Ethereum only when that rail is on). */
  const usdcNets = [view.chain.name, ...(sol ? [sol.name] : []), ...(ethOffer ? [ethOffer.name] : [])];
  const railsLabel = `USDC on ${usdcNets.length > 1 ? `${usdcNets.slice(0, -1).join(", ")} or ${usdcNets[usdcNets.length - 1]}` : usdcNets[0]}`;
  /** Chain the renter paid on: an Ethereum tx paid here, else the saved choice, else a non-0x tx (Solana), else the picker. Feeds the progress ring. */
  const paidChainName = (o: Order | null, tx: string | null | undefined): string => {
    if (tx && ethOffer && tx === ethPaidTx.current) return ethOffer.name;
    const n = o?.net ?? (tx && !tx.startsWith("0x") ? "solana" : net);
    return n === "solana" && sol ? sol.name : n === "ethereum" && ethOffer ? ethOffer.name : view.chain.name;
  };
  const txUrlFor = (tx: string | null | undefined) => (tx && sol && !tx.startsWith("0x") ? solanaTxLink(sol, tx) : tx && ethOffer && tx === ethPaidTx.current ? txLink(ethOffer.explorer, tx) : txLink(view.chain.explorer, tx));

  // Resume after a reload: unpaid = back to Pay; paid (or maybe paid) = keep collecting the access code.
  useEffect(() => {
    try { sessionStorage.removeItem("gm-rent-order-v1"); } catch { /* ignore */ }
    const saved = readSaved();
    // A payUrl's secret is in the fragment (never sent to the server). Read it once, then strip it
    // from the address bar so it isn't left in history, bookmarks or a shared screenshot.
    const link = parsePayLink(window.location.search, window.location.hash);
    // Next tick, keeping history.state, so Next's router drops #s= too and Back still works (S1).
    scheduleFragmentStrip(window);
    if (link && !(saved && saved.rentalId === link.rentalId)) {
      if (saved && resumePlan(saved, Date.now()) !== "none") setNotice("You have another order in progress on this device. Finish or cancel it first, then open your pay link again.");
      else setAiLink(link);
    }
    const plan = resumePlan(saved, Date.now());
    if (!saved || plan === "none") {
      clearSaved();
      // "Rent now" on /hashrate passes the chosen pack and window (?rigs=2&days=3). Clamp to this page's limits.
      try {
        const q = new URLSearchParams(window.location.search);
        const r = Number(q.get("rigs")), d = Number(q.get("days"));
        if (Number.isInteger(r) && r >= 1) setRigs(Math.min(r, maxRigs));
        if (Number.isInteger(d) && d >= 1) setDays(Math.max(view.minDays, Math.min(d, view.maxDays)));
      } catch { /* ignore */ }
      return;
    }
    setOrder(saved); setRigs(saved.rigs); setDays(saved.days);
    // An order committed to Bitcoin on this device goes back to its QR (its window is the BTC binding's, not payBy).
    if (plan === "pay" || (!saved.paid && btcMarked(saved.rentalId))) setStep(3);
    else { setStep(4); setCollecting({ paidKnown: !!saved.paid, signed: !saved.paid && !!saved.signed, tx: saved.tx ?? null, outcome: "settled" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collect the access code with patient backoff. The saved order is only cleared once the code is in hand.
  useEffect(() => {
    if (!collecting || !order) return;
    let live = true, attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      let status = 0, body: { accessCode?: unknown; status?: unknown; error?: unknown; endsAt?: unknown } | null = null;
      try {
        const r = await fetch("/api/rentals/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rental_id: order.rentalId, creator_secret: order.creatorSecret }) });
        status = r.status; body = await r.json().catch(() => null);
      } catch { status = 0; }
      if (!live) return;
      const st = collectStep(status, body);
      if (st.kind === "done") {
        clearSaved();
        const held = (body as { poolApproval?: unknown } | null)?.poolApproval === "manual" && body?.status === "delivering";
        setDone({ tx: collecting.tx, accessCode: st.code, endsAt: typeof body?.endsAt === "string" ? body.endsAt : null, refund: false, outcome: collecting.outcome, held });
        setCollecting(null); return;
      }
      if (st.kind === "refund") {
        clearSaved();
        setDone({ tx: collecting.tx, accessCode: null, endsAt: null, refund: true, outcome: "refund" });
        setCollecting(null); return;
      }
      if (st.kind === "unpaid" && !collecting.paidKnown && collecting.signed) {
        // We submitted a signed payment but don't know how it ended. Never claim "nothing was
        // charged" and never drop the saved order on our own: past the window + grace we keep
        // checking, show the rental ID and a way to reach us, and only the renter's explicit
        // Dismiss clears it (a settle-then-record_failed payment would otherwise lose the secret).
        setCollectNote(signedUnpaidAction(Date.now(), order.payBy) === "overdue" ? "overdue" : "pending");
        timer = setTimeout(run, collectDelayMs(attempt++)); return;
      }
      if (st.kind === "unpaid" && !collecting.paidKnown) {
        // Server confirmed: unpaid and the window is over (no signed payment from this device).
        clearSaved(); setCollecting(null); setOrder(null); setStep(1);
        setNotice("Your earlier order expired before it was paid. Nothing was charged.");
        return;
      }
      setCollectNote(st.kind === "wait" ? st.note : "pending");
      timer = setTimeout(run, collectDelayMs(attempt++));
    };
    void run();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [collecting, order, retryNow]);

  const firstStep = useRef(true);
  const quoteTracked = useRef(false);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    headingRef.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [step]);

  // Live quote (debounced).
  useEffect(() => {
    if (step !== 1 || soldOut) return;
    let live = true;
    setQuoting(true); setQuoteErr(null);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/rentals/quote?rigs=${rigs}&days=${days}`, { cache: "no-store" });
        const j = await r.json();
        if (!live) return;
        if (r.ok) {
          setQuote(j as Quote);
          // Funnel (no PII): one quote view per page view.
          if (!quoteTracked.current) { quoteTracked.current = true; try { track("rental_quote_viewed", { channel: "web", rigs, days }); } catch { /* ignore */ } }
        } else { setQuote(null); setQuoteErr(orderErrorCopy(j?.error)); }
      } catch { if (live) { setQuote(null); setQuoteErr(orderErrorCopy("pricing_unavailable")); } }
      finally { if (live) setQuoting(false); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [rigs, days, step, soldOut]);

  // Wallet discovery: EIP-6963, then legacy window.ethereum.
  useEffect(() => {
    const found = new Map<string, WalletOpt>();
    const push = () => setWallets([...found.values()]);
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info: { rdns: string; name: string; uuid: string }; provider: Eip1193 }>).detail;
      if (!d?.info || !ALLOWED_RDNS.includes(d.info.rdns)) return;
      const id = d.info.rdns.startsWith("com.coinbase") ? "coinbase" : "metamask";
      if (!found.has(id)) { found.set(id, { id, name: id === "coinbase" ? "Coinbase Wallet" : "MetaMask", provider: d.provider }); push(); }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      const list = eth?.providers?.length ? eth.providers : eth ? [eth] : [];
      for (const p of list) {
        if (p.isCoinbaseWallet && !found.has("coinbase")) found.set("coinbase", { id: "coinbase", name: "Coinbase Wallet", provider: p });
        else if (p.isMetaMask && !p.isCoinbaseWallet && !found.has("metamask")) found.set("metamask", { id: "metamask", name: "MetaMask", provider: p });
      }
      setInjected(!!eth || found.size > 0);
      push(); setDiscovered(true);
    }, 400);
    try { setMobile(isMobileDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)); } catch { /* ignore */ }
    return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); clearTimeout(t); };
  }, []);

  // Solana wallets through the Wallet Standard (only when the rail is on).
  useEffect(() => {
    if (!sol) return;
    return discoverSolanaWallets(sol.walletChain, setSolWallets);
  }, [sol]);

  // Base Account: load the SDK when the Pay step opens (not on click: iOS blocks popups opened after an await).
  useEffect(() => {
    if (step !== 3 || baseAcct) return;
    let live = true;
    const chainId = chainIdFromCaip2(view.chain.network);
    if (chainId == null) return;
    import("@coinbase/wallet-sdk").then(({ createCoinbaseWalletSDK }) => {
      if (!live) return;
      const sdk = createCoinbaseWalletSDK({
        appName: "Galaxy Mind", appLogoUrl: `${window.location.origin}/icon`, appChainIds: [chainId],
        preference: { options: "smartWalletOnly" },
      });
      setBaseAcct({ id: "base", name: "Base Account", note: "passkey, no app needed", provider: sdk.getProvider() as unknown as Eip1193 });
    }).catch(() => { /* the other wallets still work */ });
    return () => { live = false; };
  }, [step, baseAcct, view.chain.network]);

  // Countdown while paying.
  useEffect(() => {
    if (step !== 3) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const payByMs = order ? Date.parse(order.payBy) : 0;
  const btcRail = useBtcRail(order, !!view.btc && days <= (view.btc?.maxDays ?? 7));
  // Held open while Bitcoin owns the window, or while an Ethereum transfer is confirming.
  const expired = step === 3 && !!order && now >= payByMs && phase !== "confirming" && !btcRail.active && !(net === "ethereum" && ethBusy);
  const wrongChain = !!wallet && !!chainId && chainId.toLowerCase() !== view.chain.chainIdHex.toLowerCase();
  const amountAtomic = req ? BigInt(req.amount) : null;
  const lowBalance = balance != null && amountAtomic != null && balance < amountAtomic;

  // Payment request for the order (asset, amount, payTo) from the pay route.
  const loadRequest = useCallback(async (o: Order) => {
    const r = await fetch(`/api/rentals/pay/${o.paymentRef}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    const kind = requestOutcome(r.status, j);
    if (kind === "paid") return { paid: true as const, serverNow: Date.parse(r.headers.get("date") ?? "") || Date.now() };
    // 409 order_not_payable = "order_closed": its own copy with Start over (reload would loop).
    if (kind !== "payable") return { paid: false as const, error: kind };
    const p = pickRequirement(j, { network: view.chain.network, payTo: view.chain.payTo, asset: view.chain.asset });
    if (!p.ok) return { paid: false as const, error: p.error };
    // Solana is optional: a missing or mismatched Solana entry just hides the option (Base still works).
    const s = sol ? pickSolanaRequirement(j, sol, o.rentalId) : null;
    return { paid: false as const, pr: j as PaymentRequiredBody, req: p.req, sol: s?.ok ? s.req : null, serverNow: Date.parse(r.headers.get("date") ?? "") || Date.now() };
  }, [view.chain.network, view.chain.payTo, view.chain.asset, sol]);

  useEffect(() => {
    if (step !== 3 || !order) return;
    let live = true;
    loadRequest(order).then((x) => {
      if (!live) return;
      if ("req" in x && x.req) { setReq(x.req); setSolReq(x.sol ?? null); if (!x.sol) setNet("base"); }
      else if (x.paid) markPaid(order, null, "settled");
      else setProblem(payErrorCopy(x.error));
    }).catch(() => live && setProblem(payErrorCopy("facilitator_unavailable")));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, order?.paymentRef]);

  const refreshBalance = useCallback(async (p: Eip1193, addr: string, asset: string) => {
    try {
      const hex = await p.request({ method: "eth_call", params: [{ to: asset, data: balanceOfData(addr) }, "latest"] });
      setBalance(typeof hex === "string" && /^0x[0-9a-f]*$/i.test(hex) ? BigInt(hex === "0x" ? 0 : hex) : null);
    } catch { setBalance(null); }
  }, []);

  useEffect(() => {
    if (wallet && req && !wrongChain) void refreshBalance(wallet.opt.provider, wallet.address, req.asset);
  }, [wallet, req, wrongChain, refreshBalance]);

  // Follow account and network changes in the wallet.
  useEffect(() => {
    const p = wallet?.opt.provider;
    if (!p?.on) return;
    const onChain = (...a: unknown[]) => setChainId(String(a[0]));
    const onAcc = (...a: unknown[]) => { const l = a[0] as string[]; if (!l?.length) setWallet(null); else setWallet((w) => (w ? { ...w, address: l[0] } : w)); };
    p.on("chainChanged", onChain); p.on("accountsChanged", onAcc);
    return () => { p.removeListener?.("chainChanged", onChain); p.removeListener?.("accountsChanged", onAcc); };
  }, [wallet?.opt]);

  const ensureChain = async (p: Eip1193) => {
    const want = view.chain.chainIdHex;
    const cur = String(await p.request({ method: "eth_chainId" }));
    setChainId(cur);
    if (cur.toLowerCase() === want.toLowerCase()) return true;
    setPhase("switching");
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e) {
      const code = (e as { code?: number; data?: { originalError?: { code?: number } } })?.code ?? (e as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
      if (code !== 4902) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [{
        chainId: want, chainName: view.chain.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [view.chain.rpcUrl], blockExplorerUrls: [view.chain.explorer],
      }] });
    }
    const after = String(await p.request({ method: "eth_chainId" }));
    setChainId(after);
    return after.toLowerCase() === want.toLowerCase();
  };

  const connect = async (opt: WalletOpt) => {
    // Keep a payment-request error (e.g. pinned mismatch) visible while no request is loaded.
    setProblem((p) => (req ? null : p)); setPhase("connecting");
    let connected = false;
    try {
      const accs = (await opt.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.[0]) throw { code: 4001 };
      setWallet({ opt, address: accs[0] }); connected = true;
      await ensureChain(opt.provider);
    } catch (e) {
      const w = walletErrorCopy(e);
      setProblem(connected
        ? { title: "Network not switched", body: `Your wallet is connected but still on another network. Switch it to ${view.chain.name} to pay. Nothing was charged.`, charged: "no" }
        : { title: w.code === "rejected" ? "Wallet not connected" : "Couldn't connect your wallet", body: w.text, charged: "no" });
    } finally { setPhase("idle"); }
  };

  /** Payment is through: save that fact first (a reload resumes collecting), then collect the code. */
  const markPaid = (o: Order, tx: string | null, outcome: string) => {
    const safeTx = safeTxId(tx);
    const paid: Order = { ...o, paid: true, tx: safeTx };
    saveOrder(paid); setOrder(paid);
    setDone(null); setProblem(null); setPhase("idle");
    setCollecting({ paidKnown: true, signed: false, tx: safeTx, outcome }); setStep(4);
  };

  /**
   * After the wallet signed (either network): from here on money may move. Save that first, so a
   * crash, a closed tab or a lost answer resumes into checking, never into "nothing was charged".
   * Never throws.
   */
  const submitSigned = async (o: Order, header: string, payNet: "base" | "solana" = "base") => {   // x402 wallet signs only (Ethereum is a pasted tx hash)
    const signedOrder: Order = { ...o, signed: true, net: payNet };
    saveOrder(signedOrder); setOrder(signedOrder);
    setPhase("confirming");
    let status = 0, body: unknown = null;
    try {
      const r = await fetch(`/api/rentals/pay/${o.paymentRef}`, { method: "POST", headers: { "PAYMENT-SIGNATURE": header } });
      status = r.status; body = await r.json().catch(() => null);
    } catch { status = 0; body = null; }
    const out = payOutcome(status, body);
    // Funnel (review #106 F1): rental_paid fires HERE, client-side, so the event's page is /hashrate/rent
    // (SiteAnalytics beforeSend scrub), never the pay URL with its ref. Coarse props only, through the funnel allow-list
    // (an unknown outcome is dropped, never sent raw).
    if (out.kind === "paid" || out.kind === "refund") { try { track("rental_paid", funnelProps({ channel: "web", rail: payNet, outcome: out.outcome })); } catch { /* ignore */ } }
    if (out.kind === "paid") { markPaid(signedOrder, out.tx, out.outcome); return; }
    if (out.kind === "refund") {
      clearSaved();
      setDone({ tx: safeTxId(out.tx), accessCode: null, endsAt: null, refund: true, outcome: out.outcome }); setPhase("idle"); setStep(4); return;
    }
    if (out.kind === "refused") {
      // Server refused before any money moved: this attempt is over, the order can be paid again.
      const back: Order = { ...o, signed: false };
      saveOrder(back); setOrder(back);
      setPhase("idle");
      setProblem(out.code === "verify_failed" && counterfactualSig.current ? COUNTERFACTUAL_VERIFY_COPY : payErrorCopy(out.code, payNet)); return;
    }
    // Unknown outcome: maybe paid. Check with the server instead of guessing.
    setPhase("idle"); setProblem(null);
    setCollecting({ paidKnown: false, signed: true, tx: null, outcome: "settled" }); setStep(4);
  };

  const connectSol = async (opt: SolanaWalletOpt) => {
    if (!sol) return;
    setProblem((p) => (solReq ? null : p)); setPhase("connecting");
    try { setSolWallet({ opt, account: await connectSolana(opt, sol.walletChain) }); }
    catch (e) { const w = walletErrorCopy(e); setProblem({ title: w.code === "rejected" ? "Wallet not connected" : "Couldn't connect your wallet", body: w.text, charged: "no" }); }
    finally { setPhase("idle"); }
  };

  /** Solana: fresh request (fresh blockhash), build the exact transfer, payer signs, post. */
  const paySol = async () => {
    if (!sol || !solWallet || !order) return;
    setProblem(null);
    counterfactualSig.current = false;
    try {
      if (gate) setPhase("checking");
      const fresh = await loadRequest(order);
      if (fresh.paid) { markPaid(order, null, "settled"); return; }
      if (!("req" in fresh) || !fresh.pr) { setPhase("idle"); setProblem(payErrorCopy(fresh.error, "solana")); return; }
      if (!fresh.sol) { setPhase("idle"); setSolReq(null); setNet("base"); setProblem({ title: "Solana isn't available right now", body: `Pay this order on ${view.chain.name} instead, or try Solana again in a minute. Your wallet wasn't asked to sign anything.`, charged: "no" }); return; }
      setSolReq(fresh.sol);
      setPhase("signing");
      const tx = buildSolanaPayment(fresh.sol, solWallet.account.address);
      const signed = await signSolana(solWallet.opt, solWallet.account, tx, sol.walletChain);
      await submitSigned(order, solanaPaymentHeader(fresh.pr, fresh.sol, signed), "solana");
    } catch (e) {
      // Only reached before a signed transaction exists: nothing was signed or sent.
      setPhase("idle");
      const w = walletErrorCopy(e);
      setProblem({ title: w.code === "rejected" ? "Payment cancelled" : "Your wallet couldn't finish", body: w.text, charged: "no" });
    }
  };

  const pay = async () => {
    if (!wallet || !order) return;
    setProblem(null);
    const p = wallet.opt.provider;
    try {
      if (!(await ensureChain(p))) { setPhase("idle"); setProblem({ title: "Wrong network", body: `Switch your wallet to ${view.chain.name}, then try again. Nothing was charged.`, charged: "no" }); return; }
      if (gate) setPhase("checking");
      const fresh = await loadRequest(order);
      if (fresh.paid) { markPaid(order, null, "settled"); return; }
      if (!("req" in fresh) || !fresh.req || !fresh.pr) { setPhase("idle"); setProblem(payErrorCopy(fresh.error)); return; }
      setReq(fresh.req);
      setPhase("signing");
      const nowSec = Math.floor(fresh.serverNow / 1000);
      const { typedData, authorization } = buildTransferAuthorization(fresh.req, wallet.address, nowSec, randomNonce(), Math.floor(payByMs / 1000));
      const sig = String(await p.request({ method: "eth_signTypedData_v4", params: [wallet.address, JSON.stringify(typedData)] }));
      counterfactualSig.current = isCounterfactualSignature(sig);
      const payload = buildPaymentPayload(fresh.pr, fresh.req, authorization, sig);
      await submitSigned(order, encodePaymentHeader(payload));
      return;
    } catch (e) {
      // Only reached before the signature exists (the post-sign path above never throws out): nothing was signed.
      setPhase("idle");
      const w = walletErrorCopy(e);
      setProblem({ title: w.code === "rejected" ? "Payment cancelled" : "Your wallet couldn't finish", body: w.text, charged: "no" });
    }
  };

  const isOther = poolId === OTHER;
  const pickedPool = view.pools.find((p) => p.id === poolId) ?? null;
  const sig = `${rigs}|${days}|${poolId}|${isOther ? poolUrl.trim() : ""}|${worker.trim()}`;
  const poolMsg = !poolId ? "Choose your pool." : isOther ? customUrlHint(poolUrl) : null;
  const workerMsg = usernameHint(pickedPool?.usernameFormat ?? null, worker);
  const step2Ok = !poolMsg && !workerMsg && terms;

  const placeOrder = async () => {
    if (!step2Ok || placing) return;
    setPlacing(true); setOrderErr(null);
    const k = `gm-rent-idem:${sig}`;
    let key = ""; try { key = sessionStorage.getItem(k) ?? ""; } catch { /* ignore */ }
    if (!key) { key = newKey(); try { sessionStorage.setItem(k, key); } catch { /* ignore */ } }
    try {
      const r = await fetch("/api/rentals/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rigs, days, ...(isOther ? { custom_url: poolUrl.trim() } : { pool_id: poolId }), username: worker.trim(), accept_terms: true, terms_version: view.termsVersion, idempotency_key: key }),
      });
      const j = await r.json().catch(() => ({}));
      const prev = readSaved();
      if (!r.ok) {
        // Already holding an unpaid order from this connection: resume it if this browser has it.
        if (j?.error === "open_order" && prev && resumePlan(prev, Date.now()) === "pay") { setOrder(prev); setReq(null); setProblem(null); setStep(3); return; }
        setOrderErr(orderErrorCopy(j?.error)); return;
      }
      const secret = j.creatorSecret ?? (prev?.rentalId === j.rentalId ? prev?.creatorSecret : undefined);
      if (!secret) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } setOrderErr(orderErrorCopy("idempotency_conflict")); return; }
      const o: Order = { v: 2, rentalId: j.rentalId, paymentRef: j.paymentRef, payBy: j.payBy, totalUsdc: j.totalUsdc, rigs: j.rigs, th: j.th, days: j.days, pool: j.pool, creatorSecret: secret, sig, savedAt: Date.now() };
      saveOrder(o);
      if (j.replay === false) { try { track("rental_order_created", funnelProps({ channel: "web", rigs: o.rigs, days: o.days })); } catch { /* ignore */ } }
      setOrder(o); setReq(null); setProblem(null); setNotice(null); setStep(3);
    } catch { setOrderErr(orderErrorCopy("server_error")); }
    finally { setPlacing(false); }
  };

  const startOver = async (opts?: { closed?: boolean }) => {
    // A paid or maybe-paid order is never dropped before its code is collected.
    if (order && !done && (order.paid || order.signed)) { setStep(4); setCollecting({ paidKnown: !!order.paid, signed: !order.paid, tx: order.tx ?? null, outcome: "settled" }); return; }
    // The server already said this unsigned, unpaid order can't take money (409 order_not_payable
    // on the payment request): there is nothing to cancel, so start a new order straight away.
    if (opts?.closed && order && !done) {
      clearSaved();
      try { sessionStorage.removeItem(`gm-rent-idem:${order.sig}`); } catch { /* ignore */ }
      setOrder(null); setReq(null); setProblem(null); setDone(null); setBalance(null); setCollecting(null); setNotice(null); setStep(1);
      return;
    }
    // Cancel an unpaid order (frees its rigs and this connection's order slot). The saved
    // order is cleared only after the server confirms cancelled:true.
    if (order && !done) {
      let res: "cleared" | "check" | "keep" = "keep";
      try {
        const r = await fetch("/api/rentals/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", rental_id: order.rentalId, creator_secret: order.creatorSecret }) });
        res = cancelResult(r.status, await r.json().catch(() => null));
      } catch { res = "keep"; }
      if (res === "check") { setProblem(null); setStep(4); setCollecting({ paidKnown: false, signed: false, tx: null, outcome: "settled" }); return; }
      if (res === "keep") {
        setProblem({ title: "We couldn't cancel this order yet", body: "Your order is still saved on this device. Check your connection and try again in a moment.", charged: "maybe" });
        return;
      }
    }
    clearSaved();
    try { sessionStorage.removeItem(`gm-rent-idem:${order?.sig ?? sig}`); } catch { /* ignore */ }
    setOrder(null); setReq(null); setProblem(null); setDone(null); setBalance(null); setCollecting(null); setStep(1);
  };

  // An AI-placed order the server confirmed is payable: from here it is the same order as one placed on
  // this page (saved before the wallet opens, SaveBox, signed-before-POST, maybe-paid checking).
  const takeAiOrder = (o0: Order) => {
    const o: Order = { ...o0, fromAi: true };
    saveOrder(o);
    setOrder(o); setRigs(o.rigs); setDays(o.days); setReq(null); setProblem(null); setNotice(null); setAiLink(null); setStep(3);
  };

  const summary = useMemo(() => {
    const r = order?.rigs ?? rigs, d = order?.days ?? days;
    return `${plural(r, "rig", "rigs")} · ${plural(d, "day", "days")} · ${thLabel(r * view.rigTh)}`;
  }, [order, rigs, days, view.rigTh]);

  const priceUsdc = order?.totalUsdc ?? quote?.totalUsdc ?? null;
  const perRigDay = quote && quote.rigs > 0 && quote.days > 0 ? (Number(quote.totalUsdc) / (quote.rigs * quote.days)).toFixed(2) : null;
  // On a phone with no wallet in this browser: reopen checkout inside a wallet app.
  const needsWalletApp = mobile && discovered && wallets.length === 0 && !injected;
  const heading = step === 4
    ? (done ? (done.refund || done.held ? "Payment received" : "You're mining") : collecting?.paidKnown ? "Payment received" : collecting?.signed ? "Confirming your payment" : "Checking your order")
    : step === 1 ? (aiLink ? "Pay the order your AI placed" : "Rent Bitcoin hashrate") : step === 2 ? "Where should your hashrate mine?" : "Review and pay";

  return (
    <div className="mt-2">
      {step === 4 && done && !done.refund && (
        <span aria-hidden className="mb-4 mt-2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/15 text-2xl text-[var(--accent)]">✓</span>
      )}
      <h1 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="night-bench-title scroll-mt-24 outline-none">
        {heading}
      </h1>
      {step === 1 && !aiLink && (
        <p className="night-bench-lede">
          Rent SHA-256 hash power by the day. Point it at your pool and pay with {railsLabel} from your own wallet. It takes about two minutes.
        </p>
      )}
      {view.chain.testnet && step < 4 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-1.5 text-[13px] text-[var(--accent-ink)]">
          <span aria-hidden>●</span> Test mode · {view.chain.name} test USDC, no real money
        </p>
      )}

      {step < 4 && !(step === 1 && aiLink) && <Steps step={step} />}

      {step === 1 && (
        <section aria-labelledby="choose-h" className="mt-6 space-y-4">
          {notice && <p role="status" className={`${card} text-[15px] text-[var(--text-secondary)]`}>{notice}</p>}
          <h2 id="choose-h" className="sr-only">Choose rigs and days</h2>
          {aiLink ? (
            <PayAiOrder rails={railsLabel} initial={aiLink} termsPath={view.termsPath} onOrder={takeAiOrder} onNew={() => setAiLink(null)} />
          ) : soldOut ? (
            <div className={card}>
              <p className="text-[17px] font-semibold text-[var(--text-primary)]">All rigs are booked right now</p>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">Rigs free up as rentals end. Please check back a little later, or ask your AI bot to watch for an opening.</p>
              <a href="/hashrate/agents" className={`${secondary} mt-5 w-full`}>Rent with your AI bot</a>
            </div>
          ) : (
            <>
              <div className={card}>
                <div className="grid grid-cols-2 gap-3 sm:gap-6">
                  <Counter label="Rigs" value={rigs} min={1} max={maxRigs} onChange={setRigs} note={`${view.rigTh} TH/s each`} />
                  <Counter label="Days" value={days} min={view.minDays} max={view.maxDays} onChange={setDays} note={`${view.minDays} to ${view.maxDays} days`} />
                </div>
                <div className="mt-6 border-t border-[var(--nb-hair)] pt-5" aria-live="polite">
                  <p className="micro-label text-[var(--text-tertiary)]">Your price</p>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                    <span className={`font-mono text-5xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)] transition-opacity motion-reduce:transition-none sm:text-6xl ${quoting ? "opacity-40" : ""}`}>
                      ${money(quote?.totalUsdc)}
                    </span>
                    <span className="text-[15px] text-[var(--text-secondary)]">USDC</span>
                  </p>
                  <p className="mt-2 text-[15px] text-[var(--text-primary)]">{summary}</p>
                  {quoteErr ? (
                    <p role="alert" className="mt-3 text-[15px] text-[var(--accent-ink)]">{quoteErr}</p>
                  ) : (
                    <p className="mt-1 text-[14px] text-[var(--text-tertiary)]">
                      {perRigDay ? `$${perRigDay} per rig per day · ` : view.price ? `$${money(view.price.perRigDayUsdc)} per rig per day · ` : ""}{days * 24} hours of mining, starting once your payment confirms
                    </p>
                  )}
                </div>
              </div>
              {needsWalletApp && (
                <OpenInWalletApp url={handoffUrl(window.location.origin, { rigs, days })}
                  lead="You can pay right here with a Base Account passkey on the last step. Or, to use MetaMask or the wallet in your Base app, open this checkout in that app. Your rigs and days come with you." />
              )}
              <button type="button" className={primary} disabled={!quote || quoting} onClick={() => setStep(2)}>
                Continue
              </button>
              <TrustLine termsPath={view.termsPath} rails={railsLabel} />
              <button type="button" className={`${quiet} mx-auto block`} onClick={() => setAiLink({ rentalId: "", secret: null })}>
                Did your AI already place an order? Pay it here
              </button>
            </>
          )}
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="pool-h" className="mt-6 space-y-4">
          <div className={card}>
            <h2 id="pool-h" className="sr-only">Pool details</h2>
            <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">Everything your rigs find goes straight to your own pool account. Copy the details from your pool&apos;s setup page.</p>
            <fieldset className="mt-5" aria-describedby="pool-help">
              <legend className={label}>Pool</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-invalid={touched.pool && !!poolMsg}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTouched((t) => ({ ...t, pool: true })); }}>
                {view.pools.map((p) => (
                  <PoolOption key={p.id} id={p.id} name={p.name} checked={poolId === p.id}
                    onPick={() => { setPoolId(p.id); setTouched((t) => ({ ...t, pool: false })); }} />
                ))}
                <PoolOption id={OTHER} name="Another pool…" checked={isOther} wide
                  onPick={() => { setPoolId(OTHER); setTouched((t) => ({ ...t, pool: false })); }} />
              </div>
            </fieldset>
            {isOther && (
              <>
                <label htmlFor="pool-url" className={`${label} mt-4`}>Pool address</label>
                <input id="pool-url" className={`${field} mt-2`} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                  placeholder="stratum.example.com:3333" value={poolUrl} maxLength={300}
                  onChange={(e) => setPoolUrl(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, pool: true }))}
                  aria-invalid={touched.pool && !!poolMsg} aria-describedby="pool-help" />
              </>
            )}
            <div id="pool-help" className="mt-3 space-y-2 text-[14px]">
              {touched.pool && poolMsg && <p className="text-[var(--accent-ink)]">{poolMsg}</p>}
              {pickedPool && <p className="break-all font-mono text-[13px] text-[var(--text-tertiary)]">{pickedPool.name} · {pickedPool.endpoint}</p>}
              {pickedPool?.note && (
                <div role="note" className="rounded-lg border border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/60 px-4 py-3 leading-relaxed text-[var(--text-secondary)]">
                  <p className="micro-label text-[var(--accent-ink)]">Good to know</p>
                  <p className="mt-1.5">{pickedPool.note}</p>
                </div>
              )}
              {isOther
                ? <p className="rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-4 py-3 leading-relaxed text-[var(--text-primary)]">{HELD_COPY}</p>
                : pickedPool && <p className="text-[var(--text-tertiary)]">Pools on this list start right after payment.</p>}
            </div>
            <label htmlFor="worker" className={`${label} mt-6`}>Username</label>
            <input id="worker" className={`${field} mt-2`} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={pickedPool?.usernameFormat === "btc_address[.worker]" ? "bc1q…yourpayoutaddress.rig1" : "yourname.rig1"} value={worker} maxLength={64}
              onChange={(e) => setWorker(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, worker: true }))}
              aria-invalid={touched.worker && !!workerMsg} aria-describedby="worker-help" />
            <p id="worker-help" className={`mt-2 text-[14px] leading-relaxed ${touched.worker && workerMsg ? "text-[var(--accent-ink)]" : "text-[var(--text-tertiary)]"}`}>
              {touched.worker && workerMsg ? workerMsg : pickedPool ? `For ${pickedPool.name}, use ${pickedPool.usernameHelp}. No password needed.` : "Your pool username or payout address, often followed by a dot and a rig name. No password needed."}
            </p>
            <label className="mt-6 flex min-h-[44px] cursor-pointer items-start gap-3 border-t border-[var(--nb-hair)] pt-5">
              <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className={`mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)] ${ring}`} />
              <span className="text-[15px] text-[var(--text-secondary)]">
                I&apos;ve read and accept the{" "}
                <a href={view.termsPath} target="_blank" rel="noopener" className="text-[var(--accent-ink)] underline underline-offset-2">Rental Terms</a>.
              </span>
            </label>
          </div>
          <OrderLine summary={summary} price={quote?.totalUsdc ?? null} />
          {orderErr && <p role="alert" className="rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-4 py-3 text-[15px] text-[var(--text-primary)]">{orderErr}</p>}
          <button type="button" className={primary} disabled={!step2Ok || placing}
            onClick={() => { setTouched({ pool: true, worker: true }); void placeOrder(); }}>
            {placing ? <Spinner label="Holding your price" /> : "Continue to payment"}
          </button>
          <button type="button" className={`${quiet} mx-auto block`} onClick={() => setStep(1)}>← Back to rigs and days</button>
        </section>
      )}

      {step === 3 && order && (
        <section aria-labelledby="pay-h" className="mt-6 space-y-4">
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="pay-h" className="micro-label text-[var(--text-tertiary)]">You pay</h2>
              {!btcRail.active && <p className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] ${expired ? "border-[var(--nb-hair-2)] text-[var(--text-tertiary)]" : "border-[var(--accent)]/35 text-[var(--accent-ink)]"}`}>
                <span>Price held</span>
                <span className="font-mono tabular-nums" role="timer" aria-label="Time left to pay">{countdown(payByMs, now)}</span>
              </p>}
            </div>
            {btcRail.active ? <p className="mt-2 text-[15px] text-[var(--text-secondary)]">Bitcoin, on-chain. The exact amount is below.</p> : <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-5xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">${net === "ethereum" && ethOffer ? (ethAmount ?? "…") : money(priceUsdc)}</span>
              <span className="text-[15px] text-[var(--text-secondary)]">USDC on {net === "solana" && sol ? sol.name : net === "ethereum" && ethOffer ? ethOffer.name : view.chain.name}</span>
            </p>}
            <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-[var(--nb-hair)] pt-4 text-[14px]">
              <dt className="text-[var(--text-tertiary)]">Order</dt><dd className="text-right text-[var(--text-primary)]">{summary}</dd>
              <dt className="text-[var(--text-tertiary)]">Pool</dt><dd className="truncate text-right font-mono text-[var(--text-primary)]">{order.pool.host}:{order.pool.port}</dd>
              <dt className="text-[var(--text-tertiary)]">Username</dt><dd className="truncate text-right font-mono text-[var(--text-primary)]">{order.pool.worker}</dd>
            </dl>
            {order.fromAi && (
              <div data-ai-pool-check className="mt-4 rounded-lg border border-[var(--accent)]/45 bg-[var(--accent)]/10 px-4 py-4">
                <p className="text-[16px] font-semibold leading-snug text-[var(--text-primary)]">{AI_POOL_CHECK_COPY}</p>
                <dl className="mt-3 space-y-2">
                  <div><dt className="micro-label text-[var(--text-tertiary)]">Pool</dt><dd className="mt-0.5 break-all font-mono text-[17px] font-semibold text-[var(--text-primary)]">{order.pool.host}:{order.pool.port}</dd></div>
                  <div><dt className="micro-label text-[var(--text-tertiary)]">Username</dt><dd className="mt-0.5 break-all font-mono text-[17px] font-semibold text-[var(--text-primary)]">{order.pool.worker}</dd></div>
                </dl>
                <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">{AI_POOL_CHECK_WHY}</p>
              </div>
            )}
            {order.pool.approval === "manual" && <p className="mt-4 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-4 py-3 text-[14px] leading-relaxed text-[var(--text-primary)]">{HELD_COPY}</p>}
          </div>

          {/* Shown before the wallet signs: the only way back to the code if this page is lost mid-payment. */}
          {!expired && <SaveBox order={order} beforePay />}

          {/* An Ethereum transfer that is confirming locks the order to Ethereum: no switch to Bitcoin (the server refuses too). */}
          {btcRail.showPicker && !expired && phase === "idle" && !ethBusy && (
            <RailPicker value={btcRail.rail} onPick={(r) => { btcRail.setRail(r); setProblem(null); }} />
          )}

          {!expired && ((sol && solReq) || ethOffer) && !btcRail.active && (
            <NetworkPicker value={net} disabled={phase !== "idle" || ethBusy} onPick={(n) => { setNet(n); setProblem(null); }}
              options={[{ id: "base", name: view.chain.name, note: "MetaMask, Coinbase, Base" },
                ...(sol && solReq ? [{ id: "solana" as const, name: sol.name, note: "Phantom, Solflare, Backpack" }] : []),
                ...(ethOffer ? [{ id: "ethereum" as const, name: ethOffer.name, note: ETH_COPY.pickerNote }] : [])]} />
          )}

          {btcRail.active ? (
            <PayWithBitcoin order={order} siteKey={view.btc?.siteKey ?? null} committed={btcRail.committed} onCommit={btcRail.commit}
              onSettled={() => markPaid(order, null, "settled")} onUseUsdc={() => btcRail.setRail("usdc")} />
          ) : expired ? (
            <div className={card}>
              <p className="text-[17px] font-semibold text-[var(--text-primary)]">This price has expired</p>
              <p className="mt-2 text-[15px] text-[var(--text-secondary)]">Prices are held for 15 minutes and this one ran out before you paid. Start again for a fresh price.</p>
              <button type="button" className={`${primary} mt-5`} onClick={() => void startOver()}>Get a fresh price</button>
            </div>
          ) : net === "ethereum" && ethOffer ? (
            <PayWithEthereum order={order} offer={ethOffer} onBusy={setEthBusy} onSettled={(tx) => { ethPaidTx.current = tx; markPaid(order, tx, "settled"); }} onUseOther={() => { setNet("base"); setProblem(null); }} onQuote={setEthAmount} />
          ) : net === "solana" && sol && solReq ? (
            <div className={card} data-solana-pay>
              {!solWallet ? (
                <>
                  <p className="text-[17px] font-semibold text-[var(--text-primary)]">Connect a Solana wallet</p>
                  <p className="mt-1 text-[14px] text-[var(--text-secondary)]">Use a wallet that holds at least ${money(priceUsdc)} USDC on {sol.name}. You don&apos;t need SOL: the network fee is covered.</p>
                  {solWallets.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {solWallets.map((w, i) => (
                        <button key={w.id} type="button" data-sol-wallet={w.id} className={i === 0 ? primary : `${secondary} w-full`} disabled={phase !== "idle"} onClick={() => void connectSol(w)}>
                          {phase === "connecting" ? <Spinner label="Opening your wallet" /> : <>{w.icon && <img src={w.icon} alt="" width={20} height={20} className="h-5 w-5 rounded" />}Connect {w.name}</>}
                        </button>
                      ))}
                    </div>
                  ) : mobile ? (
                    <div className="mt-4 space-y-4">
                      <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">Your phone&apos;s browser doesn&apos;t have a Solana wallet inside it, so finish paying in the browser inside Phantom or Solflare. Copy your rental secret first. Your price stays held.</p>
                      <CopyRow label="1 · Copy your rental secret" value={order.creatorSecret} />
                      {(() => { const u = handoffUrl(window.location.origin, { pay: order.rentalId }); return u ? <CopyRow label="2 · Copy your order link" value={u} /> : null; })()}
                      <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)]">3 · In your wallet app, open its browser and go to that link. Paste the secret where it asks, then tap Find my order and pay.</p>
                      <p data-paste-only-here className="text-[13px] font-semibold leading-relaxed text-[var(--text-primary)]">Only paste your rental secret on galaxymind.space.</p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/60 p-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">
                      <p className="font-semibold text-[var(--text-primary)]">No Solana wallet found in this browser</p>
                      <p className="mt-1">Install{" "}
                        <a className="text-[var(--accent-ink)] underline underline-offset-2" href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Phantom</a>{" "}or{" "}
                        <a className="text-[var(--accent-ink)] underline underline-offset-2" href="https://solflare.com/download" target="_blank" rel="noopener noreferrer">Solflare</a>, then reload this page. Or pay on {view.chain.name} instead.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] text-[var(--text-secondary)]">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden />
                      {solWallet.opt.name} · <span className="font-mono text-[var(--text-primary)]">{short(solWallet.account.address)}</span>
                    </p>
                    <button type="button" className={`${quiet} px-2 text-[13px]`} disabled={phase !== "idle"} onClick={() => setSolWallet(null)}>Change</button>
                  </div>
                  {order.fromAi && (
                    <p data-ai-pool-confirm className="mt-4 rounded-lg border border-[var(--accent)]/35 px-3 py-2.5 text-[14px] leading-relaxed text-[var(--text-primary)]">
                      {AI_POOL_CHECK_COPY} Mining to <span className="break-all font-mono font-semibold">{order.pool.host}:{order.pool.port}</span> as <span className="break-all font-mono font-semibold">{order.pool.worker}</span>.
                    </p>
                  )}
                  <button type="button" className={`${primary} mt-4`} disabled={phase !== "idle"} onClick={() => void paySol()}>
                    {phase === "checking" ? <Spinner label="Checking your rigs are still free" />
                      : phase === "signing" ? <Spinner label="Approve in your wallet" />
                      : phase === "confirming" ? <Spinner label={`Confirming on ${sol.name}`} />
                      : <>Pay ${money(priceUsdc)} USDC</>}
                  </button>
                  {phase === "confirming" || phase === "checking"
                    ? <div className="mt-4"><GlowProgress title={phase === "checking" ? "Checking your rigs" : "Confirming your payment"} steps={PAY_STEPS(sol.name, gate)} active={phase === "checking" ? 0 : off + 1} note="This usually takes a few seconds. Please keep this page open." /></div>
                    : <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{`Your wallet asks you to approve one USDC transfer for exactly this amount, tagged with your rental ID ${order.rentalId}. There is no network fee to pay.`}</p>}
                </>
              )}
            </div>
          ) : !wallet ? (
            <div className={card}>
              <p className="text-[17px] font-semibold text-[var(--text-primary)]">Connect your wallet</p>
              <p className="mt-1 text-[14px] text-[var(--text-secondary)]">Use a wallet that holds at least ${money(priceUsdc)} USDC on {view.chain.name}.</p>
              {baseAcct && (
                <div className="mt-4">
                  <button type="button" data-wallet="base" className={primary} disabled={phase !== "idle"} onClick={() => void connect(baseAcct)}>
                    {phase === "connecting" ? <Spinner label="Opening your wallet" /> : <>Pay with Base Account</>}
                  </button>
                  <p className="mt-2 text-center text-[13px] leading-relaxed text-[var(--text-tertiary)]">
                    Sign in with your passkey in a Coinbase window. Works in any browser, no app needed. Base app wallets work here too.
                  </p>
                </div>
              )}
              {wallets.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {baseAcct && <p className="micro-label text-center text-[var(--text-tertiary)]">or use the wallet in this browser</p>}
                  {wallets.map((w) => (
                    <button key={w.id} type="button" className={baseAcct ? `${secondary} w-full` : primary} disabled={phase !== "idle"} onClick={() => void connect(w)}>
                      {phase === "connecting" ? <Spinner label="Opening your wallet" /> : <>Connect {w.name}</>}
                    </button>
                  ))}
                </div>
              ) : needsWalletApp ? (
                <div className="mt-4 space-y-4">
                  <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
                    {baseAcct ? "Rather use MetaMask or the wallet in your Base app? " : ""}Your phone&apos;s browser doesn&apos;t have a wallet inside it, so finish paying in your wallet app. Copy your rental secret first. Then open your order in the app and paste the secret there. Your price stays held.
                  </p>
                  <CopyRow label="1 · Copy your rental secret" value={order.creatorSecret} />
                  <OpenInWalletApp step="2 · Open your order in" url={handoffUrl(window.location.origin, { pay: order.rentalId })} />
                  <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)]">3 · Paste the secret where it asks, then tap Find my order and pay.</p>
                  <p data-paste-only-here className="text-[13px] font-semibold leading-relaxed text-[var(--text-primary)]">Only paste your rental secret on galaxymind.space.</p>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/60 p-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">
                  <p className="font-semibold text-[var(--text-primary)]">No wallet found in this browser</p>
                  <p className="mt-1">On a computer, install{" "}
                    <a className="text-[var(--accent-ink)] underline underline-offset-2" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">MetaMask</a>{" "}or{" "}
                    <a className="text-[var(--accent-ink)] underline underline-offset-2" href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noopener noreferrer">Coinbase Wallet</a>, then reload this page.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className={card}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] text-[var(--text-secondary)]">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden />
                  {wallet.opt.name} · <span className="font-mono text-[var(--text-primary)]">{short(wallet.address)}</span>
                </p>
                <button type="button" className={`${quiet} px-2 text-[13px]`} onClick={() => { setWallet(null); setBalance(null); setChainId(null); }}>Change</button>
              </div>
              {wrongChain ? (
                <div className="mt-4">
                  <p className="text-[15px] text-[var(--text-primary)]">Your wallet is on a different network.</p>
                  <button type="button" className={`${primary} mt-4`} disabled={phase !== "idle"} onClick={async () => { try { await ensureChain(wallet.opt.provider); } catch (e) { setProblem({ title: "Network not switched", body: walletErrorCopy(e).text, charged: "no" }); } finally { setPhase("idle"); } }}>
                    {phase === "switching" ? <Spinner label="Switching" /> : `Switch to ${view.chain.name}`}
                  </button>
                </div>
              ) : (
                <>
                  {balance != null && (
                    <p className={`mt-3 text-[14px] ${lowBalance ? "text-[var(--accent-ink)]" : "text-[var(--text-tertiary)]"}`}>
                      {lowBalance
                        ? `This wallet has ${usdcDisplay(balance.toString())} USDC on ${view.chain.name}. This rental needs ${req ? usdcDisplay(req.amount) : money(priceUsdc)}. Add USDC or switch wallets.`
                        : `Balance: ${usdcDisplay(balance.toString())} USDC on ${view.chain.name}`}
                    </p>
                  )}
                  {order.fromAi && (
                    <p data-ai-pool-confirm className="mt-4 rounded-lg border border-[var(--accent)]/35 px-3 py-2.5 text-[14px] leading-relaxed text-[var(--text-primary)]">
                      {AI_POOL_CHECK_COPY} Mining to <span className="break-all font-mono font-semibold">{order.pool.host}:{order.pool.port}</span> as <span className="break-all font-mono font-semibold">{order.pool.worker}</span>.
                    </p>
                  )}
                  <button type="button" className={`${primary} mt-4`} disabled={phase !== "idle" || !req || lowBalance} onClick={() => void pay()}>
                    {phase === "checking" ? <Spinner label="Checking your rigs are still free" />
                      : phase === "signing" ? <Spinner label="Approve in your wallet" />
                      : phase === "confirming" ? <Spinner label={`Confirming on ${view.chain.name}`} />
                      : phase === "switching" ? <Spinner label="Switching network" />
                      : <>Pay ${money(priceUsdc)} USDC</>}
                  </button>
                  {phase === "confirming" || phase === "checking"
                    ? <div className="mt-4"><GlowProgress title={phase === "checking" ? "Checking your rigs" : "Confirming your payment"} steps={PAY_STEPS(view.chain.name, gate)} active={phase === "checking" ? 0 : off + 1} note="This usually takes 10 to 20 seconds. Please keep this page open." /></div>
                    : <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">Your wallet asks you to approve one USDC transfer for exactly this amount. There is no network fee to pay.</p>}
                </>
              )}
            </div>
          )}

          {/* Desktop only: hand the same order to a phone wallet. The QR holds the rental ID only. */}
          {!expired && !wallet && !solWallet && phase === "idle" && <PhonePayQr rentalId={order.rentalId} />}

          {problem && <ProblemNote p={problem} rentalId={order.rentalId} support={support} onRestart={problem.action === "start_over" ? () => void startOver({ closed: true }) : problem.charged === "no" && /start|fresh/i.test(problem.body) ? () => void startOver() : undefined} />}
          {!expired && phase === "idle" && (
            <button type="button" className={`${quiet} mx-auto block`} onClick={() => void startOver()}>
              Cancel and start over
            </button>
          )}
        </section>
      )}

      {step === 4 && !done && collecting && order && (
        <Collecting order={order} chain={paidChainName(order, collecting.tx)} gate={gate} support={support} paidKnown={collecting.paidKnown} signed={collecting.signed} note={collectNote} txUrl={txUrlFor(collecting.tx)} onRetry={() => setRetryNow((n) => n + 1)}
          onDismiss={collecting.signed && !collecting.paidKnown && collectNote === "overdue" ? () => {
            // Only an explicit renter action clears a signed, maybe-paid order.
            const id = order.rentalId;
            clearSaved(); setCollecting(null); setOrder(null); setReq(null); setProblem(null); setStep(1);
            setNotice(`We removed order ${id} from this device. If your wallet shows a USDC transfer to Galaxy Mind, email ${support.email} with that rental ID and we'll sort it out.`);
          } : undefined} />
      )}
      {step === 4 && done && order && <Success done={done} order={order} summary={summary} txUrl={txUrlFor(done.tx)} />}

      <CheckRental support={support} />
      <SupportLine support={support} className="mt-6" />
    </div>
  );
}

const explorerName = (u: string) => (u.startsWith("https://solscan.io/") ? "Solscan" : /^https:\/\/(sepolia\.)?etherscan\.io\//.test(u) ? "Etherscan" : "BaseScan");

/** Frosted-glass segmented picker: which network to pay on. Ethereum shows only once that rail exists. */
function NetworkPicker({ value, options, onPick, disabled }: { value: PayNet; options: { id: PayNet; name: string; note: string }[]; onPick: (n: PayNet) => void; disabled: boolean }) {
  return (
    <div className="rent-glass rounded-2xl p-1.5" role="radiogroup" aria-label="Pay with USDC on">
      <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} disabled={disabled} data-network={o.id} onClick={() => onPick(o.id)}
              className={`min-h-[56px] rounded-xl px-3 py-2 text-left transition-colors motion-reduce:transition-none disabled:opacity-60 ${ring} ${on ? "border border-[var(--accent)]/55 bg-[var(--accent)]/15 text-[var(--text-primary)]" : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--nb-surface)]"}`}>
              <span className="block text-[15px] font-semibold">{o.name}</span>
              <span className="block text-[12px] text-[var(--text-tertiary)]">{o.note}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const items = ["Choose", "Pool", "Pay"];
  return (
    <ol className="mt-6 flex items-center gap-2 sm:gap-3" aria-label="Checkout steps">
      {items.map((t, i) => {
        const n = i + 1, on = n === step, past = n < step;
        return (
          <li key={t} aria-current={on ? "step" : undefined} className={`flex min-w-0 items-center gap-2 sm:gap-3 ${n < items.length ? "flex-1" : "shrink-0"}`}>
            <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[13px] tabular-nums ${past ? "border-[var(--accent)] bg-[var(--accent)] text-black" : on ? "border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--accent-ink)]" : "border-[var(--nb-hair-2)] bg-[var(--nb-surface)] text-[var(--text-tertiary)]"}`}>
              {past ? "✓" : n}
            </span>
            <span className={`text-[14px] ${on ? "font-semibold text-[var(--text-primary)]" : past ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}>
              {t}<span className="sr-only">{past ? " (done)" : on ? " (current step)" : ""}</span>
            </span>
            {n < items.length && <span aria-hidden className={`h-px min-w-3 flex-1 ${past ? "bg-[var(--accent)]/60" : "bg-[var(--nb-hair-2)]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function Counter({ label: name, value, min, max, onChange, note }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; note: string }) {
  const id = `ctr-${name.toLowerCase()}`;
  const btn = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--nb-hair-2)] bg-[var(--nb-surface)] text-2xl text-[var(--text-primary)] transition-colors motion-reduce:transition-none hover:border-[var(--accent)]/50 disabled:opacity-30 sm:h-12 sm:w-12 ${ring}`;
  return (
    <div>
      <p id={id} className="micro-label text-[var(--text-tertiary)]">{name}</p>
      <div className="mt-3 flex items-center justify-between gap-2" role="group" aria-labelledby={id}>
        <button type="button" aria-label={`Fewer ${name.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>−</button>
        <output aria-live="polite" className="font-mono text-4xl font-semibold tabular-nums text-[var(--text-primary)]">{value}</output>
        <button type="button" aria-label={`More ${name.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>+</button>
      </div>
      <p className="mt-2 text-center text-[13px] text-[var(--text-tertiary)]">{note}</p>
    </div>
  );
}

function PoolOption({ id, name, checked, onPick, wide = false }: { id: string; name: string; checked: boolean; onPick: () => void; wide?: boolean }) {
  return (
    <label data-pool={id} className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 transition-colors motion-reduce:transition-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] ${wide ? "col-span-2 sm:col-span-3" : ""} ${checked ? "border-[var(--accent)]/60 bg-[var(--nb-surface-active)]" : "border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/40 hover:border-[var(--accent)]/35"}`}>
      <input type="radio" name="pool" value={id} checked={checked} onChange={onPick} className="sr-only" />
      <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-[var(--accent)]" : "border-[var(--text-tertiary)]/60"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
      </span>
      <span className={`min-w-0 truncate text-[14px] ${checked ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>{name}</span>
    </label>
  );
}

const AI_PAY_ERRORS: Record<string, string> = {
  not_found: "We couldn't find that order. Check the rental ID and secret your AI gave you and try again.",
  invalid_input: "That rental ID or secret doesn't look right. Copy them again from your AI's message.",
  rate_limited: "Too many tries. Please wait a minute and try again.",
  rentals_paused: "Rentals are paused for a moment, so payments are on hold. Please try again shortly.",
};

/** Pay an order an AI placed with create_rental. Shows nothing about the order until the server accepts the secret. */
function PayAiOrder({ initial, termsPath, rails, onOrder, onNew }: { initial: { rentalId: string; secret: string | null }; termsPath: string; rails: string; onOrder: (o: Order) => void; onNew: () => void }) {
  const [rid, setRid] = useState(initial.rentalId);
  const [secret, setSecret] = useState(initial.secret ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const ready = RENTAL_ID_RE.test(rid.trim()) && CREATOR_SECRET_RE.test(secret.trim());
  const lookup = useCallback(async (r: string, sec: string) => {
    setBusy(true); setMsg(null); setCode(null);
    let status = 0, body: unknown = null;
    try {
      const res = await fetch("/api/rentals/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pay", rental_id: r, creator_secret: sec }) });
      status = res.status; body = await res.json().catch(() => null);
    } catch { status = 0; }
    const out = payLookup(status, body, sec, Date.now());
    setBusy(false);
    if (out.kind === "pay") { onOrder(out.order); return; }
    if (out.kind === "not_payable") { setMsg(notPayableCopy(out.status)); setCode(out.accessCode); return; }
    setMsg(AI_PAY_ERRORS[out.error] ?? "We couldn't load that order right now. Please try again.");
  }, [onOrder]);
  // Opened from a pay link with both parts: look it up straight away.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !initial.secret || !RENTAL_ID_RE.test(initial.rentalId)) return;
    auto.current = true;
    void lookup(initial.rentalId, initial.secret);
  }, [initial, lookup]);
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Your AI (Grok Bot, Claude, ChatGPT or another) placed the order. You pay it here from your own wallet with {rails}. Paste the rental ID and secret it gave you, or open the pay link it sent.
        </p>
        {initial.rentalId && !initial.secret && (
          <p data-paste-secret-note className="mt-3 text-[15px] leading-relaxed text-[var(--text-primary)]">
            Started this order on your computer or in your phone&apos;s browser? Paste the rental secret from its Save this box, then tap Find my order. Only paste your rental secret on galaxymind.space.
          </p>
        )}
        <label htmlFor="ai-rid" className={`${label} mt-5`}>Rental ID</label>
        <input id="ai-rid" autoComplete="off" className={`${field} mt-2`} value={rid} onChange={(e) => setRid(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="gm_…" maxLength={24} />
        <label htmlFor="ai-secret" className={`${label} mt-4`}>Rental secret</label>
        <input id="ai-secret" autoComplete="off" type="password" className={`${field} mt-2`} value={secret} onChange={(e) => setSecret(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Paste the creatorSecret" maxLength={64} />
        <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">The secret works like a password. It stays in this browser and is only sent to us to find your order.</p>
        {msg && <p role="status" className="mt-4 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-4 py-3 text-[15px] leading-relaxed text-[var(--text-primary)]">{msg}</p>}
        {code && <div className="mt-4"><CopyRow label="Your access code" value={code} /></div>}
        <button type="button" className={`${primary} mt-5`} disabled={!ready || busy} onClick={() => void lookup(rid.trim(), secret.trim())}>
          {busy ? <Spinner label="Finding your order" /> : "Find my order"}
        </button>
      </div>
      <p className="text-center text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        By paying you agree to the{" "}
        <a href={termsPath} target="_blank" rel="noopener" className="text-[var(--text-secondary)] underline underline-offset-2">Rental Terms</a>. Your AI accepted them when it placed the order.
      </p>
      <button type="button" className={`${quiet} mx-auto block`} onClick={onNew}>Rent new rigs here instead</button>
    </div>
  );
}

/** Links that reopen this checkout inside a wallet app's browser (phones only). */
function OpenInWalletApp({ url, lead, step }: { url: string | null; lead?: string; step?: string }) {
  const links = url ? walletAppLinks(url) : [];
  if (!links.length) return null;
  return (
    <div data-open-in-wallet className={step ? "" : card}>
      {lead && (
        <>
          <p className="text-[16px] font-semibold text-[var(--text-primary)]">Paying from your phone</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-secondary)]">{lead}</p>
        </>
      )}
      {step && <p className="micro-label text-[var(--text-tertiary)]">{step}</p>}
      <div className={`grid grid-cols-2 gap-2 ${step ? "mt-1.5" : "mt-4"}`}>
        {links.map((l) => (
          <a key={l.id} href={l.href} rel="noopener noreferrer" referrerPolicy="no-referrer" className={`${secondary} w-full`}>{l.name}</a>
        ))}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        {"Don't have either? Any phone wallet with a built-in browser works: open galaxymind.space/hashrate/rent there."}
      </p>
    </div>
  );
}

/**
 * "Pay on your phone": a QR of /hashrate/rent?pay=<rentalId>, drawn here with the bundled qrcode
 * package (lazy chunk, data: URL, no image service). No secret, no address: the phone opens the
 * normal checkout and the renter pastes the secret there. Shown on desktops and tablets at md and up
 * (re-checked on resize); on phones qrcode is never imported (gated in code, not just CSS).
 */
function PhonePayQr({ rentalId }: { rentalId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Desktop or tablet, wide viewport only. Checked on mount AND whenever the md breakpoint is
    // crossed (window resized, tablet rotated), so a window that starts narrow still gets the QR
    // once widened. On a phone qrcode is never imported: the dynamic import sits behind this check.
    let live = true;
    let started = false;
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)") : null;
    const check = () => {
      if (started || !live) return;
      let want = false;
      try { want = wantsPhoneQr(navigator.userAgent, navigator.maxTouchPoints ?? 0, mq ? mq.matches : true); } catch { want = false; }
      if (!want) return;
      const u = phonePayUrl(window.location.origin, rentalId);
      setUrl(u);
      if (!u) return;
      started = true;
      import("qrcode").then((QR) => QR.toDataURL(u, { width: 440, margin: 2, errorCorrectionLevel: "M", color: { dark: "#12110F", light: "#FFFFFF" } }))
        .then((d) => { if (live) setSrc(d); }).catch(() => { /* the copyable link below still works */ });
    };
    check();
    mq?.addEventListener?.("change", check);
    return () => { live = false; mq?.removeEventListener?.("change", check); };
  }, [rentalId]);
  if (!url) return null;
  return (
    <div data-phone-pay-qr className={`${card} hidden md:flex md:items-center md:gap-6`}>
      <div className="shrink-0 rounded-xl border border-[var(--nb-hair-2)] bg-white p-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        {src
          ? <img src={src} alt="QR code that opens this order on your phone" width={176} height={176} className="block h-44 w-44" />
          : <span aria-hidden className="block h-44 w-44 animate-pulse rounded bg-black/5 motion-reduce:animate-none" />}
      </div>
      <div className="min-w-0">
        <p className="micro-label text-[var(--accent-ink)]">Pay on your phone</p>
        <p className="mt-2 text-[17px] font-semibold text-[var(--text-primary)]">Scan with your phone&apos;s camera</p>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">
          It opens this same order on your phone, where you can pay with a phone wallet. You&apos;ll paste your rental secret there, from the Save this box on the computer or tablet where you started. The code holds only your rental ID, never the secret.
        </p>
        <p className="mt-3 break-all font-mono text-[12px] text-[var(--text-tertiary)]">{url.replace(/^https?:\/\//, "")}</p>
        <p data-paste-only-here className="mt-3 text-[13px] font-semibold leading-relaxed text-[var(--text-primary)]">Only paste your rental secret on galaxymind.space.</p>
      </div>
    </div>
  );
}

function TrustLine({ termsPath, rails }: { termsPath: string; rails: string }) {
  return (
    <div className="space-y-2 text-center text-[13px] leading-relaxed text-[var(--text-tertiary)]">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span>US-based rigs</span><span aria-hidden>·</span>
        <span>Pay with {rails}</span><span aria-hidden>·</span>
        <span>Price held 15 minutes</span>
      </p>
      <p>
        If we can&apos;t start your rental or end it early, you&apos;re refunded for the time you didn&apos;t get.{" "}
        <a href={termsPath} target="_blank" rel="noopener" className="text-[var(--text-secondary)] underline underline-offset-2">Rental Terms</a>
      </p>
    </div>
  );
}

function OrderLine({ summary, price }: { summary: string; price: string | null }) {
  return (
    <div className="rent-glass flex items-center justify-between gap-3 rounded-xl px-5 py-4">
      <span className="text-[14px] text-[var(--text-secondary)]">{summary}</span>
      <span className="font-mono text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">${money(price)}</span>
    </div>
  );
}

function Spinner({ label: text }: { label: string }) {
  return (
    <>
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black motion-reduce:animate-none" />
      <span>{text}…</span>
    </>
  );
}

function ProblemNote({ p, rentalId, onRestart, support }: { p: Problem; rentalId: string; onRestart?: () => void; support: SupportInfo }) {
  return (
    <div role="alert" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-5">
      <p className="text-[16px] font-semibold text-[var(--text-primary)]">{p.title}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-secondary)]">{p.body}</p>
      {p.charged === "maybe" && (
        <p className="mt-3 text-[14px] text-[var(--text-secondary)]">
          Rental ID <span className="font-mono text-[var(--text-primary)]">{rentalId}</span> · email{" "}
          <a href={`mailto:${support.email}`} className="text-[var(--accent-ink)] underline underline-offset-2">{support.email}</a>.
        </p>
      )}
      {onRestart && <button type="button" className={`${secondary} mt-4`} onClick={onRestart}>{p.action === "start_over" ? "Start over" : "Start again"}</button>}
    </div>
  );
}

function CopyRow({ label: name, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="micro-label text-[var(--text-tertiary)]">{name}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/70 px-3 py-2.5 font-mono text-[15px] text-[var(--text-primary)]">{value}</code>
        <button type="button" className={`${secondary} min-w-[84px] shrink-0`} aria-label={`Copy ${name}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function SaveBox({ order, beforePay = false }: { order: Order; beforePay?: boolean }) {
  return (
    <div className={cardAccent}>
      <p className="flex items-center gap-2 micro-label text-[var(--accent-ink)]">
        Save this{beforePay ? " before you pay" : ""}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">
        If this page is ever lost, these two get your access code back through Check a rental below. Copy them somewhere safe and keep the secret private, like a password.
      </p>
      <div className="mt-4 space-y-3">
        <CopyRow label="Rental ID" value={order.rentalId} />
        <CopyRow label="Rental secret" value={order.creatorSecret} />
      </div>
    </div>
  );
}

function Collecting({ order, chain, gate = false, support, paidKnown, signed, note, txUrl, onRetry, onDismiss }: { order: Order; chain: string; gate?: boolean; support: SupportInfo; paidKnown: boolean; signed: boolean; note: "pending" | "paused" | "busy" | "overdue"; txUrl: string | null; onRetry: () => void; onDismiss?: () => void }) {
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const overdue = signed && !paidKnown && note === "overdue";
  const status = overdue
    ? "We still haven't seen your payment arrive. If your wallet shows a USDC transfer to Galaxy Mind, it may just need a little longer, or we may need to look into it by hand. Please don't pay again. We'll keep checking, and your order stays saved on this device until you dismiss it."
    : signed && !paidKnown
    ? "We couldn't confirm your payment straight away, so we're checking whether it went through. Please don't pay again. This can take a few minutes."
    : note === "paused"
    ? "Rentals are paused for a moment, so we can't hand out codes right now. Your order is saved and we'll keep trying."
    : note === "busy"
      ? "Our server is busy. We'll keep trying, a little more slowly."
      : paidKnown ? "This usually takes under a minute. We'll keep trying until it's ready." : "We're checking whether a payment arrived for your earlier order.";
  return (
    <section className="mt-5 space-y-4" aria-live="polite">
      <GlowProgress
        title={paidKnown ? "Reserving your rigs" : signed ? "Confirming your payment" : "Checking your order"}
        steps={PAY_STEPS(chain, gate)}
        active={(gate ? 1 : 0) + (paidKnown ? 2 : signed ? 1 : 0)}
        slowAfterSec={90}
        slowCopy={`This is taking longer than usual. Your order is saved on this device and we keep checking. Please don't pay again. Questions: ${support.email}`}
      />
      <div className={card}>
        <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">{status}</p>
        <p className="mt-2 text-[14px] text-[var(--text-tertiary)]">You can close this tab and come back on this device. We&apos;ll pick up where you left off.</p>
        {overdue && (
          <p className="mt-3 text-[14px] text-[var(--text-secondary)]">
            Rental ID <span className="font-mono text-[var(--text-primary)]">{order.rentalId}</span> · email{" "}
            <a href={`mailto:${support.email}`} className="text-[var(--accent-ink)] underline underline-offset-2">{support.email}</a>{" "}
            with it if you were charged.
          </p>
        )}
        <button type="button" className={`${secondary} mt-4 w-full`} onClick={onRetry}>Check again now</button>
        {onDismiss && (confirmDismiss ? (
          <div className="mt-4 rounded-lg border border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/60 p-4">
            <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
              Dismissing removes this order and its saved details from this device. If a payment did go through, you&apos;ll need both the rental ID and the rental secret shown below to collect your code or reach us. Save both first.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className={`${secondary} flex-1`} onClick={onDismiss}>Yes, dismiss this order</button>
              <button type="button" className={`${secondary} flex-1`} onClick={() => setConfirmDismiss(false)}>Keep it</button>
            </div>
          </div>
        ) : (
          <button type="button" className={`${quiet} mx-auto mt-3 block`} onClick={() => setConfirmDismiss(true)}>
            Dismiss this order
          </button>
        ))}
      </div>
      <SaveBox order={order} />
      {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" className={`${secondary} w-full`}>View payment on {explorerName(txUrl)} ↗</a>}
    </section>
  );
}

function Success({ done, order, summary, txUrl }: { done: Done; order: Order; summary: string; txUrl: string | null }) {
  const [copied, setCopied] = useState(false);
  if (done.refund) {
    return (
      <section className="mt-6 space-y-4">
        <div className={card}>
          <p className="text-[17px] font-semibold text-[var(--text-primary)]">We couldn&apos;t start this rental</p>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">
            We couldn&apos;t start your rigs. A full refund to the same wallet is queued and reviewed by hand. You don&apos;t need to do anything.
          </p>
          <p className="mt-3 text-[14px] text-[var(--text-secondary)]">Rental ID <span className="font-mono text-[var(--text-primary)]">{order.rentalId}</span></p>
          {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" className={`${secondary} mt-4 w-full`}>View payment on {explorerName(txUrl)} ↗</a>}
        </div>
      </section>
    );
  }
  return (
    <section className="mt-4 space-y-4" aria-live="polite">
      <p className="night-bench-lede !mt-2">
        {done.held
          ? "Payment received. We're waiting for owner approval of your pool, which can take up to 2 hours. If it isn't approved, your payment is refunded in full. Once it's approved, your rigs switch to your pool and the full rental time starts then."
          : "Payment received. Your rigs are switching to your pool now and should show up there within a few minutes."}
      </p>
      <div className={cardAccent}>
        <p className="micro-label text-[var(--accent-ink)]">Your access code</p>
        {done.accessCode ? (
          <>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/70 px-4 py-3 font-mono text-[17px] text-[var(--text-primary)]">{done.accessCode}</code>
              <button type="button" className={`${secondary} min-w-[96px]`} onClick={async () => { try { await navigator.clipboard.writeText(done.accessCode!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-primary)]">
              <strong>Save this code now.</strong>{" "}It&apos;s how you check on your rental, and we can&apos;t show it again. Treat it like a password.
            </p>
          </>
        ) : (
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Your payment is confirmed and we&apos;re still preparing your code. Keep this page open and reload in a minute. Your rental ID is{" "}
            <span className="font-mono text-[var(--text-primary)]">{order.rentalId}</span>.
          </p>
        )}
      </div>
      <div className={card}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px]">
          <dt className="text-[var(--text-tertiary)]">Order</dt><dd className="text-right text-[var(--text-primary)]">{summary}</dd>
          <dt className="text-[var(--text-tertiary)]">Paid</dt><dd className="text-right font-mono text-[var(--text-primary)]">${money(order.totalUsdc)} USDC</dd>
          {done.endsAt && (<><dt className="text-[var(--text-tertiary)]">Ends</dt><dd className="text-right text-[var(--text-primary)]">{new Date(done.endsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd></>)}
          <dt className="text-[var(--text-tertiary)]">Rental ID</dt><dd className="text-right font-mono text-[var(--text-primary)]">{order.rentalId}</dd>
        </dl>
        <p className="mt-4 border-t border-[var(--nb-hair)] pt-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">
          Your pool dashboard shows the hashrate arriving. To see your rental&apos;s status and end time here, paste your access code into Check a rental below. Any AI bot connected to Galaxy Mind can check it for you too.
        </p>
        {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" className={`${secondary} mt-4 w-full`}>View payment on {explorerName(txUrl)} ↗</a>}
      </div>
    </section>
  );
}

function CheckRental({ support }: { support: SupportInfo }) {
  const [mode, setMode] = useState<"code" | "secret">("code");
  const [code, setCode] = useState("");
  const [rid, setRid] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string; code?: string } | null>(null);
  const LABEL: Record<string, string> = { awaiting_payment: "Waiting for payment", paid: "Paid, starting", delivering: "Switching to your pool", active: "Mining", completed: "Finished", failed: "Stopped early", expired: "Expired before payment", refund_pending: "Refund queued", expired_unapplied: "Couldn't start · full refund queued", offline: "Offline" };
  const ready = mode === "code" ? code.trim().length >= 22 : /^gm_[A-Za-z0-9_-]{8,20}$/.test(rid.trim()) && secret.trim().length > 10;
  const check = async () => {
    setBusy(true); setRes(null);
    try {
      const body = mode === "code" ? { access_code: code.trim() } : { rental_id: rid.trim(), creator_secret: secret.trim() };
      const r = await fetch("/api/rentals/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) setRes({ ok: false, text: j?.error === "rate_limited" ? "Too many checks. Please wait a minute." : j?.error === "rentals_paused" ? "Rentals are paused for a moment. Please try again shortly." : j?.error === "code_expired" ? "That access code has expired." : j?.error === "upstream_unavailable" ? "Status is unavailable right now. Please try again shortly." : `We couldn't find a rental with those details. Need help? ${support.email}` });
      else setRes({ ok: true, code: typeof j.accessCode === "string" ? j.accessCode : undefined, text: `${LABEL[j.status] ?? j.status}${j.rigs ? ` · ${plural(j.rigs, "rig", "rigs")}` : ""}${typeof j.deliveredTh === "number" ? ` · ${j.deliveredTh.toLocaleString("en-US")} TH/s delivered` : ""}${j.endsAt ? ` · ends ${new Date(j.endsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}` });
    } catch { setRes({ ok: false, text: "We couldn't check right now. Please try again." }); }
    finally { setBusy(false); }
  };
  return (
    <details className="rent-glass group mt-10 rounded-xl px-5 py-1">
      <summary className={`flex min-h-[52px] cursor-pointer list-none items-center justify-between rounded text-[15px] text-[var(--text-primary)] marker:content-none [&::-webkit-details-marker]:hidden ${ring}`}>
        <span>Check a rental <span className="text-[var(--text-tertiary)]">· already rented?</span></span>
        <span aria-hidden className="font-mono text-[var(--text-tertiary)] transition-transform motion-reduce:transition-none group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-3 pb-5">
        {mode === "code" ? (
          <>
            <label htmlFor="code" className={label}>Access code</label>
            <input id="code" className={field} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Paste your code" />
          </>
        ) : (
          <>
            <label htmlFor="rid" className={label}>Rental ID</label>
            <input id="rid" autoComplete="off" className={field} value={rid} onChange={(e) => setRid(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="gm_…" />
            <label htmlFor="secret" className={label}>Rental secret</label>
            <input id="secret" autoComplete="off" className={field} value={secret} onChange={(e) => setSecret(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Paste your secret" />
          </>
        )}
        <button type="button" className={`${secondary} w-full`} disabled={busy || !ready} onClick={() => void check()}>{busy ? "Checking…" : mode === "code" ? "Check" : "Get my access code"}</button>
        <button type="button" className={`${quiet} px-0`} onClick={() => { setMode(mode === "code" ? "secret" : "code"); setRes(null); }}>
          {mode === "code" ? "No access code yet? Use your rental ID and secret" : "I have an access code"}
        </button>
        {res && <p role="status" className={`text-[15px] ${res.ok ? "text-[var(--text-primary)]" : "text-[var(--accent-ink)]"}`}>{res.text}</p>}
        {res?.code && <CopyRow label="Your access code" value={res.code} />}
      </div>
    </details>
  );
}
