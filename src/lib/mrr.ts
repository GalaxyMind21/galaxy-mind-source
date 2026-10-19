/* =====================================================================
 * mrr.ts · MiningRigRentals public API client.
 *
 * Everything here is UNAUTHENTICATED public data. There is deliberately
 * no write path: MRR's createRental takes the RENTER's own pool profile
 * and charges the API key owner's balance, so renting on a visitor's
 * behalf would mean holding their bitcoin. See the spec's "Why no
 * custody" section before adding anything that posts.
 *
 * Rate limit is 100 req/min per IP. All calls are server-side and ride
 * the Next data cache, so a viral spike costs MRR nothing extra.
 * ===================================================================== */

import { upstreamFetchJson } from "@/lib/upstream";
import { toPhs } from "@/lib/hashprice";

const API = "https://www.miningrigrentals.com/api/v2";

/** The algo our machines actually run. NOT "sha256" — different book. */
export const ALGO = "sha256ab";

export type MrrRig = {
  id: string;
  name: string;
  owner: string;
  region: string;
  /**
   * Site status is rented vs available only (operator 2026-09-14).
   * `normaliseRig` never reads MRR `online` or `disabled` into this
   * field: every owned box is live, and checkout on MRR is the offline
   * gate. "coming-online" / "offline" stay on the union for phantom
   * gauge slots and tests; live MRR does not emit them.
   */
  status: "rented" | "available" | "offline" | "coming-online";
  hoursLeft: number | null;
  /** Raw MRR flag. Do not drive site status from this. */
  online: boolean;
  advertisedPh: number | null;
  measuredPh: number | null;
  askBtcPerPhDay: number | null;
  minHours: number | null;
  maxHours: number | null;
  /** MRR's Rig Performance Index. "new" on fresh listings — NOT numeric. */
  rpi: string | null;
  rentUrl: string;
};

