-- Rollback of 20261017190000_phase2_btc_onchain.sql. Drops the BTC tables, RPCs and role, and restores the original
-- checks and refund-network trigger. Refuses (raises, writes nothing) if ANY BTC money or row exists, so it can never
-- silently drop a payment record: a person resolves those rows first. pricing_daily untouched.
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.rental_orders where rail = 'btc_onchain')
     or exists (select 1 from public.rental_payments where rail = 'btc_onchain')
     or exists (select 1 from public.rental_refunds where refund_network like 'bip122:%' or payout_network like 'bip122:%' or rail = 'btc_onchain')
     or (to_regclass('public.btc_bindings') is not null and exists (select 1 from public.btc_bindings)) then
    raise exception 'btc rows exist: resolve them before rolling back';
  end if;
end $$;

drop function if exists public.btc_accept_paid(jsonb);
drop function if exists public.btc_event_failed(bigint, text);
drop function if exists public.btc_mark_event(bigint, text);
drop function if exists public.btc_record_nonce(text, text, uuid);
drop function if exists public.btc_update_binding(uuid, integer, jsonb);
drop function if exists public.btc_insert_binding(jsonb, jsonb);
drop function if exists public.btc_open_bindings();
drop function if exists public.btc_heartbeat(jsonb);
drop function if exists public.btc_report_payment(jsonb);
drop function if exists public.btc_report_event(jsonb);
drop function if exists public.btc_attach_attestation(uuid, jsonb);
drop function if exists public.btc_claim_binding_v2(uuid);
drop function if exists public.btc_claim_binding(uuid);
drop function if exists public.btc_wait_bindings(integer);
drop function if exists public.btc_open_attest_rows();
drop trigger if exists btc_bindings_notify on public.btc_bindings;
drop function if exists public.btc_notify_attest();

drop table if exists public.btc_heartbeat;
drop table if exists public.btc_events;
drop table if exists public.btc_nonces;
drop table if exists public.btc_outpoints;
drop table if exists public.btc_bindings;
-- The empty rental_payment_bindings rows for btc: refs can only exist alongside btc_bindings rows (checked empty above).

create or replace function public.rental_refunds_fill_network() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.refund_network is null then
    select s.network into new.refund_network from public.rental_x402_settlements s where s.provider_ref = new.provider_ref;
  end if;
  return new;
end $$;

alter table public.rental_refunds drop constraint if exists rental_refunds_payout_matches_settlement;
-- Ethereum networks (from the ETH rail migration) are kept in every list below and EVM refunds keep the same-network
-- rule, so rolling BTC back never narrows the ETH rail regardless of which migration ran first.
alter table public.rental_refunds add constraint rental_refunds_payout_matches_settlement check (((status <> 'paid'::text) OR (refund_network IS NULL) OR ((refund_network ~~ 'solana:%'::text) AND (payout_network IS NOT NULL) AND (payout_network = refund_network)) OR ((refund_network ~~ 'eip155:%'::text) AND (COALESCE(payout_network, 'eip155:8453'::text) = refund_network))));
alter table public.rental_refunds drop constraint if exists rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check check ((((COALESCE(payout_network, 'eip155:8453'::text) = ANY (ARRAY['eip155:84532'::text, 'eip155:8453'::text, 'eip155:1'::text, 'eip155:11155111'::text])) AND (payout_tx_hash ~ '^0x[0-9a-f]{64}$'::text)) OR ((COALESCE(payout_network, ''::text) = ANY (ARRAY['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'::text, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'::text])) AND (payout_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'::text))));
alter table public.rental_refunds drop constraint if exists rental_refunds_payout_network_check;
alter table public.rental_refunds add constraint rental_refunds_payout_network_check check ((payout_network = ANY (ARRAY['eip155:84532'::text, 'eip155:8453'::text, 'eip155:1'::text, 'eip155:11155111'::text, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'::text, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'::text])));
alter table public.rental_refunds drop constraint if exists rental_refunds_refund_network_check;
alter table public.rental_refunds add constraint rental_refunds_refund_network_check check ((refund_network = ANY (ARRAY['eip155:84532'::text, 'eip155:8453'::text, 'eip155:1'::text, 'eip155:11155111'::text, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'::text, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'::text])));
alter table public.rental_payments drop constraint if exists rental_payments_rail_check;
alter table public.rental_payments add constraint rental_payments_rail_check check ((rail = ANY (ARRAY['lightning'::text, 'x402_usdc'::text])));
alter table public.rental_orders drop constraint if exists rental_orders_rail_check;
alter table public.rental_orders add constraint rental_orders_rail_check check ((rail = ANY (ARRAY['lightning'::text, 'x402_usdc'::text])));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gm_btc') then
    revoke usage on schema public from gm_btc;
    drop role gm_btc;
  end if;
end $$;
