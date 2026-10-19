// /v/[slug] · per-vendor detail page.
//
// Why this exists:
// User feedback (May 2026) is that the vendor directory is the
// strongest acquisition surface on the site. Per-vendor pages turn
// 1 indexable page into 55 (one per vendor + the directory itself),
// each independently shareable and SEO-targetable for "[vendor name]
// bitcoin" type queries.
//
// Vendor flywheel design:
//   1. New vendor lands · auto-tweet announces it (cron-driven,
//      see SOCIAL_AUTOMATION.md)
//   2. The tweet links to /v/[slug] · vendor's own page, owned by
//      Galaxy Mind, optimized for them
//   3. Vendor RTs the announcement → their audience visits → some
//      stay on Galaxy Mind, browse other vendors, sign up for
//      alerts, find the Buying Gauge
//
// Content per page:
//   - Vendor name, handle, country, category, verified date
//   - Long-form description (full, not truncated like the card)
//   - Direct CTA buttons (View on X / Nostr / Pay via Lightning)
//   - "Share this vendor" with X compose URL pre-filled
//   - Stale warning if past the 180-day human-touch backstop
//   - Cross-link back to the directory + related categories
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { CountryMark } from "@/components/CountryMark";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  HOUSE_HANDLE,
  VENDORS,
  findVendorBySlug,
  vendorSlug,
  vendorKey,
  vendorSiblings,
  formatVerifiedDate,
  isStale,
  isNewThisWeek,
  STALE_THRESHOLD_DAYS,
  getPlatform,
  getActionUrl,
  getActionLabel,
  getDisplayHandle,
  lightningHref,
  vendorWebsite,
} from "@/lib/vendors";
import { vendorLogoSrc } from "@/lib/avatars";
import { VendorBadgeEmbed } from "@/components/VendorBadgeEmbed";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { ShareVendorButton } from "@/components/ShareVendorButton";
import { RecentlyViewedVendors } from "@/components/RecentlyViewedVendors";
import { FoundingBadge } from "@/components/FoundingBadge";
import { VendorRecentPosts } from "@/components/VendorRecentPosts";
import { VendorOutbound } from "@/components/VendorOutbound";
import { TrackedLink } from "@/components/TrackedLink";
import { vendorShelf, shelfFits } from "@/lib/shelves";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { getActivity, daysBetween } from "@/lib/vendor-activity";
import { VendorPager } from "./VendorPager";
import { VendorJourneyTracker } from "./VendorJourneyTracker";
import { SiteHeader } from "@/components/SiteHeader";
import { isSafeHttpsHref } from "@/lib/outbound-url";

const SITE_URL = "https://galaxymind.space";

// These pages perform live KV reads (dormancy) + Nostr relay fetches
// (recent activity) on every request. Marking force-dynamic prevents
// the repeated "Dynamic server usage" warnings during `next build`
// while still allowing generateStaticParams for the slug list (the
// data fetching will simply run at request time).
export const dynamic = "force-dynamic";

