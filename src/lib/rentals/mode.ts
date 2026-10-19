/**
 * RENTALS_MODE (2026-10-17, the operator): Galaxy Mind rents through the marketplace only.
 *   direct   = the Phase 2 direct checkout (quote, order, x402 pay, BTC, ETH, MCP create/cancel) as before.
 *   mrr_only = DEFAULT when unset or unrecognised: direct checkout routes answer 410 with rentUrl = our /hashrate
 *              page and a units note (the marketplace profile page is login-walled, so it is never linked), /hashrate/rent is the marketplace page, MCP create_rental/cancel_rental are not
 *              registered and the quote tools return the same redirect.
 * Rollback to direct: RENTALS_MODE=direct plus rental_settings.rentals_enabled=true. No code or table is removed.
 * Server-side only; client components get the mode as a prop.
 */
import { MARKETPLACE_CLOSED_MESSAGE, MARKETPLACE_HOW } from "@/lib/marketplace-listing";
import { RENT_PAGE_URL, RENT_UNITS_NOTE } from "@/lib/rent-page";

type Env = Record<string, string | undefined>;
export type RentalsMode = "direct" | "mrr_only";

export function rentalsMode(env: Env = process.env): RentalsMode {
  return (env.RENTALS_MODE ?? "").trim().toLowerCase() === "direct" ? "direct" : "mrr_only";
}
export const mrrOnly = (env: Env = process.env): boolean => rentalsMode(env) === "mrr_only";

/** The one body every closed direct-rental route returns (HTTP 410). */
export function directRentalsClosedBody() {
  return {
    error: "direct_rentals_closed" as const,
    message: MARKETPLACE_CLOSED_MESSAGE,
    rentUrl: RENT_PAGE_URL,
    units: RENT_UNITS_NOTE,
  };
}

/** 410 Gone for a closed direct-rental route. */
export function directRentalsClosedResponse(): Response {
  return new Response(JSON.stringify(directRentalsClosedBody()), {
    status: 410,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** closeTheSale() in mrr_only: where bots send people to rent. */
export function marketplaceSale() {
  return { how: MARKETPLACE_HOW, url: RENT_PAGE_URL, note: RENT_UNITS_NOTE };
}

/** MCP get_quote / get_rental_quote / list_available_rigs answer in mrr_only: no price, no bay board. */
export function marketplaceRedirect() {
  return { ...directRentalsClosedBody(), closeTheSale: marketplaceSale() };
}
