/**
 * Galaxy mark — photoreal enamel-pin seal (Imagine, 2026-08-24).
 * Gold bezel, nested orange arms, pearl core, four studs.
 * Master: Desktop/Galaxy-Mind-Brand/01-logo-imagine-crop.png
 * Chrome uses the 128px cut of that file.
 */

export const GALAXY_PIN_SRC = "/brand/galaxy-pin.png";
export const GALAXY_PIN_CHROME_SRC = "/brand/galaxy-pin-128.png";

export function GalaxyMark({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny brand mark; next/image is overkill at 22–24px
    <img
      src={GALAXY_PIN_CHROME_SRC}
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
      aria-hidden
    />
  );
}
