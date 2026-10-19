# Galaxy Mind: Bitcoin Games

Offline iOS shell for the eight games on the Galaxy Mind arcade. The site stays the site. This folder is the app.

| | |
|---|---|
| App Store name | Galaxy Mind: Bitcoin Games (26) |
| Home screen | Bitcoin Games (13) |
| Subtitle | Arcade racing, HODL & sats fun (30) |
| Bundle id | `space.galaxymind.arcade` |
| Version source | `app.config.json` |

A score called sats is a play point. The app does not pay bitcoin, sell anything, show ads, or run a contest. Game Center ships off.

## What is in the binary

Eight cabinets, copied or bundled by `node scripts/sync-games.mjs`:

| Game | Route in the app | Notes |
|---|---|---|
| Bitcoin Kart | `/bitcoin-kart/` | Static WebGL game. On-screen controls are forced on, including iPad. |
| Super Saylor | `/super-saylor/` | Single-file platformer. Same touch fix. |
| CHOP | `/chop/` | Saved real block, not the live tip. Audio is in the bundle. |
| WEN | `/wen/` | Saved price history. |
| The Bitcoin Gauntlet | `/gauntlet/` | Same saved history. Not a brokerage. |
| Node Runner | `/runner/` | Same saved history. |
| Timechain | `/horizon/` | The live-tip line is hidden. |
| The HODL Trail | `/trail/` | Deck is code. No network. |

SIX DEEP is not included.

Price history and the block snapshot live in `fixtures/`. Re-download them before a build you want current, then commit the files:

```bash
node scripts/refresh-fixtures.mjs
```

## Checks that run without a Mac

```bash
cd ios-arcade
npm ci
npm run sync
npm run icons
npm run check
npm run touch-test
npm run screenshots
```

`npm run check` checks lengths, keyword rules, the privacy manifest, and that the TestFlight workflow is dispatch-only.

## App Store Connect, once

1. Identifiers. Register an explicit App ID `space.galaxymind.arcade`. Do not enable Game Center yet.
2. New App. Name `Galaxy Mind: Bitcoin Games`. Primary language English (US). Bundle ID the one above. SKU `galaxymind-arcade`.
3. Users and Access, then Integrations, then App Store Connect API. Generate a team key with the Admin role. Download the `.p8` once. Note the Key ID and the Issuer ID. App Manager can upload a build, but this lane creates an Apple Distribution certificate, and Apple only allows the Account Holder or an Admin to create one. An existing Apple Distribution certificate does not stop preflight. The log names each one and its expiry, without the team id. When `DIST_CERT_P12_BASE64` and `DIST_CERT_P12_PASSWORD` are both set, the lane imports that key and reuses the certificate. When neither is set, `get_certificates` skips a certificate whose private key is not in the keychain and creates another while Apple still accepts one, then the workflow keeps the new key (see below). If Apple refuses because the team is at its limit, the log names the certificates and their expiry. Revoke one this lane cannot use, then run the workflow again. Preflight still stops when the key cannot call the users API.
4. Age rating: use `store/age-rating.md`.
5. Privacy: Data Not Collected, until Game Center is turned on.
6. Category: Games, Arcade, Racing. The metadata files already say this.
7. Paste `store/review-notes.txt` into the review notes. Fill the review contact (name, phone, email) yourself. This repo does not invent one.
8. Export compliance is already in Info.plist (`ITSAppUsesNonExemptEncryption` false).

## GitHub secrets

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | Key ID from the API key |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | The `.p8` itself, base64 of that file, or only the base64 body between the PEM markers. |
| `APPLE_TEAM_ID` | 10-character membership team id |
| `DIST_CERT_P12_BASE64` | Base64 of the saved Apple Distribution PKCS#12. Leave empty until you store it by hand after the first creating run. |
| `DIST_CERT_P12_PASSWORD` | Password for that PKCS#12. Store it by hand at the same time. The workflow never prints it. |
| `GH_SECRETS_PAT` | Not used. The workflow no longer passes it to the job (security audit 2026-10-18). Store the two secrets above by hand after a creating run. The repository secret can be deleted and the token revoked. |

The TestFlight upload workflow is not included in this public copy. It was a `workflow_dispatch`-only job that ran the steps below with the secrets listed above.