export type MrrAlgoStats = {
  floor: number | null;
  clearedLast30: number | null;
  clearedLast10: number | null;
  suggested: number | null;
  availableRigs: number | null;
  availablePh: number | null;
  rentedRigs: number | null;
  rentedPh: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Operator's MRR referral id.
 *
 * DECLINED 2026-08-06, REVERSED 2026-08-08 — both operator decisions.
 * The reversal is recorded rather than the old reasoning deleted, because
 * the tradeoff did not disappear; the operator accepted it.
 *
 * What was weighed the first time, and still holds: the program pays 0.1%
 * of every transaction a referred account completes, for life, no ceiling
 * (verified at miningrigrentals.com/helpcenter/Referral-Program/20). A
 * full WEEK of one 255 TH machine rents for ~0.00125 BTC, so the
 * commission on it is about eight cents. Against that, MRR's own rules
 * ban "automated or hidden links" and restrict referrals to people you do
 * not already know — and a referral URL inside a machine-readable recipe
 * that AI agents follow programmatically is a fair description of an
 * automated link.
 *
 * What changed: the operator judged zero attribution to be the larger
 * risk to the site's survival, and chose full coverage with the link
 * DISCLOSED everywhere it appears. Disclosure is the whole defense
 * against the "hidden links" clause, so it is not decorative and not
 * optional — `scripts/test-rental-quote.ts` fails the build if a
 * referral-bearing signup URL ever ships without it.
 *
 * Set to null to turn the entire program off again: every helper below
 * falls back to the plain URL and the disclosure disappears with it.
 *
 * REVERSED AGAIN 2026-08-13 (operator decision) · was null. bitcoin.org's
 * Spend-page reviewer had just removed 99bitcoins for turning into an
 * affiliate portal. The listing won over ~8 cents per machine-week.
 *
 * Tried ON again 2026-08-22 after click-through leakage (people left
 * /hashrate and rented someone else's machine). Rolled back the same
 * day: the live bitcoin.org listing (PR #4912) and being able to say
 * the site is affiliate-free were judged worth more than 0.1%.
 *
 * REVERSED AGAIN 2026-08-26 (operator decision) · back on. MiningRigRentals
 * ToS plus the Referral Program help-center page allow website owners to
 * participate; they ban HIDDEN and automated-undisclosed links, not
 * labelled ones, and they invite pool/website/exchange owners to place
 * the referral on their own site. Disclosure is still the whole defense
 * against that clause. The bitcoin.org listing remains a risk (the
 * directory itself stays unpaid; 99bitcoins was removed for becoming an
 * affiliate portal). The operator accepted that after checking the ToS.
 *
 * This is the whole switch: rent CTAs, the Offer JSON-LD, the agent
 * quote's signup URL and the seller link all inherit ?ref= from here.
 *
 * Turning it off is a one-token change, but it is NOT only a one-token
 * change: the four independence claims (/about x2, /faq, llms.txt) and the
 * two REFERRAL_NOTICE render sites move WITH this constant, in the same
 * commit, every time. A site that denies on three surfaces what it does on
 * a fourth is the exact failure this constant keeps causing.
 */
// 2026-10-16 (operator): rentals funnel through Galaxy Mind direct, so no referral id ships.
export const MRR_REFERRAL_ID: string | null = null;

/**
 * Attach the operator's referral id to an MRR URL.
 *
 * Verified 2026-08-08: /rigs/{id}, /u/{user} and /register all return 200
 * with the param attached. MRR only ADVERTISES three referral URLs (home,
 * register, profile), so attribution on a rig deep-link is unconfirmed —
 * the bounded downside is that it does nothing, never that it breaks the
 * rent CTA, which is why it rides there too.
 */
export function withReferral(url: string): string {
  if (MRR_REFERRAL_ID == null) return url;
  const u = new URL(url);
  u.searchParams.set("ref", MRR_REFERRAL_ID);
  return u.toString();
}

/**
 * Canonical HTTPS rent link.
 *
 * MRR's own `shorturl` field is http:// (verified 2026-08-02) and is
 * never used — an http link is not acceptable under our CSP posture.
 *
 * This is the single origin of `MrrRig.rentUrl`, so the referral rides
 * every rent CTA, the Offer JSON-LD and the agent quote from one place.
 */
/** Our own rent destination: the browser checkout at /hashrate/rent.
 *  JSON-LD offers and MrrRig.rentUrl point here. It was /hashrate#rent-with-ai
 *  until 2026-10-16, and every "Rent now" on /hashrate opened that same page
 *  again in a new tab, which read as a loop (operator). /hashrate/rent is never
 *  a loop: it is the checkout when RENTALS_HUMAN_CHECKOUT is on, and an
 *  "opening soon" card pointing at /hashrate/agents when it is off.
 *  The id/hours args are kept for call-site compatibility and deliberately
 *  not exposed. */
export const CHECKOUT_PATH = "/hashrate/rent";
export const AGENTS_PATH = "/hashrate/agents";
export const OWN_RENT_URL = `https://galaxymind.space${CHECKOUT_PATH}`;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function rentUrlFor(_id: string, _hours?: number): string {
  return OWN_RENT_URL;
}

/** Same-tab link to the checkout for the on-page "Rent now" buttons, with
 *  the chosen machine count and window preselected (whole days, rounded up).
 *  Only small integers ride the URL, never a rig id. The checkout clamps both
 *  to its own limits, so an out-of-range value just lands on the nearest one. */
export function checkoutHref(rigs?: number, hours?: number): string {
  const q: string[] = [];
  if (typeof rigs === "number" && Number.isFinite(rigs) && rigs >= 1) q.push(`rigs=${Math.min(30, Math.floor(rigs))}`);
  if (typeof hours === "number" && Number.isFinite(hours) && hours > 0) q.push(`days=${Math.min(30, Math.max(1, Math.ceil(hours / 24)))}`);
  return q.length ? `${CHECKOUT_PATH}?${q.join("&")}` : CHECKOUT_PATH;
}

/**
 * Public register page, PLAIN — never rendered directly when a referral
 * is set, but kept as the un-reffed baseline the disclosure invariant
 * compares against. Don't inline this string somewhere else.
 */
export const MRR_REGISTER_URL = "https://www.miningrigrentals.com/register";

/** Signup link used by every handoff. Carries the referral when set. */
export const MRR_REFERRAL_URL: string | null =
  MRR_REFERRAL_ID != null ? withReferral(MRR_REGISTER_URL) : null;

/**
 * The public page behind every number on /hashrate — the "check it
 * yourself" link. Nothing linked to it before 2026-08-08, which left
 * that claim unclickable.
 *
 * It pointed at /u/GalaxyMind until 2026-08-19, and that URL is
 * LOGIN-WALLED: fetched logged-out it returns HTTP 200 whose body reads
 * "you need to be logged into our service to view profiles" followed by
 * the literal words "404 Not Found!". So the one link aimed at an
 * unconvinced skeptic — the exact visitor it exists for — dead-ended in
 * a 404, and the 200 status meant no link checker ever flagged it.
 *
 * The algorithm page is fully public, renders our listings with
 * "Owner GalaxyMind" against everyone else's, and is also where MRR's
 * own Quick Rent / Rig Finder basket lives for anyone wanting several
 * machines at once. Verify with a logged-out fetch before changing it.
 */
export const MRR_SELLER_URL = AGENTS_PATH;

/**
 * The "check it yourself" link's BEST target, chosen from the live fleet.
 *
 * MRR_SELLER_URL above (the algorithm page) is honest but does not do the
 * job it was given: measured 2026-08-27 it renders page 1 of roughly 1,361
 * listings and NONE of ours appear on it, because our machines sit deeper
 * in the pagination. So a visitor who clicked "see every machine listed"
 * met a wall of other sellers' rigs and no proof of us at all. On a page
 * whose whole argument is "each block is a real machine", that is the one
 * link that had to land.
 *
 * Our own listing pages ARE fully public (verified logged-out: one of our
 * rigs returns 200 with the listing rendered, unlike /u/GalaxyMind, which is
 * login-walled behind a 200 · see the note above). So point the skeptic at
 * a real Galaxy Mind listing, preferring one they can actually book, since
 * landing on a rented machine proves the fleet exists but sells nothing.
 *
 * Falls back to the algorithm page when the fleet feed is down, which is
 * the honest degraded answer rather than a link built from a guessed id.
 */
export function sellerProofUrl(
  rigs: readonly { id: string; status: string }[],
): { href: string; isOurListing: boolean } {
  void rigs;
  // Labelled "Rent with your AI bot": a plain same-tab link to the agents page.
  return { href: AGENTS_PATH, isOurListing: false };
}

// Listing `name`/`owner`/`region` are operator-authored free text.
// `description` is HTML and is dropped; the other three used to pass
// through with only a typeof check (security review F7, 2026-08-04).
// They feed CORS-open `/api/hashrate`, the MCP tool, and JSON-LD, so
// a listing can inject `</script>` or bidi overrides. Bound + strip
// here at the projection, the same place we already refuse shorturl.
const MRR_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MRR_RPI_RE = /^[A-Za-z0-9._-]{1,16}$/;
function mrrText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, max)
    .trim();
}

/**
 * Project a raw MRR rig onto our own allow-listed shape.
 *
 * Deliberately a projection, not a spread: `description` carries raw
 * operator-authored HTML and `shorturl` is http, so neither may leak
 * into anything we render. Same discipline as toPublicVendor.
 */
export function normaliseRig(raw: unknown): MrrRig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && MRR_ID_RE.test(r.id) ? r.id : null;
  if (!id) return null;

  const st = (r.status ?? {}) as Record<string, unknown>;
  const online = r.online === true;
  const rented = st.rented === true;
  // Operator 2026-09-14: do not second-guess the box. Every owned
  // machine is live; MRR checkout refuses a listing that is actually
  // down. Reading `online` / `disabled` here invented an offline row
  // the operator then had to walk back (bay #16). Rented is the
  // only status the site owns.
  const status: MrrRig["status"] = rented ? "rented" : "available";

  const hr = (r.hashrate ?? {}) as Record<string, unknown>;
  const adv = (hr.advertised ?? {}) as Record<string, unknown>;
  const last = (hr.last_5min ?? {}) as Record<string, unknown>;

  const price = (r.price ?? {}) as Record<string, unknown>;
  const btc = (price.BTC ?? {}) as Record<string, unknown>;
  const askEnabled = btc.enabled === true;
  const ask = askEnabled ? num(btc.price) : null;

  return {
    id,
    name: mrrText(r.name, 120),
    owner: mrrText(r.owner, 64),
    region: mrrText(r.region, 32),
    status,
    hoursLeft: rented ? num(st.hours) : null,
    online,
    advertisedPh:
      adv.hash != null && typeof adv.type === "string"
        ? toPhs(adv.hash as number | string, adv.type)
        : null,
    measuredPh:
      last.hash != null && typeof last.type === "string"
        ? toPhs(last.hash as number | string, last.type)
        : null,
    askBtcPerPhDay: ask != null && ask > 0 ? ask : null,
    minHours: num(r.minhours),
    maxHours: num(r.maxhours),
    rpi: typeof r.rpi === "string" && MRR_RPI_RE.test(r.rpi) ? r.rpi : null,
    rentUrl: rentUrlFor(id),
  };
}

