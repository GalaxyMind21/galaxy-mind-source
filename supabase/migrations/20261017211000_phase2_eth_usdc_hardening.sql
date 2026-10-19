-- Export copy: receive addresses in this file are placeholders; deployments configure their own.
-- Ethereum USDC rail hardening (review #108). ADDITIVE ONLY. pricing_daily untouched. Staging first; prod only after
-- Review PASS and the operator's yes. Rollback: supabase/rollback/20261017211000_phase2_eth_usdc_hardening_rollback.sql (not run).
--  B2: public.rental_eth_payto_pin() is the SQL twin of PINNED_ETH_PAYTO (src/lib/rentals/phase2/eth/config.ts). NULL
--      until the operator confirms the Ethereum receive address, so rental_eth_bind refuses every bind (payto_not_pinned) and a
--      trigger refuses any rental_eth_quotes row whose pay_to isn't the pin. Setting it = one `create or replace` of this
--      function in a new migration, in the same PR that sets the code constant.
--  S6: rental_eth_bind takes the amount and rail from the LOCKED rental_orders row (total_usdc_atomic, rail='x402_usdc'),
--      never from the caller; a caller base_atomic that disagrees is refused.
--  S2: rental_eth_unmatched durably records a real USDC transfer to payTo that can't pay its quote (wrong amount, or
--      outside the window), once per tx (PK tx_hash). The app alerts only when a row is inserted.
--  S6b: TRUNCATE revoked on the Ethereum tables (the append-only triggers are row-level).
set local lock_timeout = '5s';

create or replace function public.rental_eth_payto_pin() returns text
  language sql immutable set search_path = '' as $$ select null::text $$;
revoke all on function public.rental_eth_payto_pin() from public, anon, authenticated;
grant execute on function public.rental_eth_payto_pin() to service_role;

create or replace function public.rental_eth_quotes_pin_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if public.rental_eth_payto_pin() is null or new.pay_to is distinct from public.rental_eth_payto_pin() then
    raise exception 'rental_eth_quotes: pay_to is not the pinned Ethereum payTo';
  end if;
  return new;
end $$;
revoke all on function public.rental_eth_quotes_pin_guard() from public, anon, authenticated;
drop trigger if exists rental_eth_quotes_pin on public.rental_eth_quotes;
create trigger rental_eth_quotes_pin before insert on public.rental_eth_quotes for each row execute function public.rental_eth_quotes_pin_guard();

