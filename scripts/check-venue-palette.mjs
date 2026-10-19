/**
 * THE VENUE PALETTE CONTRACT.
 *
 * The venue is the largest surface in the frame, and since 2026-07-31 it
 * reacts to the PLAYER (combo heat, chain breaks, milestones) and not only
 * to the music. That was a real gain — a x120 run and a fumbled one used
 * to light the room identically.
 *
 * It is also the most dangerous surface to get wrong. The house rule is
 * "WARM IS THE VERB AND THE LIGHT THAT MOTIVATES IT; EVERYTHING THE PLAYER
 * CANNOT TOUCH IS COOL" — a venue that warms up with the combo starts
 * competing with the notes for the eye, which has been tried and reverted
 * before. So player state may move LEVEL and MOTION, and must never reach
 * a colour write.
 *
 * This is a static check on purpose: it fails on the EDIT that would break
 * the contract, not on a frame that happens to look fine.
 */
import { readFileSync } from "node:fs";
const src = readFileSync("public/chop/js/venue.js", "utf8");
// Static assertions — cheap, and they catch the class of edit that matters.
const checks = [
  ["craft is read from the update payload", /d\.craft/.test(src)],
  ["multHeat is read from the update payload", /d\.multHeat/.test(src)],
  ["cutPulse is read from the update payload", /d\.cutPulse/.test(src)],
  ["heat is read from the update payload", /d\.heat/.test(src)],
  ["slump is read from the update payload", /d\.slump/.test(src)],
  ["playerFlash is read", /d\.playerFlash/.test(src)],
  ["heat multiplies beam INTENSITY", /uIntensity\.value\s*=[\s\S]{0,120}heat/.test(src)],
  ["heat lifts the crowd", /uLift\.value\s*=[\s\S]{0,200}heat/.test(src)],
  ["slump takes the room down", /1\s*-\s*slump/.test(src)],
];
// THE CONTRACT: no heat/slump/playerFlash term may reach a colour write.
const colourWrites = src.match(/(uColor\.value\.setHex|lensMat\.color\.setHex)\([^)]*\)/g) || [];
const hueTainted = colourWrites.filter((w) => /heat|slump|playerFlash|craft|multHeat|cutPulse/.test(w));
checks.push(["player state never reaches a colour write", hueTainted.length === 0]);
checks.push(["colour writes still exist (test is live)", colourWrites.length >= 2]);

let bad = 0;
for (const [name, ok] of checks) { if (!ok) { console.error("  ✗ " + name); bad++; } }
if (bad) { console.error(`✗ venue player-reaction contract: ${bad} failed`); process.exit(1); }
console.log(`✓ venue reacts to the player in LEVEL only · ${checks.length} checks, ${colourWrites.length} colour writes all clean`);
