/* =====================================================================
 * lib/og-bench.tsx · THE NIGHT BENCH CARD KIT
 *
 * WHY THIS EXISTS
 * ---------------
 * The Night Bench rollout (2026-08-23) moved the pages. `check-brand-ramp`
 * then moved the four ramp LITERALS everywhere else, including the ~37
 * opengraph cards. Both of those happened. Neither of them moved the
 * DESIGN, and a card repainted in warm colours while keeping the old
 * cockpit grammar still reads as the old site — which is what the
 * operator saw unfurling on X on 2026-09-10.
 *
 * Measured across the 37 cards before this file existed:
 *
 *   65 label sites at 22 DIFFERENT tracking values (0.04em … 0.39em).
 *      The site's canonical `.micro-label` is 0.20em. Four sites matched.
 *      The largest cluster, eight sites, sat at 0.39em — nearly double.
 *   36 of 36 display-type sites (>=40px) heavier than the site's own
 *      `.display-title`, which is weight 500. Nineteen were at 800.
 *   13 files painting a COLD `#26262C` border and 5 more on cold
 *      `#5C5C66` / `#8C8C96` ink — off-ramp, so the brand-ramp guard
 *      never saw them, sitting blue-grey against a warm ground.
 *
 * The root cause is structural: 37 hand-rolled cards, 5,227 lines, no
 * shared chrome. Each one re-declared its own palette. That is why a
 * codemod could fix four colours and nothing else, and why it would
 * have drifted again. This file is the chrome those cards never had.
 *
 * WHAT THE GRAMMAR IS
 * -------------------
 * Same as the pages, because that is the entire point:
 *   ground   warm night `#12110F`, never the retired OLED void
 *   lamp     a CREAM radial, not an orange one. Spec 4.7 retired
 *            emissive depth; the bench lamp is light falling ON things.
 *   depth    lit, not emissive — `RIM` (inset bevel) + `DROP` (contact +
 *            weight). Verified to render in Satori before being built on;
 *            `boxShadow` was used by exactly one card before this.
 *   type     display at weight 500 / -0.03em, mirroring `.display-title`
 *   labels   `.micro-label`'s mono uppercase at 0.20em, tabular figures
 *   accent   live state and the primary verb ONLY. Not every numeral.
 *
 * SCALE. The page root is 17px; these cards are 1200x630 and their type
 * runs roughly 2x page size, so the shadow GEOMETRY is doubled here
 * while the colours and alphas are copied from `globals.css` verbatim.
 * The alphas are the tuned part — do not "round" them.
 *
 * THE CARDS ARE SET IN THE SITE'S OWN FACE (Plus Jakarta Sans, OFL). The site
 * loads it as .woff2 (src/app/fonts) and Satori cannot read woff2, so the
 * three weights also ship as plain .ttf beside the woff2 files and are
 * read once per lambda here.
 *
 * `benchFonts()` FAILS SOFT on purpose. Thirty-seven routes call it, and a
 * file-tracing miss would otherwise turn every social card into a 500. An
 * empty list makes Satori fall back to its built-in face, which is exactly
 * what these cards looked like yesterday — a downgrade, not an outage.
 * `next.config.ts` pins the directory into the function trace so it should
 * never come to that; `scripts/check-og-fonts.ts` proves the files load and
 * that no card asks for a glyph the face does not have.
 *
 * WHY EVERYTHING IS THE SITE SANS, INCLUDING THE LABELS. The site's
 * `.micro-label` is Spline Sans Mono, but that face is a next/font/google
 * download with no committed artifact to convert — the only local copy is
 * a 225-glyph build subset under `.next`, which is not a source of truth.
 * The design language's own rule settles the tie: mono is for things that
 * TICK, and it is "banned as the house voice" at exactly the 10-12px
 * uppercase 0.18-0.25em an eyebrow uses. So labels are Plus Jakarta Sans at 0.20em
 * and only the figures keep tabular numerals.
 * ===================================================================== */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties, ReactNode } from "react";

/** The dark ramp, copied from `:root` in globals.css. OG cards always
 *  render the dark theme — there is no light-mode unfurl. */
