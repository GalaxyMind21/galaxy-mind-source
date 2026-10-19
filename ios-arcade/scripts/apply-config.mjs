/**
 * Push app.config.json into Capacitor config, Info.plist, and the
 * Xcode project. Bundle id and display name live in that one JSON file.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function setBool(plist, key, value) {
  const tag = value ? "<true/>" : "<false/>";
  const re = new RegExp(`(<key>${key}</key>\\s*)<(?:true|false)/>`);
  if (re.test(plist)) return plist.replace(re, `$1${tag}`);
  return plist.replace("</dict>\n</plist>", `\t<key>${key}</key>\n\t${tag}\n</dict>\n</plist>`);
}

function setString(plist, key, value) {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (re.test(plist)) return plist.replace(re, `$1${value}$2`);
  return plist.replace("</dict>\n</plist>", `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
}

function supportedOrientations(plist, key) {
  const inner = [
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
  ]
    .map((name) => `\t\t<string>${name}</string>`)
    .join("\n");
  const re = new RegExp(`(<key>${key}</key>\\s*<array>)[\\s\\S]*?(</array>)`);
  const body = `$1\n${inner}\n\t$2`;
  if (re.test(plist)) return plist.replace(re, body);
  return plist.replace(
    "</dict>\n</plist>",
    `\t<key>${key}</key>\n\t<array>\n${inner}\n\t</array>\n</dict>\n</plist>`,
  );
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "app.config.json"), "utf8"));
  const cap = {
    appId: cfg.bundleId,
    appName: cfg.displayName,
    webDir: "www",
    server: { androidScheme: "https" },
    ios: {
      contentInset: "never",
      backgroundColor: "#12110F",
      scrollEnabled: true,
      zoomEnabled: false,
    },
  };
  await fs.writeFile(path.join(root, "capacitor.config.json"), JSON.stringify(cap, null, 2) + "\n");

  const plistPath = path.join(root, "ios/App/App/Info.plist");
  try {
    let plist = await fs.readFile(plistPath, "utf8");
    plist = setString(plist, "CFBundleDisplayName", cfg.displayName);
    plist = setString(plist, "CFBundleShortVersionString", cfg.version);
    plist = setBool(plist, "GMGameCenterEnabled", cfg.gameCenterEnabled === true);
    plist = setBool(plist, "ITSAppUsesNonExemptEncryption", false);
    plist = setBool(plist, "UIRequiresFullScreen", true);
    plist = setString(plist, "LSApplicationCategoryType", "public.app-category.arcade-games");
    plist = setString(plist, "UIStatusBarStyle", "UIStatusBarStyleLightContent");
    plist = setBool(plist, "UIViewControllerBasedStatusBarAppearance", true);
    plist = supportedOrientations(plist, "UISupportedInterfaceOrientations");
    plist = supportedOrientations(plist, "UISupportedInterfaceOrientations~ipad");
    await fs.writeFile(plistPath, plist);
    console.log("updated Info.plist");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log("Info.plist not present yet");
  }

  const pbxPath = path.join(root, "ios/App/App.xcodeproj/project.pbxproj");
  try {
    let pbx = await fs.readFile(pbxPath, "utf8");
    pbx = pbx.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${cfg.bundleId};`);
    pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${cfg.version};`);
    const fromRun = Number(process.env.GITHUB_RUN_NUMBER || "0");
    const build = String(Number.isFinite(fromRun) ? Math.max(2, fromRun) : 2);
    pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
    await fs.writeFile(pbxPath, pbx);
    console.log("updated pbxproj bundle", cfg.bundleId, "build", build);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log("pbxproj not present yet");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
