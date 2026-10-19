# App Store Optimization

Metadata for deliver lives in `store/metadata/en-US`. This note is why those strings look the way they do. Nothing here promises a payout, a contest, or a live feed the binary does not have.

## Name, subtitle, keywords

Apple indexes the name and the subtitle, then adds the 100-character keyword field. Repeating a word wastes a slot.

| Field | Text | Count |
|---|---|---|
| Name | Galaxy Mind: Bitcoin Games | 26 / 30 |
| Home screen | Bitcoin Games | 13 |
| Subtitle | Arcade racing, HODL & sats fun | 30 / 30 |
| Keywords | `btc,kart,crypto,racer,retro,satoshi,offline,platformer,puzzle,runner,pixel,chart,history,drift,block` | 100 / 100 |

The keyword field is comma-separated with no spaces, singular, and lowercase. It does not repeat galaxy, mind, bitcoin, games, arcade, racing, hodl, sats, or fun.

Words chosen because a player would type them, and because the app actually contains that thing:

- `btc`, `crypto`, `satoshi` cover the bitcoin-game and crypto-game queries without restating `bitcoin`.
- `kart`, `racer`, `drift` cover kart racer. `racing` is already in the subtitle.
- `retro`, `pixel`, `platformer` cover Super Saylor.
- `puzzle`, `chart`, `history` cover WEN, the Gauntlet, and the Trail.
- `runner` covers Node Runner.
- `offline` covers the offline-games query.
- `block` covers CHOP (a saved block you slice).

Left out on purpose:

- `mining`. There is no mining game. The word also reads as "earn bitcoin."
- `free`, `best`. Apple's keyword guidance rejects both, and `best` is a claim.
- Competitor and parody marks: Nintendo, Mario, and any person or company the games caricature. Super Saylor's page source mentions "crypto mario" as a search aside. That phrase does not belong in a keyword field.
- `earn`, `reward`, `prize`, `casino`, `lottery`, `gamble`. Review risk, and untrue.

`sats` stays in the subtitle because the games use that word for the score. The description, the first-launch sheet, and the review notes say a sat is a play point. The app does not pay bitcoin.

## Category

Primary: Games (`GAMES`).

Subcategories: Arcade (`GAMES_ARCADE`) and Racing (`GAMES_RACING`). Racing is the honest second fit because Bitcoin Kart is a racer. Puzzle would also be defensible for WEN. Arcade plus Racing matches the two verbs on the launcher (race, and everything else).

## What the first lines have to do

The store listing shows about three lines before More. `description.txt` spends them on the hook:

1. Eight bitcoin games that play offline.
2. No ads, no account, and no wallet.
3. Scores are play points, not real bitcoin.

Then one sentence per game, only claims the build can keep: CHOP is a saved block, WEN / Gauntlet / Runner use saved price history, the Gauntlet is not a brokerage, Timechain points shrink as you climb. The close repeats offline, no ads, no tracking, and links `https://galaxymind.space`.

Promotional text (`promotional_text.txt`, 152 / 170) can change without a review. Use it for a seasonal line. Do not use it to announce a payout.

## Ratings

`SKStoreReviewController` is the only review ask. The shell calls it after a strictly better personal best, and only once the player has done that twice, then at most once every 90 days. Apple applies its own cap on top. The call lives in `shell/gm/app.js` (`maybeReview`) and `native/GMBridgePlugin.swift` (`requestReview`). There is no custom star dialog.

## Screenshots and preview

Sizes the script writes, portrait:

| Device | Pixels | Deliver-style name |
|---|---|---|
| iPhone 6.9" | 1320 × 2868 | `iPhone 6.9-inch-0N.png` |
| iPhone 6.5" | 1284 × 2778 | `iPhone 6.5-inch-0N.png` |
| iPad Pro 13" | 2064 × 2752 | `iPad Pro (13-inch)-0N.png` |

The first three frames carry a caption bar: offline, Bitcoin Kart, and play points. Later frames are the games with no extra claim. Generate with `npm run screenshots` from `ios-arcade/` after `npm run sync`. `fastlane frameit` is optional. These frames are HTML screenshots of the bundled games, not mockups.

If a future deliver rejects a filename, keep the pixel sizes and rename to the device string that lane prints. The pixels are the contract.

App Preview storyboard: `store/app-preview-storyboard.md`. No video file is in the repo. A preview is optional and needs a Mac capture.

## Age rating

Answers are in `store/age-rating.md`. Target is 9+ for mild cartoon violence (kart items, a platformer stomp). No gambling, contests, loot boxes, ads, or unrestricted web browsing. Safari is an allowlist (the site, X), not an in-app browser. If review treats that as unrestricted web access, switch that one answer to Yes and accept the rating change.

## Localization, later

Do not add locales until someone is ready to translate the description. When that happens, add only the keyword field for `es`, `pt-BR`, and `de`. Apple gives each localization its own 100-character keyword field, and the name and subtitle still have to be filled, but the cheap win is extra search terms in those languages (juego, corrida, offline, satoshi, and the equivalents). English stays the primary. Do not machine-translate the parody disclaimer.

## Universal Links and the Smart App Banner

Not in this build. The site is unchanged on purpose.

When the numeric Apple ID exists:

1. Host `https://galaxymind.space/.well-known/apple-app-site-association` with no redirect, `Content-Type: application/json`, and `appID` set to `{TEAMID}.space.galaxymind.arcade`. Paths worth claiming: `/arcade`, `/bitcoin-kart`, `/super-saylor`, `/chop`, `/wen`, `/gauntlet`, `/runner`, `/horizon`, `/trail`.
2. Add the Associated Domains entitlement `applinks:galaxymind.space` in the same commit that ships the file. Adding it before the file 404s makes the system cache a failure.
3. On those pages, add `<meta name="apple-itunes-app" content="app-id=APP_ID, app-argument=https://galaxymind.space/arcade">` so Safari can show a Smart App Banner. `APP_ID` is the numeric id from App Store Connect, not the bundle id.

Until step 2, links to galaxymind.space open in Safari view controller. They do not load the live site inside the web view.

## Custom product pages

App Store Connect can host extra product pages with their own screenshots and a short custom URL. Ideas that match a real cabinet, for a Nostr or X post:

| Page | First screenshot | Who it is for |
|---|---|---|
| Bitcoin Kart | The race, touch controls visible | A kart post |
| Super Saylor | A level, not the title crawl | A platformer post |
| Daily set | WEN, then the Trail, then the Gauntlet | A "today's puzzle" post |

Each page reuses the same description rules: saved data is labeled saved, scores are play points, no payout language. The default page stays the eight-game set.

## Privacy label

While Game Center is off, the label is Data Not Collected. `PrivacyInfo.xcprivacy` tracks nothing and lists no collected types. Turning leaderboards on means updating the label (User ID and Gameplay Content) in the same release. The website privacy policy describes the website. The review notes say the app does not embed that site and does not collect what the site collects.
