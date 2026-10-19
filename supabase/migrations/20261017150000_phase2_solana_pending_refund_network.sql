-- Review #101 follow-ups (F2, S4). ADDITIVE ONLY: one new table, one new RPC, one new nullable column on
-- rental_refunds with a fill-on-insert trigger and one new check. No existing constraint, row or function changes.
-- pricing_daily untouched. Staging project first; production project only after security review
-- PASS and the operator's yes. Rollback: supabase/rollback/20261017150000_phase2_solana_pending_refund_network_rollback.sql.
set local lock_timeout = '5s';

-- F2: a Solana signature the facilitator settled, saved BEFORE our on-chain check, so a check that times out is
-- re-checked by later polls. Never counts as paid: only rental_x402_settlements does. One row per ref, insert-only.
create table if not exists public.rental_x402_pending (
  provider_ref text primary key references public.rental_payment_bindings(provider_ref),
  network text not null check (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')),
  payer text not null check (payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  payer_sig text not null check (payer_sig ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  tx_hash text unique not null check (tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  created_at timestamptz not null default now()
);
alter table public.rental_x402_pending enable row level security;
revoke all on public.rental_x402_pending from anon, authenticated, public;
drop trigger if exists rental_x402_pending_ro on public.rental_x402_pending;
create trigger rental_x402_pending_ro before update or delete on public.rental_x402_pending for each row execute function public.rental_no_update();

create or replace function public.rental_record_x402_pending(s jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rental_x402_pending (provider_ref, network, payer, payer_sig, tx_hash, created_at)
  values (s->>'provider_ref', s->>'network', s->>'payer', s->>'payer_sig', s->>'tx_hash', coalesce((s->>'created_at')::timestamptz, now()))
  on conflict (provider_ref) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_record_x402_pending(jsonb) from public, anon, authenticated;
grant execute on function public.rental_record_x402_pending(jsonb) to service_role;

-- S4: the network the refunded money SETTLED on, filled from rental_x402_settlements when the refund row is
-- inserted (rental_settle is unchanged). NULL = no x402 settlement (lightning) or an older row: the Base rules apply.
alter table public.rental_refunds add column refund_network text
  constraint rental_refunds_refund_network_check
  check (refund_network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));

create or replace function public.rental_refunds_fill_network() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.refund_network is null then
    select s.network into new.refund_network from public.rental_x402_settlements s where s.provider_ref = new.provider_ref;
  end if;
  return new;
end $$;
revoke all on function public.rental_refunds_fill_network() from public, anon, authenticated;
drop trigger if exists rental_refunds_fill_network on public.rental_refunds;
create trigger rental_refunds_fill_network before insert on public.rental_refunds for each row execute function public.rental_refunds_fill_network();

-- A refund of a Solana settlement can only be marked paid with payout_network = that Solana network; a refund
-- of a Base settlement only on Base (payout_network NULL or eip155). Existing rows have refund_network NULL: pass.
alter table public.rental_refunds add constraint rental_refunds_payout_matches_settlement
  check (status <> 'paid' or refund_network is null
      or (refund_network like 'solana:%' and payout_network is not null and payout_network = refund_network)
      or (refund_network like 'eip155:%' and coalesce(payout_network, 'eip155:8453') like 'eip155:%'));
