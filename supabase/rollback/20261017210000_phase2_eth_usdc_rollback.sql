-- ROLLBACK for migrations/20261017210000_phase2_eth_usdc.sql. NOT a migration (never auto-applied).
-- Run AFTER rollback/20261017211000_phase2_eth_usdc_hardening_rollback.sql (rental_eth_unmatched references rental_eth_quotes).
-- Only with the operator's go, with RENTALS_ETH_USDC_ENABLED unset first. Refuses if any Ethereum row exists (it may be the only
-- record of money that moved); resolve those by hand first. Restores the pre-Ethereum checks, keeping the bip122 values
-- from PR #107 (harmless if #107 isn't applied).
--
-- Run it as ONE transaction that stops at the first error (review #108 R3-3):
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/20261017210000_phase2_eth_usdc_rollback.sql
-- The file has its own begin/commit, so `set local` applies and the guard's raise aborts everything before a single
-- drop runs. With -1, psql prints a harmless "already a transaction in progress" / "no transaction in progress"
-- warning around them. ON_ERROR_STOP=1 is the part that matters: without it, psql would keep going after the raise.
-- The exclusive locks stop any new quote, claim or resolution landing between the guard and the drops (rental_eth_unmatched
-- no longer exists at this point). A new Ethereum settlement or refund row racing the guard makes the re-added checks
-- below fail, which rolls the whole transaction back.
begin;
set local lock_timeout = '5s';
lock table public.rental_eth_quotes, public.rental_eth_claims, public.rental_eth_claim_resolutions in exclusive mode;
do $$ begin
  if exists (select 1 from public.rental_eth_quotes)
     or exists (select 1 from public.rental_x402_settlements where network in ('eip155:1','eip155:11155111'))
     or exists (select 1 from public.rental_refunds where refund_network in ('eip155:1','eip155:11155111') or payout_network in ('eip155:1','eip155:11155111')) then
    raise exception 'rollback refused: Ethereum rows exist; resolve them by hand first';
  end if;
end $$;
drop function if exists public.rental_eth_list_claims(text, integer, boolean);
drop function if exists public.rental_eth_record_resolution(jsonb);
drop function if exists public.rental_eth_record_claim(jsonb);
drop function if exists public.rental_eth_bind(jsonb);
drop index if exists public.rental_eth_claim_resolutions_one_terminal;
drop table public.rental_eth_claim_resolutions;
drop table public.rental_eth_claims;
drop table public.rental_eth_quotes;
alter table public.rental_refunds drop constraint rental_refunds_eth_payout_same_network;
alter table public.rental_refunds drop constraint rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check
  check ((coalesce(payout_network, 'eip155:8453') in ('eip155:84532','eip155:8453') and payout_tx_hash ~ '^0x[0-9a-f]{64}$')
      or (coalesce(payout_network, '') in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payout_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$')
      or (coalesce(payout_network, '') in ('bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c') and payout_tx_hash ~ '^[0-9a-f]{64}$'));
alter table public.rental_refunds drop constraint rental_refunds_payout_network_check;
alter table public.rental_refunds add constraint rental_refunds_payout_network_check
  check (payout_network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c'));
alter table public.rental_refunds drop constraint rental_refunds_refund_network_check;
alter table public.rental_refunds add constraint rental_refunds_refund_network_check
  check (refund_network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_tx_hash_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_tx_hash_check
  check ((network in ('eip155:84532','eip155:8453') and tx_hash ~ '^0x[0-9a-f]{64}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_payer_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_payer_check
  check ((network in ('eip155:84532','eip155:8453') and payer ~ '^0x[0-9a-fA-F]{40}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_network_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_network_check
  check (network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
commit;
