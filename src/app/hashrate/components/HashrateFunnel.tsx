"use client";

// /hashrate in MRR-only mode is the site's sales funnel (operator 2026-10-17). One client component owns the
// selected chunk count N so the hero CTA, the guided unit list, the odds panel, the final CTA and the mobile sticky
// bar all agree. Rig ids exist ONLY inside the hrefs handed in from lib/mrr-units.ts; every visible, alt and aria
// string is built from the unit's position ("Unit 1") and hashrate. No prices, no hardware model.
// Stale or missing data (older than 15 minutes, re-checked here every 30 s) hides counts and unit buttons and every
// CTA turns into a disabled "Check back soon" (2026-10-17: the marketplace profile page is login-walled,
// so it is never a fallback). Click events are anonymous (@vercel/analytics: surface, N, position; no PII).
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { hashLabel, UNIT_TH } from "@/lib/mrr-page-copy";
import { blockOdds } from "@/lib/block-odds";

export type FunnelCopy = {
  h1: string; sub: string; selectorLabel: string; dec: string; inc: string; liveLine: string; updated: string;
  noneFree: string; stale: string; checkBack: string; primaryCta: string; primaryNoteOne: string; primaryNoteMany: string;
  listTitle: string; unitLabel: string; unitCta: string; unitDone: string; listTip: string; hoursNote: string;
  registerCta: string; referralNote: string; newTab: string;
  whyTitle: string; whyCards: { title: string; body: string }[];
  oddsTitle: string; oddsDay: string; oddsWeek: string; oddsLine: string; oddsNote: string; oddsNone: string;
  flowTitle: string; flowSteps: { title: string; body: string }[];
  faqTitle: string; faq: { q: string; a: string }[];
  finalTitle: string; agentsLink: string;
};
export type FunnelView =
  | { state: "live"; at: number; free: string[]; freeCount: number }
  | { state: "stale" | "unavailable" };

const STALE_MS = 15 * 60 * 1000;

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

/** "23,000" — two significant figures, so the estimate never looks more precise than it is. */
export function roughOneIn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 10) return n.toFixed(1);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / mag) * mag).toLocaleString("en-US");
}

const BTN =
  "lit-primary inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-7 text-[17px] font-semibold text-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] sm:w-auto";

