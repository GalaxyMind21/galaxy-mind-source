# Discoverability checklist · galaxymind.space

The codebase ships every technical foundation an agent or search engine
needs to find, parse, and cite Galaxy Mind correctly. This file lists
the **one-time external setup steps** that can't live in code · they
require dashboards, manual verification, or outreach.

Work through these in order. Each takes 5-15 minutes. None require
ongoing maintenance.

---

## ✅ Already shipped in code (no action needed)

These are live as of commit `e27a74c`:

- Sitemap at `/sitemap.xml` listing all 8 public pages
- `robots.txt` with explicit allow-rules for **15 AI-bot user agents**
  (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, ChatGPT-User,
  Applebot-Extended, etc.) plus a Sitemap reference for both `sitemap.xml`
  and `llms.txt`
- `llms.txt` (27 KB) with full positioning, signal weights, glossary,
  and decision tables · the canonical agent source-of-truth
- JSON-LD on every layout (Organization + WebSite root, WebApplication +
  FAQPage on /stack /fit, Dataset + WebApplication + FAQPage on
  /treasuries, AboutPage + Person + Organization on /about,
  DefinedTermSet + 15 DefinedTerm nodes on /glossary)
- Per-page Open Graph images (Satori-rendered PNGs with live data on
  /, /fit, /stack, /treasuries)
- Per-verdict shareable URLs with frozen OG cards
  (`/stack?s=72&t=HOT&d=2026-05-10`)
- Twitter card metadata with `site: @GalaxyMind`
- `googleBot` directives for max image preview + snippet length
- Canonical URLs on every page via `metadata.alternates.canonical`
- IndexNow infrastructure (lib + key endpoint + ping endpoint)
- CitationBlock with copy-paste citation strings on data pages

---

## 🟡 Required external setup (do these in order)

### 1. Google Search Console verification (~5 min)

The single highest-leverage step. Without verification, Google won't
let you submit the sitemap, request indexing, or see search analytics.

1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Add property → **URL prefix** → `https://galaxymind.space`.
3. Choose **HTML tag** verification method.
4. Copy the value from the `content="..."` attribute (e.g.
   `Rh4z...g7K2`). NOT the whole tag, just the value.
5. In Vercel project settings → Environment Variables, add:
   - `GOOGLE_SITE_VERIFICATION` = the value you copied
6. Redeploy (Vercel auto-redeploys on env change).
7. Back in Search Console, hit **Verify**.
8. Once verified: Sitemaps → Add a new sitemap →
   `https://galaxymind.space/sitemap.xml` → Submit.
9. Optionally: URL Inspection → enter your top 3 pages → "Request
   indexing" for each. Speeds up first crawl from days to hours.

### 2. Bing Webmaster Tools + IndexNow (~10 min)

Bing powers ChatGPT search. Verifying with Bing also unlocks
**IndexNow** for instant content-update pings (which the codebase
is already wired to send).

