-- BTC on-chain rail (PLAN v3.1 §9.1-9.2 + §18; security review Fixes 1-7). Behind RENTALS_BTC_ONCHAIN_ENABLED (off).
-- ADDITIVE: five new tables, one new login role (gm_btc, no password: set out of band from the node), new RPCs, and
-- WIDENED checks on existing tables (rail 'btc_onchain'; bip122 refund/payout networks; BTC payout txid shape). Every
-- existing value stays valid. pricing_daily untouched. Staging project only until security review PASS and
-- the operator's yes; production project never from this PR.
-- Rollback: supabase/rollback/20261017190000_phase2_btc_onchain_rollback.sql.
--
-- Trust model: the database is UNTRUSTED for money. gm_btc can only call its SECURITY DEFINER functions (no table
-- grants); the site verifies every gm-btc-v1 envelope against the Ed25519 key pinned in SOURCE and re-derives every
-- address from the pinned descriptor before display or provisioning. The DB checks only shape and UNIQUE (N1).
set local lock_timeout = '5s';

-- ── role ──────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gm_btc') then
    create role gm_btc login noinherit nobypassrls connection limit 2;  -- password: SCRAM verifier generated on the node, set out of band
  end if;
end $$;
grant usage on schema public to gm_btc;

-- ── widen existing checks (additive) ───────────────────────────────────────────────────────────────────────────────
-- The rental_refunds network lists carry EVERY rail's networks (Base, Ethereum mainnet + Sepolia, Solana, BTC) so this
-- migration and the ETH one (renumbered 20261017210000) give the same final state in either order. A paid refund must
-- pay out on the network the money came from: an EVM refund too (a NULL payout_network means the legacy Base mainnet
-- default), so an Ethereum refund can never be marked paid on Base or vice versa.
alter table public.rental_orders drop constraint if exists rental_orders_rail_check;
alter table public.rental_orders add constraint rental_orders_rail_check check (rail = any (array['lightning','x402_usdc','btc_onchain']));
alter table public.rental_payments drop constraint if exists rental_payments_rail_check;
alter table public.rental_payments add constraint rental_payments_rail_check check (rail = any (array['lightning','x402_usdc','btc_onchain']));

alter table public.rental_refunds drop constraint if exists rental_refunds_refund_network_check;
alter table public.rental_refunds add constraint rental_refunds_refund_network_check check (refund_network = any (array[
  'eip155:84532','eip155:8453','eip155:1','eip155:11155111','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c']));
alter table public.rental_refunds drop constraint if exists rental_refunds_payout_network_check;
alter table public.rental_refunds add constraint rental_refunds_payout_network_check check (payout_network = any (array[
  'eip155:84532','eip155:8453','eip155:1','eip155:11155111','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c']));
