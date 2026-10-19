/**
 * Copy the committed icon. The source is design/app-icon-1024.png
 * (1024 RGB, no alpha). iOS masks the home-screen icon itself.
 * Do not redraw it here. A generated mark would replace the one
 * that shipped in the asset catalog.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "design/app-icon-1024.png");
const iconSet = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");

function assertOpaque1024(png) {
  if (png.subarray(12, 16).toString() !== "IHDR") throw new Error("icon is not a PNG");
  if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) throw new Error("icon is not 1024 square");
  if (png[25] !== 2) throw new Error("icon must be opaque RGB");
}

async function main() {
  const png = await fs.readFile(source);
  assertOpaque1024(png);
  const targets = [
    path.join(root, "shell/icon.png"),
    path.join(root, "store/icon-1024.png"),
    path.join(iconSet, "AppIcon-1024.png"),
  ];
  for (const file of targets) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, png);
    console.log("wrote", path.relative(root, file));
  }
  const retired = path.join(iconSet, "AppIcon-512@2x.png");
  await fs.rm(retired, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
