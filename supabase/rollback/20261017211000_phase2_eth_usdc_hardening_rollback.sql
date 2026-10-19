-- ROLLBACK for migrations/20261017211000_phase2_eth_usdc_hardening.sql. NOT a migration (never auto-applied). Run by
-- hand, only with the operator's go, with RENTALS_ETH_USDC_ENABLED unset. Refuses while any unmatched-transfer row exists (it
-- may be the only record of money that arrived) or any claim is still unresolved (the app treats a half-applied schema
-- as an alerting error, and those claims need the 211000 functions to finish). Restores the 20261017210000
-- rental_eth_bind and rental_eth_list_claims.
--
-- Run it as ONE transaction that stops at the first error (review #108 R3-3):
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/20261017211000_phase2_eth_usdc_hardening_rollback.sql
-- The file has its own begin/commit, so `set local` applies and the guard's raise aborts everything before a single
-- drop runs. With -1, psql prints a harmless "already a transaction in progress" / "no transaction in progress"
-- warning around them. ON_ERROR_STOP=1 is the part that matters: without it, psql would keep going after the raise.
-- The exclusive locks stop any new claim, resolution or unmatched row landing between the guard and the drops.
begin;
set local lock_timeout = '5s';
lock table public.rental_eth_claims, public.rental_eth_claim_resolutions, public.rental_eth_unmatched, public.rental_eth_unmatched_sightings in exclusive mode;
do $$ begin
  if exists (select 1 from public.rental_eth_unmatched) then
    raise exception 'rollback refused: rental_eth_unmatched has rows; resolve them by hand first';
  end if;
  if exists (select 1 from public.rental_eth_claims c where not exists (
       select 1 from public.rental_eth_claim_resolutions r where r.tx_hash = c.tx_hash and r.outcome in ('settled','dropped','failed_onchain','lost_race'))) then
    raise exception 'rollback refused: unresolved Ethereum claims exist; let them resolve (or resolve by hand) first';
  end if;
  if exists (select 1 from public.rental_payments where rail = 'eth_usdc') or exists (select 1 from public.rental_refunds where rail = 'eth_usdc') then
    raise exception 'rollback refused: eth_usdc payments or refunds exist; resolve them by hand first';
  end if;
end $$;
drop trigger if exists rental_eth_quotes_btc on public.rental_eth_quotes;
drop function if exists public.rental_eth_quotes_btc_guard();
do $$ begin
  if to_regclass('public.btc_bindings') is not null then execute 'drop trigger if exists btc_bindings_eth on public.btc_bindings'; end if;
end $$;
drop function if exists public.btc_bindings_eth_guard();
alter table public.rental_payments drop constraint if exists rental_payments_rail_check;
alter table public.rental_payments add constraint rental_payments_rail_check check (rail = any (array['lightning','x402_usdc','btc_onchain']));
drop function if exists public.rental_eth_record_unmatched(jsonb);
drop table public.rental_eth_unmatched_sightings;
drop table public.rental_eth_unmatched;
drop trigger if exists rental_eth_quotes_pin on public.rental_eth_quotes;
drop function if exists public.rental_eth_quotes_pin_guard();
drop function if exists public.rental_eth_payto_pin();
grant truncate on public.rental_eth_quotes, public.rental_eth_claims, public.rental_eth_claim_resolutions to service_role;
commit;
-- Then, in a new transaction, re-run from migrations/20261017210000_phase2_eth_usdc.sql the `create or replace function`
-- blocks for public.rental_eth_bind (caller-supplied base_atomic, no pin) and public.rental_eth_list_claims (oldest-first order).
