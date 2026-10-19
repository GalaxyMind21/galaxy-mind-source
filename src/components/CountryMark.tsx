import { COUNTRIES } from "@/lib/vendors";

/**
 * Compact country mark for vendor widgets.
 *
 * A desaturated flag — not an ISO code, not a boxed plate. Country
 * name lives in title + aria-label; the glyph is aria-hidden so
 * Windows' letter fallback does not double-speak.
 *
 * Orange-only monochrome was tried on the Night Bench prototype and
 * collapsed Italy / Japan / Germany into one amber slab. Sepia +
 * desaturate keeps nationality while sitting on the warm ground.
 */
export function CountryMark({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const info = COUNTRIES[code];
  if (!info) return null;
  return (
    <span
      className={["country-mark", className].filter(Boolean).join(" ")}
      title={info.label}
      aria-label={`Based in ${info.label}`}
    >
      <span aria-hidden className="country-mark-flag">
        {info.flag}
      </span>
    </span>
  );
}
