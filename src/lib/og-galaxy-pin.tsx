import { galaxyPinDataUrl } from "./galaxy-pin-data";

/** Enamel-pin mark for Satori / ImageResponse brand rows. */
export function OgGalaxyPin({ size = 40 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={galaxyPinDataUrl()} width={size} height={size} alt="" />
  );
}
