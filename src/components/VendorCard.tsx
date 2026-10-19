"use client";

/* =====================================================================
 * VendorCard · the directory tile. ONE component, TWO surfaces:
 *
 *   1. The homepage grid (src/app/HomeClient.tsx) · full interactive
 *      mode: heart, roving keyboard focus, popLayout exit animation.
 *   2. DirectoryShelf (country/category hubs, LATAM, listicles) ·
 *      same cell + onOpenDetail so a plain click opens the modal
 *      and the heading stays a crawlable /v/[slug] link.
 *   3. The /submit live preview · static mode: no callbacks, the
 *      submitter sees EXACTLY the card the directory will render.
 *
 * "Also sold on" marketplace links (2026-10-18) are the only outbound
 * paths on the card · see the note above .vendor-also below.
 *
 * Night Bench cell grammar (2026-08-23): lit shelf (shop-sign plate)
 * · name as heading · one sentence · subdued flag + dater. Whole card
 * is the action. The identical "Verified by a human" stamp is gone —
 * that claim lives once at page level. The millboard 45° clip lives
 * on the depicted tag, never on the card (ticket/raffle register).
 * ===================================================================== */

import { useState, type Ref } from "react";
import { motion } from "framer-motion";
import {
  type Vendor,
  formatVerifiedDate,
  isStale,
  isNew,
  getPlatform,
  getDisplayHandle,
  vendorSlug,
  alsoSoldOnLinks,
} from "@/lib/vendors";
import { xAvatarSrc } from "@/lib/avatars";
import { isSafeHttpsHref } from "@/lib/outbound-url";
import { vendorShelf, shelfFits } from "@/lib/shelves";
import { CountryMark } from "@/components/CountryMark";
import { useHydrated } from "@/lib/use-hydrated";