alter table public.rental_refunds drop constraint if exists rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check check (
     ((coalesce(payout_network, 'eip155:8453') = any (array['eip155:84532','eip155:8453','eip155:1','eip155:11155111'])) and (payout_tx_hash ~ '^0x[0-9a-f]{64}$'))
  or ((coalesce(payout_network, '') = any (array['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'])) and (payout_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'))
  or ((coalesce(payout_network, '') = any (array['bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c'])) and (payout_tx_hash ~ '^[0-9a-f]{64}$')));
alter table public.rental_refunds drop constraint if exists rental_refunds_payout_matches_settlement;
alter table public.rental_refunds add constraint rental_refunds_payout_matches_settlement check (
     (status <> 'paid') or (refund_network is null)
  or ((refund_network like 'solana:%') and (payout_network is not null) and (payout_network = refund_network))
  or ((refund_network like 'eip155:%') and (coalesce(payout_network, 'eip155:8453') = refund_network))
  or ((refund_network like 'bip122:%') and (payout_network is not null) and (payout_network = refund_network)));

-- ── tables ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.btc_bindings (
  binding_id uuid primary key,
  provider_ref text not null unique references public.rental_payment_bindings(provider_ref),
  order_id uuid not null references public.rental_orders(id),
  order_ref text not null check (order_ref ~ '^gm_[A-Za-z0-9_-]{8,20}$'),
  kind text not null check (kind in ('initial','extension')),
  network text not null check (network in ('bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c')),
  addr_index integer unique check (addr_index >= 1),            -- NULL until attested; assigned by the agent, never 0 (N1, N5)
  address text unique check (address ~ '^(bc|tb)1q[02-9ac-hj-np-z]{38}$'),
  amount_sat bigint not null check (amount_sat > 0 and amount_sat <= 2100000000000000),
  required_confs smallint not null check (required_confs = case when amount_sat < 1000000 then 1 else 2 end),
  floor_btc_per_ph_day text not null check (floor_btc_per_ph_day ~ '^0\.[0-9]{8}$'),
  floor_day date not null,
  quote_at timestamptz not null,
  quote_expires_at timestamptz not null check (quote_expires_at > quote_at),
  quote_tip_height integer check (quote_tip_height > 0),
  confirm_by_height integer check (confirm_by_height = quote_tip_height + 144),
  status text not null default 'awaiting_attest' check (status in ('awaiting_attest','awaiting_payment','seen','underpaid','paid',
    'refused','expired','late_payment','duplicate','reorged','killed_refund','refund_pending','refunded','manual_review')),
  status_reason text check (status_reason ~ '^[a-z_]{1,40}$'),
  attest_env jsonb check (attest_env is null or pg_column_size(attest_env) < 8192),
  paid_env jsonb check (paid_env is null or pg_column_size(paid_env) < 16384),
  received_sat bigint not null default 0 check (received_sat >= 0),
  credited_sat bigint not null default 0 check (credited_sat >= 0 and credited_sat <= received_sat),
  refunded_sat bigint not null default 0 check (refunded_sat >= 0),
  claimed_until timestamptz,
  display_ok_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((addr_index is null) = (address is null)),
  check ((addr_index is null) = (quote_tip_height is null)),
  check (provider_ref = 'btc:' || binding_id::text)
);
create index if not exists btc_bindings_order_idx on public.btc_bindings (order_id);
create index if not exists btc_bindings_status_idx on public.btc_bindings (status, created_at);

create table if not exists public.btc_outpoints (
  txid text not null check (txid ~ '^[0-9a-f]{64}$'),
  vout integer not null check (vout >= 0 and vout <= 65535),
  binding_id uuid not null references public.btc_bindings(binding_id),
  value_sat bigint not null check (value_sat > 0),
  height integer not null check (height > 0),
  at timestamptz not null default now(),
  primary key (txid, vout)                                       -- each outpoint is credited once, globally
);
create table if not exists public.btc_nonces (
  nonce text primary key check (nonce ~ '^[0-9a-f]{32}$'),
  type text not null check (type in ('addr','addr_refused','paid','reorged','seen','underpaid')),
  binding_id uuid,
  at timestamptz not null default now()
);
-- Agent-reported events, append-only. received_at is the DB clock: the site checks iat/exp against it (not processing time).
create table if not exists public.btc_events (
  id bigserial primary key,
  binding_id uuid,
  type text not null check (type in ('addr_refused','paid','reorged','seen','underpaid')),
  env jsonb not null check (pg_column_size(env) < 16384),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome ~ '^[a-z_:]{1,60}$')
);
-- FB3: retry bookkeeping. A failing event is given up only after >= 5 failures spread over >= 1 h (counted from the first
-- failure, never from received_at), so a long outage followed by one transient error can't reject a real paid event.
alter table public.btc_events add column if not exists attempts int not null default 0 check (attempts >= 0);
alter table public.btc_events add column if not exists first_failed_at timestamptz;
alter table public.btc_events add column if not exists last_failed_at timestamptz;
alter table public.btc_events add column if not exists last_error text check (last_error is null or last_error ~ '^[a-z0-9_:]{1,60}$');
-- Pending order: never-failed first, then least recently failed (a pile of failing events can't starve the cron).
create index if not exists btc_events_retry_idx on public.btc_events (last_failed_at asc nulls first, received_at, id) where processed_at is null;
create index if not exists btc_events_unprocessed_idx on public.btc_events (received_at) where processed_at is null;
create index if not exists btc_events_binding_idx on public.btc_events (binding_id, received_at);
create table if not exists public.btc_heartbeat (
  id smallint primary key default 1 check (id = 1),
  env jsonb not null check (pg_column_size(env) < 8192),
  received_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['btc_bindings','btc_outpoints','btc_nonces','btc_events','btc_heartbeat'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
  end loop;
end $$;
revoke all on sequence public.btc_events_id_seq from anon, authenticated, public;
-- Outpoints, nonces and events are never edited.
drop trigger if exists btc_outpoints_ro on public.btc_outpoints;
create trigger btc_outpoints_ro before update or delete on public.btc_outpoints for each row execute function public.rental_no_update();
drop trigger if exists btc_nonces_ro on public.btc_nonces;
create trigger btc_nonces_ro before update or delete on public.btc_nonces for each row execute function public.rental_no_update();

-- A new binding wakes the agent (LISTEN gm_btc_attest on its session-mode connection).
create or replace function public.btc_notify_attest() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform pg_notify('gm_btc_attest', new.binding_id::text); return new; end $$;
revoke all on function public.btc_notify_attest() from public, anon, authenticated;
drop trigger if exists btc_bindings_notify on public.btc_bindings;
create trigger btc_bindings_notify after insert on public.btc_bindings for each row execute function public.btc_notify_attest();

-- BTC refunds go back on the chain the money came from.
create or replace function public.rental_refunds_fill_network() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.refund_network is null then
    if new.provider_ref like 'btc:%' then
      select b.network into new.refund_network from public.btc_bindings b where b.provider_ref = new.provider_ref;
    else
      select s.network into new.refund_network from public.rental_x402_settlements s where s.provider_ref = new.provider_ref;
    end if;
  end if;
  return new;
end $$;

-- ── gm_btc (node agent) functions: EXECUTE only ──────────────────────────────────────────────────────────────────
create or replace function public.btc_open_attest_rows() returns table (binding_id uuid, order_id uuid, order_ref text, kind text, network text,
  amount_sat bigint, required_confs smallint, floor_btc_per_ph_day text, floor_day date, quote_at timestamptz, quote_expires_at timestamptz)
  language sql security definer set search_path = '' stable as $$
  select b.binding_id, b.order_id, b.order_ref, b.kind, b.network, b.amount_sat, b.required_confs, b.floor_btc_per_ph_day, b.floor_day, b.quote_at, b.quote_expires_at
  from public.btc_bindings b
  where b.status = 'awaiting_attest' and b.quote_expires_at > now() and (b.claimed_until is null or b.claimed_until < now())
  order by b.created_at limit 20 $$;
revoke all on function public.btc_open_attest_rows() from public, anon, authenticated;

-- Long-poll fallback for LISTEN (<= 25 s, 0.25 s pickup).
create or replace function public.btc_wait_bindings(p_timeout_sec int default 25) returns table (binding_id uuid, order_id uuid, order_ref text, kind text, network text,
  amount_sat bigint, required_confs smallint, floor_btc_per_ph_day text, floor_day date, quote_at timestamptz, quote_expires_at timestamptz)
  language plpgsql security definer set search_path = '' as $$
declare deadline timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_timeout_sec, 25), 0), 25));
begin
  loop
    return query select * from public.btc_open_attest_rows();
    if found or clock_timestamp() >= deadline then return; end if;
    perform pg_sleep(0.25);
  end loop;
