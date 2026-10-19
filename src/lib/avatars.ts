// Avatar-source resolution for X-platform vendors · shared by every
// avatar render site (VendorCard, VendorDetailModal, HeroVendorPreview,
// /v/[slug] VendorLogo) so the priority chain lives in ONE place.
//
// Priority: local snapshot (public/avatars/x/ · committed at
// verification time by scripts/snapshot-avatars.ts and indexed by
// avatar-manifest.json) → unavatar.io hotlink with ?fallback=false.
//
// WHY local-first (2026-07-11): unavatar.io's free tier enforces a
// ~25-requests-per-IP rate window (verified live: x-pricing-tier:
// free, x-rate-limit-limit: 25, reset ~24h out). The homepage renders
// ~80 X-vendor <img> tags, so a single first-time visitor scrolling
// the directory exhausts the quota mid-page and every later avatar
// breaks — and an unavatar outage removes every X vendor's face
// sitewide. Snapshotting makes avatar delivery first-party
// (same-origin, Vercel-CDN-cached); unavatar remains only the
// fallback for vendors added since the last snapshot run.
//
// WHY ?fallback=false: without it unavatar answers HTTP 200 with a
// generic placeholder for dead/suspended handles, so the <img>
// onError → initials-chip fallback never fires and dead X handles
// rot silently on the cards. With it, missing avatars 404 and the
// branded chip renders instead.
//
// WHY ?size=72: unavatar serves 400×400 (~14KB) by default for a
// 36px display slot (72px @2x) — the size param cuts ~85% of the
// image bytes for the not-yet-snapshotted fallback minority.
import manifest from "./avatar-manifest.json";
import { isSafeHttpsHref } from "./outbound-url";

// Keys are LOWERCASE handles (macOS dev FS is case-insensitive but
// the deploy target is case-sensitive linux · lowercasing both the
// filenames and the lookup sidesteps the mismatch).
const LOCAL_AVATARS: Record<string, string> = manifest;

export function xAvatarSrc(handle: string): string {
  return (
    LOCAL_AVATARS[handle.toLowerCase()] ??
    `https://unavatar.io/x/${encodeURIComponent(handle)}?fallback=false&size=72`
  );
}

/**
 * Logo for one LISTING (multi-shop, 2026-10). A handle may run several
 * shops, so each listing's own `pictureUrl` (the shop's logo) wins; a
 * listing without one falls back to the ACCOUNT avatar (X snapshot /
 * unavatar), and null means "render the initials chip". Server-safe:
 * the /v page and its "More from @handle" row render through this.
 */
export function vendorLogoSrc(v: {
  handle: string;
  platform?: "x" | "nostr" | "lightning";
  pictureUrl?: string;
}): string | null {
  if (v.pictureUrl && isSafeHttpsHref(v.pictureUrl)) return v.pictureUrl;
  if ((v.platform ?? "x") === "x") return xAvatarSrc(v.handle);
  return null;
}
