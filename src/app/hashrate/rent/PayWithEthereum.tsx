"use client";
/**
 * USDC on Ethereum (direct transfer), the Pay step's third network. Human checkout only.
 * 1) bind: the server reserves this order's exact amount (price + unique cents) and shows the address.
 * 2) The customer sends that exact USDC amount on Ethereum (from a browser wallet here, or any wallet / exchange) and
 *    pays the gas themselves.
 * 3) The tx hash is claimed (automatically when sent from this page, or pasted), then polled while Ethereum finalizes it,
 *    under a glowing progress ring. Nothing here moves money on its own and no secret leaves the saved order.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedOrder } from "@/lib/rentals/phase2/human-wallet";
import type { EthOffer } from "@/lib/rentals/phase2/eth/service";
import { ETH_COPY, ethErrorCopy, erc20TransferData, etherscanTx } from "@/lib/rentals/phase2/eth/client";

type Quote = { paymentRef: string; network: string; name: string; chainIdHex: string; asset: string; payTo: string; amountAtomic: string; amountUsdc: string; amountUsdc6: string; priceUsdc: string; tagUsdc: string; payBy: string; explorer: string; testnet: boolean };
type Claim = { txHash: string; state: "not_seen_yet" | "checking" | "confirming" | "settled" | "dropped" | "failed_onchain" | "lost_race" } | null;
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const txKey = (rid: string) => `gm-rent-eth-tx:${rid}`;
const btn = "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black lit-primary disabled:cursor-not-allowed disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const btn2 = "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[var(--nb-hair-2)] bg-[var(--nb-surface)] px-5 text-[15px] text-[var(--text-primary)] hover:border-[var(--accent)]/45 disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; j: Record<string, unknown> }> {
  try {
    const r = await fetch("/api/rentals/eth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return { ok: r.ok, status: r.status, j: ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch { return { ok: false, status: 0, j: {} }; }
}

export function PayWithEthereum({ order, offer, onSettled, onBusy, onUseOther, onQuote }: { order: SavedOrder; offer: EthOffer; onSettled: (tx: string) => void; onBusy: (busy: boolean) => void; onUseOther: () => void; onQuote?: (amountUsdc: string | null) => void }) {
  const who = { rental_id: order.rentalId, creator_secret: order.creatorSecret };
  const [quote, setQuote] = useState<Quote | null>(null);
  const [claim, setClaim] = useState<Claim>(null);
  const [problem, setProblem] = useState<ReturnType<typeof ethErrorCopy> | null>(null);
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState<null | "binding" | "sending" | "claiming">("binding");
  const [hasWallet, setHasWallet] = useState(false);
  const settledRef = useRef(false);

  const submit = useCallback(async (tx: string) => {
    setBusy("claiming"); setProblem(null);
    const r = await call({ action: "claim", ...who, tx_hash: tx });
    setBusy(null);
    if (!r.ok) { setProblem(ethErrorCopy(String(r.j.error ?? ""))); return; }
    try { localStorage.setItem(txKey(order.rentalId), tx); } catch { /* ignore */ }
    setClaim((r.j.claim as Claim) ?? { txHash: tx, state: "not_seen_yet" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.rentalId, order.creatorSecret]);

  // Reserve (or re-read) this order's exact amount once.
  useEffect(() => {
    let live = true;
    setHasWallet(typeof window !== "undefined" && !!(window as unknown as { ethereum?: Eip1193 }).ethereum);
    (async () => {
      // An existing quote first (status is free and works with the rail switched off); bind only when there is none.
      const st = await call({ action: "status", ...who });
      const r = st.ok && st.j.quote ? st : await call({ action: "bind", ...who });
      if (!live) return;
      setBusy(null);
      if (!r.ok || !r.j.quote) { setProblem(ethErrorCopy(String(r.j.error ?? ""))); return; }
      setQuote(r.j.quote as Quote);
      onQuote?.((r.j.quote as Quote).amountUsdc);
      let saved: string | null = null;
      try { saved = localStorage.getItem(txKey(order.rentalId)); } catch { saved = null; }
      if (saved) void submit(saved);
    })();
    return () => { live = false; onQuote?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.rentalId]);

  const inFlight = !!claim && (claim.state === "not_seen_yet" || claim.state === "checking" || claim.state === "confirming");
  useEffect(() => { onBusy(inFlight); }, [inFlight, onBusy]);

  // Poll while a claim is in flight. Not yet seen = re-claim (the tx may be mined now); confirming = status.
  useEffect(() => {
    if (!claim || !inFlight) return;
    const t = setTimeout(async () => {
      if (claim.state === "not_seen_yet" || claim.state === "checking") { await submit(claim.txHash); return; }
      const r = await call({ action: "status", ...who });
      if (r.ok && r.j.claim) setClaim(r.j.claim as Claim);
    }, claim.state === "confirming" ? 8_000 : 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim, inFlight, submit]);

  useEffect(() => {
    if (claim?.state === "settled" && !settledRef.current) { settledRef.current = true; try { localStorage.removeItem(txKey(order.rentalId)); } catch { /* ignore */ } onSettled(claim.txHash); }
  }, [claim, onSettled, order.rentalId]);

  /** Optional: send from a browser wallet (MetaMask, Coinbase Wallet, Rabby). The hash is claimed automatically. */
  const sendFromWallet = async () => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth || !quote) return;
    setBusy("sending"); setProblem(null);
    try {
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: quote.chainIdHex }] });
      const chain = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
      if (chain !== quote.chainIdHex) { setBusy(null); setProblem({ title: `Switch your wallet to ${quote.name}`, body: "Your wallet is on another network, so nothing was sent. Switch it and try again.", charged: "no" }); return; }
      const tx = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: quote.asset, data: erc20TransferData(quote.payTo, quote.amountAtomic) }] })) as string;
      setBusy(null);
      await submit(String(tx).toLowerCase());
    } catch {
      setBusy(null);
      setProblem({ title: "The wallet didn't send it", body: "Nothing was sent from this page. You can try again, or send the exact amount from any wallet and paste the hash below.", charged: "no" });
    }
  };

  if (claim && (inFlight || claim.state === "settled")) {
    const confirming = claim.state === "confirming" || claim.state === "settled";
    return (
      <div className="rent-glass rounded-xl p-6 text-center" data-eth-wait aria-live="polite">
        <div className="relative mx-auto h-28 w-28" aria-hidden>
          <span className="absolute inset-0 rounded-full border-2 border-[var(--accent)]/20" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] [animation-duration:1.6s] shadow-[0_0_28px_var(--accent)] motion-reduce:animate-none" />
          <span className="absolute inset-4 animate-pulse rounded-full bg-[var(--accent)]/10 blur-md motion-reduce:animate-none" />
        </div>
        <p className="mt-5 text-[18px] font-semibold text-[var(--text-primary)]">{confirming ? ETH_COPY.confirmingTitle : ETH_COPY.waitingTitle}</p>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--text-secondary)]">{confirming ? ETH_COPY.confirmingBody : ETH_COPY.waitingBody}</p>
        <a className="mt-4 inline-block break-all font-mono text-[13px] text-[var(--accent-ink)] underline underline-offset-2" href={etherscanTx(offer.explorer, claim.txHash)} target="_blank" rel="noopener noreferrer">View on Etherscan</a>
      </div>
    );
  }

  return (
    <div className="rent-glass rounded-xl p-5 sm:p-6" data-eth-pay>
      {busy === "binding" && !quote ? (
        <p className="text-[15px] text-[var(--text-secondary)]">Getting your exact Ethereum amount…</p>
      ) : quote ? (
        <>
          <p className="micro-label text-[var(--text-tertiary)]">Send exactly</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-4xl font-semibold tabular-nums text-[var(--text-primary)]">{quote.amountUsdc}</span>
            <span className="text-[15px] text-[var(--text-secondary)]">USDC on {quote.name}</span>
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">{ETH_COPY.tagNote} That is ${quote.priceUsdc} plus {quote.tagUsdc}.</p>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">{ETH_COPY.gasNote}</p>
          <div className="mt-4">
            <p className="micro-label text-[var(--text-tertiary)]">To this address</p>
            <code className="mt-1.5 block break-all rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/70 px-3 py-2.5 font-mono text-[15px] text-[var(--text-primary)]">{quote.payTo}</code>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btn2} onClick={() => { void navigator.clipboard?.writeText(quote.payTo).catch(() => {}); }}>Copy address</button>
              <button type="button" className={btn2} onClick={() => { void navigator.clipboard?.writeText(quote.amountUsdc).catch(() => {}); }}>Copy amount</button>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{ETH_COPY.exchangeNote} Token contract {quote.asset}.</p>
          {hasWallet && (
            <button type="button" className={`${btn} mt-5`} disabled={busy !== null} onClick={() => void sendFromWallet()}>
              {busy === "sending" ? "Waiting for your wallet…" : "Send with my browser wallet"}
            </button>
          )}
          <form className="mt-5" onSubmit={(ev) => { ev.preventDefault(); void submit(hash.trim()); }}>
            <label htmlFor="eth-tx" className="micro-label block text-[var(--text-tertiary)]">Already sent it? Paste the transaction hash</label>
            <input id="eth-tx" value={hash} onChange={(ev) => setHash(ev.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off"
              className="mt-1.5 min-h-[52px] w-full rounded-lg border border-[var(--nb-hair-2)] bg-[var(--bg-elevated-2)]/70 px-4 font-mono text-[15px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
            <button type="submit" className={`${btn2} mt-3 w-full`} disabled={busy !== null || !hash.trim()}>{busy === "claiming" ? "Checking…" : "Check my payment"}</button>
          </form>
        </>
      ) : null}
      {problem && (
        <div role="alert" className="mt-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-4">
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">{problem.title}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">{problem.body}</p>
          {problem.charged === "maybe" && <p className="mt-2 text-[13px] text-[var(--text-secondary)]">Rental ID <span className="font-mono text-[var(--text-primary)]">{order.rentalId}</span></p>}
        </div>
      )}
      {!claim && <button type="button" className="mt-4 min-h-[44px] w-full text-[14px] text-[var(--text-tertiary)] underline underline-offset-2" onClick={onUseOther}>Pay on another network instead</button>}
    </div>
  );
}
