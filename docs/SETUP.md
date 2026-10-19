# Galaxy Mind — Setup notes for the engagement features

Two of the five v1.5 improvements (email alerts + daily X bot) require
third-party API access. The code is shipped and inert until the
environment variables are set in Vercel project settings.

Until you provision them, the features fail closed:

- `/api/subscribe` returns `{ ok: false, error: "Email alerts are not configured yet…" }`
- `/api/cron/check-thresholds` returns 500 with a clear error message
- `/api/cron/daily-tweet` returns 500 with a clear error message
- The on-page subscribe form surfaces the error inline

This is by design — the build never breaks, only the feature is
parked until credentials arrive.

---

## Email alerts (Resend)

### What you need

1. **Resend account** — [resend.com](https://resend.com), free tier is 3 000 emails/month and 100 daily sends.
2. **Verified sending domain** — verify `galaxymind.space` in Resend's dashboard. They'll give you DKIM/SPF DNS records to add at your domain registrar. Verification typically takes 1–24 hours.
3. **Audience** — Resend dashboard → Audiences → New audience. Name it whatever ("Buying Gauge alerts"). Copy the audience ID.

### Vercel env vars

Set these in the Vercel project → Settings → Environment Variables:

| Name | Value | Where it comes from |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Resend dashboard → API Keys → Create |
| `RESEND_AUDIENCE_ID` | `aud_…` | Resend dashboard → Audiences → audience detail page |
| `RESEND_FROM_EMAIL` | `alerts@galaxymind.space` | Any address on your verified domain |
| `CRON_SECRET` | random 32+ char string | Generate one — used as bearer token to authenticate `/api/cron/*` routes |

After saving, redeploy (or push any commit) so the new env vars are picked up by the runtime.

### Verifying it works

```bash
# Subscribe yourself first
curl -X POST https://galaxymind.space/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# Expect: {"ok":true,"data":{"id":"…"}}

# Manually trigger the cron (only fires email if score is in extreme range)
curl https://galaxymind.space/api/cron/check-thresholds \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expect: {"ok":true,"action":"sent" | "skip","score":…}
```

The cron runs automatically daily at 14:00 UTC (~9am ET) per `vercel.json`.

### Limitations (worth knowing)

- **No per-user thresholds.** Everyone subscribed gets every alert. v2 could let users pick "alert me at ≥80" vs "alert me at ≥90".
- **No debouncing.** If the score stays in the extreme zone for several days, subscribers get one email per day. Acceptable for v1 because true extremes are rare.
- **Single audience.** No "warm extreme only" vs "cold extreme only" segmentation.

---

## Daily X bot

### What you need

1. **X developer account** — [developer.x.com](https://developer.x.com). Free tier exists with monthly write limits (~1500 tweets/month at the time of writing — way more than 2 posts/week needs).
2. **App with read+write permissions** — in the developer portal, create an app with both Read and Write OAuth scopes.
3. **Access tokens** — same app page → "Keys and tokens" → generate "Access Token & Secret". You'll get four secrets in total.

### Vercel env vars

| Name | What it is |
|---|---|
| `X_API_KEY` | App API Key (consumer key) |
| `X_API_SECRET` | App API Secret (consumer secret) |
| `X_ACCESS_TOKEN` | Generated access token |
| `X_ACCESS_TOKEN_SECRET` | Generated access token secret |
| `CRON_SECRET` | Same one used for email alerts |

### Verifying it works

```bash
curl https://galaxymind.space/api/cron/daily-tweet \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expect: {"ok":true,"score":67,"tier":"HOT","tweetId":"…","text":"…"}
```

If you see `{"ok":false,"error":"…"}` it'll tell you exactly what's missing.

The cron runs automatically Tue + Wed at 13:45 UTC (~9:45am ET) per
`vercel.json`. the README identifies that window as the optimal post
time for the BTC Twitter audience.

### Tweet template (current)

```
Bitcoin Buying Gauge: 67/100 STACK NOW

Above-average entry conditions. Stack with conviction.

Best window next 7 days: Thu 8pm–10pm ET

galaxymind.space/stack
```

X auto-attaches the OG card from the link, so the gauge image
appears below the tweet without needing media upload. The flavor
line varies per tier (3 alternatives each in `daily-tweet/route.ts`)
and rotates by day-of-year so consecutive days at the same tier
don't read identically.

---

## Operational notes

- Both crons use `CRON_SECRET` for bearer auth. **Vercel automatically
  injects** `Authorization: Bearer ${CRON_SECRET}` on every cron
  invocation when that env var is set in the project. You don't need
  to do anything special — just set the secret.
- Both endpoints are also reachable via direct `curl` (with the same
  bearer header) for manual testing or backfills.
- The cron logs are visible in Vercel project → Deployments → Logs.
