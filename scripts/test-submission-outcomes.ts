/**
 * Invariants for the submission outcome codes (lib/submission-outcomes).
 *
 * The load-bearing one is the CAP check. /api/admin/notify-submitter
 * rejects a body over 1,000 chars with a 400, and that limit silently
 * made the three most carefully reasoned rejections on file
 * undeliverable (2,177 / 1,538 / 1,349 chars). Template copy must never
 * reintroduce that failure, so the cap is tested rather than trusted —
 * and the check itself is self-tested against a deliberately overlong
 * string, because a cap check that has never fired is not evidence.
 */
import {
  OUTCOMES,
  OUTCOME_CODES,
  NOTIFYING_CODES,
  OUTCOME_TEXT_CAP,
  type OutcomeCode,
  dmHandoffText,
  isOutcomeCode,
  noteHeadroom,
  outcomeBodyLength,
  profileUrlFor,
  renderOutcomeBody,
} from "../src/lib/submission-outcomes";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\nSubmission outcomes\n");

// 1. Shape.
for (const code of OUTCOME_CODES) {
  const o = OUTCOMES[code];
  check(`${code}: code field matches its key`, o.code === code);
  check(`${code}: has an operator label`, o.label.trim().length > 0);
}

// 2. The four silent codes are the ones the operator chose (2026-08-20).
const EXPECTED_SILENT: OutcomeCode[] = [
  "spam",
  "already-listed",
  "bulk-clear",
  "superseded",
];
const actualSilent = OUTCOME_CODES.filter((c) => !OUTCOMES[c].notifies).sort();
check(
  "exactly the four agreed codes are silent",
  JSON.stringify(actualSilent) === JSON.stringify([...EXPECTED_SILENT].sort()),
  `got ${actualSilent.join(",")}`,
);

// 3. Silent codes carry no submitter-facing copy at all. Nothing is
//    sent, so copy here would be dead text that reads as if it were.
for (const code of EXPECTED_SILENT) {
  const o = OUTCOMES[code];
  check(`${code}: no message`, o.message === "");
  check(`${code}: no remedy`, o.remedy === null);
}

// 4. Notifying codes actually say something.
for (const code of NOTIFYING_CODES) {
  const o = OUTCOMES[code];
  check(`${code}: has a submitter-facing message`, o.message.trim().length > 20);
  check(
    `${code}: remedy is a string or an explicit null`,
    o.remedy === null || o.remedy.trim().length > 10,
  );
}

// 5. THE CAP. Body must fit, and an operator note must still have room.
for (const code of NOTIFYING_CODES) {
  const len = outcomeBodyLength(code);
  check(
    `${code}: body ${len} <= ${OUTCOME_TEXT_CAP}`,
    len <= OUTCOME_TEXT_CAP,
    `${len} chars`,
  );
  check(
    `${code}: leaves room for an operator note`,
    noteHeadroom(code) >= 200,
    `${noteHeadroom(code)} chars headroom`,
  );
}

// 5b. SELF-TEST · prove the cap check can fail.
{
  const overlong = "x".repeat(OUTCOME_TEXT_CAP + 1);
  const len = renderOutcomeBody("unreachable", overlong).message.length;
  check(
    "self-test: an overlong note pushes the body past the cap",
    len > OUTCOME_TEXT_CAP,
  );
}

// 6. The note lands on the message, never on the remedy · the remedy is
//    the actionable line and must stay the template's words.
{
  const { message, remedy } = renderOutcomeBody("no-payment-confirmed", "Ping me on Nostr.");
  check("note is appended to the message", message.includes("Ping me on Nostr."));
  check(
    "note does not contaminate the remedy",
    remedy === OUTCOMES["no-payment-confirmed"].remedy,
  );
}

// 7. Guard rejects junk.
check("isOutcomeCode rejects unknown strings", !isOutcomeCode("definitely-not"));
check("isOutcomeCode rejects non-strings", !isOutcomeCode(42));
check("isOutcomeCode accepts a real code", isOutcomeCode("spam"));
check(
  "isOutcomeCode is not fooled by prototype keys",
  !isOutcomeCode("toString") && !isOutcomeCode("constructor"),
);

// 8. DM handoff text.
{
  const withRemedy = dmHandoffText("Acme", "no-payment-confirmed");
  check("handoff names the vendor", withRemedy.includes("Acme"));
  check("handoff includes the fix line", withRemedy.includes("What to fix:"));

  const closed = dmHandoffText("Acme", "placement-conflict");
  check(
    "handoff includes a fix line only when a remedy exists",
    OUTCOMES["placement-conflict"].remedy
      ? closed.includes("What to fix:")
      : !closed.includes("What to fix:"),
  );

  const substance = dmHandoffText("Ground Up Genes", "controlled-substance");
  check(
    "controlled-substance is a closed decision (no fix line)",
    OUTCOMES["controlled-substance"].remedy === null &&
      !substance.includes("What to fix:"),
  );
  check(
    "controlled-substance handoff names the policy",
    /cannabis|controlled-substance/i.test(substance),
  );
}

// 9. Profile URL · handle shape outranks the claimed platform.
{
  check(
    "npub → njump",
    profileUrlFor("npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq") ===
      "https://njump.me/npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  );
  check(
    "x handle → x.com",
    profileUrlFor("GalaxyMind") === "https://x.com/GalaxyMind",
  );
  check(
    "strips a leading @",
    profileUrlFor("@GalaxyMind") === "https://x.com/GalaxyMind",
  );
  check(
    "name@domain without platform is blank (not x.com/foo@bar)",
    profileUrlFor("alice@example.com") === "",
  );
  check(
    "nostr platform → njump even for NIP-05",
    profileUrlFor("alice@example.com", "nostr") === "https://njump.me/alice@example.com",
  );
  check(
    "lightning → empty",
    profileUrlFor("alice@walletofsatoshi.com", "lightning") === "",
  );
}

console.log();
if (failures > 0) {
  console.log(`❌ ${failures} failure(s).\n`);
  process.exit(1);
}
console.log(`✓ submission outcomes clean · ${OUTCOME_CODES.length} codes, ${NOTIFYING_CODES.length} notifying\n`);
