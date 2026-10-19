/**
 * Invariants for the /submit door (lib/submit-guard).
 *
 * Wired into `npm run verify`. Pure and offline — no network, no KV.
 *
 * Why this exists (2026-08-23): a public /submit posted shop name
 * "Kinka", a gmail address pasted as the handle (fictional here: `not.a.real.submitter@gmail.com`; platform defaulted
 * to X), country EC, category Services, description "im a good person
 * pls dont hack me pls", website a Minecraft rank shop with no bitcoin.
 * It passed the then-current checks and emailed the operator. The
 * API is the source of truth; this suite pins that that payload — and
 * the class it belongs to — dies at the door.
 */
import { readFileSync } from "node:fs";
import {
  assessSubmitGuard,
  hasControlledSubstanceCopy,
  sanitizeText,
  untrustedWebsiteReview,
} from "../src/lib/submit-guard";
import { firstPartyAllowOrigin } from "../src/lib/first-party-origin";

// The live 2026-08-23 junk submission. Kept here, not in production
// source, so the door is tested against the real case without
// teaching the product about one troll shop.
const KINKA_PAYLOAD = {
  name: "Kinka",
  handle: "not.a.real.submitter@gmail.com",
  platform: "x",
  country: "EC",
  category: "services",
  description: "im a good person pls dont hack me pls",
  website: "https://hycraft.us/",
} as const;

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n🛡  Submit guardrails\n");

function honestShop(over: Record<string, unknown> = {}) {
  return {
    handle: "tallowfarmsoap",
    platform: "x",
    name: "Tallow Farm Soap",
    description:
      "Handmade beef tallow soap. We accept bitcoin and lightning at checkout, shipped from Ohio.",
    category: "consumables",
    country: "US",
    website: "https://tallowfarm.example.com",
    acceptsBitcoinAtCheckout: true,
    notifyEmail: "farmer@tallowfarm.example.com",
    ...over,
  };
}

// ── the design case ────────────────────────────────────────────────
{
  const r = assessSubmitGuard(KINKA_PAYLOAD);
  check("Kinka payload is rejected", r.ok === false);
  check(
    "Kinka rejection carries the identity hole (gmail pasted as an X handle)",
    r.flags.includes("handle-email-mismatch") &&
      r.flags.includes("consumer-mail-handle"),
    `flags=${r.flags.join(",")}`,
  );
  check(
    "Kinka rejection carries no-bitcoin-mention",
    r.flags.includes("no-bitcoin-mention"),
    `flags=${r.flags.join(",")}`,
  );
  check(
    "Kinka rejection carries bait-language (the 'dont hack me' blurb)",
    r.flags.includes("bait-language"),
    `flags=${r.flags.join(",")}`,
  );
  check(
    "Kinka rejection carries missing-bitcoin-attestation",
    r.flags.includes("missing-bitcoin-attestation"),
    `flags=${r.flags.join(",")}`,
  );
  check(
    "Kinka errors are non-empty (the submitter is told no, not queued)",
    r.ok === false && r.errors.length > 0,
  );
}

{
  // The actual hole: platform omitted, so the route defaulted to X
  // while validateAndInferHandle treated name@gmail as a valid
  // NIP-05 / Lightning handle.
  const r = assessSubmitGuard({
    ...KINKA_PAYLOAD,
    platform: undefined,
  });
  check(
    "Kinka with omitted platform (the live hole) is still rejected",
    r.ok === false && r.flags.includes("handle-email-mismatch"),
  );
}

{
  const r = assessSubmitGuard({ ...KINKA_PAYLOAD, platform: "nostr" });
  check(
    "Kinka cannot launder a gmail handle by claiming Nostr",
    r.ok === false && r.flags.includes("consumer-mail-handle"),
  );
}

