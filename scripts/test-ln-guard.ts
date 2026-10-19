// Lightning-address guard invariants. Run with `npx tsx scripts/test-ln-guard.ts`.
// Wired into `npm run verify` · exits non-zero on any failure.
//
// Why this exists (2026-07-23): a /submit form's Lightning address is
// self-reported and unauthenticated — anyone can paste a legitimate
// vendor's PUBLIC npub while substituting their OWN Lightning address
// to divert payments. The signed kind:0 `lud16` is the only
// payment-address source cryptographically bound to the vendor's key,
// so publish decisions must reconcile the two. This suite pins the
// policy:
//   · verified profile CONTRADICTS the form  → hard hold (requiresHold)
//   · payment address present but unanchored → soft gate (needsConfirm)
//   · nothing submitted                      → no gate, suggest lud16
// A silent bug here IS the vulnerability, hence the test-first suite.

import {
  assessLnSubmission,
  lnAddressesMatch,
  normalizeLnAddress,
} from "../src/lib/ln-guard";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n⚡ Lightning-address guard\n");

// ── normalization ───────────────────────────────────────────────────
{
  check(
    "normalize trims whitespace and lowercases",
    normalizeLnAddress("  Sats_Oil_@WalletOfSatoshi.com ") ===
      "sats_oil_@walletofsatoshi.com",
  );
  check(
    "normalize rejects non-address garbage",
    normalizeLnAddress("not-an-address") === null &&
      normalizeLnAddress("") === null &&
      normalizeLnAddress("a@b") === null, // no TLD
  );
  check(
    "normalize preserves local-part characters exactly (no de-underscoring)",
    normalizeLnAddress("sats_oil_@walletofsatoshi.com") ===
      "sats_oil_@walletofsatoshi.com",
  );
}

// ── matching ────────────────────────────────────────────────────────
{
  check(
    "match is case- and whitespace-insensitive",
    lnAddressesMatch(" SATS_OIL_@WalletOfSatoshi.com", "sats_oil_@walletofsatoshi.com"),
  );
  // The real-world case from the Sat's Oil submission: a single
  // trailing underscore distinguishes two DIFFERENT custodial
  // accounts. Normalization must never be so aggressive it
  // collapses distinct addresses into a false match.
  check(
    "trailing underscore is a DIFFERENT address (no fuzzy matching)",
    !lnAddressesMatch("sats_oil_@walletofsatoshi.com", "sats_oil@walletofsatoshi.com"),
  );
  check(
    "different domains never match",
    !lnAddressesMatch("alice@walletofsatoshi.com", "alice@primal.net"),
  );
  check(
    "garbage never matches garbage",
    !lnAddressesMatch("not-an-address", "not-an-address"),
  );
}

// ── assessment: nostr platform (has a crypto anchor) ────────────────
{
  const match = assessLnSubmission({
    platform: "nostr",
    submittedLn: "Alice@Primal.net",
    profileFetchOk: true,
    profileLud16: "alice@primal.net",
  });
  check(
    "nostr · form == signed lud16 → match, no gates",
    match.status === "match" && !match.requiresHold && !match.needsConfirm,
  );

  const mismatch = assessLnSubmission({
    platform: "nostr",
    submittedLn: "mallory@walletofsatoshi.com",
    profileFetchOk: true,
    profileLud16: "alice@primal.net",
  });
  check(
    "nostr · form != signed lud16 → mismatch, HARD hold",
    mismatch.status === "mismatch" && mismatch.requiresHold,
  );
  check(
    "mismatch carries both normalized addresses for the reviewer",
    mismatch.submittedLn === "mallory@walletofsatoshi.com" &&
      mismatch.profileLud16 === "alice@primal.net",
  );

  const noProfileLn = assessLnSubmission({
    platform: "nostr",
    submittedLn: "alice@primal.net",
    profileFetchOk: true,
    profileLud16: "",
  });
  check(
    "nostr · profile has no lud16 → unanchored, soft confirm gate",
    noProfileLn.status === "profile-missing-ln" &&
      !noProfileLn.requiresHold &&
      noProfileLn.needsConfirm,
  );

  const fetchFailed = assessLnSubmission({
    platform: "nostr",
    submittedLn: "alice@primal.net",
    profileFetchOk: false,
  });
  check(
    "nostr · profile fetch failed → unverified (fail-VISIBLE), soft confirm gate",
    fetchFailed.status === "unverified" &&
      !fetchFailed.requiresHold &&
      fetchFailed.needsConfirm,
  );

  const nothingSubmitted = assessLnSubmission({
    platform: "nostr",
    profileFetchOk: true,
    profileLud16: "Alice@Primal.net",
  });
  check(
    "nostr · no LN submitted → no gates, signed lud16 offered as suggestion",
    nothingSubmitted.status === "no-ln-submitted" &&
      !nothingSubmitted.requiresHold &&
      !nothingSubmitted.needsConfirm &&
      nothingSubmitted.suggestedLn === "alice@primal.net",
  );
}

// ── assessment: platforms without a signed payment source ───────────
{
  const xWithLn = assessLnSubmission({
    platform: "x",
    submittedLn: "alice@walletofsatoshi.com",
  });
  check(
    "x · LN submitted → no-anchor, soft confirm gate (DM the X account)",
    xWithLn.status === "no-anchor" &&
      !xWithLn.requiresHold &&
      xWithLn.needsConfirm,
  );

  const xNoLn = assessLnSubmission({ platform: "x" });
  check(
    "x · no LN submitted → nothing to guard",
    xNoLn.status === "no-ln-submitted" &&
      !xNoLn.requiresHold &&
      !xNoLn.needsConfirm &&
      xNoLn.suggestedLn === undefined,
  );

  const defaultPlatform = assessLnSubmission({
    platform: undefined,
    submittedLn: "alice@walletofsatoshi.com",
  });
  check(
    "undefined platform (defaults to x) treated as no-anchor",
    defaultPlatform.status === "no-anchor" && defaultPlatform.needsConfirm,
  );

  const lightning = assessLnSubmission({
    platform: "lightning",
    submittedLn: "alice@walletofsatoshi.com",
  });
  check(
    "lightning platform · handle IS the payment address → no-anchor gate",
    lightning.status === "no-anchor" && lightning.needsConfirm,
  );
}

// ── summary strings exist for email/CLI surfacing ───────────────────
{
  const mismatch = assessLnSubmission({
    platform: "nostr",
    submittedLn: "mallory@walletofsatoshi.com",
    profileFetchOk: true,
    profileLud16: "alice@primal.net",
  });
  check(
    "every assessment carries a non-empty human summary",
    typeof mismatch.summary === "string" && mismatch.summary.length > 0,
  );
}

console.log();
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("⚡ ln-guard · all checks passed.\n");