/**
 * Fetch specific rigs by ID. Semicolon-joined multi-ID is verified to
 * return an array AND to include rigs that are currently rented — which
 * the search endpoint does not, so this is the only way to see our own
 * fleet while it is earning.
 */
export async function getRigs(ids: string[]): Promise<MrrRig[] | null> {
  if (ids.length === 0) return [];
  const res = await upstreamFetchJson<{ success?: boolean; data?: unknown }>(
    `${API}/rig/${ids.map(encodeURIComponent).join(";")}`,
    { label: "mrr-rigs", revalidate: 120 },
  );
  if (!res.ok || res.data?.success !== true) return null;
  const d = res.data.data;
  const list = Array.isArray(d) ? d : [d];
  const out = list.map(normaliseRig).filter((x): x is MrrRig => x !== null);
  return out.length > 0 ? out : null;
}

export async function getAlgoStats(
  algo: string = ALGO,
): Promise<MrrAlgoStats | null> {
  const res = await upstreamFetchJson<{ success?: boolean; data?: unknown }>(
    `${API}/info/algos/${encodeURIComponent(algo)}`,
    { label: "mrr-algo", revalidate: 300 },
  );
  if (!res.ok || res.data?.success !== true) return null;
  const d = (res.data.data ?? {}) as Record<string, unknown>;
  const stats = (d.stats ?? {}) as Record<string, unknown>;
  const prices = (stats.prices ?? {}) as Record<string, unknown>;
  const avail = (stats.available ?? {}) as Record<string, unknown>;
  const rentd = (stats.rented ?? {}) as Record<string, unknown>;
  const amt = (o: unknown) =>
    num((o as Record<string, unknown> | undefined)?.amount);
  const hashOf = (o: unknown) => {
    const h = (o as Record<string, unknown> | undefined)?.hash as
      | Record<string, unknown>
      | undefined;
    if (!h || typeof h.unit !== "string") return null;
    return toPhs(h.hash as number | string, h.unit);
  };
  return {
    floor: amt(prices.lowest),
    clearedLast30: amt(prices.last_30),
    clearedLast10: amt(prices.last_10),
    suggested: amt(d.suggested_price),
    availableRigs: num(avail.rigs),
    availablePh: hashOf(avail),
    rentedRigs: num(rentd.rigs),
    rentedPh: hashOf(rentd),
  };
}

