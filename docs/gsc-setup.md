# Google Search Console — API access setup

One-time setup so `scripts/pull-gsc.ts` (and, later, a cron) can read
Search Console data for galaxymind.space without a browser.

**Time: ~10 minutes.** You do steps 1–4 in a browser; everything after
is scripted.

Search Console is one of the few Google APIs that accepts **service
account** auth with no OAuth consent screen — you grant access from
inside Search Console's own UI instead. That's what makes this
cron-able.

---

## 1. Create a Google Cloud project + service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
   Sign in as the Google account that **owns the Search Console
   property** (the one that verified galaxymind.space).
2. Top bar → project dropdown → **New Project**. Name it
   `galaxy-mind-seo`. Create, then make sure it's the selected project.
3. Left nav → **IAM & Admin → Service Accounts** → **Create service
   account**.
   - Name: `gsc-reader`
   - Skip the optional "grant this service account access to the
     project" and "grant users access" steps — it needs **no** Cloud
     IAM roles. Its only permission comes from Search Console in step 3.
   - Click **Done**.

## 2. Enable the Search Console API

1. Left nav → **APIs & Services → Library**.
2. Search for **Google Search Console API**. Open it → **Enable**.

> If you skip this, the script fails at the token exchange with
> `Search Console API has not been used in project …`.

## 3. Authorize the service account inside Search Console

1. Back in the Service Accounts list, copy the service account's
   **email** — it looks like
   `gsc-reader@galaxy-mind-seo.iam.gserviceaccount.com`.
2. Go to [Search Console](https://search.google.com/search-console) →
   select the galaxymind.space property.
3. **Settings** (left nav, bottom) → **Users and permissions** → **Add
   user**.
4. Paste the service account email. Permission: **Full**.
   (Restricted also works for reading, but Full avoids surprises if we
   later add sitemap submission.)

> This is the step people miss. The service account can authenticate
> just fine without it — it simply sees zero properties. Run
> `npx tsx scripts/pull-gsc.ts --sites` to confirm it can see the
> property before going further.

## 4. Download the key

1. Service Accounts → click `gsc-reader` → **Keys** tab → **Add key →
   Create new key** → **JSON** → Create.
2. The browser downloads a `.json` file. Move it to the repo root as
   **`.gsc-key.json`**:

```bash
mv ~/Downloads/galaxy-mind-seo-*.json <repo>/.gsc-key.json
```

`.gsc-key.json` is gitignored. It contains a real RSA private key —
never commit it, never paste it into a chat or an issue. If it leaks,
delete the key in the Keys tab and create a new one.

---

## 5. Run it

```bash
npx tsx scripts/pull-gsc.ts --sites
```

Confirms auth works and lists the properties the service account can
read. Then the actual report:

```bash
npx tsx scripts/pull-gsc.ts
```

### Options

| Flag | Effect |
|---|---|
| *(none)* | Last 28 days vs the prior 28, full report |
| `--days 90` | Longer window (GSC retains ~16 months) |
| `--json` | Raw rows as JSON — pipe into other tooling |
| `--sites` | List readable properties and exit |

### What the report shows

- **Summary** — clicks / impressions / CTR / avg position vs the prior
  equal-length window. Position is impression-weighted so a
  1-impression #1 ranking can't outweigh a 5,000-impression #12.
- **Striking distance** — queries ranking 5–20. The highest-leverage
  list: these already rank, so moving them to page one is a title /
  content / internal-link job rather than a new page.
- **CTR gap** — pages whose CTR trails *this site's own median CTR at
  the same position band*. Deliberately self-calibrated rather than
  compared against invented industry CTR constants. High "missed" means
  the ranking is fine and the title/description is losing the click.
- **Cannibalization** — one query where multiple URLs rank. Relevant
  here because the README deliberately keeps the exact-match spend phrase
  off the homepage title so `/` and
  `/online-stores-that-accept-bitcoin` don't split relevance; this
  report is how we check that discipline is actually holding.
- **Top pages / top queries** by clicks.

---

## Notes

- **Read-only.** The script requests the `webmasters.readonly` scope. It
  cannot submit sitemaps, request indexing, or change the property.
- **Data lag.** GSC's pipeline runs ~2 days behind, so the script ends
  its window 3 days back. Asking for yesterday returns partial rows that
  look like a traffic collapse.
- **Running it on Vercel/cron later.** Set
  `GSC_SERVICE_ACCOUNT_JSON` to the key JSON, base64-encoded (Vercel env
  vars handle newlines badly):
  ```bash
  base64 -i .gsc-key.json | pbcopy
  ```
  The script accepts raw JSON or base64 in that variable.
- **Property override.** If the script picks the wrong property, set
  `GSC_SITE_URL` — exactly as `--sites` prints it, e.g.
  `sc-domain:galaxymind.space` (domain property) or
  `https://galaxymind.space/` (URL-prefix property). These are different
  properties with different data.