export const BENCH = {
  /** --bg-base */
  ground: "#12110F",
  /** --bg-elevated */
  panel: "#1C1A16",
  /** --bg-elevated-2 */
  panelRaised: "#26231E",
  /** --text-primary */
  ink: "#F2EFE9",
  /** --text-secondary · 7.0:1 on ground, AA */
  inkMuted: "#A5A096",
  /** --text-tertiary · the WARM tertiary. Replaces the cold #5C5C66 /
   *  #8C8C96 the cards were using, which read blue against the ground. */
  inkFaint: "#948F84",
  /** --accent · live state and the primary verb only. */
  accent: "#F7931A",
  /** --border-subtle · replaces the cold #26262C. */
  hairline: "rgba(247, 238, 224, 0.085)",
  /** A slightly stronger hairline for a panel that must hold an edge
   *  against the ground at thumbnail size. */
  hairlineStrong: "rgba(247, 238, 224, 0.14)",
} as const;

/** Plus Jakarta Sans first, with the old stack behind it so a soft font failure
 *  still lands somewhere sensible. */
export const SANS = "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif";
/** Figures and dates. Same face — `tabular-nums` is what does the work
 *  here, not a second family. See the header for why. */
export const MONO = SANS;

const FONT_FILES: Array<{ file: string; weight: 400 | 500 | 700 }> = [
  { file: "PlusJakartaSans-Regular.ttf", weight: 400 },
  { file: "PlusJakartaSans-Medium.ttf", weight: 500 },
  { file: "PlusJakartaSans-Bold.ttf", weight: 700 },
];

type SatoriFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 700;
  style: "normal";
};

let fontCache: SatoriFont[] | null = null;

/** The font list every card hands to ImageResponse. Read once per lambda,
 *  and never throws — see the header. */
export function benchFonts(): SatoriFont[] {
  if (fontCache) return fontCache;
  try {
    const dir = join(process.cwd(), "src/app/fonts");
    fontCache = FONT_FILES.map(({ file, weight }) => ({
      name: "Plus Jakarta Sans",
      data: readFileSync(join(dir, file)),
      weight,
      style: "normal" as const,
    }));
  } catch {
    fontCache = [];
  }
  return fontCache;
}

/** --nb-rim, geometry doubled for the card canvas. The three things a
 *  real pane shows at its edge: light on the top bevel, that light
 *  falling a short way down the inside face, and the pane's own
 *  thickness shading the bottom lip. INSET only — never an outer halo. */
export const RIM =
  "inset 0 2px 0 rgba(255, 246, 232, 0.22), " +
  "inset 0 32px 56px -44px rgba(255, 240, 219, 0.32), " +
  "inset 0 -2px 0 rgba(0, 0, 0, 0.32)";

/** --nb-drop · tight contact + wide weight. */
export const DROP =
  "0 2px 4px rgba(0, 0, 0, 0.55), 0 28px 64px -24px rgba(0, 0, 0, 0.88)";

/** --nb-drop-lamp · the bench lamp falls on ONE object per card. */
export const DROP_LAMP =
  "0 4px 8px rgba(0, 0, 0, 0.55), " +
  "0 44px 96px -28px rgba(0, 0, 0, 0.92), " +
  "0 0 92px -24px rgba(255, 240, 219, 0.17)";

/** A seated surface: bevel + contact. Pass `lamp` for the one object
 *  the bench lamp is meant to fall on. */
export const seated = (lamp = false) => `${RIM}, ${lamp ? DROP_LAMP : DROP}`;

/**
 * The card ground. A warm night surface with a cream lamp coming in
 * high and left, plus a faint floor gather at the bottom so the card
 * has a value structure instead of being a flat slab.
 *
 * The old cards used `radial-gradient(circle at 95% 0%, rgba(247,147,26,
 * 0.10))` — an ORANGE corner bloom. That is brand glow, the thing spec
 * 4.7 retired, and it is most of why the family read as a cockpit.
 */
export const LAMP = [
  // The bench lamp: high and left, cream, wide falloff.
  "radial-gradient(1150px 660px at 16% -22%, rgba(255, 240, 219, 0.115) 0%, transparent 68%)",
  // A faint gather off the far edge of the bench, so the bottom-right
  // corner is not dead flat. Measured cost to legibility: the lightest
  // ground pixel moves 17,16,14 -> 31,29,26, which still leaves the
  // faintest ink at 5.22:1 — better than the orange bloom it replaced.
  "radial-gradient(900px 420px at 88% 118%, rgba(255, 226, 189, 0.05) 0%, transparent 70%)",
].join(", ");

