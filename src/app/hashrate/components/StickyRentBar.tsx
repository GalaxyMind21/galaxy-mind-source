"use client";
// Mobile-only bottom bar: the one price and the one action stay in reach while scrolling.
// Appears after the hero leaves the viewport; hidden at sm and up.
import { useEffect, useState } from "react";

export function StickyRentBar({ price, unit, cta, href, watchId }: { price: string; unit: string; cta: string; href: string; watchId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = document.getElementById(watchId);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);
  return (
    <div
      aria-hidden={!show}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-[var(--nb-hair-2)] bg-[var(--bg-base)]/85 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl transition-transform duration-300 motion-reduce:transition-none sm:hidden ${show ? "translate-y-0" : "translate-y-full"}`}
      data-sticky-rent
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <p className="min-w-0">
          <span className="font-mono text-lg tabular-nums text-[var(--text-primary)]">{price}</span>
          <span className="ml-1.5 text-[12px] text-[var(--text-tertiary)]">{unit}</span>
        </p>
        <a href={href} tabIndex={show ? 0 : -1} className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-black">
          {cta} →
        </a>
      </div>
    </div>
  );
}