create or replace function public.rental_eth_bind(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  oid uuid := (p->>'order_id')::uuid;
  st text;
  rl text;
  base bigint;
  q public.rental_eth_quotes;
  pin text := public.rental_eth_payto_pin();
  t int;
  amt bigint;
begin
  select o.state, o.rail, o.total_usdc_atomic into st, rl, base from public.rental_orders o where o.id = oid for update;
  select * into q from public.rental_eth_quotes where order_id = oid;
  if found then return jsonb_build_object('ok', true, 'created', false, 'quote', to_jsonb(q)); end if;
  if st is distinct from 'awaiting_payment' or rl is distinct from 'x402_usdc' or base is null or base <= 0 then
    return jsonb_build_object('ok', false, 'error', 'order_not_payable');
  end if;
  if p ? 'base_atomic' and (p->>'base_atomic')::bigint is distinct from base then
    return jsonb_build_object('ok', false, 'error', 'order_not_payable');
  end if;
  if pin is null or p->>'pay_to' is distinct from pin then
    return jsonb_build_object('ok', false, 'error', 'payto_not_pinned');
  end if;
  perform pg_advisory_xact_lock(hashtext('rental_eth_tags'));
  for t in 1..99 loop
    amt := base + t * 10000;
    if not exists (select 1 from public.rental_eth_quotes x where x.network = p->>'network' and x.amount_atomic = amt and x.reserved_until > now()) then
      insert into public.rental_payment_bindings (provider_ref, order_id, kind, expected_atomic, extend_days, expires_at, challenge)
      values (p->>'provider_ref', oid, 'initial', amt, null, (p->>'expires_at')::timestamptz,
              jsonb_set(jsonb_set(jsonb_set(p->'challenge', '{eth,amount}', to_jsonb(amt::text)), '{eth,tag}', to_jsonb(t)), '{eth,payTo}', to_jsonb(pin)));
      insert into public.rental_eth_quotes (provider_ref, order_id, network, pay_to, asset, base_atomic, tag, amount_atomic, expires_at, reserved_until)
      values (p->>'provider_ref', oid, p->>'network', pin, p->>'asset', base, t, amt, (p->>'expires_at')::timestamptz, (p->>'reserved_until')::timestamptz)
      returning * into q;
      return jsonb_build_object('ok', true, 'created', true, 'quote', to_jsonb(q));
    end if;
  end loop;
  return jsonb_build_object('ok', false, 'error', 'tags_exhausted');
end $$;
revoke all on function public.rental_eth_bind(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_bind(jsonb) to service_role;

create table if not exists public.rental_eth_unmatched (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  provider_ref text not null references public.rental_eth_quotes(provider_ref),
  network text not null check (network in ('eip155:1','eip155:11155111')),
  reason text not null check (reason in ('amount_mismatch','outside_window')),
  amount_atomic bigint check (amount_atomic is null or amount_atomic > 0),
  payer text not null check (payer ~ '^0x[0-9a-f]{40}$'),
  block_number bigint not null check (block_number > 0),
  created_at timestamptz not null default now()
);
create index if not exists rental_eth_unmatched_ref_idx on public.rental_eth_unmatched (provider_ref);
alter table public.rental_eth_unmatched enable row level security;
revoke all on public.rental_eth_unmatched from anon, authenticated, public;
drop trigger if exists rental_eth_unmatched_ro on public.rental_eth_unmatched;
create trigger rental_eth_unmatched_ro before update or delete on public.rental_eth_unmatched for each row execute function public.rental_no_update();

-- Insert-or-ignore; {inserted:true} only for the first record of a tx. u = null is the schema probe (writes nothing).
create or replace function public.rental_eth_record_unmatched(u jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if u is null or jsonb_typeof(u) <> 'object' then return jsonb_build_object('inserted', false, 'probe', true); end if;
  insert into public.rental_eth_unmatched (tx_hash, provider_ref, network, reason, amount_atomic, payer, block_number, created_at)
  values (u->>'tx_hash', u->>'provider_ref', u->>'network', u->>'reason', nullif(u->>'amount_atomic', '')::bigint, lower(u->>'payer'),
          (u->>'block_number')::bigint, coalesce((u->>'created_at')::timestamptz, now()))
  on conflict (tx_hash) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n = 1);
end $$;
revoke all on function public.rental_eth_record_unmatched(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_record_unmatched(jsonb) to service_role;

revoke truncate on public.rental_eth_quotes, public.rental_eth_claims, public.rental_eth_claim_resolutions, public.rental_eth_unmatched
  from service_role, authenticated, anon, public;

-- ── Round 2 (review #108 SF-B/E/F), additive ─────────────────────────────────────────────────────────────────────
-- SF-F: the pin is read at call time (STABLE): a later `create or replace` of the pin can't be constant-folded away.
create or replace function public.rental_eth_payto_pin() returns text
  language sql stable set search_path = '' as $$ select null::text $$;
revoke all on function public.rental_eth_payto_pin() from public, anon, authenticated;
grant execute on function public.rental_eth_payto_pin() to service_role;

-- SF-E: an unmatched transfer belongs to its PAYER + tx (whoever sent it is who a manual refund goes to), not to the
-- first order that pasted the hash. provider_ref becomes "first seen" only; every order that pasted it is logged.
alter table public.rental_eth_unmatched alter column provider_ref drop not null;
alter table public.rental_eth_unmatched drop constraint rental_eth_unmatched_pkey;
alter table public.rental_eth_unmatched add constraint rental_eth_unmatched_pkey primary key (payer, tx_hash);
create index if not exists rental_eth_unmatched_tx_idx on public.rental_eth_unmatched (tx_hash);
create table if not exists public.rental_eth_unmatched_sightings (
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  provider_ref text not null references public.rental_eth_quotes(provider_ref),
  created_at timestamptz not null default now(),
  primary key (tx_hash, provider_ref)
);
alter table public.rental_eth_unmatched_sightings enable row level security;
revoke all on public.rental_eth_unmatched_sightings from anon, authenticated, public;
revoke truncate on public.rental_eth_unmatched_sightings from service_role;
drop trigger if exists rental_eth_unmatched_sightings_ro on public.rental_eth_unmatched_sightings;
create trigger rental_eth_unmatched_sightings_ro before update or delete on public.rental_eth_unmatched_sightings for each row execute function public.rental_no_update();

-- {inserted:true} only for the first record of a (payer, tx). Every pasting order is logged as a sighting. u = null is the probe.
create or replace function public.rental_eth_record_unmatched(u jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if u is null or jsonb_typeof(u) <> 'object' then return jsonb_build_object('inserted', false, 'probe', true); end if;
  insert into public.rental_eth_unmatched_sightings (tx_hash, provider_ref, created_at)
  values (u->>'tx_hash', u->>'provider_ref', coalesce((u->>'created_at')::timestamptz, now()))
  on conflict (tx_hash, provider_ref) do nothing;
  insert into public.rental_eth_unmatched (tx_hash, provider_ref, network, reason, amount_atomic, payer, block_number, created_at)
  values (u->>'tx_hash', u->>'provider_ref', u->>'network', u->>'reason', nullif(u->>'amount_atomic', '')::bigint, lower(u->>'payer'),
          (u->>'block_number')::bigint, coalesce((u->>'created_at')::timestamptz, now()))
  on conflict (payer, tx_hash) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n = 1);
end $$;
revoke all on function public.rental_eth_record_unmatched(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_record_unmatched(jsonb) to service_role;

-- SF-B: unresolved claims NOT yet in manual review come first, then oldest first, so stuck claims can't fill the page.
create or replace function public.rental_eth_list_claims(p_ref text default null, p_limit integer default 200, p_all boolean default false) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with u as (
    select c.*, exists (select 1 from public.rental_eth_claim_resolutions m where m.tx_hash = c.tx_hash and m.outcome = 'manual_review') as mr
    from public.rental_eth_claims c
    where (p_ref is null or c.provider_ref = p_ref)
      and (p_all or not exists (select 1 from public.rental_eth_claim_resolutions r
                                where r.tx_hash = c.tx_hash and r.outcome in ('settled','dropped','failed_onchain','lost_race')))
  ), page as (select * from u order by mr, created_at, tx_hash limit greatest(0, least(coalesce(p_limit, 200), 200)))
  select jsonb_build_object('total', (select count(*) from u),
    'rows', coalesce((select jsonb_agg((to_jsonb(pg) - 'mr') || jsonb_build_object('outcomes',
        coalesce((select jsonb_agg(r.outcome order by r.id) from public.rental_eth_claim_resolutions r where r.tx_hash = pg.tx_hash), '[]'::jsonb))
      order by pg.mr, pg.created_at, pg.tx_hash) from page pg), '[]'::jsonb));
$$;
revoke all on function public.rental_eth_list_claims(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.rental_eth_list_claims(text, integer, boolean) to service_role;

-- ── Round 3 (review #108 nit), additive and idempotent ──────────────────────────────────────────────────────────
-- provider_ref on rental_eth_unmatched goes back to NOT NULL, matching rental_eth_unmatched_sightings. It is the first
-- order that pasted the hash; rental_eth_record_unmatched writes the sighting (NOT NULL provider_ref) first in the same
-- call (one transaction), so a null ref could never be stored here anyway. SF-E's `drop not null` was not needed for the
-- (payer, tx_hash) key. Safe on staging (0 rows, checked read-only 2026-10-17); prod has no Ethereum tables yet.
alter table public.rental_eth_unmatched alter column provider_ref set not null;

-- BTC and ETH are mutually exclusive per order (review #108, after #107). rental_eth_bind and btc_insert_binding both
-- lock the rental_orders row FOR UPDATE before inserting, so these two insert guards serialize and no order can end up
-- with both an Ethereum quote and a live BTC binding. The app checks first (bindEth / createBtcBinding); these are the
-- race backstop. btc_bindings comes from 20261017190000 (applied first); the checks look it up at run time, so this file
-- still applies where it is absent.
create or replace function public.rental_eth_quotes_btc_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare live boolean := false;
begin
  if to_regclass('public.btc_bindings') is not null then
    execute 'select exists (select 1 from public.btc_bindings b where b.order_id = $1 and b.status not in (''refused'',''expired''))' into live using new.order_id;
  end if;
  if live then raise exception 'rental_eth_quotes: order has a live BTC binding' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function public.rental_eth_quotes_btc_guard() from public, anon, authenticated;
drop trigger if exists rental_eth_quotes_btc on public.rental_eth_quotes;
create trigger rental_eth_quotes_btc before insert on public.rental_eth_quotes for each row execute function public.rental_eth_quotes_btc_guard();

-- The message carries btc_x402_money, which SupabaseBtcStore maps to its "USDC payment already in progress" refusal.
create or replace function public.btc_bindings_eth_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.rental_eth_quotes q where q.order_id = new.order_id) then
    raise exception 'btc_x402_money: order has an Ethereum quote' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.btc_bindings_eth_guard() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.btc_bindings') is not null then
    execute 'drop trigger if exists btc_bindings_eth on public.btc_bindings';
    execute 'create trigger btc_bindings_eth before insert on public.btc_bindings for each row execute function public.btc_bindings_eth_guard()';
  end if;
end $$;

-- Rail eth_usdc (verifier rev 1.8): payments on eth_ refs are recorded with rail 'eth_usdc' (refunds' rail has no
-- check). Widened only, so every existing row still passes. rental_orders keeps its list: an Ethereum order stays
-- 'x402_usdc' (its creation rail).
alter table public.rental_payments drop constraint if exists rental_payments_rail_check;
alter table public.rental_payments add constraint rental_payments_rail_check check (rail = any (array['lightning','x402_usdc','btc_onchain','eth_usdc']));

-- The Ethereum payTo pin (B2/SF-F), confirmed by the operator on 2026-10-17: his Coinbase USDC address on the
-- Ethereum network, which is the same address as Base. EIP-55 form, byte-identical to PINNED_ETH_PAYTO in
-- src/lib/rentals/phase2/eth/config.ts (rental_eth_bind and the quotes trigger compare exactly). ETH_PAYTO_HISTORY stays
-- empty (first pin). Pinning does not turn the rail on; RENTALS_ETH_USDC_ENABLED stays unset.
create or replace function public.rental_eth_payto_pin() returns text
  language sql stable set search_path = '' as $$ select '0x0000000000000000000000000000000000000000'::text $$;
revoke all on function public.rental_eth_payto_pin() from public, anon, authenticated;
grant execute on function public.rental_eth_payto_pin() to service_role;
