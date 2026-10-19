/**
 * Drop the native bridge into the Capacitor iOS project and point the
 * storyboard at GMBridgeViewController. Idempotent.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "ios/App/App");

async function main() {
  await fs.access(appDir);
  const names = [
    "GMAudio.swift",
    "GMBridgePlugin.swift",
    "GMBridgeViewController.swift",
    "PrivacyInfo.xcprivacy",
  ];
  for (const name of names) {
    await fs.copyFile(path.join(root, "native", name), path.join(appDir, name));
  }
  await fs.copyFile(
    path.join(root, "native/LaunchScreen.storyboard"),
    path.join(appDir, "Base.lproj/LaunchScreen.storyboard"),
  );

  const storyPath = path.join(appDir, "Base.lproj/Main.storyboard");
  let story = await fs.readFile(storyPath, "utf8");
  story = story.replace(
    /customClass="(?:CAPBridgeViewController|GMBridgeViewController)" customModule="(?:Capacitor|App)"/,
    'customClass="GMBridgeViewController" customModule="App"',
  );
  if (!story.includes("GMBridgeViewController")) {
    throw new Error("Main.storyboard has no bridge view controller class to replace");
  }
  await fs.writeFile(storyPath, story);

  const delegatePath = path.join(appDir, "AppDelegate.swift");
  let delegate = await fs.readFile(delegatePath, "utf8");
  if (!delegate.includes("GMAudio.applyAmbient()")) {
    delegate = delegate.replace(
      /didFinishLaunchingWithOptions[^{]+\{/,
      (m) => `${m}\n        GMAudio.applyAmbient()`,
    );
  }
  if (!delegate.includes("func applicationDidBecomeActive")) {
    delegate = delegate.replace(
      /}\s*$/,
      `    func applicationDidBecomeActive(_ application: UIApplication) {\n        GMAudio.applyAmbient()\n    }\n}\n`,
    );
  } else if (!/applicationDidBecomeActive[\s\S]*GMAudio\.applyAmbient/.test(delegate)) {
    delegate = delegate.replace(
      /func applicationDidBecomeActive\(_ application: UIApplication\) \{\n/,
      (m) => `${m}        GMAudio.applyAmbient()\n`,
    );
  }
  await fs.writeFile(delegatePath, delegate);
  await ensurePbx();
  console.log("patched iOS project");
}

function ensurePbx() {
  const pbxPath = path.join(root, "ios/App/App.xcodeproj/project.pbxproj");
  return fs.readFile(pbxPath, "utf8").then((pbx) => {
    const files = [
      ["GMAudio.swift", "A1B1C1D11FED796500168501", "A1B1C1D21FED796500168501", "sourcecode.swift", "Sources"],
      ["GMBridgePlugin.swift", "A1B1C1D11FED796500168502", "A1B1C1D21FED796500168502", "sourcecode.swift", "Sources"],
      ["GMBridgeViewController.swift", "A1B1C1D11FED796500168503", "A1B1C1D21FED796500168503", "sourcecode.swift", "Sources"],
      ["PrivacyInfo.xcprivacy", "A1B1C1D11FED796500168504", "A1B1C1D21FED796500168504", "text.xml", "Resources"],
    ];
    let next = pbx;
    for (const [name, fileId, buildId, type, phase] of files) {
      if (next.includes(name)) continue;
      const buildLine = `\t\t${buildId} /* ${name} in ${phase} */ = {isa = PBXBuildFile; fileRef = ${fileId} /* ${name} */; };\n`;
      const fileLine = `\t\t${fileId} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${type}; path = ${name}; sourceTree = "<group>"; };\n`;
      next = next.replace("/* End PBXBuildFile section */", `${buildLine}/* End PBXBuildFile section */`);
      next = next.replace("/* End PBXFileReference section */", `${fileLine}/* End PBXFileReference section */`);
      next = next.replace(
        "504EC3071FED79650016851F /* AppDelegate.swift */,",
        `504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${fileId} /* ${name} */,`,
      );
      const phaseEnd = phase === "Sources"
        ? "504EC3081FED79650016851F /* AppDelegate.swift in Sources */,"
        : "2FAD9763203C412B000D30F8 /* config.xml in Resources */,";
      next = next.replace(phaseEnd, `${phaseEnd}\n\t\t\t\t${buildId} /* ${name} in ${phase} */,`);
    }
    return fs.writeFile(pbxPath, next);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
