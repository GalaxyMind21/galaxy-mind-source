/* =====================================================================
 * lib/haptics.ts · navigator.vibrate() wrapper for Galaxy Mind
 *
 * Pairs with src/lib/audio-synth.ts: when the user enables sound on
 * the gauge or the Reservoir, they also get tactile feedback for the
 * same events. Drips vibrate, vault landings buzz, the bell pulses ·
 * the device becomes a small instrument in the visitor's hand.
 *
 * Browser support
 * ───────────────
 * Vibration API works on Android Chrome / Firefox / Edge / Samsung
 * Internet · all desktop browsers no-op (vibrate() returns false but
 * doesn't throw). iOS Safari has refused to implement Vibration API
 * for over a decade · iPhone visitors get the audio without the
 * tactile component. The feature-detect via `'vibrate' in navigator`
 * means we don't even attempt the call when unsupported.
 *
 * No permission required · the API is gesture-bound (only fires after
 * a user-initiated event) and there's no permission prompt to manage.
 *
 * Why pair to sound: a single mental model. If the visitor wants
 * audio, they probably want haptics too · they're both "make the
 * tool feel alive." Splitting them into two separate toggles would
 * be more configuration than people want.
 * ===================================================================== */

/**
 * True if the runtime supports navigator.vibrate. Cached at module
 * load so callers don't redo the check on every event.
 */
export const HAPTICS_SUPPORTED: boolean =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/**
 * Standard haptic patterns · keyed by event type. Numbers are durations
 * in milliseconds. An array describes a sequence of vibrate-pause-
 * vibrate-pause... e.g. [10, 50, 30] means 10ms on, 50ms off, 30ms on.
 *
 * The patterns are tuned for SUBTLETY · drips are 6-10ms which feel
 * like a tap, not a buzz. Heavy events (vaultThud, glassShatter)
 * use multi-pulse patterns that map 1:1 to their audio structure
 * (each shatter pulse = one debris pulse).
 *
 * Safe values: phones cap individual pulses at 5000ms and total
 * pattern length around 10000ms · we're well under.
 */
export const HAPTIC_PATTERNS = {
  // Reservoir patterns
  drip: 8, // mining tap drip · subtle tap
  splash: 14, // tap-coin breaks surface · slightly stronger
  drainDrip: 6, // demand drain · lightest (drains are FREQUENT)
  vaultThud: [5, 18, 30], // sealed vault landing · weighty 3-pulse
  uiTap: 8, // button confirm

  // Gauge patterns
  needleTick: 5, // needle drag · very light "click" feel
  bellDing: [10, 35, 12], // HOT-tier bell · 2-pulse "ding-dong"
  iceCrack: [8, 22, 6, 18, 4], // crystalline crack · 3 sharp pulses
  glassShatter: [25, 40, 30, 25, 20, 35, 18], // 4 hits · cascading debris
} as const;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

// Per-pattern throttle · prevents the dense REPLAY drip animation
// or rapid needle drags from machine-gunning the device. Values
// match (or are slightly larger than) the corresponding audio
// throttle gaps so haptics never lead audio.
const PATTERN_THROTTLE_MS: Record<HapticPattern, number> = {
  drip: 90,
  splash: 70,
  drainDrip: 130,
  vaultThud: 240,
  uiTap: 0,
  needleTick: 35,
  bellDing: 0,
  iceCrack: 0,
  glassShatter: 0,
};

const lastFiredAt = new Map<HapticPattern, number>();

/**
 * Fire a haptic pulse · throttled per-pattern so rapid call sites
 * (canvas RAF loops) don't spam the device. Returns true when the
 * vibration was actually scheduled.
 *
 * Silent no-op when:
 *   - The browser doesn't support navigator.vibrate (iOS Safari)
 *   - The same pattern fired more recently than its throttle gap
 *   - `enabled` is false (the audio toggle is off)
 *
 * @param kind  Which named pattern to play
 * @param enabled Whether haptics are currently active (mirrors sound)
 */
export function haptic(kind: HapticPattern, enabled: boolean): boolean {
  if (!enabled || !HAPTICS_SUPPORTED) return false;
  const gap = PATTERN_THROTTLE_MS[kind];
  if (gap > 0) {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = lastFiredAt.get(kind) ?? 0;
    if (now - last < gap) return false;
    lastFiredAt.set(kind, now);
  }
  try {
    return navigator.vibrate(HAPTIC_PATTERNS[kind] as number | number[]);
  } catch {
    // Some browsers throw if vibrate is called outside a user
    // gesture even though they "support" the API · graceful no-op.
    return false;
  }
}

/**
 * Cancel any in-flight vibration · useful when the user disables
 * sound mid-pattern (don't leave the device buzzing after toggle off).
 */
export function cancelHaptics(): void {
  if (!HAPTICS_SUPPORTED) return;
  try {
    navigator.vibrate(0);
  } catch {
    /* silent */
  }
}