It writes `ASC_KEY_P8` to `$RUNNER_TEMP/AuthKey_<id>.p8`, checks that file with `openssl pkey -noout`, checks that `gpg` is installed, selects the newest installed Xcode, and runs `bundle exec fastlane ios preflight` before `npm ci` or the archive. Preflight authenticates with the API key, calls the users API (an Admin key can, an App Manager key cannot), checks that bundle id `space.galaxymind.arcade` and the app record exist, and lists Apple Distribution certificates by name and expiry. An existing certificate does not stop the run. One of the two `DIST_CERT_P12_*` secrets without the other stops preflight before any certificate is created. The next build number is one higher than the latest TestFlight build for marketing version 1.0.0, and never below 2, because build 1 is already on TestFlight.

The key step accepts three shapes and rebuilds one canonical PEM with 64-character lines. A PEM may carry a BOM, CRLF, literal `\n`, spaces inside the marker lines, or junk before `-----BEGIN PRIVATE KEY-----`. Base64 of that whole PEM is accepted, including a trailing `%` from zsh. A bare base64 body with no BEGIN or END lines is accepted when those bytes are a PKCS#8 private key (the contents of a `.p8` between its markers). Characters outside `[A-Za-z0-9+/=]` are removed from the body, the body must base64-decode, and the decoded bytes must be a PKCS#8 sequence. The log says `pem`, `base64`, or `der`, and never the key. A bad secret fails with lengths and booleans only (`len`, `bom`, `has_begin`, `has_end`, `body_len`, `mod4`, `der`).

After preflight the workflow installs this folder, syncs the games, runs `cap sync ios`, applies `app.config.json`, and requires `ios/App/Podfile.lock`. Play links and the Games button use `index.html`. Capacitor's stock router serves the root `index.html` for every URL with no file extension, so a link to `/bitcoin-kart/` reloads the menu. `GMBridgeViewController` overrides `router()` and serves a directory's own `index.html` when that file is in the bundle. The deployment target is iOS 15.0. Apple warned ITMS-90068 that an iOS 14.0 target will be rejected from April 2027. `IPHONEOS_DEPLOYMENT_TARGET` is 15.0 on every Xcode build setting, the Podfile platform is `15.0`, and the Podfile post_install raises CocoaPods targets to 15.0. Capacitor 7 has no deployment-target field in `capacitor.config.json`. Its CLI hardcodes 14.0 only when it generates Cordova plugin podspecs, and this shell has none. The lane builds `ios/App/App.xcworkspace` (CocoaPods, not Swift Package Manager) with the shared App scheme. It imports a saved distribution certificate when both DIST_CERT secrets are set, and otherwise creates an Apple Distribution certificate in a temporary keychain, then requests an App Store provisioning profile for `space.galaxymind.arcade`. The profile call omits `adhoc` and `development`. Passing both, even as false, is a fastlane option conflict, and the default profile type is App Store. Fastlane's certificate `type` option is Mac-only, so the lane passes `development: false` instead of `type: distribution`. The App target is switched to manual signing with identity Apple Distribution, the profile name from that profile, and team `APPLE_TEAM_ID`. The archive is exported with method app-store and a provisioningProfiles map for the bundle id. It does not ask Xcode for an iOS Development profile, so the team does not need a registered device. It does not use match. `upload_to_testflight` gets the same API key, `skip_waiting_for_build_processing: true`, and `uses_non_exempt_encryption: false` (Info.plist already sets `ITSAppUsesNonExemptEncryption` false). It does not wait for Apple to finish processing the build. Fastlane is pinned at 2.228.0 in `Gemfile` and `Gemfile.lock`. The workflow caches that lock. Keep the lock.

After the processing email: internal testers who are App Store Connect users can install. An external group needs beta review.

## Reuse the distribution certificate

Each creating run makes an Apple Distribution certificate. Apple stops accepting another one once the team is at its limit, and a certificate without its private key cannot sign. The lane keeps that private key.

When `DIST_CERT_P12_BASE64` and `DIST_CERT_P12_PASSWORD` are both set, the beta lane imports the PKCS#12 into the temporary keychain before `get_certificates`. Fastlane reuses the identity. That run does not create a certificate, does not upload an artifact, and does not overwrite the secrets. If the saved key does not match a certificate still on the team, the lane creates a replacement, uploads a new encrypted artifact, and leaves the old secrets as they are.

