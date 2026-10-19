#!/usr/bin/env bash
# scripts/recruit-launch.sh · one-shot launcher for the vendor-
# recruitment X campaign.
#
# Does three things in sequence with confirm prompts between:
#   1. Previews TODAY'S daily-drafts cron output (proves the env
#      vars + KV + draft logic are all wired correctly · no email
#      sent and no cooldowns marked because of ?dryRun=1)
#   2. Dry-runs threads/recruitment-boost.json so you can read all
#      4 tweets in your terminal before any of them touches X
#   3. After your explicit "yes," fires the recruitment thread for
#      real via /api/post-to-social. Replies chain automatically.
#
# Requires:
#   CRON_SECRET  · same secret used by /api/cron/* + post-to-social.
#                  Set it before running:
#                    export CRON_SECRET=<your-secret>
#                  Or invoke inline:
#                    CRON_SECRET=xxx ./scripts/recruit-launch.sh
#
# Optional:
#   SITE_URL     · override the target host (defaults to production).
#                  Useful for testing against a preview deploy:
#                    SITE_URL=https://galaxy-mind-git-x.vercel.app \
#                      ./scripts/recruit-launch.sh
#
# Exit codes:
#   0 · everything ran cleanly (or you aborted at the confirm step)
#   1 · CRON_SECRET unset
#   2 · daily-drafts preview failed (cron endpoint or upstream issue)
#   3 · recruitment-thread dry-run failed (likely a char-count overflow)
#   4 · recruitment-thread real post failed (X API failure mid-thread)
#
# After successful posting · pin the first tweet on @GalaxyMind's
# profile, then run the paid X boost against that pinned tweet.

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${RESET} %s\n" "$*"; }
dim()   { printf "${DIM}%s${RESET}\n" "$*"; }
title() { printf "\n${BOLD}══ %s ══${RESET}\n\n" "$*"; }

# ── Preflight ─────────────────────────────────────────────────────
if [ -z "${CRON_SECRET:-}" ]; then
  fail "CRON_SECRET not set."
  printf "  Set it inline:  ${BOLD}CRON_SECRET=xxx %s${RESET}\n" "$0"
  printf "  Or export it:   ${BOLD}export CRON_SECRET=xxx && %s${RESET}\n" "$0"
  exit 1
fi

SITE_URL="${SITE_URL:-https://galaxymind.space}"
THREAD_FILE="threads/recruitment-boost.json"

# Pre-resolve the script's repo root so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$THREAD_FILE" ]; then
  fail "$THREAD_FILE not found · run from the galaxy-mind repo root."
  exit 1
fi

# ── Step 1: daily-drafts preview ─────────────────────────────────
title "Step 1 · preview today's daily-drafts cron"
dim "Hitting $SITE_URL/api/cron/social-post-drafts?dryRun=1"

DRAFT_RESPONSE=$(curl -sf \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$SITE_URL/api/cron/social-post-drafts?dryRun=1" \
  || true)

if [ -z "$DRAFT_RESPONSE" ]; then
  fail "Empty response from cron · check CRON_SECRET and that the deploy is live."
  exit 2
fi

# Quick sanity · the response should mention "drafts" key.
if ! printf "%s" "$DRAFT_RESPONSE" | grep -q '"drafts"'; then
  fail "Cron response didn't contain a drafts object · printing raw response:"
  printf "%s\n" "$DRAFT_RESPONSE"
  exit 2
fi

ok "Daily-drafts cron responded with both X + Nostr drafts."

# Pretty-print if jq is around · otherwise raw.
if command -v jq >/dev/null 2>&1; then
  printf "\n${DIM}--- X DRAFT ---${RESET}\n"
  printf "%s\n" "$DRAFT_RESPONSE" | jq -r '.drafts.x.text'
  printf "${DIM}--- charCount: %s/280 · mentions: %s ---${RESET}\n" \
    "$(printf '%s' "$DRAFT_RESPONSE" | jq -r '.drafts.x.charCount')" \
    "$(printf '%s' "$DRAFT_RESPONSE" | jq -r '.drafts.x.mentionedHandles | join(", ")')"
  printf "\n${DIM}--- NOSTR DRAFT ---${RESET}\n"
  printf "%s\n" "$DRAFT_RESPONSE" | jq -r '.drafts.nostr.text'
else
  warn "jq not installed · printing raw JSON. Install jq for prettier output."
  printf "%s\n" "$DRAFT_RESPONSE"
fi

# ── Step 2: recruitment-thread dry-run ────────────────────────────
title "Step 2 · dry-run recruitment thread (4 tweets, paid-boost target)"

if ! DRY_RUN_SOCIAL=1 npx tsx scripts/post-thread.ts \
       "$THREAD_FILE" --dry-run; then
  fail "Recruitment-thread dry-run failed · likely a char-count overflow."
  fail "Edit $THREAD_FILE, trim, and rerun this script."
  exit 3
fi

ok "Recruitment thread dry-run passed."

# ── Step 3: confirm + fire for real ───────────────────────────────
title "Step 3 · post the recruitment thread for real?"
printf "  This will fire 4 tweets to ${BOLD}@GalaxyMind${RESET} sequentially.\n"
printf "  Each reply chains to the previous via /api/post-to-social.\n"
printf "  After it lands · pin the first tweet, then boost from X Ads.\n\n"

read -r -p "Post the thread? Type 'yes' to confirm: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  warn "Aborted · nothing posted. Rerun anytime."
  exit 0
fi

title "Posting recruitment thread"
if ! npx tsx scripts/post-thread.ts "$THREAD_FILE"; then
  fail "Thread post failed · check the post-thread.ts output for which tweet"
  fail "broke. Edit $THREAD_FILE to start from the failed tweet, and rerun."
  exit 4
fi

# ── Done ─────────────────────────────────────────────────────────
title "Recruitment thread live"
ok "All 4 tweets posted to @GalaxyMind."
printf "\n${BOLD}Next actions on x.com:${RESET}\n"
printf "  1. Open @GalaxyMind's profile, find the first tweet of the thread.\n"
printf "  2. Click ${BOLD}⋯${RESET} → ${BOLD}Pin to your profile${RESET}.\n"
printf "  3. Open ads.x.com, target the pinned tweet.\n"
printf "  4. Apply the targeting + budget from the campaign playbook.\n\n"
printf "${DIM}If you need to roll back: delete each tweet manually from the X UI.${RESET}\n"
