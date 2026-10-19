/**
 * Linux-side checks for the iOS package. Does not build Xcode.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "..");
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function words(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

async function read(rel) {
  return fs.readFile(path.join(root, rel), "utf8");
}

async function main() {
  const cfg = JSON.parse(await read("app.config.json"));
  if (cfg.bundleId !== "space.galaxymind.arcade") fail("bundle id drifted");
  if (cfg.appStoreName !== "Galaxy Mind: Bitcoin Games") fail("app store name");
  if (cfg.appStoreName.length > 30) fail("name over 30");
  if (cfg.displayName !== "Bitcoin Games") fail("display name");
  if (cfg.displayName.length > 30) fail("display name over 30");
  if (cfg.subtitle !== "Arcade racing, HODL & sats fun") fail("subtitle text");
  if ([...cfg.subtitle].length > 30) fail("subtitle over 30");
  if (cfg.gameCenterEnabled !== false) fail("Game Center must ship off");

  const cap = JSON.parse(await read("capacitor.config.json"));
  if (cap.appId !== cfg.bundleId) fail("capacitor appId");
  if (cap.appName !== cfg.displayName) fail("capacitor appName");
  if (cap.ios?.scrollEnabled !== true) fail("scrollEnabled");

  const keywords = (await read("store/metadata/en-US/keywords.txt")).trim();
  if (keywords.length > 100) fail(`keywords ${keywords.length}`);
  if (/\s/.test(keywords)) fail("keywords contain spaces");
  const kw = keywords.split(",");
  if (new Set(kw).size !== kw.length) fail("duplicate keywords");
  const taken = new Set([...words(cfg.appStoreName), ...words(cfg.subtitle)]);
  const banned = new Set(["free", "best", "nintendo", "mario", "mining", "earn", "reward", "prize", "casino", "lottery", "gamble"]);
  for (const word of kw) {
    if (!word) fail("empty keyword");
    if (taken.has(word)) fail(`keyword repeats indexed word: ${word}`);
    if (banned.has(word)) fail(`banned keyword: ${word}`);
    if (word !== word.toLowerCase()) fail(`keyword not lowercase: ${word}`);
  }

  const promo = (await read("store/metadata/en-US/promotional_text.txt")).trim();
  if ([...promo].length > 170) fail(`promo ${promo.length}`);

  const description = await read("store/metadata/en-US/description.txt");
  if (!description.includes("https://galaxymind.space")) fail("description missing site");
  if (!/offline/i.test(description)) fail("description missing offline");
  if (!/no ads/i.test(description)) fail("description missing no ads");
  const head = description.trim().split("\n").slice(0, 3).join("\n");
  if (head.length < 40) fail("description hook too short");

  const name = (await read("store/metadata/en-US/name.txt")).trim();
  const subtitle = (await read("store/metadata/en-US/subtitle.txt")).trim();
  if (name !== cfg.appStoreName) fail("metadata name");
  if (subtitle !== cfg.subtitle) fail("metadata subtitle");

  const category = (await read("store/metadata/primary_category.txt")).trim();
  const sub1 = (await read("store/metadata/primary_first_sub_category.txt")).trim();
  const sub2 = (await read("store/metadata/primary_second_sub_category.txt")).trim();
  if (category !== "GAMES") fail("primary category");
  if (sub1 !== "GAMES_ARCADE") fail("arcade subcategory");
  if (sub2 !== "GAMES_RACING") fail("racing subcategory");

  const privacy = await read("native/PrivacyInfo.xcprivacy");
  if (!privacy.includes("<key>NSPrivacyTracking</key>") || !/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy)) {
    fail("tracking not false");
  }
  if (!/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>|<key>NSPrivacyCollectedDataTypes<\/key>\s*<array>\s*<\/array>/.test(privacy)) {
    fail("collected data types not empty");
  }

  // Export copy: the TestFlight workflow is not published, so its checks run only where the file exists.
  const workflow = await fs.readFile(path.join(repo, ".github/workflows/ios-testflight.yml"), "utf8").catch(() => null);
  const simulatorWorkflow = await fs.readFile(path.join(repo, ".github/workflows/ios-simulator.yml"), "utf8");
  if (workflow) {
  if (!/workflow_dispatch:/.test(workflow)) fail("workflow missing dispatch");
  if (/^\s*(push|pull_request|schedule):/m.test(workflow)) fail("workflow has an automatic trigger");
  if (!workflow.includes("skip_waiting_for_build_processing") && !workflow.includes("fastlane ios beta")) {
    fail("workflow does not call the beta lane");
  }
  if (/-----BEGIN [A-Z ]+-----\s+[A-Za-z0-9+/=]{20,}/.test(workflow)) fail("workflow contains a key");
  }

  const fastfile = await read("fastlane/Fastfile");
  const ascPy = await read("scripts/asc_key.py");
  const ascRb = await read("fastlane/asc_key.rb");
  if (!fastfile.includes("skip_waiting_for_build_processing: true")) fail("fastlane waits on processing");
  if (fastfile.includes("match(")) fail("fastlane uses match");
  if (!fastfile.includes("get_certificates(")) fail("lane does not fetch a distribution certificate");
  if (!fastfile.includes("get_provisioning_profile(")) fail("lane does not fetch an App Store profile");
  if (fastfile.includes("adhoc:")) fail("profile call passes adhoc, which conflicts with development");
  if ((fastfile.match(/development:\s*false/g) || []).length !== 1) {
    fail("development: false belongs only on get_certificates");
  }
  if (/development:\s*true/.test(fastfile)) fail("lane requests a development certificate or profile");
  if (fastfile.includes("Apple allows one of that certificate")) {
    fail("preflight still stops because one distribution certificate exists");
  }
  if (!fastfile.includes("will create another while Apple still accepts one")) {
    fail("preflight does not allow another distribution certificate");
  }
  if (!fastfile.includes("Revoke one of them, then run the workflow again.")) {
    fail("certificate limit failure does not tell the operator to revoke one");
  }
  if (/type:\s*["']distribution["']/.test(fastfile)) fail("cert type distribution is rejected by fastlane");
  if (!fastfile.includes("use_automatic_signing: false")) fail("lane still uses automatic signing");
  if (!fastfile.includes('code_sign_identity: "Apple Distribution"')) fail("lane does not use Apple Distribution");
  if (!fastfile.includes("provisioningProfiles")) fail("export options missing provisioningProfiles");
  if (!fastfile.includes('export_method: "app-store"')) fail("export method is not app-store");
  if (fastfile.includes("skip_codesigning") || fastfile.includes("-allowProvisioningUpdates")) {
    fail("lane still depends on a development profile");
  }
  if (!fastfile.includes("skip_profile_detection: true")) fail("gym still detects profiles");
  if (!fastfile.includes("AuthKey_") || !fastfile.includes("key_filepath:")) fail("fastlane does not write the p8 path");
  if (fastfile.includes("api_key[:key_filepath]")) fail("fastlane still reads an empty key path");
  if (!fastfile.includes("ASC key file is empty")) fail("fastlane missing empty-key guard");
  if (!fastfile.includes('require_relative "asc_key"')) fail("fastlane does not use the shared key normalizer");
  if (!fastfile.includes("lane :preflight")) fail("fastlane missing preflight lane");
  if (!fastfile.includes("get_users(")) fail("preflight does not probe the users API");
  if (!fastfile.includes("BundleId.find")) fail("preflight does not check the bundle id");
  if (!fastfile.includes("App.find")) fail("preflight does not check the app record");
  if (!fastfile.includes('certificateType: "DISTRIBUTION"') || !fastfile.includes('certificate_type == "DISTRIBUTION"')) {
    fail("preflight does not count Apple Distribution certificates");
  }
  if (!fastfile.includes("latest_testflight_build_number") || !fastfile.includes("initial_build_number: 0")) {
    fail("build number is not the next TestFlight build");
  }
  if (fastfile.includes("GITHUB_RUN_NUMBER")) fail("build number still follows the GitHub run number");
  if (!fastfile.includes('workspace: "ios/App/App.xcworkspace"')) fail("gym does not build the CocoaPods workspace");
  if (fastfile.includes('project: "ios/App/App.xcodeproj"')) fail("gym still builds the project only");
  if (!fastfile.includes("uses_non_exempt_encryption: false")) fail("upload does not declare the encryption exemption");
  if (!fastfile.includes("app_identifier: BUNDLE_ID")) fail("upload does not name the bundle id");
  if (!fastfile.includes('require_relative "dist_p12"')) fail("fastlane does not load the p12 helper");
  if (fastfile.includes("APPLE_DIST_P12")) fail("fastlane still uses the old distribution secret names");
  if (!fastfile.includes("DIST_CERT_P12_BASE64") || !fastfile.includes("DIST_CERT_P12_PASSWORD")) {
    fail("fastlane does not read the saved distribution certificate");
  }
  if (!fastfile.includes("Could not import the distribution certificate. Check DIST_CERT_P12_BASE64 and DIST_CERT_P12_PASSWORD.")) {
    fail("import failure text is missing");
  }
  if (!fastfile.includes("DIST_CERT_P12_BASE64 is set but DIST_CERT_P12_PASSWORD is empty.")) {
    fail("a half-set distribution secret does not stop preflight");
  }
  if (!fastfile.includes("DIST_CERT_P12_PASSWORD is set but DIST_CERT_P12_BASE64 is empty.")) {
    fail("a password without a certificate does not stop preflight");
  }
  if (fastfile.includes("Revoke it, or provide its private key, before the next run.")) {
    fail("preflight still stops because one distribution certificate exists");
  }
  if (fastfile.includes('"-P"')) fail("the p12 password is passed on the security argv");
  if (!fastfile.includes("import_pkcs12(")) fail("saved certificate is not imported as PKCS#12");
  if (fastfile.includes("import_pem_identity")) fail("saved certificate is imported as PEM");
  if (fastfile.includes('"-inform"')) fail("pkcs12 export still passes an input format flag");
  if (!fastfile.includes("revoke_distribution_certificate!")) {
    fail("packaging failure does not revoke the certificate this run created");
  }
  if (!fastfile.includes("Packaging failed. Revoking the certificate this run created.")) {
    fail("packaging failure does not say it is revoking the new certificate");
  }
  // The lane never writes repository secrets (security audit 2026-10-18, H4).
  if (fastfile.includes("GH_SECRETS_PAT") || fastfile.includes("publish_distribution_secrets")) fail("fastlane still has the secrets PAT path");
  const betaLane = fastfile.slice(fastfile.indexOf("lane :beta"));
  const importAt = betaLane.indexOf("import_saved_distribution_p12(");
  const certAt = betaLane.indexOf("get_certificates(");
  const packageAt = betaLane.indexOf("package_distribution_p12(");
  const toolAt = betaLane.indexOf('DistP12.require_tool!("gpg")');
  if (importAt < 0 || certAt < 0 || packageAt < 0 || toolAt < 0 || !(toolAt < importAt && importAt < certAt && certAt < packageAt)) {
    fail("saved certificate is not imported before cert runs");
  }
  const distRb = await read("fastlane/dist_p12.rb");
  if (!distRb.includes("DIST_CERT_P12_BASE64 is not valid base64") || !distRb.includes("[^A-Za-z0-9+/=]")) {
    fail("p12 decode does not strip non-base64 characters");
  }
  if (!distRb.includes("DIST_CERT_P12_BASE64 is not a PKCS#12 file")) {
    fail("p12 decode does not require a PKCS#12 sequence");
  }
  if (!distRb.includes("artifact_passphrase") || !distRb.includes("SHA256")) {
    fail("artifact passphrase is not a SHA-256 of the existing secrets");
  }
  if (!distRb.includes("--passphrase-fd")) {
    fail("the distribution archive passphrase is not kept off argv");
  }
  if (!distRb.includes("def export_identity") || !distRb.includes("def verify_reusable!")) {
    fail("p12 export does not live in the helper");
  }
  if (!distRb.includes("passin") || !distRb.includes("passout")) {
    fail("openssl does not read the p12 password from the environment");
  }
  if (!distRb.includes('"-legacy"')) fail("pkcs12 export does not use the legacy PBE when openssl offers it");
  if (distRb.includes("GH_SECRETS_PAT") || distRb.includes("seal_secret") || distRb.includes("actions/secrets")) {
    fail("the helper still writes repository secrets");
  }
  // The secret-sealing path stays gone (security review 2026-10-18, round 3):
  // no sealing script, no vendored NaCl, and no file that calls GitHub's
  // repository-secrets API. Checks tracked files and the working tree.
  const SECRET_WRITERS = [
    /(^|\/)seal-github-secret\.m?[jt]s$/i,
    /(^|\/)(tweet)?nacl[\w.-]*\.c?m?js$/i,
    /(^|\/)sealed-?box[\w.-]*\.c?m?js$/i,
    /(^|\/)LICENSE-(tweetnacl|sealedbox)\.txt$/i,
  ];
  for (const rel of ["ios-arcade/scripts/seal-github-secret.mjs", "ios-arcade/scripts/vendor/tweetnacl.cjs"]) {
    if (await fs.stat(path.join(repo, rel)).then(() => true, () => false)) fail(`${rel} is back`);
  }
  const lsFiles = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "ios-arcade", ".github"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (lsFiles.status !== 0) {
    fail("cannot list files to check for the secret-sealing path");
  } else {
    const self = path.relative(repo, fileURLToPath(import.meta.url)).split(path.sep).join("/");
    for (const rel of lsFiles.stdout.split("\0").filter(Boolean)) {
      if (rel.includes("/node_modules/") || rel.includes("/Pods/")) continue;
      if (SECRET_WRITERS.some((re) => re.test(rel))) fail(`secret-sealing file is back: ${rel}`);
      if (rel === self || !/\.(m?[jt]s|cjs|rb|py|sh|ya?ml|json|txt|md)$|(^|\/)(Fastfile|Appfile|Gemfile)$/.test(rel)) continue;
      const text = await fs.readFile(path.join(repo, rel), "utf8").catch(() => "");
      if (text.includes("actions/secrets")) fail(`${rel} mentions the repository-secrets API (actions/secrets)`);
      if (/\bnacl\.(box|sealedbox|secretbox)\b|crypto_box_seal/.test(text)) fail(`${rel} seals secrets with NaCl`);
    }
  }
  // Pinned to full commit SHAs with a version comment (security audit 2026-10-18, H4).
  if (workflow) {
  if (!/actions\/checkout@[0-9a-f]{40} # v7\./.test(workflow) || !/actions\/setup-node@[0-9a-f]{40} # v7\./.test(workflow)) {
    fail("workflow actions are not the Node 24 majors");
  }
  for (const [name, src] of [["ios-testflight", workflow], ["ios-simulator", simulatorWorkflow]].filter(([, s]) => s)) {
    const unpinned = [...src.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]).filter((u) => !/^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}$/.test(u));
    if (unpinned.length) fail(`${name} has actions not pinned to a commit SHA: ${unpinned.join(", ")}`);
  }
  if (!/^permissions:\s*\n\s+contents: read\s*$/m.test(workflow)) fail("workflow token is not read-only");
  if (!workflow.includes("scripts/asc_key.py")) fail("workflow does not write the p8 with the normalizer");
  if (!workflow.includes("AuthKey_") || !workflow.includes("ASC key file is empty")) {
    fail("workflow does not write and check the p8");
  }
  if (!workflow.includes("openssl pkey")) fail("workflow does not check the normalized key with openssl");
  const preflightAt = workflow.indexOf("fastlane ios preflight");
  const npmAt = workflow.indexOf("npm ci");
  const opensslAt = workflow.indexOf("openssl pkey");
  if (preflightAt < 0 || npmAt < 0 || opensslAt < 0 || !(opensslAt < preflightAt && preflightAt < npmAt)) {
    fail("preflight does not run after the key check and before the build");
  }
  if (!workflow.includes("scripts/select-xcode.py")) fail("workflow does not select an Xcode");
  if (!workflow.includes("Podfile.lock")) fail("workflow does not check the CocoaPods lock");
  if (!workflow.includes("fastlane ios beta")) fail("workflow does not call the beta lane");
  if (workflow.includes("APPLE_DIST_P12")) fail("workflow still uses the old distribution secret names");
  if (!workflow.includes("DIST_CERT_P12_BASE64") || !workflow.includes("DIST_CERT_P12_PASSWORD")) {
    fail("workflow does not pass the distribution certificate secrets");
  }
  // The job never gets a token that can write repository secrets (security audit 2026-10-18, H4).
  if (workflow.includes("GH_SECRETS_PAT")) fail("workflow passes the secrets PAT to the job");
  if (!workflow.includes("gpg --version")) fail("workflow does not check gpg before creating a certificate");
  const betaAt = workflow.lastIndexOf("fastlane ios beta");
  const artifactAt = workflow.indexOf("dist-cert.p12.gpg");
  const gpgAt = workflow.indexOf("gpg --version");
  if (betaAt < 0 || artifactAt < 0 || gpgAt < 0 || !(gpgAt < betaAt && betaAt < artifactAt)) {
    fail("distribution archive is not uploaded after the lane");
  }
  if (!workflow.includes("name: dist-cert-p12") || !workflow.includes("if: always() && inputs.export_new_cert")) {
    fail("distribution archive is not an opt-in one-day fallback");
  }
  if (!/export_new_cert:[\s\S]*?type: boolean[\s\S]*?default: false/.test(workflow)) {
    fail("export_new_cert input is missing or defaults on");
  }
  if (!/actions\/upload-artifact@[0-9a-f]{40} # v7\./.test(workflow) || !workflow.includes("retention-days: 1")) {
    fail("distribution archive upload is missing");
  }
  if (!workflow.includes("if-no-files-found: ignore") || !workflow.includes('archive: "false"')) {
    fail("distribution archive upload is not a single file");
  }
  }
  for (const source of [ascPy, ascRb]) {
    if (!source.includes("BEGIN PRIVATE KEY") || !source.includes("END PRIVATE KEY")) {
      fail("key normalizer does not look for PEM markers");
    }
    if (!source.includes("[^A-Za-z0-9+/=]")) fail("key decode does not strip non-base64 characters");
    if (!source.includes("ASC key PEM unusable ")) fail("key failure text is not the length-only form");
    if (!source.includes("ASC_KEY_P8 is empty") || !source.includes("ASC_KEY_P8 is not valid base64")) {
      fail("key normalizer dropped an empty or base64 failure");
    }
  }
  if (!fastfile.includes("ASC key format:") || !ascPy.includes("ASC key format:")) {
    fail("key step does not report pem, base64, or der");
  }
  const pbx = await read("ios/App/App.xcodeproj/project.pbxproj");
  const deploymentTargets = pbx.match(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g) || [];
  if (deploymentTargets.length !== 4 || deploymentTargets.some((line) => !line.includes("= 15.0;"))) {
    fail("IPHONEOS_DEPLOYMENT_TARGET is not 15.0 on every build setting");
  }
  const podfile = await read("ios/App/Podfile");
  if (!podfile.includes("platform :ios, '15.0'")) fail("Podfile platform is not iOS 15.0");
  if (!podfile.includes("build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'")) {
    fail("Podfile does not raise CocoaPods targets to iOS 15.0");
  }
  const simulator = await fs.readFile(path.join(repo, ".github/workflows/ios-simulator.yml"), "utf8");
  if (!simulator.includes("CODE_SIGNING_ALLOWED=NO")) fail("simulator workflow signs the build");
  if (!simulator.includes("generic/platform=iOS Simulator")) fail("simulator workflow does not build for the simulator");
  if (!simulator.includes('test "$version" = "15.0"')) fail("simulator workflow does not check MinimumOSVersion");
  if (simulator.includes("upload_to_testflight") || simulator.includes("fastlane")) {
    fail("simulator workflow is a release");
  }
  const plist = await read("ios/App/App/Info.plist");
  if (!/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist)) {
    fail("Info.plist encryption flag is not false");
  }
  const scheme = await read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
  if (!scheme.includes("504EC3031FED79650016851F") || !scheme.includes('buildConfiguration = "Release"')) {
    fail("shared App scheme is missing");
  }
  const workspace = await read("ios/App/App.xcworkspace/contents.xcworkspacedata");
  if (!workspace.includes("group:App.xcodeproj")) fail("workspace does not reference the project");
  const keyTest = spawnSync("python3", [path.join(root, "scripts/test-asc-key.py")], { stdio: "inherit" });
  if (keyTest.status !== 0) fail("asc key normalizer tests");
  const p12Test = spawnSync("ruby", [path.join(root, "scripts/test-dist-p12.rb")], { stdio: "inherit" });
  if (p12Test.status !== 0) fail("distribution p12 tests");
  const p12Export = spawnSync("ruby", [path.join(root, "scripts/test-p12-export.rb")], { stdio: "inherit" });
  if (p12Export.status !== 0) fail("distribution p12 export tests");

  // Website CI does not install the fastlane gems. The string checks above
  // still fail a profile call that passes adhoc or development. Run the
  // Configuration.create audit locally, where fastlane 2.228 is installed.
  if (!process.env.CI) {
    const laneAudit = spawnSync("bundle", ["exec", "ruby", "scripts/test-lane-options.rb"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (laneAudit.error || laneAudit.status !== 0) fail("lane option audit");
  }

  for (const name of ["btc-history.json", "chop-block.json", "heartbeat.json"]) {
    const json = JSON.parse(await read("fixtures/" + name));
    if (name === "btc-history.json") {
      const n = json.series?.find((s) => s.ticker === "BTC")?.points?.length || 0;
      if (n < 30) fail("history fixture shallow");
    }
    if (name === "chop-block.json" && !(json.ok && json.tip && json.offlineSnapshot)) fail("chop fixture");
  }

  const readme = await read("README.md");
  if (!readme.includes("ASC_KEY_ID") || !readme.includes("ASC_KEY_P8") || !readme.includes("APPLE_TEAM_ID")) {
    fail("readme missing secrets");
  }
  if (readme.includes("APPLE_DIST_P12")) fail("readme still uses the old distribution secret names");
  if (!readme.includes("DIST_CERT_P12_BASE64") || !readme.includes("DIST_CERT_P12_PASSWORD") || !readme.includes("dist-cert.p12.gpg")) {
    fail("readme missing distribution certificate reuse");
  }
  if (!readme.includes("SHA-256")) {
    fail("readme missing the passphrase");
  }
  if (!readme.includes("MATCH_GIT_URL") || !readme.includes("MATCH_PASSWORD")) {
    fail("readme missing the match alternative");
  }
  if (!readme.includes(cfg.bundleId)) fail("readme missing bundle id");

  const aso = await read("store/ASO.md");
  for (const bit of ["es", "pt-BR", "de", "apple-itunes-app", "SKStoreReviewController", "Custom product"]) {
    if (!aso.includes(bit)) fail(`ASO.md missing ${bit}`);
  }

  try {
    const wwwIndex = path.join(root, "www/index.html");
    await fs.access(wwwIndex);
    for (const g of ["bitcoin-kart", "super-saylor", "chop", "wen", "gauntlet", "runner", "horizon", "trail"]) {
      await fs.access(path.join(root, "www", g, "index.html"));
    }
  } catch {
    /* www is generated; absence is fine before sync */
  }

  const shell = await read("shell/gm/app.js");
  if (!shell.includes("requestReview")) fail("review prompt missing");
  if (!shell.includes("ok: false")) fail("score stub must not claim a global rank");
  if (!shell.includes('location.href = "/index.html"')) fail("Games button does not return to /index.html");
  if (!shell.includes('return roots[i] + "/index.html"')) fail("shell does not rewrite extensionless game roots");
  if (!shell.includes('gm:native:mute')) fail("shell mute missing");
  if (!shell.includes('bare === "/arcade"')) fail("arcade links leave the app");
  if (!shell.includes("stopImmediatePropagation")) fail("shell chrome taps still reach the game");
  if (!shell.includes('document.visibilityState !== "hidden"')) fail("shell does not suspend audio in the background");
  if (!shell.includes("Element.prototype.requestFullscreen = denyFullscreen")) fail("element fullscreen can cover Games");

  const appCss = await read("shell/gm/app.css");
  if (!appCss.includes('body[data-gm-game="horizon"] canvas')) fail("horizon canvas does not fill the phone");
  if (!appCss.includes('body[data-gm-game="kart"] main')) fail("kart stage can collapse");
  if (!appCss.includes("touch-action: none")) fail("chop touch-action");
  if (!appCss.includes('body[data-gm-game="wen"] input[type="range"]')) fail("wen timeline hit target");
  if (!appCss.includes('body[data-gm-game="kart"] .hud-lap')) fail("kart lap sits under Games");
  if (!appCss.includes('body[data-gm-game="chop"] #hud-sats') && !appCss.includes('body[data-gm-game="chop"] #hud {')) {
    fail("chop sats sit under Games");
  }
  if (!appCss.includes('body[data-gm-game="saylor"] #wrap')) fail("saylor cabinet does not fill under Games");
  const launcherCss = await read("shell/launcher.css");
  if (/body\s*\{[^}]*overflow:\s*hidden/.test(launcherCss)) fail("menu still hides overflow on body");
  if (!launcherCss.includes("overflow: visible")) fail("menu is not the document scroller");

  const navShim = await read("shims/navigation.js");
  if (!navShim.includes('"/arcade"') || !navShim.includes('"/index.html"')) fail("exit routes leave the app");

  const sync = await read("scripts/sync-games.mjs");
  if (!sync.includes("maximum-scale=1")) fail("game viewport still allows pinch zoom");
  if (!sync.includes('GAME.state === "play"')) fail("saylor resumes audio while paused");
  if (!sync.includes("Best score saved on this device")) fail("trail tells an offline player the board post failed");
  if (!shell.includes("appStateChange")) fail("shell ignores app background");

  const launcher = await read("shell/launcher.js");
  for (const href of [
    "/bitcoin-kart/index.html",
    "/super-saylor/index.html",
    "/chop/index.html",
    "/wen/index.html",
    "/gauntlet/index.html",
    "/runner/index.html",
    "/horizon/index.html",
    "/trail/index.html",
  ]) {
    if (!launcher.includes(href)) fail("launcher missing " + href);
  }
  if (/"\/bitcoin-kart\/"/.test(launcher)) fail("launcher still links a directory URL");

  const nativeRouter = await read("native/GMBridgeViewController.swift");
  const iosRouter = await read("ios/App/App/GMBridgeViewController.swift");
  if (nativeRouter !== iosRouter) fail("GMBridgeViewController copies drifted");
  if (!nativeRouter.includes("override func router()") || !nativeRouter.includes("struct GMLocalRouter")) {
    fail("bridge does not override the Capacitor router");
  }
  if (!nativeRouter.includes('return basePath + "/index.html"')) fail("router dropped the menu fallback");

  const versions = pbx.match(/CURRENT_PROJECT_VERSION = ([^;]+);/g) || [];
  if (versions.length !== 2 || versions.some((line) => !line.includes("= 2;"))) {
    fail("CURRENT_PROJECT_VERSION is not 2");
  }
  const marketing = pbx.match(/MARKETING_VERSION = ([^;]+);/g) || [];
  if (marketing.length < 2 || marketing.some((line) => !line.includes("= 1.0.0;"))) {
    fail("MARKETING_VERSION is not 1.0.0");
  }
  if (cfg.version !== "1.0.0") fail("app.config version is not 1.0.0");
  if (!fastfile.includes("number = 2 if number < 2")) fail("TestFlight build number can repeat 1");
  const apply = await read("scripts/apply-config.mjs");
  if (!apply.includes("Math.max(2, fromRun)")) fail("apply-config can write a build below 2");
  if (apply.includes('|| "1"')) fail("apply-config still defaults the build to 1");

  if (cap.ios?.contentInset !== "never") fail("content inset still pads the web view");
  if (cap.ios?.backgroundColor !== "#12110F") fail("web view background is not the site ground");
  if (cap.ios?.zoomEnabled !== false) fail("pinch zoom is still enabled");
  for (const key of ["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"]) {
    if (!plist.includes(key)) fail("missing " + key);
  }
  if (!plist.includes("UIInterfaceOrientationLandscapeLeft") || !plist.includes("UIInterfaceOrientationLandscapeRight")) {
    fail("Info.plist does not allow landscape for Kart and Saylor");
  }
  const launch = await read("native/LaunchScreen.storyboard");
  if (!launch.includes('red="0.07058823529411765"')) fail("launch screen is not the site ground");
  const menu = await read("shell/index.html");
  if (!menu.includes("More at galaxymind.space")) fail("menu does not name the site");
  if (!launcherCss.includes("#12110f")) fail("menu ground is not the site ground");

  const iconJson = JSON.parse(await read("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"));
  const iconFile = iconJson.images?.[0]?.filename;
  if (iconFile !== "AppIcon-1024.png" || iconJson.images.length !== 1 || iconJson.images[0].size !== "1024x1024") {
    fail("AppIcon is not a single 1024 universal image");
  }
  const iconBytes = await fs.readFile(path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset", iconFile));
  if (iconBytes.subarray(12, 16).toString() !== "IHDR" || iconBytes[25] !== 2) {
    fail("AppIcon PNG is missing or has an alpha channel");
  }
  if (iconBytes.readUInt32BE(16) !== 1024 || iconBytes.readUInt32BE(20) !== 1024) fail("AppIcon is not 1024 square");
  const chosen = await fs.readFile(path.join(root, "design/app-icon-1024.png"));
  if (!iconBytes.equals(chosen)) fail("AppIcon is not the chosen design/app-icon-1024.png");
  for (const copy of ["shell/icon.png", "store/icon-1024.png"]) {
    const bytes = await fs.readFile(path.join(root, copy));
    if (!bytes.equals(chosen)) fail(copy + " is still the old icon");
  }
  try {
    await fs.access(path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"));
    fail("old AppIcon-512@2x.png is still in the asset catalog");
  } catch {
    /* removed */
  }
  const maker = await read("scripts/make-icons.mjs");
  if (!maker.includes("design/app-icon-1024.png")) fail("make-icons does not copy the chosen icon");

  const routerTest = spawnSync(process.execPath, [path.join(root, "scripts/local-router.mjs")], { stdio: "inherit" });
  if (routerTest.status !== 0) fail("local router self-test");

  if (errors.length) {
    console.error(errors.map((e) => "FAIL " + e).join("\n"));
    process.exit(1);
  }
  console.log("validate ok");
  console.log("name", cfg.appStoreName.length, "subtitle", [...cfg.subtitle].length, "keywords", keywords.length, "promo", [...promo].length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