/**
 * What one pagination sweep of the ask book actually collected.
 *
 * A bare `MrrRig[]` cannot tell its caller WHY pagination stopped, and
 * the three reasons are not equivalent (audit 2026-08-02):
 *
 *   - the book ran out            → we hold the complete ask book
 *   - we hit the configured cap   → we hold a SAMPLE, by our own choice
 *   - a page fetch FAILED         → we hold a sample, by accident
 *
 * The last one is the dangerous one: it looks exactly like the other two
 * from the outside, and anything derived from it (notably the published
 * median ask) is a truncated sample presented as a whole-book figure.
 * So the sweep reports which happened and the composition layer decides.
 */
export type AskBookSweep = {
  rigs: MrrRig[];
  /** Pages actually fetched (a failed page is not counted). */
  pages: number;
  /** Pagination stopped because a page fetch failed or came back malformed. */
  truncatedByError: boolean;
  /** Pagination stopped at `maxPages` with a full last page — more remain. */
  cappedAtMaxPages: boolean;
};

/**
 * The ask book. Returns AVAILABLE rigs only — MRR's search cannot see
 * rented rigs, so anything built on this must be labelled "available
 * now" and never presented as the whole market.
 *
 * `maxPages` is deliberately modest. Each page is a sequential upstream
 * fetch under `lib/upstream`'s 5s ceiling and this runs inside a page
 * render, so paginating the whole live book (≈1,359 available rigs on
 * 2026-08-02, i.e. 14 pages) is not an option. Raising the cap is the
 * wrong fix; reporting the shortfall is the right one.
 *
 * Never pass `orderby`: an unsupported value returns an empty body that
 * is not valid JSON (verified 2026-08-02).
 */
