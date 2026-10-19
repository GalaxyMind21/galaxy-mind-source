"use client";

/**
 * PrizeConsole · the machined block-prize instrument at the top of
 * /hashrate (2026-08-04). The page's hero was the flattest number on a
 * site whose signature surfaces are the Supply Clock and the Pressure
 * Gauge; the prize deserves the same instrument treatment.
 *
 * Idiom: the bezel-metal 1.5px gradient ring + sc-digit glass digit
 * windows from the homepage DirectoryConsole / Supply Clock family
 * (globals.css). Each digit cell is KEYED by position+value, so a
 * changed digit remounts and plays the sc-cell-flash once — the
 * "lottery drum" moment, driven by real data only.
 *
 * Live behavior, all honest and all cheap:
 *  · The prize re-reads the CDN-cached /api/hashrate every 5 minutes
 *    (matches its s-maxage) — no server fan-out.
 *  · The block height polls the ~120-byte /api/heartbeat every 30s
 *    (the BlockHeightTicker pattern). A new block flashes the lamp —
 *    someone just won this prize; the next one is live now.
 * Server-rendered initial prize means no layout pop and full content
 * for crawlers; polling only ever updates numbers in place.
 */

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import {
  HERO_KICKER,
  HERO_PRIZE_NOTE,
  HERO_CTA_LABEL,
  HERO_CTA_LABEL_NONE,
  HERO_TICKET_OPEN,
  HERO_TICKET_NONE,
  REFERRAL_NOTICE,
} from "@/lib/hashrate-copy";
import { MRR_REFERRAL_ID } from "@/lib/mrr";