When neither secret is set, the lane creates a certificate, exports a PKCS#12 with a random password, and encrypts a tar of `distribution.p12` and `password.txt`. The workflow uploads that ciphertext as the `dist-cert-p12` artifact for one day, but only when the run is dispatched with the `export_new_cert` input turned on. Normal runs never upload it. The file is `dist-cert.p12.gpg`. It is not a zip. The log never prints the password, the passphrase, or the key.

The export reads the private key file and the `.cer` certificate file written by the create step. Both are turned into PEM, and the pkcs12 command receives those two PEM paths. OpenSSL 3 and macOS LibreSSL reject an input-format flag on pkcs12, which is what left the new certificate on the team with no saved key. Before anything is stored, the lane imports that PKCS#12 into a temporary keychain and restores the previous keychain. Importing the unwrapped PEM stores the certificate and drops the private key, so the lane does not use that path. If that export or that import check fails, the lane revokes the certificate it just created and then stops.

The gpg passphrase is the lowercase hex SHA-256 of this byte string and nothing else: `ASC_KEY_ID` with surrounding whitespace removed, one newline, then `ASC_KEY_P8` exactly as that secret is stored (a trailing newline on the `.p8` counts).

```bash
python3 -c 'import hashlib,os; print(hashlib.sha256((os.environ["ASC_KEY_ID"].strip()+"\n"+os.environ["ASC_KEY_P8"]).encode()).hexdigest())'
```

Decrypt and read the two files without printing the password into the shell history:

```bash
mkdir -m 700 "$HOME/dist-cert-unpack"
gpg --batch --yes --pinentry-mode loopback --decrypt --passphrase-fd 3 \
  -o "$HOME/dist-cert-unpack/dist-cert.tar" dist-cert.p12.gpg 3<<<"$PASSPHRASE"
tar -C "$HOME/dist-cert-unpack" -xf "$HOME/dist-cert-unpack/dist-cert.tar"
base64 < "$HOME/dist-cert-unpack/distribution.p12" | tr -d '\n' > "$HOME/dist-cert-unpack/p12.b64"
```

`password.txt` is `DIST_CERT_P12_PASSWORD` with no trailing newline. `p12.b64` is `DIST_CERT_P12_BASE64`. Whitespace in the base64 is stripped on import. Delete the unpack directory and the artifact after the secrets are stored. Do not commit either file.

The lane has no code that writes repository secrets. Store the two values by hand from the decrypted archive. The default `GITHUB_TOKEN` cannot write secrets, and this lane does not try.

One secret without the other stops preflight before a certificate is created. A base64 value that is not a PKCS#12 fails with lengths and a `der` boolean only. Revoking the certificate means deleting both secrets before the next run, because an old key does not match a new certificate. The next run with both secrets empty creates a replacement, which you store by hand again.

fastlane match is the other place a team can keep this key: a private git repo, `MATCH_GIT_URL`, and `MATCH_PASSWORD`. This lane does not call match.

Metadata upload is a separate lane, after the app record exists:

```bash
cd ios-arcade
bundle exec fastlane ios metadata
```

That lane is not in the GitHub workflow.

## Store copy

Draft listing text is in `store/metadata/en-US`. The reasoning, screenshot sizes, localization plan, Universal Link plan, and custom product pages are in `store/ASO.md`. Do not change the website for the Smart App Banner until an Apple ID exists. This package does not.

Keywords (100 characters, no repeats of the name or subtitle):

```
btc,kart,crypto,racer,retro,satoshi,offline,platformer,puzzle,runner,pixel,chart,history,drift,block
```

## Game Center, later

1. Create the leaderboards in App Store Connect with the ids in `app.config.json`.
2. Enable the Game Center capability on the App ID.
3. Set `gameCenterEnabled` to true in `app.config.json`.
4. Change the privacy label to include User ID and Gameplay Content.
5. Rebuild.

Leaving the flag on before the leaderboards exist will fail the upload or the score submit. The flag defaults to false, and the entitlement is not in the project while it is false.

## Privacy

`native/PrivacyInfo.xcprivacy` declares no tracking and no collected data types. The app does not send analytics, does not call chop stats, and does not link an X account. High scores stay in the web view's local storage.

`https://galaxymind.space/privacy` describes the website. The app does not embed the website. Say that in review if asked.

Support URL: `https://galaxymind.space/about`. Marketing URL: `https://galaxymind.space/arcade`.

## Parody

Bitcoin Kart and Super Saylor are unofficial. They are not affiliated with the people or companies they depict, or with any other game.
