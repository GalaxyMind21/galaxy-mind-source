"use client";
// "Pay with Bitcoin" (on-chain) for the Pay step. Self-contained: Turnstile check -> binding -> the payment agent
// signs a fresh address (glowing ring while it works, about 5 s) -> the server re-derives and verifies it -> QR.
// The address is never built or trusted in the browser: it comes only from /api/rentals/btc/status after the
// server's checks. Once an address is shown, this order is Bitcoin-only (onCommit).
import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

type View = {
  state: "attesting" | "pay" | "window_closed" | "underpaid" | "confirming" | "paid" | "paused_refund" | "refund" | "unavailable";
  rentalId: string; amountSats?: number; requiredConfs?: number; quoteExpiresAt?: string; address?: string; bip21?: string;
  shortfall?: { amountSats: number }; receivedSats?: { amountSats: number }; message?: string; stale?: boolean; abandoned?: boolean;
};
type Props = {
  order: { rentalId: string; creatorSecret: string };
  siteKey: string | null;
  committed: boolean;
  onCommit: () => void;
  /** Money is in (or a refund is queued): continue to the access-code step, which shows either outcome. */
  onSettled: () => void;
  /** Back to USDC (only before an address was shown). */
  onUseUsdc: () => void;
};

const ring = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]";
const card = "rent-glass rounded-xl p-5 sm:p-6";
const primary = `inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-black lit-primary transition-opacity motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45 ${ring}`;
const secondary = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[var(--nb-hair-2)] bg-[var(--nb-surface)] px-5 text-[15px] text-[var(--text-primary)] transition-colors motion-reduce:transition-none hover:border-[var(--accent)]/45 disabled:opacity-45 ${ring}`;
const btc = (sats: number) => (sats / 1e8).toFixed(8);
const UNAVAILABLE = "Bitcoin is temporarily unavailable. Pay with USDC, or try Bitcoin again in a few minutes.";
const ATTEST_BUDGET_MS = 6000;

async function post(path: string, body: unknown): Promise<{ status: number; body: (View & { error?: string; message?: string }) | null }> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch { return { status: 0, body: null }; }
}

export function PayWithBitcoin({ order, siteKey, committed, onCommit, onSettled, onUseUsdc }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tsReady, setTsReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState<string | null>(null);
  const tsBox = useRef<HTMLDivElement | null>(null);
  const tsId = useRef<string | null>(null);
  const attestStart = useRef<number | null>(null);
  const creds = { rental_id: order.rentalId, creator_secret: order.creatorSecret };

  // Resume: an order already committed to Bitcoin (or a binding in flight) skips the check.
  useEffect(() => {
    let live = true;
    void post("/api/rentals/btc/status", creds).then((r) => { if (live && r.status === 200 && r.body && r.body.state !== "unavailable") setView(r.body); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.rentalId]);

  // Turnstile, only when a new binding is needed.
  const needCheck = !view && !committed && !!siteKey;
  useEffect(() => { if (typeof window !== "undefined" && window.turnstile) setTsReady(true); }, []);
  useEffect(() => {
    if (!needCheck || !tsReady || !tsBox.current || !window.turnstile || tsId.current || !siteKey) return;
    tsId.current = window.turnstile.render(tsBox.current, {
      sitekey: siteKey, theme: "dark", size: "flexible",
      callback: (t) => setToken(t), "error-callback": () => setToken(null), "expired-callback": () => setToken(null),
    });
  }, [needCheck, tsReady, siteKey]);

  // Token in hand -> create the binding.
  useEffect(() => {
    if (!token || view) return;
    let live = true;
    void post("/api/rentals/btc/bind", { ...creds, turnstile_token: token }).then((r) => {
      if (!live) return;
      if (r.status === 200 && r.body) { attestStart.current = Date.now(); setView(r.body); return; }
      setToken(null); tsId.current && window.turnstile?.reset(tsId.current);
      setError(r.body?.message ?? (r.status === 429 ? "Too many Bitcoin requests. Try again later or pay with USDC." : UNAVAILABLE));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Poll: fast while the address is being prepared, slower while waiting for the payment.
  const refresh = useCallback(async (abandon = false) => {
    const r = await post("/api/rentals/btc/status", { ...creds, ...(abandon ? { abandon: true } : {}) });
    if (r.status === 200 && r.body) setView(r.body);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.rentalId]);
  useEffect(() => {
    if (!view) return;
    const s = view.state;
    if (s === "unavailable" || s === "paid" || s === "refund" || s === "paused_refund") return;
    if (s === "attesting") {
      const started = attestStart.current ?? (attestStart.current = Date.now());
      const t = setTimeout(() => {
        // Past the budget: release it so USDC works again, and say so plainly.
        if (Date.now() - started > ATTEST_BUDGET_MS) void refresh(true).then(() => setError(UNAVAILABLE));
        else void refresh();
      }, 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => void refresh(), 8000);
    return () => clearTimeout(t);
  }, [view, refresh]);

  // Address shown = Bitcoin-only from here (a reload comes back to this QR).
  useEffect(() => { if (view?.address && !committed) onCommit(); }, [view?.address, committed, onCommit]);
  useEffect(() => { if (view?.state === "paid") { const t = setTimeout(onSettled, 1600); return () => clearTimeout(t); } }, [view?.state, onSettled]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // QR for whatever the renter should pay now (full amount, or the shortfall).
  useEffect(() => {
    let live = true;
    const uri = view?.bip21;
    if (!uri) { setQr(null); return; }
    void import("qrcode").then((Q) => Q.toDataURL(uri, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#0b0b10", light: "#f5f3ee" } }))
      .then((u) => { if (live) setQr(u); }).catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [view?.bip21]);

  const left = view?.quoteExpiresAt ? Math.max(0, Date.parse(view.quoteExpiresAt) - now) : 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  if (error && (!view || view.state === "unavailable" || view.state === "attesting")) {
    return (
      <div className={card} data-btc-pay="unavailable">
        <p className="text-[17px] font-semibold text-[var(--text-primary)]">Bitcoin isn&apos;t available right now</p>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">{error}</p>
        {!committed && <button type="button" className={`${primary} mt-5`} onClick={onUseUsdc}>Pay with USDC</button>}
      </div>
    );
  }

  if (!view) {
    return (
      <div className={card} data-btc-pay="check">
        <p className="text-[17px] font-semibold text-[var(--text-primary)]">Pay with Bitcoin</p>
        <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">One quick check, then we prepare a payment address just for this order.</p>
        {siteKey ? (
          <>
            {!tsReady && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="lazyOnload" onLoad={() => setTsReady(true)} onReady={() => setTsReady(true)} />}
            <div ref={tsBox} className="mt-4 min-h-[65px]" />
            {token && <GlowWait label="Holding your Bitcoin price" />}
          </>
        ) : <GlowWait label="Checking your order" />}
        <button type="button" className={`${secondary} mt-4 w-full`} onClick={onUseUsdc}>Pay with USDC instead</button>
      </div>
    );
  }

  const s = view.state;
  if (s === "attesting") {
    return (
      <div className={card} data-btc-pay="attesting" aria-live="polite">
        <GlowWait big label="Preparing your payment address" sub="A fresh address is being signed for this order. This takes a few seconds." />
      </div>
    );
  }
  if (s === "unavailable") {
    return (
      <div className={card} data-btc-pay="unavailable">
        <p className="text-[17px] font-semibold text-[var(--text-primary)]">Bitcoin isn&apos;t available right now</p>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">{view.message ?? UNAVAILABLE}</p>
        {!committed && <button type="button" className={`${primary} mt-5`} onClick={onUseUsdc}>Pay with USDC</button>}
      </div>
    );
  }
  if (s === "paid") {
    return (
      <div className={card} data-btc-pay="paid" aria-live="polite">
        <GlowWait big done label="Payment received" sub="Switching your rigs now. Your access code is next." />
      </div>
    );
  }
  if (s === "refund" || s === "paused_refund") {
    return (
      <div className={card} data-btc-pay={s}>
        <p className="text-[17px] font-semibold text-[var(--text-primary)]">{s === "paused_refund" ? "Rentals are paused" : "Refund pending"}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">{view.message}</p>
        {view.address && <AddrRow address={view.address} />}
        <p className="mt-3 text-[14px] text-[var(--text-tertiary)]">Rental ID <span className="font-mono text-[var(--text-primary)]">{order.rentalId}</span></p>
        <button type="button" className={`${secondary} mt-4 w-full`} onClick={onSettled}>Check my rental</button>
      </div>
    );
  }
  if (s === "confirming") {
    return (
      <div className={card} data-btc-pay="confirming" aria-live="polite">
        <GlowWait big label="Payment seen" sub={view.message ?? "Waiting for confirmations. Do not send again."} />
        {view.address && <AddrRow address={view.address} />}
      </div>
    );
  }
  if (s === "window_closed") {
    return (
      <div className={card} data-btc-pay="window_closed">
        <p className="text-[17px] font-semibold text-[var(--text-primary)]">Payment window closed</p>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">{view.message}</p>
        {view.address && <AddrRow address={view.address} />}
        {view.stale && <p className="mt-3 text-[14px] text-[var(--text-tertiary)]">Waiting for the network. This page updates on its own.</p>}
      </div>
    );
  }
  // pay / underpaid
  const sats = s === "underpaid" ? view.shortfall?.amountSats ?? 0 : view.amountSats ?? 0;
  return (
    <div className={card} data-btc-pay={s}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="micro-label text-[var(--text-tertiary)]">{s === "underpaid" ? "Send the rest" : "Send exactly"}</p>
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/35 px-3 py-1 text-[13px] text-[var(--accent-ink)]">
          <span>Address valid</span><span className="font-mono tabular-nums" role="timer" aria-label="Time left to send">{mmss}</span>
        </p>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)] sm:text-5xl">{btc(sats)}</span>
        <span className="text-[15px] text-[var(--text-secondary)]">BTC</span>
      </p>
      <p className="mt-1 font-mono text-[13px] tabular-nums text-[var(--text-tertiary)]">{sats.toLocaleString("en-US")} sats</p>
      <div className="mt-5 grid items-center gap-5 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div className="relative mx-auto w-full max-w-[240px]">
          <div aria-hidden className="absolute -inset-2 rounded-2xl bg-[var(--accent)]/20 blur-xl motion-reduce:hidden" />
          <div className="relative rounded-2xl border border-[var(--nb-hair-2)] bg-[#f5f3ee] p-3 shadow-[0_0_40px_-10px_var(--accent)]">
            {qr ? <img src={qr} alt="Bitcoin payment QR code" width={216} height={216} className="h-auto w-full" />
              : <div className="flex aspect-square items-center justify-center"><GlowWait label="Drawing QR" /></div>}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          {view.address && <AddrRow address={view.address} />}
          <CopyLine name="Amount (BTC)" value={btc(sats)} />
          {view.bip21 && <a href={view.bip21} className={`${primary}`}>Open in wallet</a>}
        </div>
      </div>
      <ul className="mt-5 space-y-1.5 border-t border-[var(--nb-hair)] pt-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">
        <li>Send the exact amount in one payment, on the Bitcoin network only.</li>
        <li>Your rigs switch after {view.requiredConfs === 2 ? "2 confirmations" : "1 confirmation"}. This page updates on its own.</li>
        {s === "underpaid" && view.receivedSats && <li>Received so far: <span className="font-mono">{btc(view.receivedSats.amountSats)} BTC</span>.</li>}
      </ul>
      {view.stale && <p className="mt-3 text-[13px] text-[var(--text-tertiary)]">Waiting for the network. Your payment is safe and will show here once it&apos;s confirmed.</p>}
    </div>
  );
}

function AddrRow({ address }: { address: string }) {
  return <CopyLine name="Address" value={address} mono />;
}

function CopyLine({ name, value, mono = true }: { name: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="micro-label text-[var(--text-tertiary)]">{name}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className={`min-w-0 flex-1 break-all rounded-lg border border-[var(--nb-hair)] bg-[var(--bg-elevated-2)]/70 px-3 py-2.5 text-[14px] text-[var(--text-primary)] ${mono ? "font-mono" : ""}`}>{value}</code>
        <button type="button" className={`${secondary} min-w-[84px] shrink-0`} aria-label={`Copy ${name}`}
          onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Spinning glowing ring: the renter can see work is happening (never a frozen screen). */
function GlowWait({ label, sub, big = false, done = false }: { label: string; sub?: string; big?: boolean; done?: boolean }) {
  const size = big ? 88 : 22;
  return (
    <div className={`flex ${big ? "flex-col py-6 text-center" : "mt-3 items-center gap-3"} items-center`} role="status">
      <span aria-hidden className="relative inline-block shrink-0" style={{ width: size, height: size }}>
        <span className="absolute inset-0 rounded-full blur-md motion-reduce:hidden" style={{ background: "conic-gradient(from 0deg, transparent, var(--accent), transparent 70%)", opacity: 0.55 }} />
        <span className={`absolute inset-0 rounded-full ${done ? "" : "animate-spin motion-reduce:animate-none"}`}
          style={{ background: done ? "var(--accent)" : "conic-gradient(from 0deg, transparent 0 25%, var(--accent) 75%, #fff 100%)", WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${big ? 5 : 3}px), #000 calc(100% - ${big ? 5 : 3}px))`, mask: `radial-gradient(farthest-side, transparent calc(100% - ${big ? 5 : 3}px), #000 calc(100% - ${big ? 5 : 3}px))`, animationDuration: "1.1s" }} />
        {done && <span className="absolute inset-0 flex items-center justify-center text-[28px] font-semibold text-[var(--accent-ink)]">✓</span>}
      </span>
      <span className={big ? "mt-5" : ""}>
        <span className={`block ${big ? "text-[18px] font-semibold text-[var(--text-primary)]" : "text-[14px] text-[var(--text-secondary)]"}`}>{label}{done ? "" : "…"}</span>
        {sub && <span className="mt-1.5 block text-[14px] leading-relaxed text-[var(--text-secondary)]">{sub}</span>}
      </span>
    </div>
  );
}

/** Frosted-glass segmented picker: USDC or Bitcoin. Rendered only when Bitcoin is offered. */
export function RailPicker({ value, onPick, disabled }: { value: "usdc" | "btc"; onPick: (r: "usdc" | "btc") => void; disabled?: boolean }) {
  const opts = [{ id: "usdc" as const, name: "USDC", note: "Wallet approval, instant" }, { id: "btc" as const, name: "Bitcoin", note: "On-chain, 1-2 confirmations" }];
  return (
    <div className="rent-glass rounded-2xl p-1.5" role="radiogroup" aria-label="Pay with">
      <div className="grid grid-cols-2 gap-1.5">
        {opts.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} disabled={disabled} data-rail={o.id} onClick={() => onPick(o.id)}
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
