"use client";

import { isSafeHttpsHref } from "@/lib/safe-fetch";

/* =====================================================================
 * VendorDetailModal · in-page magnified vendor view
 *
 * Click a card on / and you don't bounce off-site · the card opens
 * this modal, which mirrors the /v/[slug] content (full description,
 * verified date, country, category, related vendors, share button,
 * and the quiet VendorHashrateModule after related shops) but stays
 * in the directory context. When a merchant website exists, Visit
 * shop is the primary leave (directory → checkout), matching /v/[slug];
 * View on X / Pay via Lightning stay secondary. Everything else
 * encourages staying on Galaxy Mind · including a path onto /hashrate
 * for visitors who came to spend and discover the USA desk without
 * leaving the modal.
 *
 * Why a modal vs. just routing to /v/[slug]:
 *   - Routing is a full page nav · loses scroll position, filter
 *     state, search input. Modal is in-place.
 *   - Modal works seamlessly with the keyboard nav layer (arrows
 *     between cards, Enter to expand, Escape to close, Right/Left
 *     swap focus to the next vendor without closing).
 *   - The /v/[slug] page still exists for direct sharing and SEO ·
 *     the modal links to it via "View full page →" so power users
 *     can grab the URL.
 *
 * Keyboard:
 *   - Escape   → close
 *   - Left/Right → previous/next vendor (without closing)
 *   - "v"      → "view full page" (jump to /v/[slug])
 *   - "s"      → focus the share button
 * ===================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { useModalA11y } from "@/lib/use-modal-a11y";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  HOUSE_HANDLE,
  STALE_THRESHOLD_DAYS,
  VENDORS,
  formatVerifiedDate,
  isStale,
  isNew,
  getActionLabel,
  getActionUrl,
  getDisplayHandle,
  getPlatform,
  getPlatformBadge,
  lightningHref,
  vendorSlug,
  vendorKey,
  vendorSiblings,
  vendorWebsite,
  type Vendor,
} from "@/lib/vendors";
import { xAvatarSrc } from "@/lib/avatars";
import { FoundingBadge } from "./FoundingBadge";
import { CountryMark } from "@/components/CountryMark";
import { VendorBadgeEmbed } from "./VendorBadgeEmbed";
import { VendorHashrateModule } from "./VendorHashrateModule";
import { VendorOutbound } from "./VendorOutbound";
import { vendorShelf } from "@/lib/shelves";

type Props = {
  vendor: Vendor | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  // Total vendors and current 1-based index in the filtered set ·
  // shown in the modal corner so users know "Vendor 12 of 56" and
  // get a count of how much more there is to explore.
  position?: { index: number; total: number };
  // Callback to swap the modal to a different vendor without closing
  // it · used by the "More vendors in [category]" similar-vendors
  // panel at the bottom of the modal. When provided, similar vendors
  // are rendered as clickable mini-cards; when undefined the panel
  // is hidden (e.g. modal opened from a context where vendor swaps
  // don't make sense).
  onSelectVendor?: (vendor: Vendor) => void;
};

export function VendorDetailModal({
  vendor,
  onClose,
  onPrev,
  onNext,
  position,
  onSelectVendor,
}: Props) {
  // Focus contract · the existing keydown listener below keeps the
  // arrow/v navigation; Escape now also fires here (idempotent
  // double-close is harmless, focus trap + restore is the point).
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(vendor !== null, panelRef, onClose);

  // Track the "share copied" state for the copy-link affordance.
  const [linkCopied, setLinkCopied] = useState(false);

  // Keyboard: Escape closes; Left/Right navigate; "v" opens full
  // page; "s" focuses share. All listeners are global because the
  // modal owns focus while open.
  useEffect(() => {
    if (!vendor) return;
    const current = vendor;
    function onKey(e: KeyboardEvent) {
      // Don't intercept keys when the user is typing into an input
      // field (defensive · the modal doesn't have inputs but a
      // future variant might).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        onNext();
        track("vendor_modal_keynav", { dir: "next" });
      } else if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
        track("vendor_modal_keynav", { dir: "prev" });
      } else if (
        (e.key === "v" || e.key === "V") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const slug = vendorSlug(current);
        track("vendor_modal_keynav", { dir: "full" });
        track("vendor_modal_to_full_page", { slug });
        window.location.assign(`/v/${slug}`);
      } else if (
        (e.key === "s" || e.key === "S") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        document.getElementById("vendor-modal-share")?.focus();
        track("vendor_modal_keynav", { dir: "share" });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [vendor, onClose, onNext, onPrev]);

  async function handleCopyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(
        `https://galaxymind.space/v/${slug}`,
      );
      setLinkCopied(true);
      track("vendor_modal_link_copied", { slug });
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Older browsers · degrade silently.
    }
  }

  return (
    <AnimatePresence>
      {vendor && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop · click anywhere outside the panel closes */}
          <div
            className="absolute inset-0 glass-scrim"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vendor-modal-title"
            // max-h uses dvh (dynamic viewport height), NOT vh.
            // iPhone bug (audit 2026-05): on iOS Safari `vh` is the
            // LARGE viewport (toolbar hidden), so `90vh` made the
            // panel taller than the actually-visible area when
            // Safari's chrome was shown — the modal header (with the
            // × close button, which sits ABOVE the scroll body and
            // doesn't scroll) ended up off-screen, "too large to
            // close". `dvh` tracks the live visible viewport so the
            // panel — and its close button — always fit.
            className="relative max-w-2xl w-full rounded-xl glass-sheet overflow-hidden flex flex-col max-h-[88dvh]"
            initial={{ y: 12, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            // Stop click bubble · clicking inside the panel shouldn't
            // dismiss via the backdrop's onClick.
            onClick={(e) => e.stopPropagation()}
          >
            <ModalContent
              vendor={vendor}
              onClose={onClose}
              onPrev={onPrev}
              onNext={onNext}
              position={position}
              linkCopied={linkCopied}
              onCopyLink={handleCopyLink}
              onSelectVendor={onSelectVendor}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ModalContent({
  vendor,
  onClose,
  onPrev,
  onNext,
  position,
  linkCopied,
  onCopyLink,
  onSelectVendor,
}: {
  vendor: Vendor;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
  linkCopied: boolean;
  onCopyLink: (slug: string) => void;
  onSelectVendor?: (vendor: Vendor) => void;
}) {
  const platform = getPlatform(vendor);
  const actionUrl = getActionUrl(vendor);
  const actionLabel = getActionLabel(vendor);
  const displayHandle = getDisplayHandle(vendor);
  const country = vendor.country ? COUNTRIES[vendor.country] : null;
  const platformBadge = getPlatformBadge(vendor);
  const stale = isStale(vendor.verifiedAt);
  const fresh = isNew(vendor);
  const slug = vendorSlug(vendor);
  const shopHref = vendorWebsite(vendor);
  const hasShop = !!(shopHref && isSafeHttpsHref(shopHref));
  // Same committed shelf picture as the homepage tile and /v (#67), shown
  // as the popup's shop window. Only with a website + shelf; else nothing.
  const shelf = hasShop ? vendorShelf(vendor) : null;
  // Plain string, not a JSX conditional — same trap the /v page documents
  // (scripts/check-jsx-whitespace.ts).
  const shopCheckClause = shopHref
    ? ", and the shop page is watched for it to stop mentioning bitcoin or Lightning at all"
    : "";

  // Similar vendors · same category, excluding the current vendor.
  // Cap at 3 · enough to suggest "more like this" without bloating
  // the modal. If the category itself is sparse (<3 candidates), we
  // top up with same-country vendors so the panel always shows
  // something meaningful when there are >0 alternatives. Memoized
  // because VENDORS is module-constant but the filter still runs on
  // every modal render otherwise.
  //
  // Why this exists: before May 2026 the modal's only "what next?"
  // affordances were leave-site CTAs (View on X, Pay LN, Visit shop).
  // A visitor who liked Vendor A had no path to discover Vendor B
  // without closing the modal, scanning the directory, finding their
  // place again. The similar-vendors strip closes that loop · click
  // a card and the modal swaps to Vendor B without ever leaving
  // Galaxy Mind. Quintessential connector-layer behavior.
  // Multi-shop (2026-10) · other shops run by the same identity get
  // their own row above the category panel and are kept out of it.
  const siblings = useMemo(() => vendorSiblings(vendor), [vendor]);
  const similar = useMemo(() => {
    if (!onSelectVendor) return [];
    const self = vendorKey(vendor);
    const sib = new Set(siblings.map(vendorKey));
    return VENDORS.filter(
      (v) =>
        vendorKey(v) !== self &&
        !sib.has(vendorKey(v)) &&
        v.category === vendor.category,
    ).slice(0, 3);
  }, [vendor, onSelectVendor, siblings]);

  // Country peers (Tier 2 · 2026-07-03) · the geographic sibling of
  // the category panel above. "Who else near me takes bitcoin?" is
  // the question a visitor with a country-flagged vendor open is
  // most likely to have next · shipping cost and customs make
  // same-country merchants disproportionately actionable. Excludes
  // vendors already shown in `similar` so the two panels never
  // repeat a card. Hidden entirely for country-less vendors and for
  // countries where this vendor is the only listing (an "Also from
  // Finland" header over zero cards would be noise).
  const countryPeers = useMemo(() => {
    if (!onSelectVendor || !vendor.country) return [];
    const self = vendorKey(vendor);
    const shown = new Set([...similar, ...siblings].map(vendorKey));
    return VENDORS.filter(
      (v) =>
        vendorKey(v) !== self &&
        v.country === vendor.country &&
        !shown.has(vendorKey(v)),
    ).slice(0, 3);
  }, [vendor, onSelectVendor, similar, siblings]);

  // X-compose URL for the share button. Same shape as the directory
  // card's share, but built inline here so the modal doesn't depend
  // on a buildVendorTweetUrl import path.
  const flagText = country ? ` ${country.flag}` : "";
  const subject = platform === "x" ? `@${vendor.handle}` : vendor.name;
  const desc =
    vendor.description.length > 130
      ? vendor.description.slice(0, 127) + "…"
      : vendor.description;
  const tweetText = [
    `${subject} accepts Bitcoin${flagText}`,
    "",
    desc,
    "",
    `https://galaxymind.space/v/${slug}`,
  ].join("\n");
  const composeUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(tweetText);

  return (
    <>
      {/* Top bar · header strip with position counter + dismiss.
          Sticky-ish in feel, sits above the scrollable body. */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-baseline gap-2 t-xs font-medium text-[var(--text-tertiary)]">
          <span className="text-[var(--accent-ink)]">★</span>
          <span>Vendor detail</span>
          {position && (
            <span className="text-[var(--text-tertiary)] hidden sm:inline">
              · {position.index} of {position.total}
            </span>
          )}
          {fresh && (
            <span className="ml-2 text-[var(--accent-ink)]">NEW</span>
          )}
          {stale && (
            <span className="ml-2 text-[var(--warning)]">STALE</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Prev / Next nav · inline arrows for mouse users; the
              keyboard layer handles arrow keys regardless. */}
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]/80 transition-colors"
              aria-label="Previous vendor"
              title="Previous vendor (←)"
            >
              ←
            </button>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]/80 transition-colors"
              aria-label="Next vendor"
              title="Next vendor (→)"
            >
              →
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)]/80 transition-colors text-lg leading-none ml-1"
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      </div>

      {/* Scrollable body · max-h on outer panel keeps long content
          contained without spilling off the viewport on small windows. */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Header row · profile logo + brand name + country flag.
            Logo source priority: vendor.pictureUrl (pre-populated for
            Nostr vendors via kind:0 metadata) → xAvatarSrc for X
            vendors (local snapshot, else unavatar.io?fallback=false)
            → initials chip for Lightning / fetch failures. Larger
            56px size than the directory card's 40px so the logo
            reads as the modal headline. */}
        {hasShop && shelf && (
          <VendorOutbound
            href={shopHref!}
            slug={slug}
            dest="shelf"
            surface="vendor_modal"
            className="vendor-cell block mb-5 overflow-hidden rounded-xl"
          >
            {/* Slim banner on desktop (16:9, capped 180px) so the name and
                buttons stay above the fold; 4:3 on phones as before. The
                image is always shown whole (contain) on a blurred bed of
                itself, so the shorter frame never crops a shop's sign. */}
            <div className="vendor-shelf vendor-shelf-modal">
              <div className="vendor-shelf-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="vendor-photo-bed"
                  src={shelf.src}
                  alt=""
                  aria-hidden
                  loading="lazy"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="vendor-photo is-contained"
                  src={shelf.src}
                  alt={`${vendor.name} storefront, opens the shop`}
                  width={640}
                  height={480}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </VendorOutbound>
        )}

        <ModalAvatar vendor={vendor} />

        <div className="flex items-baseline gap-3 flex-wrap mb-2 mt-4">
          <h2
            id="vendor-modal-title"
            className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)] leading-tight"
          >
            {vendor.name}
          </h2>
          {vendor.country && <CountryMark code={vendor.country} />}
          {/* Founding 100 scarcity badge · renders only for vendors
              with addedAt 1-100. Sits in the title-row baseline so
              the honor reads alongside the name + country at a glance. */}
          <FoundingBadge addedAt={vendor.addedAt} />
        </div>

        <div className="font-mono text-sm text-[var(--accent-ink)] mb-2 truncate">
          {displayHandle}
        </div>

        {/* Founder name · adds a personal touch when set. Reads as
            "Made by Sarah" rather than just the brand name alone. */}
        {vendor.founderName && (
          <div className="text-xs text-[var(--text-tertiary)] mb-5">
            Made by{" "}
            <span className="text-[var(--text-secondary)]">
              {vendor.founderName}
            </span>
          </div>
        )}
        {!vendor.founderName && <div className="mb-3" />}

        <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-5">
          {vendor.description}
        </p>

        <div className="flex flex-wrap items-baseline gap-2 mb-6">
          <span className="t-xs font-medium text-[var(--accent-ink)] px-2 py-1 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30">
            {CATEGORY_LABELS[vendor.category]}
          </span>
          <span className="t-xs text-[var(--text-tertiary)]">
            On{" "}
            <span className="text-[var(--text-secondary)]">
              {platformBadge.label}
            </span>
          </span>
          {vendor.shipsInternational && (
            <span
              className="t-xs text-[var(--text-secondary)] px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60"
              title="Ships internationally"
            >
              ✈ Ships int&apos;l
            </span>
          )}
          {/* Verified chip with a "what does this mean" affordance ·
              dotted underline + cursor-help + title tooltip, and the
              same text via aria-label so keyboard/SR users get it
              too (tabIndex 0 makes the tooltip reachable without a
              mouse). The methodology in one breath: human check, on
              this date, re-checked on a cycle. */}
          <span
            tabIndex={0}
            className={`t-xs cursor-help underline decoration-dotted decoration-[var(--text-tertiary)]/60 underline-offset-4 ${
              stale ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
            }`}
            title={`Human-verified: we confirmed this vendor accepts bitcoin on this date. Listings are re-checked at least every ${STALE_THRESHOLD_DAYS} days.`}
            aria-label={`Verified ${formatVerifiedDate(vendor.verifiedAt)}. Human-verified: we confirmed this vendor accepts bitcoin on this date. Listings are re-checked at least every ${STALE_THRESHOLD_DAYS} days.`}
          >
            Verified{" "}
            <span
              className={
                stale ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"
              }
            >
              {formatVerifiedDate(vendor.verifiedAt)}
            </span>
            {stale && ` (>${STALE_THRESHOLD_DAYS}d)`}
          </span>
        </div>

        {/* Payment-method signals · only render when at least one of
            the payment fields is set. Default assumption (no fields)
            is "BTC works, both rails" so we don't render badges for
            silent yeses. Explicit `false` IS rendered (someone with
            "Lightning only" is signaling something meaningful). */}
        {(vendor.lightningAddress ||
          vendor.acceptsLightning === false ||
          vendor.acceptsOnChain === false) && (
          <div className="flex flex-wrap items-center gap-2 mb-5 t-xs">
            <span className="text-[var(--text-tertiary)]">Payment:</span>
            {vendor.acceptsOnChain !== false && (
              <span className="text-[var(--text-secondary)] px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40">
                ⛓ on-chain
              </span>
            )}
            {vendor.acceptsLightning !== false && (
              <span className="text-[var(--text-secondary)] px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40">
                ⚡ lightning
              </span>
            )}
            {(() => {
              // Defense-in-depth · malformed stored address → no
              // `lightning:` href (see lightningHref in lib/vendors).
              const lnHref = lightningHref(vendor.lightningAddress);
              if (!lnHref) return null;
              return (
                <a
                  href={lnHref}
                  onClick={() =>
                    track("vendor_lnaddress_click", {
                      handle: vendor.handle,
                      surface: "vendor_modal",
                    })
                  }
                  className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] normal-case tracking-normal text-xs"
                  title="Pay this Lightning Address directly"
                >
                  {vendor.lightningAddress}
                </a>
              );
            })()}
          </div>
        )}

        {/* Reach this vendor · extra identity channels only. Visit shop
            is the primary action-row CTA when a website exists, so it
            is not repeated here as a muted text link. */}
        {vendor.nostrPubkey && (
          <div className="mb-5">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
              Also reachable on
            </div>
            <div className="flex flex-wrap items-baseline gap-3 text-xs">
              <a
                href={`https://njump.me/${vendor.nostrPubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track("vendor_nostr_click", {
                    handle: vendor.handle,
                    surface: "vendor_modal",
                  })
                }
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Nostr →
              </a>
            </div>
          </div>
        )}

        {/* Action row · when a merchant website exists, Visit shop is
            the primary leave (directory → checkout), matching /v/[slug].
            Platform profile stays secondary. Share / Copy link unchanged. */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {hasShop ? (
            <VendorOutbound
              href={shopHref!}
              slug={slug}
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
            >
              Visit shop
            </VendorOutbound>
          ) : (
            <a
              href={actionUrl}
              target={platform === "lightning" ? undefined : "_blank"}
              rel={platform === "lightning" ? undefined : "noopener noreferrer"}
              onClick={() =>
                track("vendor_click", {
                  handle: vendor.handle,
                  platform,
                  surface: "vendor_modal",
                  category: vendor.category,
                })
              }
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
            >
              {actionLabel}
            </a>
          )}

          {hasShop && (
            <a
              href={actionUrl}
              target={platform === "lightning" ? undefined : "_blank"}
              rel={platform === "lightning" ? undefined : "noopener noreferrer"}
              onClick={() =>
                track("vendor_click", {
                  handle: vendor.handle,
                  platform,
                  surface: "vendor_modal",
                  category: vendor.category,
                })
              }
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[14px] font-semibold hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-all"
            >
              {actionLabel}
            </a>
          )}

          <a
            id="vendor-modal-share"
            data-vendor-share
            href={composeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Share (s)"
            onClick={() =>
              track("vendor_share", {
                handle: vendor.handle,
                platform,
                surface: "vendor_modal",
                category: vendor.category,
              })
            }
            className="micro-label inline-flex items-baseline gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-all"
          >
            ↗ Share
          </a>

          <button
            type="button"
            onClick={() => onCopyLink(slug)}
            className="micro-label inline-flex items-baseline gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-all"
            aria-label="Copy vendor page URL"
          >
            {linkCopied ? "✓ Copied" : "Copy link"}
          </button>
        </div>

        {/* "View full page" link · routes to /v/[slug] for users who
            want a permalink. The modal stays open behind the route
            change · this is a navigation, not a sub-modal. */}
        <Link
          href={`/v/${slug}`}
          title="View full page (v)"
          onClick={() =>
            track("vendor_modal_to_full_page", { slug })
          }
          className="inline-flex items-baseline gap-1 t-xs text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          View full page →
        </Link>

        {/* Compact twins of the /v/[slug] verify + badge blocks.
            Homepage traffic opens this modal, not the permalink, so
            the methodology and the self-serve badge have to live here
            too. Same wording family; tighter spacing. */}
        <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 p-4">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            How we verify
          </div>
          <p className="t-xs text-[var(--text-secondary)] leading-relaxed">
            Each vendor is manually confirmed accepting Bitcoin (on-chain
            and/or Lightning) before being added. The listed profile is
            checked automatically every day for reachability{shopCheckClause}.
            Anything that changes is queued for a person to review, and
            every listing gets a human look at least every{" "}
            {STALE_THRESHOLD_DAYS} days even if nothing changed.{" "}
            {stale ? (
              <span className="text-[var(--warning)]">
                This vendor is past the {STALE_THRESHOLD_DAYS}-day window ·
                DM{" "}
                <a
                  href="https://x.com/GalaxyMind"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  @GalaxyMind
                </a>{" "}
                if you confirm they still accept Bitcoin and we&apos;ll
                re-verify.
              </span>
            ) : (
              <span>
                This vendor was last confirmed by a human{" "}
                {formatVerifiedDate(vendor.verifiedAt)}.
              </span>
            )}
          </p>
        </div>

        <VendorBadgeEmbed
          slug={slug}
          name={vendor.name}
          className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 p-4"
        />

        {/* "More vendors in [category]" · in-modal continued-browsing
            affordance. Each card swaps the modal to that vendor via
            onSelectVendor (no close + reopen flicker). Hidden when
            onSelectVendor isn't provided OR when there are no
            similar vendors to show (e.g. a vendor in a category of
            one). 3-card cap keeps the panel visually contained. */}
        {siblings.length > 0 && onSelectVendor && (
          <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              More from{" "}
              <span className="text-[var(--accent-ink)]">
                {getDisplayHandle(vendor)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {siblings.slice(0, 6).map((s) => (
                <MiniVendorButton
                  key={vendorKey(s)}
                  vendor={s}
                  from={vendor.handle}
                  surface="sibling"
                  onSelect={onSelectVendor}
                />
              ))}
            </div>
          </div>
        )}

        {similar.length > 0 && onSelectVendor && (
          <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              More in{" "}
              <span className="text-[var(--accent-ink)]">
                {CATEGORY_LABELS[vendor.category]}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {similar.map((s) => (
                <MiniVendorButton
                  key={vendorKey(s)}
                  vendor={s}
                  from={vendor.handle}
                  surface="similar"
                  onSelect={onSelectVendor}
                />
              ))}
            </div>
          </div>
        )}

        {/* "Also from [country]" · geographic sibling of the category
            panel. Same-country merchants are the most actionable
            follow-on for a physical-goods directory (shipping +
            customs), so they get their own row instead of competing
            for the 3 category slots. Never repeats a card shown
            above (countryPeers excludes `similar`). */}
        {countryPeers.length > 0 && onSelectVendor && country && (
          <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Also from{" "}
              <span className="text-[var(--accent-ink)]">
                {country.flag} {country.label}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {countryPeers.map((s) => (
                <MiniVendorButton
                  key={vendorKey(s)}
                  vendor={s}
                  from={vendor.handle}
                  surface="country"
                  onSelect={onSelectVendor}
                />
              ))}
            </div>
          </div>
        )}

        {/* Quiet hashrate desk · same module as /v/[slug]. Homepage
            traffic opens this modal on plain click, so the /v-only
            mount was invisible to the dominant directory path.
            Skip the house listing (it IS the hashrate page). */}
        {vendor.handle !== HOUSE_HANDLE && (
          <VendorHashrateModule className="mt-6 mb-0" />
        )}

        {/* Keyboard hint at the very bottom · subtle, doesn't compete
            with the primary CTAs but rewards keyboard users with
            confirmation that arrows + Esc work. */}
        <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] t-xs text-[var(--text-tertiary)]">
          ← / →{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            navigate
          </span>{" "}
          · Esc{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            close
          </span>{" "}
          · v{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            full page
          </span>{" "}
          · s{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-normal">
            share
          </span>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
 * MiniVendorButton · one clickable mini-card in the "More in
 * [category]" / "Also from [country]" panels. Swaps the modal to the
 * clicked vendor via onSelect (no close + reopen flicker). Extracted
 * (2026-07-03) when the country panel joined so the two panels share
 * one card instead of drifting copies.
 * ===================================================================== */
function MiniVendorButton({
  vendor,
  from,
  surface,
  onSelect,
}: {
  vendor: Vendor;
  from: string;
  surface: "similar" | "country" | "sibling";
  onSelect: (vendor: Vendor) => void;
}) {
  const country = vendor.country ? COUNTRIES[vendor.country] : null;
  return (
    <button
      type="button"
      onClick={() => {
        track(
          surface === "similar"
            ? "vendor_modal_similar_click"
            : surface === "sibling"
              ? "vendor_modal_sibling_click"
              : "vendor_modal_country_peer_click",
          {
            from,
            to: vendor.handle,
            category: vendor.category,
          },
        );
        onSelect(vendor);
      }}
      className="text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 hover:bg-[var(--accent)]/5 hover:border-[var(--accent)]/40 px-3 py-2.5 transition-all group/sim"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs font-semibold text-[var(--text-primary)] group-hover/sim:text-[var(--accent-ink)] transition-colors truncate">
          {vendor.name}
        </span>
        {country && (
          <span
            className="text-sm leading-none shrink-0"
            aria-label={`Based in ${country.label}`}
          >
            {country.flag}
          </span>
        )}
      </div>
      <div className="t-xs text-[var(--text-tertiary)] line-clamp-2 leading-snug">
        {vendor.description}
      </div>
    </button>
  );
}

/* =====================================================================
 * ModalAvatar · large profile-logo block for the modal headline.
 *
 * Larger than the directory-card Avatar (56px vs 40px) so it reads as
 * the "this is the vendor" anchor of the modal. Same source-priority:
 *   1. vendor.pictureUrl · pre-populated from kind:0 metadata for
 *      Nostr vendors at vendor-add time (no runtime relay query)
 *   2. xAvatarSrc · for X vendors, local snapshot when one exists,
 *      else unavatar.io with ?fallback=false (dead handles 404)
 *   3. initials chip · graceful fallback for Lightning vendors and
 *      X vendors whose avatar fetch failed
 * ===================================================================== */
function ModalAvatar({ vendor }: { vendor: Vendor }) {
  const [errored, setErrored] = useState(false);
  const platform = getPlatform(vendor);
  let src: string | null = null;
  if (vendor.pictureUrl && isSafeHttpsHref(vendor.pictureUrl) && !errored)
    src = vendor.pictureUrl;
  else if (platform === "x" && !errored) src = xAvatarSrc(vendor.handle);

  if (!src) {
    return (
      <div
        className="w-14 h-14 rounded-full bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] flex items-center justify-center font-mono text-base font-semibold text-[var(--accent-ink)]"
        aria-hidden
      >
        {modalInitials(vendor.name || vendor.handle)}
      </div>
    );
  }
  return (
    // Descriptive alt text · SEO site-audit 2026-05-28 fix · vendor
    // name keyword density helps image-search ranking + a11y.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${vendor.name || vendor.handle} · accepts Bitcoin`}
      width={56}
      height={56}
      onError={() => setErrored(true)}
      className="w-14 h-14 rounded-full object-cover border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] lit-active"
      loading="eager"
      referrerPolicy="no-referrer"
    />
  );
}

// Local initials helper (the homepage's `initials` is module-private).
function modalInitials(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