// ── platform / handle consistency ──────────────────────────────────
{
  const r = assessSubmitGuard(
    honestShop({ handle: "alice@primal.net", platform: "x" }),
  );
  check(
    "email-shaped handle is rejected for platform x (even non-gmail)",
    r.ok === false && r.flags.includes("handle-email-mismatch"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      handle: "shop@primal.net",
      platform: "nostr",
    }),
  );
  check(
    "NIP-05 on a non-mailbox domain is accepted as Nostr",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({ handle: "not.a.real.submitter@gmail.com", platform: "x" }),
  );
  check(
    "gmail handle is rejected even with an honest bitcoin shop description",
    r.ok === false && r.flags.includes("consumer-mail-handle"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      handle: "tips@gmail.com",
      platform: "lightning",
    }),
  );
  check(
    "consumer mail is never a valid Lightning identity handle",
    r.ok === false && r.flags.includes("consumer-mail-handle"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({ handle: "@tallowfarmsoap", platform: "x" }),
  );
  check(
    "leading @ is still normalized away for a real X username",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      handle: "https://x.com/tallowfarmsoap",
      platform: "x",
    }),
  );
  check(
    "x.com profile URL still collapses to the username",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

// ── bitcoin is the product ─────────────────────────────────────────
{
  const r = assessSubmitGuard(
    honestShop({
      description:
        "Handmade beef tallow soap, shipped from a small farm in Ohio each week.",
    }),
  );
  check(
    "honest goods copy without bitcoin/BTC/lightning/sats is rejected",
    r.ok === false && r.flags.includes("no-bitcoin-mention"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      description:
        "Jabón de sebo artesanal. Aceptamos bitcoin en el checkout, envíos desde Quito.",
    }),
  );
  check(
    "ES copy that names bitcoin is accepted",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      description:
        "Café torrado no Brasil. Aceitamos bitcoin e lightning no checkout.",
    }),
  );
  check(
    "PT copy that names bitcoin is accepted",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({ acceptsBitcoinAtCheckout: false }),
  );
  check(
    "unchecked bitcoin-at-checkout attestation is rejected",
    r.ok === false && r.flags.includes("missing-bitcoin-attestation"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({ acceptsBitcoinAtCheckout: "yes" }),
  );
  check(
    "stringy attestation is not accepted (boolean true only)",
    r.ok === false && r.flags.includes("missing-bitcoin-attestation"),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      description:
        "Handmade soap we sell for bitcoin pls dont hack me pls",
    }),
  );
  check(
    "bait language is rejected even if the word bitcoin is stuffed in",
    r.ok === false && r.flags.includes("bait-language"),
  );
}

// ── website ────────────────────────────────────────────────────────
{
  const r = assessSubmitGuard(
    honestShop({ website: "http://tallowfarm.example.com" }),
  );
  check("http:// websites are still rejected", r.ok === false);
}

{
  const r = assessSubmitGuard(
    honestShop({ website: "https://127.0.0.1/admin" }),
  );
  check("loopback websites still fail validateOutboundUrl", r.ok === false);
}

{
  const r = assessSubmitGuard(
    honestShop({
      handle: "pixelhatco",
      website: "https://hypixel-ranks.example.com",
      description:
        "Knit hats shipped worldwide. Bitcoin and lightning at checkout.",
    }),
  );
  check(
    "well-known game-rank host is flagged, not a silent pass",
    r.flags.includes("suspicious-host"),
    `flags=${r.flags.join(",")}`,
  );
}

// ── reviewer safety ────────────────────────────────────────────────
{
  const w = untrustedWebsiteReview("https://hycraft.us/");
  check(
    "reviewer helper surfaces the registrable host, not a first-party CTA",
    w.host === "hycraft.us" &&
      w.cta === null &&
      /untrusted/i.test(w.label),
    `host=${w.host} cta=${String(w.cta)} label=${w.label}`,
  );
  check(
    "reviewer helper does not fetch or embed a screenshot field",
    !("screenshot" in w) && !("preview" in w),
  );
}


