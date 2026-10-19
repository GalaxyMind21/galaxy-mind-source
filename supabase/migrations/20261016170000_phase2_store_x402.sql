-- Phase 2 persistent store + x402 settlements (STAGING ONLY, staging project; never the production project).
-- The Vercel service (service_role) reads these tables and writes ONLY through
-- rental_insert_order, rental_settle and rental_record_x402. RLS stays on, no anon access.

-- One row per x402 ref the facilitator settled (/verify then /settle). The tx hash is unique,
-- so one on-chain transfer can never pay two refs.
create table if not exists public.rental_x402_settlements (
  provider_ref text primary key references public.rental_payment_bindings(provider_ref),
  network text not null check (network in ('eip155:84532','eip155:8453')),
  payer text not null check (payer ~ '^0x[0-9a-fA-F]{40}$'),
  tx_hash text unique not null check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  amount_atomic bigint not null check (amount_atomic > 0),
  settled_at timestamptz not null default now()
);
alter table public.rental_x402_settlements enable row level security;
revoke all on public.rental_x402_settlements from anon, authenticated, public;
drop trigger if exists rental_x402_settlements_ro on public.rental_x402_settlements;
create trigger rental_x402_settlements_ro before update or delete on public.rental_x402_settlements for each row execute function public.rental_no_update();