end $$;

create or replace function public.btc_claim_binding(p_binding_id uuid) returns table (binding_id uuid, order_id uuid, order_ref text, kind text, network text,
  amount_sat bigint, required_confs smallint, floor_btc_per_ph_day text, floor_day date, quote_at timestamptz, quote_expires_at timestamptz)
  language sql security definer set search_path = '' as $$
  update public.btc_bindings b set claimed_until = now() + interval '30 seconds', updated_at = now()
  where b.binding_id = p_binding_id and b.status = 'awaiting_attest' and b.quote_expires_at > now() and (b.claimed_until is null or b.claimed_until < now())
  returning b.binding_id, b.order_id, b.order_ref, b.kind, b.network, b.amount_sat, b.required_confs, b.floor_btc_per_ph_day, b.floor_day, b.quote_at, b.quote_expires_at $$;

-- v2 (folded in from the node BTC1 delta 20261017203000 before this migration reached prod): same lease, same predicate,
-- plus rig_count and days so the agent can re-check amount_sat = max(ask_sat, min_sat(F)) for rigs x days before it signs
-- (PLAN §3/§4.3 N7). gm_btc still has no table grants. days = rental_orders.days (initial) or the binding's extend_days.
create or replace function public.btc_claim_binding_v2(p_binding_id uuid) returns table (binding_id uuid, order_id uuid, order_ref text, kind text, network text,
  amount_sat bigint, required_confs smallint, floor_btc_per_ph_day text, floor_day date, quote_at timestamptz, quote_expires_at timestamptz,
  rig_count int, days int)
  language sql security definer set search_path = '' as $$
  with c as (
    update public.btc_bindings b set claimed_until = now() + interval '30 seconds', updated_at = now()
    where b.binding_id = p_binding_id and b.status = 'awaiting_attest' and b.quote_expires_at > now() and (b.claimed_until is null or b.claimed_until < now())
    returning b.binding_id, b.order_id, b.order_ref, b.kind, b.network, b.amount_sat, b.required_confs, b.floor_btc_per_ph_day, b.floor_day, b.quote_at, b.quote_expires_at, b.provider_ref
  )
  select c.binding_id, c.order_id, c.order_ref, c.kind, c.network, c.amount_sat, c.required_confs, c.floor_btc_per_ph_day, c.floor_day, c.quote_at, c.quote_expires_at,
         o.rig_count, case when c.kind = 'extension' then rb.extend_days else o.days end
  from c join public.rental_orders o on o.id = c.order_id
         join public.rental_payment_bindings rb on rb.provider_ref = c.provider_ref $$;