// Build-time slug list · used for static generation of the shell.
// The actual data (recent posts, dormancy) is fetched dynamically.
export function generateStaticParams() {
  return VENDORS.map((v) => ({ slug: vendorSlug(v) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vendor = findVendorBySlug(slug);
  if (!vendor) return { title: "Vendor not found · Galaxy Mind" };

  const country = vendor.country ? COUNTRIES[vendor.country]?.label : null;
  const title = `${vendor.name} · accepts Bitcoin · Galaxy Mind`;
  const suffix = `${country ? ` Based in ${country}.` : ""} Verified by Galaxy Mind ${formatVerifiedDate(vendor.verifiedAt)}.`;
  const blurbCap = 155 - suffix.length;
  let blurb = vendor.description;
  if (blurb.length > blurbCap) {
    const truncated = blurb.slice(0, blurbCap);
    const lastBreak = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf(" · "),
    );
    if (lastBreak > blurbCap * 0.6) {
      blurb = truncated.slice(0, lastBreak + 1);
    } else {
      blurb = truncated.slice(0, blurbCap - 1).trimEnd() + "…";
    }
  }
  let description = `${blurb}${suffix}`;
  if (description.length < 110) {
    const extra = ` ${CATEGORY_LABELS[vendor.category]} · monitored daily.`;
    if (description.length + extra.length <= 155) description += extra;
  }
  const url = `${SITE_URL}/v/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: "Galaxy Mind",
      images: pageOgImage(`/v/${slug}/opengraph-image/${slug}`, title),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: "@GalaxyMind",
    },
  };
}

export default async function VendorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vendor = findVendorBySlug(slug);
  if (!vendor) notFound();

  const platformForActivity = getPlatform(vendor);
  const activity =
    platformForActivity === "nostr"
      ? await getActivity(vendor.handle)
      : null;
  const activityDaysAgo =
    activity && Number.isFinite(activity.lastSeenAt)
      ? daysBetween(activity.lastSeenAt, Math.floor(Date.now() / 1000))
      : null;

  const platform = getPlatform(vendor);
  const actionUrl = getActionUrl(vendor);
  const actionLabel = getActionLabel(vendor);
  const displayHandle = getDisplayHandle(vendor);
  const country = vendor.country ? COUNTRIES[vendor.country] : null;
  const stale = isStale(vendor.verifiedAt);
  const fresh = isNewThisWeek(vendor);
  const shopHref = vendorWebsite(vendor);
  const shopCheckClause = shopHref
    ? ", and the shop page is watched for it to stop mentioning bitcoin or Lightning at all"
    : "";
  const hasShop = !!(shopHref && isSafeHttpsHref(shopHref));
  // The shop's own og:image or storefront screenshot, already committed for
  // the homepage tiles. Homepage visitors see it before they open a shop;
  // /v visitors (Google, shared links, the shop's own followers) never did,
  // so the listing read as a text card with a button.
  const shelf = hasShop ? vendorShelf(vendor) : null;
  const shelfHost = (() => {
    try {
      return new URL(shopHref!).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  // Same-identity shops get their own section; keep them out of the
  // category strip so a sibling never shows twice.
  const siblings = vendorSiblings(vendor);
  const siblingKeys = new Set(siblings.map(vendorKey));
  const related = VENDORS.filter(
    (v) =>
      v.category === vendor.category &&
      vendorKey(v) !== vendorKey(vendor) &&
      !siblingKeys.has(vendorKey(v)),
  )
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 3);

  const categoryHref = `/spend-bitcoin-on/${vendor.category}`;
  const categoryLabel = CATEGORY_LABELS[vendor.category];

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-8 pb-20">
        <VendorJourneyTracker vendorKey={vendorKey(vendor)} />
        <VendorPager currentKey={vendorKey(vendor)} />

        {/* Visible trail · layout.tsx BreadcrumbList must stay in sync. */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 t-xs text-[var(--text-tertiary)]">
            <li>
              <Link
                href="/"
                className="hover:text-[var(--accent-ink)] transition-colors"
              >
                Directory
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={categoryHref}
                className="hover:text-[var(--accent-ink)] transition-colors"
              >
                {categoryLabel}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li
              className="text-[var(--text-secondary)] truncate max-w-[14rem]"
              aria-current="page"
            >
              {vendor.name}
            </li>
          </ol>
        </nav>

        <div className="night-bench-kicker mb-3">
          Verified bitcoin vendor
          {fresh && (
            <span className="ml-3 text-[var(--accent-ink)]">★ New this week</span>
          )}
          {stale && (
            <span className="ml-3 text-[var(--warning)]">
              ⚠ Awaiting re-verification
            </span>
          )}
        </div>

        <VendorLogo vendor={vendor} />

        <h1 className="display-title mb-3 mt-4">
          {vendor.name}
        </h1>

        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <span className="font-mono text-sm text-[var(--accent-ink)] truncate">
            {displayHandle}
          </span>
          {vendor.country && country && (
            <span className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <CountryMark code={vendor.country} />
              {country.label}
            </span>
          )}
          <FoundingBadge addedAt={vendor.addedAt} />
        </div>

        {vendor.founderName &&
        (vendor.founderPhoto || vendor.quote) ? (
          <FounderBlock
            name={vendor.founderName}
            photo={vendor.founderPhoto}
            quote={vendor.quote}
          />
        ) : vendor.founderName ? (
          <div className="text-sm text-[var(--text-tertiary)] mb-6">
            Made by{" "}
            <span className="text-[var(--text-secondary)]">
              {vendor.founderName}
            </span>
          </div>
        ) : (
          <div className="mb-3" />
        )}

        <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed mb-6">
          {vendor.description}
        </p>

        <div className="flex flex-wrap items-baseline gap-2 mb-6">
          <span className="t-xs font-medium text-[var(--accent-ink)] px-2.5 py-1 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30">
            {CATEGORY_LABELS[vendor.category]}
          </span>
          <span className="t-xs text-[var(--text-tertiary)]">
            Platform:{" "}
            <span className="text-[var(--text-secondary)]">
              {platform === "x"
                ? "X / Twitter"
                : platform === "nostr"
                  ? "Nostr"
                  : "Lightning Address"}
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
          <span
            className={`t-xs ${
              stale ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
            }`}
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

        {activity && activityDaysAgo !== null && (
          <div className="mb-6 inline-flex items-baseline gap-2 px-3 py-1.5 rounded-full border border-[#4ADE80]/40 bg-[#4ADE80]/5 text-[#86efac] text-xs">
            <span aria-hidden>●</span>
            <span className="t-xs font-medium">
              Recently active on Nostr
            </span>
            <span className="font-mono t-xs tracking-widest text-[#86efac]/80">
              {activityDaysAgo === 0
                ? "· today"
                : activityDaysAgo === 1
                  ? "· yesterday"
                  : `· last seen ${activityDaysAgo}d ago`}
            </span>
          </div>
        )}

        {platform === "nostr" && (
          <VendorRecentPosts handle={vendor.handle} />
        )}

        {(() => {
          const lnHref = lightningHref(vendor.lightningAddress);
          if (!lnHref) return null;
          return (
            <div className="mb-6 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-4">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div className="t-xs font-medium text-[var(--accent-ink)]">
                  ⚡ Tip {vendor.name} in sats
                </div>
                <div className="t-xs font-medium text-[var(--text-tertiary)] hidden sm:inline">
                  Direct to vendor
                </div>
              </div>
              <a
                href={lnHref}
                className="block w-full px-4 py-3 rounded-md bg-[var(--accent)] text-black font-mono text-sm font-semibold text-center hover:bg-[var(--accent-hover)] hover:lit-primary transition-all break-all"
                title="Open your Lightning wallet with this address pre-filled"
              >
                {vendor.lightningAddress}
              </a>
              <div className="mt-2 t-xs text-[var(--text-tertiary)] leading-relaxed">
                Click to open your Lightning wallet · the address is
                pre-filled · you choose the amount.
              </div>
            </div>
          );
        })()}

        {(vendor.acceptsLightning === false ||
          vendor.acceptsOnChain === false) && (
          <div className="flex flex-wrap items-center gap-2 mb-8 t-xs">
            <span className="text-[var(--text-tertiary)]">Accepts:</span>
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
          </div>
        )}

        <div className="flex flex-wrap items-baseline gap-3 mb-10">
          {hasShop ? (
            <VendorOutbound
              href={shopHref!}
              slug={slug}
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
            >
              Visit shop
            </VendorOutbound>
          ) : (
            <TrackedLink
              href={actionUrl}
              target={platform === "lightning" ? undefined : "_blank"}
              rel={platform === "lightning" ? undefined : "noopener noreferrer"}
              event="vendor_click"
              data={{
                handle: vendor.handle,
                platform,
                surface: "vendor_page",
                category: vendor.category,
              }}
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
            >
              {actionLabel}
            </TrackedLink>
          )}

          {hasShop && (
            <TrackedLink
              href={actionUrl}
              target={platform === "lightning" ? undefined : "_blank"}
              rel={platform === "lightning" ? undefined : "noopener noreferrer"}
              event="vendor_click"
              data={{
                handle: vendor.handle,
                platform,
                surface: "vendor_page",
                category: vendor.category,
              }}
              className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[14px] font-semibold hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-all"
            >
              {actionLabel}
            </TrackedLink>
          )}

          <ShareVendorButton vendor={vendor} />
        </div>

        {/* Shop window · the same shelf picture the homepage tile shows,
            as a second, larger way into the shop. Only when the shop has
            a website and a committed shelf image; otherwise nothing. Goes
            through VendorOutbound (utm_source, noopener, house shop stays
            in-tab) and counts as vendor_outbound dest "shelf". */}
        {hasShop && shelf && (
          <VendorOutbound
            href={shopHref!}
            slug={slug}
            dest="shelf"
            className="vendor-cell max-w-md mb-10"
          >
            <div className="vendor-shelf">
              <div className="vendor-shelf-frame">
                {!shelfFits(shelf) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="vendor-photo-bed"
                    src={shelf.src}
                    alt=""
                    aria-hidden
                    loading="lazy"
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={`vendor-photo${shelfFits(shelf) ? "" : " is-contained"}`}
                  src={shelf.src}
                  alt={`${vendor.name} shop`}
                  width={640}
                  height={480}
                  loading="lazy"
                />
              </div>
            </div>
            <span className="flex items-baseline justify-between gap-3 px-4 py-2.5 t-xs">
              <span className="font-mono text-[var(--text-secondary)] truncate">
                {shelfHost ?? vendor.name}
              </span>
              <span className="shrink-0 font-medium text-[var(--accent-ink)]">
                Visit shop ↗
              </span>
            </span>
          </VendorOutbound>
        )}

        <VendorBadgeEmbed
          slug={vendorSlug(vendor)}
          name={vendor.name}
        />

        {vendor.nostrPubkey && (
          <div className="mb-10">
            <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
              Also reachable on
            </div>
            <div className="flex flex-wrap items-baseline gap-4 text-sm">
              <a
                href={`https://njump.me/${vendor.nostrPubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Nostr →
              </a>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 mb-10">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            How we verify
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
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
                  className="underline"
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

        {/* Multi-shop (2026-10) · other listings run by the same
            identity. Server-rendered so the sibling /v links are in the
            HTML for crawlers; absent for every single-shop handle. */}
        {siblings.length > 0 && (
          <section className="mb-10" data-testid="more-from-handle">
            <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
              More from {getDisplayHandle(vendor)}
            </h2>
            <ul className="space-y-3">
              {siblings.map((v) => {
                const logo = vendorLogoSrc(v);
                return (
                  <li key={vendorKey(v)}>
                    <Link
                      href={`/v/${vendorSlug(v)}`}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 hover:lit-active transition-all p-4"
                    >
                      {logo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logo}
                          alt=""
                          width={32}
                          height={32}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 shrink-0 rounded-full object-cover border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3 mb-1">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {v.name}
                          </span>
                          {v.country && <CountryMark code={v.country} />}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] line-clamp-2">
                          {v.description}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {related.length > 0 && (
          <section className="mb-10">
            <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
              More {CATEGORY_LABELS[vendor.category]} vendors
            </h2>
            <ul className="space-y-3">
              {related.map((v) => (
                <li key={vendorKey(v)}>
                  <Link
                    href={`/v/${vendorSlug(v)}`}
                    className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 hover:lit-active transition-all p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {v.name}
                      </span>
                      {v.country && <CountryMark code={v.country} />}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] line-clamp-2">
                      {v.description}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="mt-4 inline-flex items-baseline gap-1 text-xs text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              See all {VENDORS.length} vendors →
            </Link>
          </section>
        )}

        {vendor.handle !== HOUSE_HANDLE && <VendorHashrateModule />}

        <RecentlyViewedVendors
          excludeKey={vendorKey(vendor)}
          headline="⌬ Also viewed"
          className="mb-10"
        />

        <div className="mt-12 pt-6 border-t border-[var(--border-subtle)] flex flex-wrap items-baseline gap-x-4 gap-y-1 t-xs text-[var(--text-tertiary)]">
          <span>More on Galaxy Mind</span>
          <Link
            href="/should-i-buy-bitcoin"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            Should I buy? →
          </Link>
          <Link
            href="/fit"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            How much to own →
          </Link>
          <Link
            href="/treasuries"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            Treasuries →
          </Link>
          <Link
            href="/glossary"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            Glossary →
          </Link>
          <Link
            href="/about"
            className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
          >
            About →
          </Link>
        </div>
      </article>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-8 mb-6">
        <InlineSubscribePrompt
          source="vendors"
          headline="Get new merchants like this one in the weekly digest"
        />
      </div>

      <FooterDisclaimer />
    </main>
  );
}

function VendorLogo({
  vendor,
}: {
  vendor: import("@/lib/vendors").Vendor;
}) {
  // The shop's own logo, else the account avatar (lib/avatars).
  const src = vendorLogoSrc(vendor);

  if (!src) {
    return (
      <div
        className="w-16 h-16 rounded-full bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] flex items-center justify-center font-mono text-lg font-semibold text-[var(--accent-ink)]"
        aria-hidden
      >
        {(vendor.name || vendor.handle)
          .replace(/[^a-zA-Z0-9 ]/g, " ")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((s) => s[0]!.toUpperCase())
          .join("")
          .padEnd(1, "?")
          .slice(0, 2)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${vendor.name || vendor.handle} · Bitcoin merchant logo`}
      width={64}
      height={64}
      className="w-16 h-16 rounded-full object-cover border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] lit-active"
      loading="eager"
      referrerPolicy="no-referrer"
    />
  );
}

function FounderBlock({
  name,
  photo,
  quote,
}: {
  name: string;
  photo?: string;
  quote?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={`${name}, founder`}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full object-cover border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] shrink-0"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="text-sm text-[var(--text-tertiary)]">
          Made by{" "}
          <span className="text-[var(--text-secondary)]">{name}</span>
        </div>
      </div>
      {quote && (
        <blockquote className="mt-3 pl-4 border-l-2 border-[var(--accent)]/40 italic text-sm text-[var(--text-secondary)] leading-relaxed">
          &ldquo;{quote}&rdquo;
          <footer className="not-italic t-xs font-medium text-[var(--text-tertiary)] mt-1">
            {name}
          </footer>
        </blockquote>
      )}
    </div>
  );
}