export function benchGround(): CSSProperties {
  return { background: BENCH.ground, backgroundImage: LAMP };
}

/** Root style for a full-bleed 1200x630 card. */
export function benchRoot(padding = 64): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding,
    color: BENCH.ink,
    fontFamily: SANS,
    ...benchGround(),
  };
}

/**
 * Display type, mirroring `.display-title`: weight 500, -0.03em, 0.98.
 * The cards were running 700/800 at every display size — 36 of 36 sites.
 * Size carries the hierarchy here; weight is not a second lever.
 */
export function display(size: number, color: string = BENCH.ink): CSSProperties {
  return {
    // Satori requires an explicit display on any node with more than one
    // child, and a wrapped headline is several children to it.
    display: "flex",
    fontSize: size,
    fontWeight: 500,
    letterSpacing: -0.03 * size,
    lineHeight: 0.98,
    color,
    fontVariantNumeric: "tabular-nums",
  };
}

/**
 * `.micro-label`: mono, uppercase, 0.20em, tabular figures. This is the
 * site's canonical eyebrow — 423 call sites were deliberately moved onto
 * it in the 2026-09-07 sweep — so a card that spells its own is not
 * being expressive, it is being off-brand.
 */
export function microLabel(
  size = 20,
  color: string = BENCH.inkFaint,
): CSSProperties {
  return {
    display: "flex",
    fontFamily: MONO,
    fontSize: size,
    textTransform: "uppercase",
    letterSpacing: 0.2 * size,
    lineHeight: 1.1,
    color,
    fontVariantNumeric: "tabular-nums",
  };
}

/** A number that ticks. Mono, tabular, never uppercase-tracked. */
export function readout(size: number, color: string = BENCH.ink): CSSProperties {
  return {
    display: "flex",
    fontFamily: MONO,
    fontSize: size,
    fontWeight: 500,
    letterSpacing: -0.01 * size,
    lineHeight: 1,
    color,
    fontVariantNumeric: "tabular-nums",
  };
}

/** Body copy under a headline. */
export function body(size = 28, color: string = BENCH.inkMuted): CSSProperties {
  return { fontSize: size, lineHeight: 1.32, color, display: "flex" };
}

/** A seated panel. `lamp` marks the single lit object. */
export function BenchPanel({
  children,
  style,
  lamp = false,
  raised = false,
  radius = 20,
  padding = 28,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  lamp?: boolean;
  raised?: boolean;
  radius?: number;
  padding?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: raised ? BENCH.panelRaised : BENCH.panel,
        borderRadius: radius,
        boxShadow: seated(lamp),
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The brand row. The site header renders the wordmark in SENTENCE CASE
 * at weight 500 (`SiteHeader.tsx`), so the cards' `GALAXY MIND` at
 * 0.30em was not the wordmark — it was a different mark on the same
 * name. `mark` should be the site pin where the card can afford it.
 */
export function BenchBrand({
  mark,
  right,
  size = 26,
}: {
  mark?: ReactNode;
  right?: ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {mark}
        <span
          style={{
            fontSize: size,
            fontWeight: 500,
            letterSpacing: -0.01 * size,
            color: BENCH.ink,
          }}
        >
          Galaxy Mind
        </span>
      </div>
      {right}
    </div>
  );
}

/** A 6px live dot. Status green survives as a dot, never a sentence. */
export function LiveDot({ color = BENCH.accent, size = 10 }: { color?: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size,
        background: color,
      }}
    />
  );
}

/** The footer rule + url. Warm hairline, never the cold #26262C. */
export function BenchFooter({
  url = "galaxymind.space",
  right,
  paddingTop = 26,
}: {
  url?: string;
  right?: ReactNode;
  paddingTop?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: `1px solid ${BENCH.hairline}`,
        paddingTop,
        width: "100%",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 22,
          color: BENCH.inkMuted,
          letterSpacing: 0.2,
        }}
      >
        {url}
      </span>
      {right}
    </div>
  );
}