export async function searchAvailable(
  algo: string = ALGO,
  maxPages = 6,
): Promise<AskBookSweep | null> {
  const out: MrrRig[] = [];
  let pages = 0;
  let truncatedByError = false;
  let cappedAtMaxPages = false;

  for (let page = 0; page < maxPages; page++) {
    const res = await upstreamFetchJson<{ success?: boolean; data?: unknown }>(
      `${API}/rig?type=${encodeURIComponent(algo)}&count=100&offset=${page * 100}`,
      { label: "mrr-search", revalidate: 300 },
    );
    if (!res.ok || res.data?.success !== true) {
      truncatedByError = true;
      break;
    }
    const recs = (res.data.data as Record<string, unknown> | undefined)
      ?.records;
    if (!Array.isArray(recs)) {
      // A 200 whose body we cannot read is a failure, not an empty book.
      truncatedByError = true;
      break;
    }
    pages++;
    if (recs.length === 0) break;
    for (const raw of recs) {
      const rig = normaliseRig(raw);
      if (rig) out.push(rig);
    }
    // A short page means the book ran out. A full last page on the final
    // permitted iteration means there is more we chose not to fetch.
    if (recs.length < 100) break;
    if (page === maxPages - 1) cappedAtMaxPages = true;
  }

  if (out.length === 0) return null;
  return { rigs: out, pages, truncatedByError, cappedAtMaxPages };
}

/**
 * Availability-only projection for the MRR-only /hashrate (2026-10-17).
 * Reads the same public, keyless GET /rig/{id;id} as getRigs, but keeps the
 * three flags the guided list needs (status.status, available_status,
 * online) plus measured hashrate. No price, name, region or description
 * leaves this function. lib/mrr-units.ts applies the availability rule.
 * Not cached here (the caller caches with a timestamp so staleness is visible).
 */
export type MrrUnitState = {
  id: string;
  owner: string;
  status: string;
  rented: boolean;
  availableStatus: string;
  online: boolean;
  measured15Th: number | null;
};
export function projectUnitState(raw: unknown): MrrUnitState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && MRR_ID_RE.test(r.id) ? r.id : null;
  if (!id) return null;
  const st = (r.status ?? {}) as Record<string, unknown>;
  const hr = (r.hashrate ?? {}) as Record<string, unknown>;
  const l15 = (hr.last_15min ?? {}) as Record<string, unknown>;
  const ph = l15.hash != null && typeof l15.type === "string" ? toPhs(l15.hash as number | string, l15.type) : null;
  return {
    id,
    owner: mrrText(r.owner, 64),
    status: typeof st.status === "string" ? st.status : "",
    rented: st.rented === true,
    availableStatus: typeof r.available_status === "string" ? r.available_status : "",
    online: r.online === true,
    measured15Th: ph != null && Number.isFinite(ph) ? ph * 1000 : null,
  };
}
export async function getUnitStates(ids: readonly string[]): Promise<MrrUnitState[] | null> {
  if (ids.length === 0) return [];
  const res = await upstreamFetchJson<{ success?: boolean; data?: unknown }>(
    `${API}/rig/${ids.map(encodeURIComponent).join(";")}`,
    { label: "mrr-units" },
  );
  if (!res.ok || res.data?.success !== true) return null;
  const d = res.data.data;
  const list = Array.isArray(d) ? d : [d];
  const out = list.map(projectUnitState).filter((x): x is MrrUnitState => x !== null);
  return out.length > 0 ? out : null;
}
