// Node-only Imagine pin bytes for ImageResponse (icon / apple-icon / OG).
// Master: Desktop/Galaxy-Mind-Brand/01-logo-imagine-crop.png (1024),
// resampled to public/brand/galaxy-pin.png (512) so Satori stays under
// the 500KB ImageResponse cap. GalaxyMark loads the 128px cut instead —
// do not import this module from a client component (it uses fs).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PIN_PATH = join(process.cwd(), "public/brand/galaxy-pin.png");

let cached: string | undefined;

/** PNG data URL of the photoreal enamel pin. */
export function galaxyPinDataUrl(): string {
  if (cached) return cached;
  cached = `data:image/png;base64,${readFileSync(PIN_PATH).toString("base64")}`;
  return cached;
}

export const GALAXY_PIN_NIGHT = "#12110F";