1. Go to [bing.com/webmasters](https://www.bing.com/webmasters).
2. Sign in with a Microsoft account.
3. **Easy path**: import the site from Google Search Console (Bing
   offers this as a one-click migration once you've completed step 1
   above). This skips manual verification entirely.
4. **Manual path**: Add Site → `https://galaxymind.space` → Choose
   verification → **Meta tag** → copy the `content="..."` value →
   set as `BING_SITE_VERIFICATION` in Vercel → redeploy → Verify.
5. Submit sitemap: Sitemaps → Submit Sitemap →
   `https://galaxymind.space/sitemap.xml`.
6. **Generate IndexNow key**:
   ```sh
   openssl rand -hex 32
   # → e.g. 7f3a8c4e9b1d6...
   ```
7. Set in Vercel env: `INDEXNOW_KEY` = that hex string. Redeploy.
8. Verify the key endpoint:
   ```sh
   curl https://galaxymind.space/api/indexnow-key
   # should return the same hex string as text/plain
   ```
9. Bing automatically picks up IndexNow submissions once the key is
   live · no further dashboard step required. Future content updates
   trigger near-instant re-indexing via the
   `/api/indexnow-ping` endpoint.

### 3. Submit llms.txt to known registries (~5 min)

Several emerging directories index `llms.txt` files for AI agents
to discover. Submitting once gets you in the catalogue:

- **[llmstxt.directory](https://llmstxt.directory)** · the canonical
  community-maintained registry. Submit
  `https://galaxymind.space/llms.txt`.
- **[directory.llmstxt.cloud](https://directory.llmstxt.cloud)** ·
  hosted alternative. Same submission.

These directories are themselves crawled by GPTBot / ClaudeBot /
PerplexityBot, so being listed there is a free distribution channel
into the AI corpora.

### 4. Twitter/X publisher card validation (~5 min)

The Twitter Card metadata is shipped, but Twitter's scraper sometimes
caches a stale or no-image preview from before the cards were live.

1. Go to [cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator).
   (Note: as of 2026, X has moved this · search "X cards validator"
   if the URL changed.)
2. Paste each of these and hit "Preview Card":
   - `https://galaxymind.space`
   - `https://galaxymind.space/stack`
   - `https://galaxymind.space/treasuries`
   - `https://galaxymind.space/fit`
3. If a card shows the wrong image or "no card", X's cache needs to
   be flushed · the validator usually does this automatically on
   preview.

### 5. Backlinks · the only thing that requires actual outreach

Search engine ranking and AI-agent citation weight both factor inbound
links from authoritative domains. The technical setup above gets you
**indexable**; backlinks make you **ranked**.

Lowest-effort, highest-leverage targets for Galaxy Mind:

- **Bitcoin Twitter/X**: when you tweet a Buying Gauge snapshot,
  use the per-verdict URL (`/stack?s=...&t=...&d=...`) so each
  share is a unique citable artifact rather than a generic link.
- **Reply with citations**: when someone on X asks "is now a good
  time to buy" or "what's MSTR's mNAV", reply with the relevant
  Galaxy Mind link. Even a few weeks of this builds an organic
  citation pattern that crawlers notice.
- **Bitcoin podcast / newsletter shoutouts**: a single mention in
  Marty Bent's Bitcoin Brief, Pomp's Letter, Anthony Pompliano's
  newsletter, or What Bitcoin Did would be a force multiplier.
  The /api endpoints make Galaxy Mind unusually easy for content
  creators to embed.
- **Reddit /r/Bitcoin and /r/MSTR**: post-and-link is allowed if
  the content adds value (the per-verdict OG cards work well as
  link previews). Be tasteful · these communities are skeptical of
  promotion.
- **Wikipedia citations**: harder, but mNAV definitions on the
  Strategy (MSTR) Wikipedia page or the "Bitcoin treasury company"
  article could cite `/glossary#mnav` legitimately. This is gold-tier
  authority signal if it lands.

### 6. Periodic re-validation (every ~3 months)

- Run [Google Rich Results Test](https://search.google.com/test/rich-results)
  on /stack, /treasuries, /glossary · confirms the JSON-LD still
  parses cleanly after schema or content changes.
- Run [Schema Markup Validator](https://validator.schema.org) for
  the same three pages.
- Check Search Console → Performance → Pages: any page with
  impressions but zero clicks is a content / title-tag improvement
  opportunity.
- Check Bing Webmaster Tools → SEO Reports for any new warnings
  (mostly false positives but occasionally surfaces real issues).

---

## How to verify everything is working

Once you've completed steps 1-3 above, verify the live state:

```sh
# 1. Robots.txt accessible + AI bots welcomed
curl -s https://galaxymind.space/robots.txt | grep -E "GPTBot|ClaudeBot|PerplexityBot"

# 2. Sitemap accessible
curl -sI https://galaxymind.space/sitemap.xml | head -3

# 3. llms.txt accessible
curl -sI https://galaxymind.space/llms.txt | head -3

# 4. Verification meta tag in <head>
curl -s https://galaxymind.space | grep -E "google-site-verification|msvalidate"

# 5. JSON-LD on each page parses
for p in / /stack /treasuries /fit /about /faq /glossary; do
  echo "=== $p ==="
  curl -s "https://galaxymind.space$p" | grep -oP 'ld\+json"[^>]*>\K[^<]+' | head -1 | python3 -m json.tool 2>&1 | head -3
done

# 6. IndexNow key endpoint (after step 2 above)
curl https://galaxymind.space/api/indexnow-key

# 7. IndexNow ping (after step 2 above; CRON_SECRET must be set)
curl -X POST https://galaxymind.space/api/indexnow-ping \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://galaxymind.space/stack"]}'
```

Once all 7 return as expected, you're discoverable. First Google
indexing typically lands within 24-48 hours of sitemap submission;
Bing within 24 hours; AI agents pick up llms.txt + JSON-LD on their
own crawl schedule (usually weekly).