-- Stores the agent's signed "addr" envelope. The DB copies index/address/heights from it and checks ONLY shape and UNIQUE;
-- the site verifies the signature and re-derives the address before anything is shown. A UNIQUE conflict (index or address
-- already used) raises 'btc_index_burned' (SQLSTATE 23505): the agent burns that index and counts it toward its caps.
create or replace function public.btc_attach_attestation(p_binding_id uuid, p_envelope jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare p jsonb := p_envelope->'payload'; n int;
begin
  if jsonb_typeof(p) <> 'object' or p->>'type' <> 'addr' or p->>'binding_id' <> p_binding_id::text then raise exception 'btc_bad_envelope' using errcode = '22023'; end if;
  begin
    update public.btc_bindings b set attest_env = p_envelope, addr_index = (p->>'index')::int, address = p->>'address',
      quote_tip_height = (p->>'quote_tip_height')::int, confirm_by_height = (p->>'confirm_by_height')::int,
      status = 'awaiting_payment', claimed_until = null, updated_at = now(), version = b.version + 1
    where b.binding_id = p_binding_id and b.status = 'awaiting_attest';
    get diagnostics n = row_count;
  exception when unique_violation then
    raise exception 'btc_index_burned' using errcode = '23505';
  end;
  if n <> 1 then raise exception 'btc_binding_not_awaiting_attest' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.btc_report_event(p_envelope jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare p jsonb := p_envelope->'payload'; bid uuid; id bigint;
begin
  if jsonb_typeof(p) <> 'object' or coalesce(p->>'type', '') not in ('addr_refused','paid','reorged','seen','underpaid') then raise exception 'btc_bad_envelope' using errcode = '22023'; end if;
  if (p->>'binding_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then bid := (p->>'binding_id')::uuid; end if;
  insert into public.btc_events (binding_id, type, env) values (bid, p->>'type', p_envelope) returning btc_events.id into id;
  return jsonb_build_object('ok', true, 'id', id);
end $$;
-- Named in the plan; same intake, paid events only.
create or replace function public.btc_report_payment(p_envelope jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  if p_envelope->'payload'->>'type' <> 'paid' then raise exception 'btc_bad_envelope' using errcode = '22023'; end if;
  return public.btc_report_event(p_envelope);
end $$;

create or replace function public.btc_heartbeat(p_envelope jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  if p_envelope->'payload'->>'type' <> 'heartbeat' then raise exception 'btc_bad_envelope' using errcode = '22023'; end if;
  insert into public.btc_heartbeat (id, env, received_at) values (1, p_envelope, now())
  on conflict (id) do update set env = excluded.env, received_at = excluded.received_at;
  return jsonb_build_object('ok', true);
end $$;

-- Attested bindings the agent watches (its own ledger decides cadence: full until paid + 6 conf or 7 days, then daily).
create or replace function public.btc_open_bindings() returns table (binding_id uuid, order_id uuid, order_ref text, kind text, network text, addr_index int, address text,
  amount_sat bigint, required_confs smallint, quote_at timestamptz, quote_expires_at timestamptz, quote_tip_height int, confirm_by_height int, status text, received_sat bigint)
  language sql security definer set search_path = '' stable as $$
  select b.binding_id, b.order_id, b.order_ref, b.kind, b.network, b.addr_index, b.address, b.amount_sat, b.required_confs, b.quote_at, b.quote_expires_at,
         b.quote_tip_height, b.confirm_by_height, b.status, b.received_sat
  from public.btc_bindings b where b.addr_index is not null order by b.addr_index limit 10000 $$;

do $$ declare f text; begin
  foreach f in array array['btc_wait_bindings(integer)','btc_claim_binding(uuid)','btc_claim_binding_v2(uuid)','btc_attach_attestation(uuid, jsonb)','btc_report_event(jsonb)',
                           'btc_report_payment(jsonb)','btc_heartbeat(jsonb)','btc_open_bindings()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to gm_btc', f);
  end loop;
end $$;

-- ── service_role (site) functions ──────────────────────────────────────────────────────────────────────────────────
-- New binding + its rental_payment_bindings row, atomically. Refuses unless the order is an unpaid x402-created order with
-- no x402 money (settlement or pending signature) and no live BTC binding.
create or replace function public.btc_insert_binding(p_binding jsonb, p_rental jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare oid uuid := (p_binding->>'order_id')::uuid; st text; rl text;
begin
  select o.state, o.rail into st, rl from public.rental_orders o where o.id = oid for update;
  if not found or st <> 'awaiting_payment' or rl <> 'x402_usdc' then raise exception 'btc_order_not_payable' using errcode = 'P0001'; end if;
  if exists (select 1 from public.rental_payment_bindings rb join public.rental_x402_settlements s on s.provider_ref = rb.provider_ref where rb.order_id = oid)
     or exists (select 1 from public.rental_payment_bindings rb join public.rental_x402_pending_sigs s on s.provider_ref = rb.provider_ref where rb.order_id = oid)
     or exists (select 1 from public.rental_payment_bindings rb join public.rental_x402_pending s on s.provider_ref = rb.provider_ref where rb.order_id = oid) then
    raise exception 'btc_x402_money' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.btc_bindings b where b.order_id = oid and b.status not in ('refused','expired')) then
    raise exception 'btc_binding_exists' using errcode = 'P0001';
  end if;
  insert into public.rental_payment_bindings (provider_ref, order_id, kind, expected_atomic, extend_days, expires_at, challenge)
  values (p_rental->>'provider_ref', oid, p_rental->>'kind', (p_rental->>'expected_atomic')::bigint, (p_rental->>'extend_days')::int,
          (p_rental->>'expires_at')::timestamptz, p_rental->'challenge');
  insert into public.btc_bindings (binding_id, provider_ref, order_id, order_ref, kind, network, amount_sat, required_confs, floor_btc_per_ph_day, floor_day, quote_at, quote_expires_at)
  values ((p_binding->>'binding_id')::uuid, p_binding->>'provider_ref', oid, p_binding->>'order_ref', p_binding->>'kind', p_binding->>'network',
          (p_binding->>'amount_sat')::bigint, (p_binding->>'required_confs')::smallint, p_binding->>'floor_btc_per_ph_day', (p_binding->>'floor_day')::date,
          (p_binding->>'quote_at')::timestamptz, (p_binding->>'quote_expires_at')::timestamptz);
  return jsonb_build_object('ok', true);
end $$;

-- Compare-and-set on a binding (version). Only these columns can change here.
create or replace function public.btc_update_binding(p_binding_id uuid, p_from_version int, p_patch jsonb) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.btc_bindings b set
    status = coalesce(p_patch->>'status', b.status),
    status_reason = case when p_patch ? 'status_reason' then p_patch->>'status_reason' else b.status_reason end,
    display_ok_at = case when p_patch ? 'display_ok_at' then (p_patch->>'display_ok_at')::timestamptz else b.display_ok_at end,
    refunded_sat = coalesce((p_patch->>'refunded_sat')::bigint, b.refunded_sat),
    version = b.version + 1, updated_at = now()
  where b.binding_id = p_binding_id and b.version = p_from_version;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.btc_record_nonce(p_nonce text, p_type text, p_binding_id uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.btc_nonces (nonce, type, binding_id) values (p_nonce, p_type, p_binding_id) on conflict (nonce) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.btc_mark_event(p_id bigint, p_outcome text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.btc_events e set processed_at = now(), outcome = p_outcome where e.id = p_id and e.processed_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- FB3: count one failed processing attempt of an unprocessed event. Returns the new totals (null if already processed).
create or replace function public.btc_event_failed(p_id bigint, p_error text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare a int; f timestamptz;
begin
  update public.btc_events e set attempts = e.attempts + 1, first_failed_at = coalesce(e.first_failed_at, now()), last_failed_at = now(),
    last_error = left(regexp_replace(lower(coalesce(nullif(p_error, ''), 'error')), '[^a-z0-9_:]', '_', 'g'), 60)
  where e.id = p_id and e.processed_at is null
  returning e.attempts, e.first_failed_at into a, f;
  if not found then return null; end if;
  return jsonb_build_object('attempts', a, 'first_failed_at', f);
end $$;

-- Paid-event acceptance, ONE transaction: nonce (unseen), outpoints (globally unique; re-reported outpoints of the SAME
-- binding are fine for top-ups), binding CAS, optional switch of the order to the BTC rail, the event marked processed,
-- then the regular rental_settle commit (order/payment/refund/job/alerts). Any failure writes nothing.
create or replace function public.btc_accept_paid(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare bid uuid := (p->>'binding_id')::uuid; o jsonb; n int; other uuid;
begin
  perform 1 from public.btc_bindings b where b.binding_id = bid for update;
  if not found then raise exception 'stale_version' using errcode = '40001'; end if;
  if p ? 'nonce' then
    insert into public.btc_nonces (nonce, type, binding_id) values (p->>'nonce', coalesce(p->>'nonce_type', 'paid'), bid);
  end if;
  for o in select * from jsonb_array_elements(coalesce(p->'outpoints', '[]'::jsonb)) loop
    select x.binding_id into other from public.btc_outpoints x where x.txid = o->>'txid' and x.vout = (o->>'vout')::int;
    if found then
      if other <> bid then raise exception 'btc_outpoint_reused' using errcode = '23505'; end if;
    else
      insert into public.btc_outpoints (txid, vout, binding_id, value_sat, height) values (o->>'txid', (o->>'vout')::int, bid, (o->>'value_sat')::bigint, (o->>'height')::int);
    end if;
  end loop;
  update public.btc_bindings b set
    status = coalesce(p->'patch'->>'status', b.status),
    status_reason = case when p->'patch' ? 'status_reason' then p->'patch'->>'status_reason' else b.status_reason end,
    paid_env = case when p->'patch' ? 'paid_env' then p->'patch'->'paid_env' else b.paid_env end,
    received_sat = coalesce((p->'patch'->>'received_sat')::bigint, b.received_sat),
    credited_sat = coalesce((p->'patch'->>'credited_sat')::bigint, b.credited_sat),
    refunded_sat = coalesce((p->'patch'->>'refunded_sat')::bigint, b.refunded_sat),
    version = b.version + 1, updated_at = now()
  where b.binding_id = bid and b.version = (p->>'from_version')::int;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'stale_version' using errcode = '40001'; end if;
  if p ? 'order_rail' then
    update public.rental_orders r set rail = 'btc_onchain', total_sats = (p->'order_rail'->>'total_sats')::bigint, total_usdc_atomic = null
    where r.id = (p->'order_rail'->>'order_id')::uuid and r.state = 'awaiting_payment' and r.rail = 'x402_usdc'
      and not exists (select 1 from public.rental_payment_bindings rb join public.rental_x402_settlements s on s.provider_ref = rb.provider_ref where rb.order_id = r.id);
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'stale_version' using errcode = '40001'; end if;
  end if;
  if p ? 'event_id' then
    update public.btc_events e set processed_at = now(), outcome = coalesce(p->>'event_outcome', 'accepted') where e.id = (p->>'event_id')::bigint and e.processed_at is null;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'stale_version' using errcode = '40001'; end if;
  end if;
  if p ? 'commit' and jsonb_typeof(p->'commit') = 'object' then
    perform public.rental_settle(p->'commit');
  end if;
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['btc_insert_binding(jsonb, jsonb)','btc_update_binding(uuid, integer, jsonb)','btc_record_nonce(text, text, uuid)',
                           'btc_mark_event(bigint, text)','btc_event_failed(bigint, text)','btc_accept_paid(jsonb)','btc_open_attest_rows()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
-- btc_open_attest_rows is an internal helper of btc_wait_bindings (security definer); gm_btc never calls it directly.
