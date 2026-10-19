-- Export copy: receive addresses in this file are placeholders; deployments configure their own.
-- ROLLBACK for migrations/20261017120000_phase2_solana_tx_ids.sql. Restores the exact Base-only checks.
-- NOT a migration (kept outside supabase/migrations/ so it is never auto-applied). Run by hand,
-- in ONE transaction (apply_migration tool or psql -1), only with the operator's go.
-- Refuses to run if any Solana row (or any refund payout_network) exists: rolling back would then
-- have to delete payment records, which this file never does. Turn the Solana rail off first
-- (RENTALS_SOLANA_ENABLED unset) and resolve those rows by hand.
set local lock_timeout = '5s';
do $$
begin
  if exists (select 1 from public.rental_x402_settlements where network like 'solana:%')
     or exists (select 1 from public.rental_test_orders where network like 'solana:%')
     or exists (select 1 from public.rental_refunds where payout_network is not null) then
    raise exception 'solana rows exist: rollback refused';
  end if;
end $$;

alter table public.rental_x402_settlements drop constraint rental_x402_settlements_network_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_network_check check (network in ('eip155:84532','eip155:8453'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_payer_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_payer_check check (payer ~ '^0x[0-9a-fA-F]{40}$');
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_tx_hash_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_tx_hash_check check (tx_hash ~ '^0x[0-9a-f]{64}$');

alter table public.rental_refunds drop constraint rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check check (payout_tx_hash ~ '^0x[0-9a-f]{64}$');
alter table public.rental_refunds drop column payout_network;

alter table public.rental_test_orders drop constraint rental_test_orders_network_check;
alter table public.rental_test_orders add constraint rental_test_orders_network_check check (network in ('eip155:84532','eip155:8453'));
alter table public.rental_test_orders drop constraint rental_test_orders_pay_to_check;
alter table public.rental_test_orders add constraint rental_test_orders_pay_to_check check (lower(pay_to) = lower('0x0000000000000000000000000000000000000000'));
alter table public.rental_test_orders drop constraint rental_test_orders_tx_hash_check;
alter table public.rental_test_orders add constraint rental_test_orders_tx_hash_check check (tx_hash ~ '^0x[0-9a-f]{64}$');
