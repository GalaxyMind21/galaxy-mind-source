-- Review #102 flag-on blockers (FB1, SF3, G6) + #103 follow-ups (B1, S3, S4, S7). ADDITIVE ONLY: two new tables + two new RPCs. Nothing existing changes;
-- pricing_daily untouched. Staging project first; production project only after security review PASS and
-- the operator's yes, and only AFTER 20261017150000. Rollback: supabase/rollback/20261017170000_phase2_solana_pending_sigs_rollback.sql.
--
-- Supersedes rental_x402_pending (20261017150000, keyed by provider_ref) for new writes: pending signatures are now keyed
-- by tx_hash (SF3), so a losing concurrent signature on the same ref is kept and goes to manual review. The old table
-- stays (additive), unused by the code from this migration on.
set local lock_timeout = '5s';

create table if not exists public.rental_x402_pending_sigs (
  tx_hash text primary key check (tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  provider_ref text not null references public.rental_payment_bindings(provider_ref),
  network text not null check (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')),
  payer text not null check (payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  payer_sig text not null check (payer_sig ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  last_valid_block_height bigint check (last_valid_block_height > 0),
  created_at timestamptz not null default now()
);
create index if not exists rental_x402_pending_sigs_ref_idx on public.rental_x402_pending_sigs (provider_ref);
alter table public.rental_x402_pending_sigs enable row level security;
revoke all on public.rental_x402_pending_sigs from anon, authenticated, public;
drop trigger if exists rental_x402_pending_sigs_ro on public.rental_x402_pending_sigs;
create trigger rental_x402_pending_sigs_ro before update or delete on public.rental_x402_pending_sigs for each row execute function public.rental_no_update();

-- Append-only resolution log. A pending signature is UNRESOLVED until it has a terminal row (settled, dropped, lost_race,
-- failed_onchain).
--   settled        the on-chain check passed and it is the ref's recorded settlement
--   lost_race      the on-chain check passed but ANOTHER signature is the ref's settlement (money moved twice): manual review
--   dropped        getSignatureStatuses (searchTransactionHistory) = null AND finalized height > last_valid_block_height + 150
--   failed_onchain the tx is finalized WITH an error (no token moved; the ref can take a payment again) (#103 S3)
--   alerted        unresolved for 10 min; ntfy alert sent once (still unresolved)
--   manual_review  a person must decide (lost concurrent race, stuck, node sol_maybe_paid); never an automatic refund
create table if not exists public.rental_x402_pending_resolutions (
  id bigserial primary key,
  tx_hash text not null references public.rental_x402_pending_sigs(tx_hash),
  outcome text not null check (outcome in ('settled','dropped','lost_race','failed_onchain','alerted','manual_review')),
  detail text check (detail ~ '^[a-z_]{1,40}$'),
  at timestamptz not null default now(),
  unique (tx_hash, outcome)
);
alter table public.rental_x402_pending_resolutions enable row level security;
revoke all on public.rental_x402_pending_resolutions from anon, authenticated, public;
revoke all on sequence public.rental_x402_pending_resolutions_id_seq from anon, authenticated, public;
drop trigger if exists rental_x402_pending_resolutions_ro on public.rental_x402_pending_resolutions;
create trigger rental_x402_pending_resolutions_ro before update or delete on public.rental_x402_pending_resolutions for each row execute function public.rental_no_update();
-- At most one terminal outcome per signature (#103 S4): enforced by a partial unique index (race-proof), plus a trigger
-- that raises a readable error first.
create unique index if not exists rental_x402_pending_resolutions_one_terminal on public.rental_x402_pending_resolutions (tx_hash)
  where outcome in ('settled','dropped','lost_race','failed_onchain');
create or replace function public.rental_pending_resolution_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.outcome in ('settled','dropped','lost_race','failed_onchain') and exists (
       select 1 from public.rental_x402_pending_resolutions r
       where r.tx_hash = new.tx_hash and r.outcome in ('settled','dropped','lost_race','failed_onchain') and r.outcome <> new.outcome) then
    raise exception 'pending_resolution_conflict';
  end if;
  return new;
end $$;
revoke all on function public.rental_pending_resolution_guard() from public, anon, authenticated;
drop trigger if exists rental_pending_resolution_guard on public.rental_x402_pending_resolutions;
create trigger rental_pending_resolution_guard before insert on public.rental_x402_pending_resolutions for each row execute function public.rental_pending_resolution_guard();

create or replace function public.rental_record_x402_pending_sig(s jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rental_x402_pending_sigs (tx_hash, provider_ref, network, payer, payer_sig, last_valid_block_height, created_at)
  values (s->>'tx_hash', s->>'provider_ref', s->>'network', s->>'payer', s->>'payer_sig', (s->>'last_valid_block_height')::bigint,
          coalesce((s->>'created_at')::timestamptz, now()))
  on conflict (tx_hash) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_record_x402_pending_sig(jsonb) from public, anon, authenticated;
grant execute on function public.rental_record_x402_pending_sig(jsonb) to service_role;

create or replace function public.rental_record_pending_resolution(r jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rental_x402_pending_resolutions (tx_hash, outcome, detail, at)
  values (r->>'tx_hash', r->>'outcome', nullif(r->>'detail', ''), coalesce((r->>'at')::timestamptz, now()))
  on conflict (tx_hash, outcome) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_record_pending_resolution(jsonb) from public, anon, authenticated;
grant execute on function public.rental_record_pending_resolution(jsonb) to service_role;

-- #103 B1: unresolved pending signatures, server side. NOT EXISTS on a terminal outcome, oldest first, at most p_limit
-- (1..500, default 500) rows, plus the TOTAL unresolved count so the app can alert when the list is capped. Optional
-- p_ref narrows to one payment ref. p_limit = 0 returns only the total (S7 schema probe). service_role only.
create or replace function public.rental_list_unresolved_pending(p_ref text default null, p_limit integer default 500) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with u as (
    select s.tx_hash, s.provider_ref, s.network, s.payer, s.payer_sig, s.last_valid_block_height, s.created_at
    from public.rental_x402_pending_sigs s
    where (p_ref is null or s.provider_ref = p_ref)
      and not exists (select 1 from public.rental_x402_pending_resolutions r
                      where r.tx_hash = s.tx_hash and r.outcome in ('settled','dropped','lost_race','failed_onchain'))
  ), page as (
    select * from u order by created_at, tx_hash limit greatest(0, least(coalesce(p_limit, 500), 500))
  )
  select jsonb_build_object(
    'total', (select count(*) from u),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'tx_hash', p.tx_hash, 'provider_ref', p.provider_ref, 'network', p.network, 'payer', p.payer, 'payer_sig', p.payer_sig,
        'last_valid_block_height', p.last_valid_block_height, 'created_at', p.created_at,
        'outcomes', coalesce((select jsonb_agg(r.outcome order by r.id) from public.rental_x402_pending_resolutions r where r.tx_hash = p.tx_hash), '[]'::jsonb))
      order by p.created_at, p.tx_hash) from page p), '[]'::jsonb));
$$;
revoke all on function public.rental_list_unresolved_pending(text, integer) from public, anon, authenticated;
grant execute on function public.rental_list_unresolved_pending(text, integer) to service_role;