// ── cannabis / controlled-substance (Ground Up Genes, 2026-09-14) ──
{
  const r = assessSubmitGuard(
    honestShop({
      handle: "GroundUpGenes",
      name: "Ground Up Genes",
      description:
        "Ground Up Genes is a U.S.-based cannabis seed bank specializing in preservation work, S1 releases, and hard-to-find cannabis genetics. BTC accepted at checkout with extra freebies given!",
      website: "https://groundupgenes.com",
      category: "general-goods",
    }),
  );
  check(
    "Ground Up Genes payload is rejected at the door",
    r.ok === false && r.flags.includes("controlled-substance"),
    r.ok ? "accepted" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({
      description:
        "Hemp canvas tote bags, sewn in Oregon. We accept bitcoin at checkout and ship in the US.",
    }),
  );
  check(
    "hemp clothing is not this class (cannabis / THC / dispensary are)",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

{
  check(
    "helper fires on cannabis and not on hemp",
    hasControlledSubstanceCopy("cannabis seed bank") &&
      !hasControlledSubstanceCopy("hemp canvas tote"),
  );
}

// ── required outcome email ─────────────────────────────────────────
{
  const r = assessSubmitGuard(honestShop({ notifyEmail: "" }));
  check(
    "missing notify email is rejected",
    r.ok === false && r.errors.some((e) => /email is required/i.test(e)),
    r.ok ? "accepted" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(honestShop({ notifyEmail: "not-an-email" }));
  check(
    "malformed notify email is rejected",
    r.ok === false,
    r.ok ? "accepted" : r.errors.join("; "),
  );
}

{
  const r = assessSubmitGuard(
    honestShop({ notifyEmail: "farmer@gmail.com" }),
  );
  check(
    "Gmail is a valid notify mailbox (contact, not identity)",
    r.ok === true,
    r.ok ? "" : r.errors.join("; "),
  );
}

// ── honeypot stays silent ──────────────────────────────────────────
{
  const r = assessSubmitGuard(KINKA_PAYLOAD);
  const blob = r.errors.join(" ").toLowerCase();
  check(
    "error text never names the honeypot (do not teach bots)",
    !blob.includes("honeypot") && !blob.includes("_hpot"),
  );
}

// ── happy path still lands ─────────────────────────────────────────
{
  const r = assessSubmitGuard(honestShop());
  check(
    "a real bitcoin shop with an X username is accepted",
    r.ok === true && r.flags.length === 0,
    r.ok ? `flags=${r.flags.join(",")}` : r.errors.join("; "),
  );
}

// ── /api/submit-vendor ordering (security review F5) ───────────────
{
  const route = readFileSync("src/app/api/submit-vendor/route.ts", "utf8");
  const validationReturn = route.indexOf("if (errors.length > 0)");
  const pendingCall = route.indexOf("listPendingSubmissions()");
  check(
    "pending-queue KV walk runs AFTER the validation early-return",
    validationReturn >= 0 &&
      pendingCall >= 0 &&
      validationReturn < pendingCall,
    "a malformed submission must not pay the pending-index fan-out",
  );
  check(
    "NIP-05 / ambiguous handles always run the kind:0 LN hold",
    route.includes("nostrShaped") &&
      route.includes('handleShape.platform === "ambiguous"'),
  );
  check(
    // Multi-shop (2026-10): the handle is no longer the duplicate key ·
    // the storefront + slug are (findListingConflicts, whose handle
    // match is case-insensitive · pinned in test-multi-shop.ts).
    "duplicate check runs through findListingConflicts + conflictErrors",
    route.includes("findListingConflicts(") && route.includes("conflictErrors("),
  );
}

{
  check(
    "sanitizeText strips CR/LF/tab",
    sanitizeText("ok\r\nname\there") === "oknamehere",
  );
}

{
  const hdr = (origin?: string) => ({
    headers: new Headers(origin ? { origin } : {}),
  });
  check(
    "first-party CORS echoes the apex",
    firstPartyAllowOrigin(hdr("https://galaxymind.space")) ===
      "https://galaxymind.space",
  );
  check(
    "first-party CORS does not echo a random *.vercel.app",
    firstPartyAllowOrigin(hdr("https://evil.vercel.app")) ===
      "https://galaxymind.space",
  );
  check(
    "first-party CORS falls back to apex when Origin is missing",
    firstPartyAllowOrigin(hdr()) === "https://galaxymind.space",
  );
  const prev = process.env.VERCEL_URL;
  process.env.VERCEL_URL = "galaxy-mind-abc.vercel.app";
  check(
    "first-party CORS echoes this deployment's VERCEL_URL",
    firstPartyAllowOrigin(hdr("https://galaxy-mind-abc.vercel.app")) ===
      "https://galaxy-mind-abc.vercel.app",
  );
  check(
    "first-party CORS still refuses a different vercel.app host",
    firstPartyAllowOrigin(hdr("https://other.vercel.app")) ===
      "https://galaxymind.space",
  );
  if (prev === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = prev;

  const enrich = readFileSync("src/app/api/enrich-handle/route.ts", "utf8");
  check(
    "enrich-handle GET and POST both reject cross-site Sec-Fetch-Site",
    /function crossSiteFetchBlocked[\s\S]*sfs === "cross-site"[\s\S]*sfs === "same-site"/.test(
      enrich,
    ) &&
      /export async function POST[\s\S]*?crossSiteFetchBlocked\(req\)/.test(
        enrich,
      ) &&
      /export async function GET[\s\S]*?crossSiteFetchBlocked\(req\)/.test(
        enrich,
      ),
  );
  check(
    "enrich-handle POST requires application/json",
    /export async function POST[\s\S]*?application\/json/.test(enrich),
  );
  const form = readFileSync("src/app/submit/SubmitForm.tsx", "utf8");
  check(
    "submit form POSTs JSON to enrich-handle (not a simple GET)",
    form.includes('method: "POST"') &&
      form.includes('JSON.stringify({ handle: h })'),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll submit-guard checks passed.\n");
