# Social automation · safety contract

What galaxymind.space posts to X (and eventually Nostr) **automatically**,
what it explicitly **doesn't**, and how to **disable everything in one
env var** if you ever need to.

Last updated May 11, 2026 (commit landed in this PR).

---

## What posts automatically

Three cron-driven posters, all gated by `SOCIAL_AUTOMATION_DISABLED`
and all skipped on degraded data.

### ~~1. Tier-change tweet · `cron/daily-tweet`~~ (DELETED May 13, 2026)

This cron and three sibling X-posting crons (`announce-new-vendors`,
`featured-vendor-tweet`, `fire-directory-boost`) were unscheduled and
deleted in commit `b9e231c`. Operator preference shifted to manual
posting via X UI using the daily-drafts email
(`SOCIAL_AUTOMATION_EMAIL` → `social-post-drafts` cron, see #2 below).
The plumbing existed but X API credentials were never provisioned, so
the routes were silent no-ops anyway.

To re-enable the X auto-posting path: provision X API creds + revert
commit `b9e231c`. See the README "X auto-posting" section for the full
context.

### 2. Cheapest-treasury-change tweet · `cron/snapshot-treasuries`

**Schedule:** daily at 00:10 UTC

**Fires when:**
- The lowest-mNAV treasury company is different from yesterday's lowest

**Skips when:**
- Same cheapest as yesterday
- Insufficient data for comparison (first run, or all priors null)
- `SOCIAL_AUTOMATION_DISABLED=1` env set

**Example post:** `📊 New cheapest Bitcoin treasury: Metaplanet (MPJPY) at 0.78× mNAV. Was Strategy (MSTR) yesterday at 1.04×. galaxymind.space/treasuries`

### 3. (Coming soon) Vendor-add tweet

When a new vendor lands in `src/lib/vendors.ts` and the deploy completes, post a "New vendor: @handle" announcement. Currently NOT shipped — needs deploy-hook detection logic. Tracked as a follow-up.

---

## What does NOT post automatically (by design)

These categories are off-limits regardless of how clever the trigger could be:

- **Replies to other people's tweets / notes** — bot-reply behavior alienates real audiences within days
- **Quote-retweets** — same risk class
- **Direct messages** — never under any condition
- **"Daily verdict" tweets** — the previous behavior posted on every Tue+Wed regardless of news. This is the noise that erodes follower trust on data-account formats. Replaced with the event-driven gate above
- **Engagement-bait** ("RT if you agree", "what do you think?") — never
- **Auto-following / auto-liking** — never
- **Cryptocurrency price predictions or trading signals** — Galaxy Mind exposes verdicts, not predictions. The wording matters

---

## Manual posting · `/api/post-to-social`

For ad-hoc posts you don't want to wait for a cron to fire:

```sh
curl -X POST https://galaxymind.space/api/post-to-social \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Bitcoin Buying Gauge just printed 87. STACK NOW. galaxymind.space/stack",
    "target": "x"
  }'
```

**Body fields:**
- `text` (required, 1–280 chars)
- `target` (optional, default `"x"`): `"x"` | `"nostr"` | `"both"`

**Response:** per-target results so partial failures are visible. If you ask for `"both"` and Nostr isn't configured yet, X still posts and the response shows `nostr: { ok: false, error: "..." }`.

---

## Kill switches

### Disable all automation in one env var

```
SOCIAL_AUTOMATION_DISABLED=1
```

Set this in Vercel env → redeploy. Every poster (cron-driven and manual) will return `503 SOCIAL_AUTOMATION_DISABLED env set` until you remove or unset the var.

Useful for: an extended outage when even tier-change posts would feel weird, a brand crisis where you want a hard stop, or an upgrade where you want to stage things without firing real posts.

### Dry-run mode (test composition without posting)

```
DRY_RUN_SOCIAL=1
```

Or per-call: `?dryRun=1` on the cron URL.

Posters compute the would-be-posted text and return it in the response payload, but skip the actual post. Use this to validate copy changes in production before flipping the live switch.

---

## Nostr setup (when ready)

The infrastructure is shipped (`src/lib/nostr.ts`, `/api/post-to-social` Nostr branch) but the actual signing requires a one-time package install. Recipe:

### 1. Create a NIP-26 delegated key (do NOT use your main nsec)

Why delegation: putting your main nsec in env vars is a real security risk. If Vercel ever leaks, attackers get full control of your identity (post, edit profile, follow scams, the works). With a delegate, the worst they can do is post text notes for a limited period · you can revoke and re-delegate.

```sh
# Generate a fresh keypair · this is the DELEGATE.
# Use any Nostr key generator (nak, nostr-tools CLI, etc.):
nak key generate
# → outputs: nsec1... (delegate's secret) and npub1... (delegate's public)

# Convert nsec1 to hex (what NOSTR_NSEC_HEX expects):
nak decode nsec1...
# → outputs the 64-char hex
```

### 2. Sign a delegation tag from your MAIN nsec

```sh
# This says: "delegate <delegate_npub> may post kind 1 notes on my
# behalf for the next 6 months". Adjust the kind filter / expiry as
# you like.
nak event --kind 26 \
  --tag p=<delegate_npub_hex> \
  --content "kind=1&created_at>$(date +%s)&created_at<$(($(date +%s) + 15780000))" \
  --sec <your_main_nsec_hex>
# → outputs the delegation tag (a JSON array starting with "delegation")
```

### 3. Install the signing libs

```sh
pnpm add @noble/secp256k1 nostr-tools
```

### 4. Activate the publisher

Open `src/lib/nostr.ts`. Replace the `postNostrNote` stub body with the activation recipe in the file's docstring (it's spelled out · just import-line + 10 lines of nostr-tools wiring).

### 5. Set Vercel env vars

```
NOSTR_NSEC_HEX           = <delegate's 64-char hex secret>
NOSTR_DELEGATION_TAG     = <the JSON tag from step 2>
NOSTR_RELAYS             = wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol,wss://relay.snort.social
```

Redeploy. Test via the manual endpoint with `target: "nostr"`. If it lands on relay.damus.io and relay.primal.net within a few seconds, you're live.

### 6. Verify

Open your npub in [primal.net](https://primal.net/) or [coracle.social](https://coracle.social/). The test note should appear within 2-3 seconds of a successful POST.

---

## What gets logged

Every automated post (real or dry-run) writes a JSON response that Vercel keeps in the cron log:

- Reason (tier_change, extreme_reading, cheapest_changed, etc.)
- Score / tier / cheapest tickers (for context)
- Tweet ID (for X) or event ID (for Nostr) on success
- Error string on failure

So even though no posts ever happen "silently", you can see the full history in the Vercel cron dashboard. If you ever wonder "did the gauge tweet today?", check `/api/cron/daily-tweet`'s most recent log entry.

---

## Why this contract exists

Galaxy Mind's editorial credibility is the moat. One bot-spammy week (replying to every "is it a good time to buy Bitcoin" tweet, auto-quoting MSTR price posts, daily "today is 64 STACK" filler) and the audience writes the account off. The automation contract above is a deliberate choice to **err on the side of posting less** rather than more. Quiet weeks should be quiet. Loud weeks earn the volume.

If a future contributor wants to add a new automated poster, the bar is:
- It must be **event-driven**, not schedule-driven (regime change, threshold crossing, new addition)
- It must have a **cooldown** so a prolonged event doesn't spam
- It must **gracefully no-op** on degraded data
- It must respect `SOCIAL_AUTOMATION_DISABLED`
- It must **log every decision** including "did not post because X" so the operator never has to wonder