export function PrizeConsole({
  initialPrizeUsd,
  anyRentable,
  entryUsd,
  openTh,
  sellerHref,
  sellerLabel,
  rentHref = "#your-shot",
}: {
  initialPrizeUsd: number;
  /** Resolved by the parent via sellerProofUrl(): a real Galaxy Mind
   *  listing when the feed gives us one, the SHA-256 market page when it
   *  does not. Carries the referral, so the notice below rides with it. */
  sellerHref: string;
  sellerLabel: string;
  /** Server-computed at render: is a machine genuinely bookable? The
   *  CTA must not say "Rent now" when the chooser has nothing to sell. */
  anyRentable: boolean;
  /** Cheapest 1-day ticket in USD, when a machine is open. */
  entryUsd: number | null;
  /** Combined bookable hashrate in TH. */
  openTh: number;
  /** Hero CTA target: /hashrate/rent (same tab) when a machine is open, else the picker. */
  rentHref?: string;
}) {
  const [prize, setPrize] = useState(initialPrizeUsd);
  const [height, setHeight] = useState<number | null>(null);
  const [blockFlash, setBlockFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/hashrate");
        if (!res.ok) return;
        const desk = (await res.json()) as {
          blockRewardBtc?: number | null;
          btcUsd?: number | null;
        };
        if (!alive) return;
        if (desk.blockRewardBtc != null && desk.btcUsd != null) {
          setPrize(desk.blockRewardBtc * desk.btcUsd);
        }
      } catch {
        /* keep the last honest number */
      }
    };
    const id = window.setInterval(refresh, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let prev = 0;
    const tick = async () => {
      try {
        const r = await fetch("/api/heartbeat");
        if (!r.ok) return;
        const j = (await r.json()) as { blockHeight?: number };
        const h = typeof j.blockHeight === "number" ? j.blockHeight : null;
        if (!alive || h == null) return;
        if (prev !== 0 && h !== prev) {
          setBlockFlash(true);
          window.setTimeout(() => setBlockFlash(false), 1200);
        }
        prev = h;
        setHeight(h);
      } catch {
        /* swallow · the lamp simply doesn't render */
      }
    };
    void tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const label = `$${Math.round(prize).toLocaleString("en-US")}`;

  return (
    <section className="bezel-metal w-full min-w-0 max-w-[calc(100vw-2rem)] rounded-2xl p-[1.5px] nb-seated">
      {/* TWO COLUMNS AT lg, one below it. The console is the full width of
          the page, and centring a ~700px content column inside 1440 left
          roughly 350px dead on either side while the h1 above it ran on the
          LEFT axis — two alignment systems stacked, which is what made the
          hero read as an empty box rather than a machine. Split, it uses the
          width and echoes the odds panel further down the same page, which
          already puts its figures left and its drum right. */}
      <div className="rounded-2xl bg-[var(--bg-elevated)] px-3 py-6 text-center sm:p-8 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-10 lg:px-10 lg:text-left">
        <div className="lg:min-w-0">
        <p className="micro-label text-balance text-[var(--text-tertiary)]">{HERO_KICKER}</p>

        {/* Digit size tracks the viewport so six/seven cells never blow
            past a 390px phone (text-4xl + min-w-[1.6rem] measured 451
            CSS-px, 2026-08-24). The row can still scroll as a last
            resort if a seven-figure prize lands. */}
        <div className="mt-4 w-full min-w-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            className="flex items-baseline justify-center gap-px sm:gap-1 lg:justify-start"
            aria-label={label}
          >
            {label.split("").map((ch, i) =>
              /\d/.test(ch) ? (
                <span
                  key={`${i}-${ch}`}
                  className="sc-digit sc-cell inline-block min-w-[0.95rem] rounded-md px-[3px] py-1 font-mono text-[clamp(1.25rem,6.2vw,3.75rem)] leading-none tabular-nums sm:min-w-[2.6rem] sm:px-0.5"
                >
                  {ch}
                </span>
              ) : (
                <span
                  key={`${i}-${ch}`}
                  className="font-mono text-[clamp(1rem,4.4vw,3rem)] leading-none text-[var(--text-tertiary)]"
                >
                  {ch}
                </span>
              ),
            )}
          </div>
        </div>

        </div>

        <div className="lg:min-w-0">
        <p className="mx-auto mt-4 max-w-md text-sm text-[var(--text-secondary)] lg:mx-0 lg:mt-0">
          {HERO_PRIZE_NOTE}
        </p>
        {/* THE PRICE CARRIES THE WEIGHT (2026-09-05).
            Same sentence, same words — the copy contract and its gates are
            untouched. Only the number a visitor is actually deciding on
            gets the emphasis. The prize above is the reason to look; the
            entry cost is the reason to act, and it was set in the same
            15px grey as the clause around it.

            Split on the {PRICE} token rather than dangerouslySetInnerHTML:
            the placeholder is already the contract between copy and
            render, so this needs no new string and cannot desync from a
            copy edit. */}
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-snug text-[var(--text-primary)] tabular-nums lg:mx-0">
          {anyRentable && entryUsd != null && openTh > 0
            ? (() => {
                const price =
                  entryUsd >= 10
                    ? `$${Math.round(entryUsd)}`
                    : `$${entryUsd.toFixed(2)}`;
                const [before, after] = HERO_TICKET_OPEN.split("{PRICE}");
                return (
                  <>
                    {before}
                    <strong className="text-[17px] font-semibold text-[var(--accent-ink)]">
                      {price}
                    </strong>
                    {(after ?? "").replace(
                      "{TH}",
                      openTh.toLocaleString("en-US"),
                    )}
                  </>
                );
              })()
            : HERO_TICKET_NONE}
        </p>

        {height != null && (
          <p
            className={`mt-3 font-mono t-xs tabular-nums transition-colors ${
              blockFlash
                ? "text-[var(--accent-ink)]"
                : "text-[var(--text-tertiary)]"
            }`}
          >
            <span aria-hidden>●</span> block #{height.toLocaleString("en-US")}
            {blockFlash ? " · just found" : " · in play now"}
          </p>
        )}

        <a
          href={rentHref}
          onClick={() => track("hashrate_hero_cta")}
          className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black lit-primary"
        >
          {anyRentable ? HERO_CTA_LABEL : HERO_CTA_LABEL_NONE} {rentHref.startsWith("#") ? "↓" : "→"}
        </a>

        {/* THE FIRST SCREEN HAD NO WAY OUT TO THE MARKETPLACE (2026-09-05).
            Measured: of 32 links to MiningRigRentals on this page, the
            earliest sat at scroll-screen 1.56, and the sticky pick bar only
            arms once the chooser has scrolled past — so screens 0 through 2
            offered a visitor no path at all, on the one screen every visitor
            sees. The primary button stays the anchor, because the chooser is
            a genuine qualifying step and someone who lands on a marketplace
            cold converts worse. This is the fast lane for the visitor who is
            already decided.

            Deliberately SECONDARY: a text link under a filled button, not a
            second button competing with the first.

            The referral notice rides with it rather than relying on the copy
            one screen below, because a visitor who clicks from here would
            never have scrolled past that one — and "disclosed" has to mean
            disclosed before the click. Gated on MRR_REFERRAL_ID like the
            other two render sites, so turning the referral off takes the
            claim with it. */}
        <p className="mt-3">
          <a
            href={sellerHref}
            onClick={() => track("hashrate_hero_seller_link")}
            className="inline-flex min-h-[44px] items-center text-[14px] text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            {sellerLabel} →
          </a>
        </p>
        {MRR_REFERRAL_ID != null && (
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            {REFERRAL_NOTICE}
          </p>
        )}
        </div>
      </div>
    </section>
  );
}
