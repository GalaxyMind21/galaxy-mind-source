// Where every customer-facing "rent" link points (operator 2026-10-17): our own /hashrate page. The
// marketplace profile page is login-walled for signed-out visitors, so it is never linked. Relative on the site,
// absolute in API payloads, MCP, llms.txt and the OpenAPI document.
export const RENT_PAGE_PATH = "/hashrate";
export const RENT_PAGE_URL = "https://galaxymind.space/hashrate";
/** The 410 / MCP "units" note: how renting works now, no prices, no ids. */
export const RENT_UNITS_NOTE =
  "Pick how much hashrate you want in 270 TH/s units at https://galaxymind.space/hashrate. Each free unit there has its own Rent button.";