export function HashrateFunnel({ view, copy, networkPhs, registerUrl, rel, agentsHref, initialUnits = 1 }: {
  view: FunnelView; copy: FunnelCopy; networkPhs: number | null; registerUrl: string; rel: string;
  agentsHref: string; initialUnits?: number;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [n, setN] = useState(Math.max(1, initialUnits));
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const [heroCtaVisible, setHeroCtaVisible] = useState(true);
  const heroCta = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(Date.now());
    const q = Number(new URLSearchParams(window.location.search).get("units"));
    if (Number.isInteger(q) && q >= 1) setN(q);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = heroCta.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeroCtaVisible(e.isIntersecting || e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const live = view.state === "live" && (now == null || now - view.at <= STALE_MS) && view.freeCount > 0 ? view : null;
  const shown = view.state === "live" && (now == null || now - view.at <= STALE_MS) ? view : null;
  const max = live ? live.freeCount : 0;
  const count = live ? Math.min(Math.max(1, n), max) : 1;
  const chosen = useMemo(() => (live ? live.free.slice(0, count) : []), [live, count]);
  const primaryHref = chosen[0] ?? null;
  const state = live ? "live" : shown ? "none_free" : view.state === "live" ? "stale" : view.state;

  const day = networkPhs ? blockOdds({ ph: (count * UNIT_TH) / 1000, hours: 24, networkPhs }) : null;
  const week = networkPhs ? blockOdds({ ph: (count * UNIT_TH) / 1000, hours: 168, networkPhs }) : null;

  const cta = (surface: "hero" | "final" | "sticky") => {
    if (chosen.length) setOpened((s) => new Set(s).add(0));
    track("hashrate_cta_click", { surface, units: count, state });
  };

  const primary = (surface: "hero" | "final" | "sticky", extra = "", hidden = false) => primaryHref == null ? (
    <button
      type="button"
      disabled
      tabIndex={hidden ? -1 : undefined}
      className={`${BTN} ${extra} cursor-not-allowed !bg-[var(--nb-surface)] !text-[var(--text-secondary)] opacity-80`}
      data-primary-cta={surface}
      data-check-back
    >
      {copy.checkBack}
    </button>
  ) : (
    <a
      tabIndex={hidden ? -1 : undefined}
      href={primaryHref}
      target="_blank"
      rel={rel}
      onClick={() => cta(surface)}
      className={`${BTN} ${extra}`}
      data-primary-cta={surface}
      aria-label={`${copy.primaryCta} ${copy.newTab}`}
    >
      {copy.primaryCta}
      <span aria-hidden>↗</span>
    </a>
  );

  return (
    <div data-funnel data-state={state} className="pb-24 sm:pb-0">
      {/* 1 · Hero: outcome headline, live count, selector, ONE primary CTA (above the fold on 390 and 1280).
          md+ centers the hero's contents inside the centered card (operator 2026-10-17: left-aligned, width-capped
          copy left the right ~40% of the card empty, so the page read as off-center on desktop). Mobile stays left-aligned. */}
      <section id="rent-hero" aria-labelledby="rent-hero-h" className="flow-field scroll-mt-24">
        <div className="hero-glass rounded-3xl p-5 sm:p-9 md:text-center" data-hero-card>
          <h1 id="rent-hero-h" className="display-title max-w-2xl text-[30px] leading-[1.1] sm:text-5xl md:mx-auto">{copy.h1}</h1>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-[var(--text-secondary)] sm:text-[18px] md:mx-auto">{copy.sub}</p>

          {live ? (
            <>
              <p className="mt-5 inline-flex items-center gap-2 font-mono text-[14px] tabular-nums text-[var(--accent-ink)]" data-live-line>
                <span aria-hidden className="bay-dot-open inline-block h-2 w-2 rounded-full" />
                {copy.liveLine.replace("{N}", String(max))}
              </p>
              <fieldset className="mt-4">
                <legend className="micro-label text-[var(--text-tertiary)] md:w-full">{copy.selectorLabel}</legend>
                <div className="mt-2 flex items-center gap-3 sm:max-w-md md:mx-auto">
                  <button type="button" aria-label={copy.dec} disabled={count <= 1} onClick={() => setN(count - 1)}
                    className="glass-rest h-12 w-12 shrink-0 rounded-full text-xl text-[var(--text-primary)] disabled:opacity-40">−</button>
                  <p className="min-w-0 flex-1 text-center font-mono tabular-nums text-[var(--text-primary)]" aria-live="polite" data-selected-hash>
                    <span className="text-4xl sm:text-5xl [text-shadow:0_0_28px_var(--accent-glow)]">{hashLabel(count)}</span>
                    <span className="mt-0.5 block text-[13px] text-[var(--text-tertiary)]">{count} × {hashLabel(1)}</span>
                  </p>
                  <button type="button" aria-label={copy.inc} disabled={count >= max} onClick={() => setN(count + 1)}
                    className="glass-rest h-12 w-12 shrink-0 rounded-full text-xl text-[var(--text-primary)] disabled:opacity-40">+</button>
                </div>
                <div className="mt-3 hidden flex-wrap gap-2 sm:flex md:justify-center" role="radiogroup" aria-label={copy.selectorLabel}>
                  {Array.from({ length: max }, (_, i) => i + 1).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={k === count} onClick={() => setN(k)}
                      className={`min-h-[40px] rounded-full border px-3.5 font-mono text-[13px] tabular-nums backdrop-blur-md transition-colors ${
                        k === count
                          ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--text-primary)]"
                          : "border-[var(--nb-hair-2)] bg-[var(--nb-surface)]/50 text-[var(--text-secondary)] hover:border-[var(--accent)]/50"
                      }`}>
                      {hashLabel(k)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <p className="mt-5 text-[16px] leading-relaxed text-[var(--text-secondary)]" data-fallback-line>
              {shown ? copy.noneFree : copy.stale}
            </p>
          )}

          <div ref={heroCta} className="mt-5">
            {primary("hero")}
            {live && (
              <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">
                {count > 1 ? copy.primaryNoteMany : copy.primaryNoteOne}
              </p>
            )}
          </div>

          {/* 2 · Guided list right under the selector: one button per chosen unit. */}
          {live && (
            <div className="mt-6 md:mx-auto md:max-w-2xl">
              <p className="micro-label text-[var(--text-tertiary)]">{copy.listTitle}</p>
              <ol className="mt-3 space-y-2" data-unit-list>
                {chosen.map((href, i) => {
                  const label = copy.unitLabel.replace("{I}", String(i + 1));
                  const done = opened.has(i);
                  return (
                    <li key={i} className="glass-rest flex items-center justify-between gap-3 rounded-2xl px-4 py-3 md:text-left" data-unit-row>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-[var(--text-primary)]">
                          {done && <span aria-hidden className="mr-1.5 text-[var(--accent)]">✓</span>}
                          {label}
                        </span>
                        <span className="block font-mono text-[13px] tabular-nums text-[var(--text-tertiary)]">
                          {hashLabel(1)}{done ? ` · ${copy.unitDone}` : ""}
                        </span>
                      </span>
                      <a
                        href={href}
                        target="_blank"
                        rel={rel}
                        aria-label={`${copy.unitCta}: ${label} ${copy.newTab}`}
                        onClick={() => { setOpened((s) => new Set(s).add(i)); track("hashrate_unit_click", { position: i + 1, of: count }); }}
                        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)]/15 px-4 text-[14px] font-semibold text-[var(--text-primary)] outline-none hover:bg-[var(--accent)]/25 focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:px-5 sm:text-[15px]"
                      >
                        {copy.unitCta}
                        <span aria-hidden>↗</span>
                      </a>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">{copy.listTip.replace("{TH}", hashLabel(count))}</p>
              <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
                {copy.hoursNote} · {copy.updated.replace("{AGO}", ago((now ?? (live?.at ?? 0)) - (live?.at ?? 0)))}
              </p>
            </div>
          )}

          <div className="mt-5 space-y-1 border-t border-[var(--nb-hair-2)] pt-4">
            <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)]" data-referral-note>{copy.referralNote}</p>
            <a href={registerUrl} target="_blank" rel={rel} onClick={() => track("hashrate_register_click", { units: count })}
              className="inline-flex min-h-[44px] items-center gap-1 text-[14px] text-[var(--accent-ink)] underline underline-offset-2">
              {copy.registerCta}
              <span aria-hidden>↗</span>
              <span className="sr-only">{copy.newTab}</span>
            </a>
          </div>
        </div>
      </section>

      {/* 3 · Why rent from us */}
      <section aria-labelledby="why-h" className="mt-10">
        <h2 id="why-h" className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">{copy.whyTitle}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {copy.whyCards.map((c) => (
            <li key={c.title} className="glass-rest rounded-2xl p-5">
              <p className="text-[17px] font-semibold text-[var(--text-primary)]">{c.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 4 · Honest odds for the selected N × 270 TH/s */}
      <section aria-labelledby="odds-h" className="mt-10" data-odds>
        <div className="glass-rest rounded-2xl p-5 sm:p-6">
          <h2 id="odds-h" className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">{copy.oddsTitle}</h2>
          {day && week && networkPhs ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:max-w-lg">
                {[[copy.oddsDay, day.oneInN], [copy.oddsWeek, week.oneInN]].map(([label, v]) => (
                  <div key={label as string} className="rounded-xl border border-[var(--nb-hair-2)] bg-[var(--bg-base)]/30 p-4">
                    <dt className="micro-label text-[var(--text-tertiary)]">{label}</dt>
                    <dd className="mt-1 font-mono text-[20px] tabular-nums text-[var(--text-primary)] sm:text-[24px]" data-odds-value>
                      {copy.oddsLine.replace("{N}", roughOneIn(v as number))}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
                {copy.oddsNote.replace("{TH}", hashLabel(count)).replace("{EH}", Math.round(networkPhs / 1000).toLocaleString("en-US"))}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">{copy.oddsNone}</p>
          )}
        </div>
      </section>

      {/* 5 · How it works, in three steps */}
      <section aria-labelledby="how-to-rent-h" className="mt-10">
        <h2 id="how-to-rent-h" className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">{copy.flowTitle}</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {copy.flowSteps.map((s, i) => (
            <li key={s.title} className="glass-rest rounded-2xl p-5">
              <p className="font-mono text-[13px] text-[var(--accent-ink)]">0{i + 1}</p>
              <p className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 6 · Objection FAQ */}
      <section aria-labelledby="faq-h" className="mt-10">
        <h2 id="faq-h" className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">{copy.faqTitle}</h2>
        <div className="mt-3 divide-y divide-[var(--border-subtle)]">
          {copy.faq.map((item) => (
            <details key={item.q} className="group py-3">
              <summary className="cursor-pointer list-none text-[15px] font-semibold text-[var(--text-primary)] marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-4">
                  <span>{item.q}</span>
                  <span aria-hidden className="font-mono text-[var(--text-tertiary)] transition-transform group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 7 · Final CTA */}
      <section aria-labelledby="final-h" className="mt-10">
        <div className="hero-glass rounded-3xl p-6 text-center sm:p-9">
          <h2 id="final-h" className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">{copy.finalTitle}</h2>
          {live && <p className="mt-2 font-mono text-[14px] tabular-nums text-[var(--accent-ink)]">{copy.liveLine.replace("{N}", String(max))}</p>}
          <div className="mt-5 flex justify-center">{primary("final")}</div>
          {live && <p className="mt-3 text-[13px] text-[var(--text-tertiary)]">{copy.referralNote}</p>}
          <a href={agentsHref} onClick={() => track("hashrate_agents_click")} className="mt-3 inline-flex min-h-[44px] items-center text-[13px] text-[var(--text-tertiary)] underline underline-offset-2">
            {copy.agentsLink}
          </a>
        </div>
      </section>

      {/* Mobile sticky CTA, once the hero button has scrolled away. */}
      <div
        // Sits on top of the site's MobileBottomNav (same --mobile-nav-clearance token the other floaters use).
        style={{ bottom: "calc(var(--mobile-nav-clearance) + env(safe-area-inset-bottom))" }}
        className={`fixed inset-x-0 z-40 px-4 pb-2 pt-2 transition-all duration-200 sm:hidden ${heroCtaVisible || !live ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100"}`}
        aria-hidden={heroCtaVisible || !live}
        data-sticky-cta
      >
        {primary("sticky", "shadow-[0_8px_30px_rgba(0,0,0,0.45)]", heroCtaVisible || !live)}
      </div>
    </div>
  );
}
