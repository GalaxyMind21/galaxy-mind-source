"use client";

/* =====================================================================
 * MotionPrefs · site-wide prefers-reduced-motion bridge for
 * framer-motion (a11y 2026-06-12).
 *
 * framer-motion animates via inline styles / WAAPI, so the CSS
 * `@media (prefers-reduced-motion: reduce)` overrides in globals.css
 * never reach it · a vestibular-sensitive user still got the full
 * grid FLIP shuffle on directory filter taps, modal scale-pops and
 * scroll-rises. <MotionConfig reducedMotion="user"> makes framer
 * read the OS setting itself and auto-disable transform/layout
 * animations (opacity fades stay, which is the correct behavior).
 *
 * Client component wrapping the server `children` passed down from
 * the root layout · RSC is preserved because the children render on
 * the server and pass through as a slot.
 * ===================================================================== */

import { MotionConfig } from "framer-motion";

export function MotionPrefs({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