export function VendorCard({
  vendor,
  index,
  isFocused = false,
  lamp = false,
  saved = false,
  onToggleSave,
  onOpenDetail,
  onFocusWithin,
  // React 19 ref-as-prop. AnimatePresence popLayout injects a
  // measurement ref via cloneElement; it MUST reach the DOM node or
  // exiting cards are never position:absolute-popped out of the grid
  // flow (review 2026-07-02 · dropping it silently degraded the exit
  // animation to an in-place fade + double reflow in every browser).
  ref,
}: {
  vendor: Vendor;
  index: number;
  isFocused?: boolean;
  /** Bench lamp — featured / focused card sits in the pool of light. */
  lamp?: boolean;
  saved?: boolean;
  onToggleSave?: () => void;
  onOpenDetail?: () => void;
  onFocusWithin?: () => void;
  ref?: Ref<HTMLElement>;
}) {
  const platform = getPlatform(vendor);
  const displayHandle = getDisplayHandle(vendor);
  const lit = isFocused || lamp;
  const fresh = isNew(vendor);
  const stale = isStale(vendor.verifiedAt);
  const shelf = vendorShelf(vendor);
  const fits = shelf ? shelfFits(shelf) : true;
  const alsoSold = alsoSoldOnLinks(vendor);
  // The save heart only works with JS (localStorage), so it is mounted
  // after hydration instead of being server-rendered on all ~140 cards
  // (about 19 KB of the home HTML, 2026-10-18). .vendor-foot reserves its
  // height so nothing shifts when it appears.
  const hydrated = useHydrated();

  // The ENTIRE card is the affordance · click anywhere on it (photo
  // included) to open the in-page detail modal. Card surface has ZERO
  // OUTBOUND paths — the May 2026 decision survives. The heading
  // <a href="/v/[slug]"> is the crawlable / cmd-click control; a
  // stretched ::after plus an article click handler both open the
  // modal on a plain click (the heading's overflow:hidden used to
  // clip that overlay, so only the name was tappable). The heart is
  // a sibling raised above the stretch. Preview mode (/submit)
  // keeps the heading as text.
  const handleCardClick = () => {
    if (!onOpenDetail) return;
    onOpenDetail();
  };

  return (
    <motion.article
      ref={ref}
      role="listitem"
      data-vendor-card
      data-vc-index={index}
      onFocus={onFocusWithin}
      onClick={(e) => {
        if (!onOpenDetail) return;
        if ((e.target as HTMLElement | null)?.closest(".vendor-save, .vendor-also")) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (e.button !== 0) return;
        handleCardClick();
      }}
      layout
      initial={false}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className={`vendor-cell group${lit ? " is-lamp" : ""}`}
    >
      <div className="vendor-shelf">
        {/* Clip the photo/sign here, not on .vendor-shelf — the maker
            mark hangs 26px below the shelf and was losing its lower
            half to overflow:hidden. */}
        <div className="vendor-shelf-frame">
          {shelf ? (
            <>
              {/* THE BED. Only for images that do not fit the 4:3 shelf —
                  34% of the roster are og:image cards at 1.905, and cover
                  was taking up to 47% off their width, straight through
                  the shop's own name ("The Bitcoin Act" rendered as "he
                  Bitcoin Ac"). Those now sit CONTAINED on a blurred,
                  darkened copy of themselves, so the whole sign shows and
                  the tile still fills. Same src, so the browser fetches
                  once. The 66 screenshots that already fit skip this
                  entirely and render exactly as before. */}
              {!fits && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="vendor-photo-bed"
                  src={shelf.src}
                  alt=""
                  aria-hidden
                  loading={index < 8 ? "eager" : "lazy"}
                />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={`vendor-photo${fits ? "" : " is-contained"}`}
                src={shelf.src}
                alt={`${vendor.name} shop`}
                width={640}
                height={480}
                loading={index < 8 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : undefined}
              />
            </>
          ) : (
            <div className="vendor-sign" data-cat={vendor.category}>
              <div className="vendor-tag">
                <span className="vendor-plate">{vendor.name}</span>
              </div>
            </div>
          )}
        </div>
        <div className="vendor-mm">
          <MakerMark
            handle={vendor.handle}
            name={vendor.name}
            platform={platform}
            pictureUrl={vendor.pictureUrl}
          />
        </div>
      </div>

      <div className="vendor-body">
        <h3 className="vendor-name">
          {onOpenDetail ? (
            <a
              href={`/v/${vendorSlug(vendor)}`}
              data-vc-open
              onClick={(e) => {
                if (
                  e.button !== 0 ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey
                ) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                handleCardClick();
              }}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              }}
              aria-label={`View details for ${vendor.name}`}
            >
              <span className="vendor-name-text">{vendor.name}</span>
            </a>
          ) : (
            vendor.name
          )}
        </h3>
        {displayHandle !== vendor.name && (
          <span className="sr-only">{displayHandle}</span>
        )}
        <p className="vendor-desc">{vendor.description}</p>
        {/* "Also sold on" (operator-approved 2026-10-18): the one deliberate
            exception to the card's no-outbound rule. Small, nofollow,
            raised above the stretched open-modal overlay, and excluded
            from the article click handler so a tap goes to the shop's
            marketplace storefront instead of opening the modal. */}
        {alsoSold.length > 0 && (
          <p className="vendor-also">
            <span className="vendor-also-label">Also sold on</span>
            {alsoSold.map((l) => (
              <a
                key={l.marketplace}
                href={l.url}
                target="_blank"
                rel="nofollow noopener"
                data-also-sold-on={l.marketplace}
                aria-label={`${vendor.name} on ${l.label} (opens in a new tab)`}
                onClick={(e) => e.stopPropagation()}
              >
                {l.label}
              </a>
            ))}
          </p>
        )}
        <div className="vendor-foot">
          <span className="vendor-geo">
            {vendor.country && <CountryMark code={vendor.country} />}
            <span className="vendor-dater">
              <span
                className={`vendor-lamp-dot${fresh ? " is-new" : stale ? " is-stale" : ""}`}
                aria-hidden
              />
              <span>
                {stale
                  ? "Re-check due"
                  : fresh
                    ? "Just in"
                    : formatVerifiedDate(vendor.verifiedAt)}
              </span>
            </span>
          </span>
          {onToggleSave && hydrated && (
            <button
              type="button"
              className="vendor-save"
              aria-pressed={saved}
              aria-label={
                saved
                  ? `Remove ${vendor.name} from saved`
                  : `Save ${vendor.name} for later`
              }
              title={saved ? "Remove from saved" : "Save for later"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSave();
              }}
            >
              {saved ? "♥" : "♡"}
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function MakerMark({
  handle,
  name,
  platform = "x",
  pictureUrl,
}: {
  handle: string;
  name: string;
  platform?: "x" | "nostr" | "lightning";
  pictureUrl?: string;
}) {
  const [errored, setErrored] = useState(false);

  let src: string | null = null;
  if (pictureUrl && isSafeHttpsHref(pictureUrl) && !errored) src = pictureUrl;
  else if (platform === "x" && !errored) src = xAvatarSrc(handle);

  if (!src) {
    return (
      <span className="vendor-mm-chip" aria-hidden>
        {initials(name || handle)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name || handle} · accepts Bitcoin`}
      width={56}
      height={56}
      onError={() => setErrored(true)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function initials(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
