/**
 * /submit website-field friction (2026-10-18).
 *
 * North Idaho Tallow Co. (Oct 17) typed its shop address the
 * way people do (no https://, or the http:// link from its X bio). The
 * form greyed out "Submit for review (1 field left)" with a small
 * "must be an https:// URL" hint; the shop wrote "It's not letting me
 * submit?" in the note and got through only by pasting its BTCPay
 * checkout URL (the old hint literally asked for "the checkout page").
 *
 * Pins: bare domains and http:// links are upgraded client-side to an
 * https:// URL that the UNCHANGED API guard accepts; garbage is left as
 * typed; the submit button is never inert while fields are missing; the
 * website input does not use native type="url" validation; and the hint
 * asks for the shop's own site, not the payment processor.
 *
 * Pure and offline. Wired into `npm run verify`.
 */
import { readFileSync } from "node:fs";
import { normalizeWebsiteInput } from "../src/lib/website-input";
import { assessSubmitGuard } from "../src/lib/submit-guard";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${desc}`);
  else {
    failures++;
    console.log(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

const cases: Array<[string, string]> = [
  ["idahotallow.com", "https://idahotallow.com"],
  ["  idahotallow.com  ", "https://idahotallow.com"],
  ["http://idahotallow.com/shop", "https://idahotallow.com/shop"],
  ["HTTP://IdahoTallow.com", "https://IdahoTallow.com"],
  ["HTTPS://shop.example", "https://shop.example"],
  ["https://idahotallow.com/", "https://idahotallow.com/"],
  ["www.shop.co.uk/store?x=1", "https://www.shop.co.uk/store?x=1"],
  ["//shop.example", "https://shop.example"],
  ["shop.example:8443/x", "https://shop.example:8443/x"],
];
for (const [input, want] of cases) {
  const got = normalizeWebsiteInput(input);
  check(`normalize ${JSON.stringify(input)} → ${want}`, got === want, `got ${JSON.stringify(got)}`);
}

// Never invents a host or rewrites a non-web scheme into one.
for (const keep of ["my shop", "localhost:3000", "ftp://a.example", "javascript:alert(1)", "mailto:a@b.example", "shop", ""]) {
  const got = normalizeWebsiteInput(keep);
  check(`leaves ${JSON.stringify(keep)} as typed`, got === keep.trim(), `got ${JSON.stringify(got)}`);
}

// What the form now sends passes the API guard as-is (API rule unchanged).
const base = {
  handle: "idahotallow",
  name: "North Idaho Tallow Co.",
  description: "Handmade beef tallow skincare: soaps, balms and candles. Accepts Bitcoin!",
  category: "consumables",
  country: "US",
  notifyEmail: "test@example.com",
  acceptsBitcoinAtCheckout: true,
};
for (const typed of ["idahotallow.com", "http://idahotallow.com/shop"]) {
  const raw = assessSubmitGuard({ ...base, website: typed });
  check(`API still rejects raw ${JSON.stringify(typed)} (acceptance rule unchanged)`, !raw.ok && raw.errors.some((e) => /website/i.test(e)));
  const fixed = assessSubmitGuard({ ...base, website: normalizeWebsiteInput(typed) });
  check(`API accepts the normalized ${JSON.stringify(typed)}`, fixed.ok, fixed.errors.join(" | "));
}

// Form wiring.
const form = readFileSync("src/app/submit/SubmitForm.tsx", "utf8");
const websiteInput = form.slice(form.indexOf('id="website"'), form.indexOf('id="website"') + 900);
check("website input is not native type=\"url\"", !/type="url"/.test(websiteInput));
check("website input upgrades on blur", /onBlur=\{[\s\S]*normalizeWebsiteInput\(website\)/.test(websiteInput));
check("submit sends the normalized website", (form.match(/website: websiteOut \|\| undefined/g) ?? []).length === 2);
check("required-check uses the normalized website", /ok: \/\^https:\\\/\\\/\.\+\/i\.test\(normalizeWebsiteInput\(website\)\)/.test(form));
const btn = form.slice(form.indexOf('type="submit"'), form.indexOf('type="submit"') + 300);
check("submit button is not disabled just because fields are missing", !/isReadyToSubmit/.test(btn.split("\n").find((l) => l.includes("disabled=")) ?? ""));
check("form opts out of native validation bubbles (noValidate)", /<form\s[\s\S]{0,300}noValidate/.test(form));
check("a blocked submit explains what is missing", /if \(!isReadyToSubmit\) \{[\s\S]{0,400}setSubmitState\(\{\s*kind: "error",\s*errors: missing\.map/.test(form));

// Copy: ask for the shop's own site; no "checkout page" steer to a processor.
for (const lang of ["en", "es"]) {
  const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, "utf8")) as Record<string, string>;
  const hint = m["submit.websiteHint"] ?? "";
  check(`${lang}: website hint mentions BTCPay / processor`, /BTCPay/.test(hint));
  check(`${lang}: website hint no longer asks for the checkout page`, !/checkout page|página de pago/i.test(hint));
  check(`${lang}: website hint never says "real"`, !/\breal\b/i.test(hint));
  check(`${lang}: https hint gives an example address`, /\.com/.test(m["submit.hintHttps"] ?? ""));
}

console.log(failures === 0 ? "\n✓ submit website input · all pass" : `\n✗ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
