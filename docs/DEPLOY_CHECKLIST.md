# Deploy checklist

After every Production deploy:

1. **Roster is not empty.** Run `node scripts/check-roster.mjs --url https://galaxymind.space`. It must report at least one rig.
   The `post-deploy roster` workflow runs the same check automatically when Vercel reports a Production deployment.
   - The listing ids come from server-only env (`GALAXY_MIND_RIG_IDS`, `GALAXY_MIND_XP_UNIT_IDS`). If either is
     missing or malformed, /hashrate shows no machines. The build does not fail.
   - Fix: correct the value in Vercel (Production) and redeploy.
2. **Receive addresses still match their pins.** If a direct rail is meant to be open, check the logs for
   `payto_pin_mismatch`. Each payTo env value (`RENTALS_PAYTO_PIN_EVM`, `RENTALS_PAYTO_PIN_SOLANA`, `RENTALS_ETH_PAYTO`)
   must hash to its sha256 pin in `src/lib/rentals/phase2/payto-pins.ts`. Any value that doesn't keeps its rail closed.
   The log line is written on every refusal. The ntfy alert is sent once per serverless instance (per kind and problem),
   not once overall, so a bad value produces one alert from each cold instance that reads it.
3. `/`, `/hashrate`, `/hashrate/rent` and `/api/hashrate` answer 200.

Changing a receive address takes a reviewed commit that updates the pin, plus the env change. Neither one works without the other.
