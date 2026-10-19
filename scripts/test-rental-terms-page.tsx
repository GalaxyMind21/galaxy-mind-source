// /terms/rental must render in production and show the same version that
// create_rental submits (RENTAL_TERMS_VERSION). Published 2026-10-16.
import React from "react";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { RentalTermsBody, rentalTermsVersionLabel, rentalTermsEffectiveDate } from "../src/components/RentalTermsBody";
import { RENTAL_TERMS_VERSION, RENTAL_TERMS_PATH, RENTAL_TERMS_URL } from "../src/lib/rentals/phase2/terms";
import { metadata } from "../src/app/terms/rental/page";
import { leaksNeverReveal } from "./lib/never-reveal-test";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

console.log("── /terms/rental ─────────────────────────────────");
process.env.VERCEL_ENV = "production";
const html = renderToString(<RentalTermsBody />);
assert("renders in production", html.length > 5000 && html.includes("Rental Terms"), String(html.length));
const date = RENTAL_TERMS_VERSION.slice(0, 10);
assert("effective date = date part of RENTAL_TERMS_VERSION", rentalTermsEffectiveDate() === date && html.includes(`data-terms-effective="${date}"`), date);
const label = rentalTermsVersionLabel();
const [y, mo, d] = date.split("-").map(Number);
const want = `Effective ${new Date(Date.UTC(y, mo - 1, d)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d}, ${y}`;
assert("label derived from the constant", label === want, `${label} vs ${want}`);
assert("label has no 'draft'", !/draft/i.test(label), label);
assert("label shown on page", html.includes(label), label);

const src = readFileSync("src/app/terms/rental/page.tsx", "utf8");
assert("page has no production notFound", !/notFound|isProductionEnv|VERCEL_ENV/.test(src));
assert("noindex", (metadata.robots as { index?: boolean })?.index === false);
assert("terms path", RENTAL_TERMS_PATH === "/terms/rental" && RENTAL_TERMS_URL === "https://galaxymind.space/terms/rental");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
assert("not in sitemap", !sitemap.includes("terms/rental"));
assert("links point to /terms/rental and /privacy", (html.match(/href="\/terms\/rental"/g) ?? []).length === 2 && html.includes('href="/privacy"') && html.includes("Rental Terms at https://galaxymind.space/terms/rental."));
assert("no bare /terms link", !/galaxymind\.space\/terms(?!\/rental)/.test(html));
assert("no privacy draft link", !html.includes("/privacy/rental"));

// MRR-only (2026-10-17): the "Direct rentals closed" banner may name the marketplace (copy from the gated
// lib/marketplace-listing.ts); the Terms text itself still may not.
const banner = html.match(/<aside[^>]*data-terms-closed-banner[\s\S]*?<\/aside>/)?.[0] ?? "";
assert("closed banner shown by default (RENTALS_MODE unset = mrr_only)", banner.includes("Direct rentals closed October 17, 2026"));
const text = html.replace(banner, "").replace(/<[^>]+>/g, " ");
for (const [n, re] of [["IPv4", /\b\d{1,3}(\.\d{1,3}){3}\b/], ["MRR", /miningrigrentals/i], ["DRAFT", /DRAFT/], ["not in effect", /not in effect/i], ["[____]", /\[_*\]|\[[^\]]*_{2,}/], ["bracket placeholder", /\[[^\]]*\]/], ["draft (visible)", /\bdraft\b/i]] as [string, RegExp][]) {
  const m = text.match(re); assert(`no ${n}`, !m, m ? m[0] : "");
}
assert("no never-reveal term", !leaksNeverReveal(text));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