create or replace function public.rental_record_x402(s jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rental_x402_settlements (provider_ref, network, payer, tx_hash, amount_atomic, settled_at)
  values (s->>'provider_ref', s->>'network', s->>'payer', s->>'tx_hash', (s->>'amount_atomic')::bigint, coalesce((s->>'settled_at')::timestamptz, now()));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_record_x402(jsonb) from public, anon, authenticated;
grant execute on function public.rental_record_x402(jsonb) to service_role;

-- Order + idempotency key in one transaction.
create or replace function public.rental_insert_order(o jsonb, i jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rental_orders (id, public_id, idem_key, rail, state, rig_count, th, days, price_btc_ph_day, floor_btc_ph_day,
    total_sats, total_usdc_atomic, pool_host, pool_port, worker, access_code_hmac, creator_secret_hmac, created_at, expires_at,
    terms_version, terms_accepted_at, bays, version)
  values ((o->>'id')::uuid, o->>'public_id', o->>'idem_key', o->>'rail', o->>'state', (o->>'rig_count')::int, (o->>'th')::int, (o->>'days')::int,
    (o->>'price_btc_ph_day')::numeric, (o->>'floor_btc_ph_day')::numeric, (o->>'total_sats')::bigint, (o->>'total_usdc_atomic')::bigint,
    o->>'pool_host', (o->>'pool_port')::int, o->>'worker', o->>'access_code_hmac', o->>'creator_secret_hmac',
    (o->>'created_at')::timestamptz, (o->>'expires_at')::timestamptz, o->>'terms_version', (o->>'terms_accepted_at')::timestamptz, o->>'bays', 0);
  insert into public.rental_idempotency (key, tool, request_hash, order_id, provider_ref)
  values (i->>'key', i->>'tool', i->>'request_hash', (i->>'order_id')::uuid, i->>'provider_ref');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_insert_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rental_insert_order(jsonb, jsonb) to service_role;

-- Settle also writes payment bindings and extension idempotency keys in the same transaction.
create or replace function public.rental_settle(c jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare n int; r jsonb; e jsonb; a jsonb;
  cur_state text; cur_rigs int; cur_days int; next_state text; next_days int; others int; enabled boolean;
begin
  if c ? 'order' then
    select o.state, o.rig_count, o.days into cur_state, cur_rigs, cur_days from public.rental_orders o
      where o.id = (c->'order'->>'id')::uuid for update;
    if not found then raise exception 'stale_version' using errcode = '40001'; end if;
    next_state := coalesce(c->'order'->'patch'->>'state', cur_state);
    next_days := coalesce((c->'order'->'patch'->>'days')::int, cur_days);
    -- State machine (mirrors TRANSITIONS in types.ts; settle may pass through paid in one call).
    if next_state <> cur_state and not (
         (cur_state = 'awaiting_payment' and next_state in ('paid','delivering','expired','refund_pending'))
      or (cur_state = 'expired' and next_state = 'refund_pending')
      or (cur_state = 'paid' and next_state in ('delivering','refund_pending','failed'))
      or (cur_state = 'delivering' and next_state in ('active','failed'))
      or (cur_state = 'active' and next_state in ('completed','failed'))
      or (cur_state = 'failed' and next_state = 'refund_pending')
      or (cur_state = 'refund_pending' and next_state = 'refunded')) then
      raise exception 'illegal_transition' using errcode = 'P0001';
    end if;
    -- Starting a rental or adding days: lock the settings row FOR UPDATE, re-check
    -- the kill flag under that lock, then (for a start) sum committed rigs.
    if (next_state in ('paid','delivering','active') and cur_state not in ('paid','delivering','active')) or next_days > cur_days then
      select s.rentals_enabled into enabled from public.rental_settings s where s.id = 1 for update;
      if enabled is not true then raise exception 'kill_switch' using errcode = 'P0001'; end if;
    end if;
    -- Pilot fleet cap (MAX_RIGS in src/lib/rentals/limits.ts; test-enforced).
    if next_state in ('paid','delivering','active') and cur_state not in ('paid','delivering','active') then
      select coalesce(sum(o.rig_count), 0) into others from public.rental_orders o
        where o.state in ('paid','delivering','active') and o.id <> (c->'order'->>'id')::uuid;
      if others + cur_rigs > 4 then raise exception 'cap_exceeded' using errcode = 'P0001'; end if;
      -- Bays (never rig ids): the assigned bays must not overlap any committed order's bays.
      if exists (select 1 from public.rental_orders o
                 where o.state in ('paid','delivering','active') and o.id <> (c->'order'->>'id')::uuid and o.bays is not null
                   and string_to_array(o.bays, ',') && string_to_array(c->'order'->'patch'->>'bays', ',')) then
        raise exception 'cap_exceeded' using errcode = 'P0001';
      end if;
    end if;
    update public.rental_orders o set
      state = coalesce(c->'order'->'patch'->>'state', o.state),
      bays = coalesce(c->'order'->'patch'->>'bays', o.bays),
      starts_at = coalesce((c->'order'->'patch'->>'starts_at')::timestamptz, o.starts_at),
      ends_at = coalesce((c->'order'->'patch'->>'ends_at')::timestamptz, o.ends_at),
      days = coalesce((c->'order'->'patch'->>'days')::int, o.days),
      version = o.version + 1
    where o.id = (c->'order'->>'id')::uuid and o.version = (c->'order'->>'from_version')::int;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'stale_version' using errcode = '40001'; end if;
  end if;
  if c ? 'payment' then
    insert into public.rental_payments (id, order_id, kind, rail, provider_ref, seq, delta_atomic, cumulative_atomic, expected_atomic, extend_days, settles, at)
    select x.id, x.order_id, x.kind, x.rail, x.provider_ref, x.seq, x.delta_atomic, x.cumulative_atomic, x.expected_atomic, x.extend_days, x.settles, x.at
    from jsonb_populate_record(null::public.rental_payments, c->'payment') x;
  end if;
  for r in select * from jsonb_array_elements(coalesce(c->'refunds', '[]'::jsonb)) loop
    insert into public.rental_refunds (order_id, provider_ref, seq, reason, atomic, rail)
    values ((r->>'order_id')::uuid, r->>'provider_ref', (r->>'seq')::bigint, r->>'reason', (r->>'atomic')::bigint, r->>'rail');
  end loop;
  if c ? 'job' then
    insert into public.rental_jobs (job_id, order_ref, kid, payload, sig, nonce, exp)
    values ((c->'job'->'payload'->>'job_id')::uuid, c->'job'->'payload'->>'order_ref', c->'job'->>'kid', c->'job'->'payload', c->'job'->>'sig',
            c->'job'->'payload'->>'nonce', to_timestamp((c->'job'->'payload'->>'exp')::bigint));
  end if;
  if c ? 'binding' then
    insert into public.rental_payment_bindings (provider_ref, order_id, kind, expected_atomic, extend_days, expires_at, challenge)
    values (c->'binding'->>'provider_ref', (c->'binding'->>'order_id')::uuid, c->'binding'->>'kind', (c->'binding'->>'expected_atomic')::bigint,
            (c->'binding'->>'extend_days')::int, (c->'binding'->>'expires_at')::timestamptz, c->'binding'->'challenge');
  end if;
  if c ? 'idem' then
    insert into public.rental_idempotency (key, tool, request_hash, order_id, provider_ref)
    values (c->'idem'->>'key', c->'idem'->>'tool', c->'idem'->>'request_hash', (c->'idem'->>'order_id')::uuid, c->'idem'->>'provider_ref');
  end if;
  for e in select * from jsonb_array_elements(coalesce(c->'events', '[]'::jsonb)) loop
    insert into public.rental_events (order_id, from_state, to_state, actor) values ((e->>'order_id')::uuid, e->>'from', e->>'to', e->>'actor');
  end loop;
  for a in select * from jsonb_array_elements(coalesce(c->'alerts', '[]'::jsonb)) loop
    insert into public.rental_alerts (kind, order_ref) values (a->>'kind', a->>'order_ref');
  end loop;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_settle(jsonb) from public, anon, authenticated;
grant execute on function public.rental_settle(jsonb) to service_role;
