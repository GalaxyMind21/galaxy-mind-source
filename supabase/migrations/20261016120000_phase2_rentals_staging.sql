-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- Phase 2 paid rentals · STAGING ONLY · DO NOT APPLY TO ANY LIVE DATABASE.
-- Mirrors src/lib/rentals/phase2/store.ts. RLS on everywhere, deny by default.
-- All settle-time writes go through public.rental_settle(jsonb): ONE transaction.
create extension if not exists pgcrypto;

create table if not exists public.rental_settings (     -- kill switch (Vercel side)
  id int primary key check (id = 1),
  rentals_enabled boolean not null default false,       -- default OFF
  updated_by text, updated_at timestamptz not null default now()
);
insert into public.rental_settings (id, rentals_enabled) values (1, false) on conflict (id) do nothing;

create table if not exists public.rental_orders (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null check (public_id ~ '^gm_[A-Za-z0-9_-]{8,20}$'),
  idem_key text unique not null check (idem_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  rail text not null check (rail in ('lightning','x402_usdc')),
  state text not null check (state in ('awaiting_payment','expired','paid','delivering','active','completed','failed','refund_pending','refunded')),
  rig_count int not null check (rig_count between 1 and 4),
  th int not null check (th > 0 and th % 270 = 0 and th = rig_count * 270),
  days int not null check (days between 1 and 30),
  price_btc_ph_day numeric not null check (price_btc_ph_day > 0),
  floor_btc_ph_day numeric not null check (price_btc_ph_day >= floor_btc_ph_day),
  total_sats bigint not null check (total_sats > 0),
  total_usdc_atomic bigint check (total_usdc_atomic is null or total_usdc_atomic > 0),
  pool_host text not null check (pool_host ~ '^[a-z0-9.-]{1,253}$'),
  pool_port int not null check (pool_port between 1 and 65535),
  worker text not null check (worker ~ '^[A-Za-z0-9._-]{1,64}$'),
  pool_pass_sealed bytea,                              -- sealed only; no plaintext pool password column exists
  access_code_hmac text unique not null,               -- HMAC of a code derived from the creator secret
  creator_secret_hmac text not null,                   -- HMAC of the secret returned once by create_rental
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  starts_at timestamptz, ends_at timestamptz,
  version int not null default 0
);
create index if not exists rental_orders_state_idx on public.rental_orders (state, expires_at);

create table if not exists public.rental_idempotency (
  key text primary key check (key ~ '^[A-Za-z0-9_-]{16,64}$'),
  tool text not null check (tool in ('create_rental','extend_rental')),
  request_hash text not null,
  order_id uuid not null references public.rental_orders(id),
  provider_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.rental_payment_bindings (
  provider_ref text primary key check (length(provider_ref) <= 80),
  order_id uuid not null references public.rental_orders(id),
  kind text not null check (kind in ('initial','extension')),
  expected_atomic bigint not null check (expected_atomic > 0),
  extend_days int check (extend_days is null or extend_days between 1 and 29),
  expires_at timestamptz not null,
  challenge jsonb not null,
  check ((kind = 'extension') = (extend_days is not null))
);

-- One row per money increment seen on a ref; seq = cumulative before it.
create table if not exists public.rental_payments (
  id text primary key,                                  -- provider_ref || '#' || seq
  order_id uuid not null references public.rental_orders(id),
  kind text not null check (kind in ('initial','extension')),
  rail text not null check (rail in ('lightning','x402_usdc')),
  provider_ref text not null references public.rental_payment_bindings(provider_ref),
  seq bigint not null check (seq >= 0),
  delta_atomic bigint not null check (delta_atomic >= 0),
  cumulative_atomic bigint not null check (cumulative_atomic = seq + delta_atomic),
  expected_atomic bigint not null,
  extend_days int check (extend_days is null or extend_days between 1 and 29),
  settles boolean not null default false,
  at timestamptz not null default now(),
  unique (provider_ref, seq),
  check (id = provider_ref || '#' || seq::text)
);
create unique index if not exists rental_payments_one_settle on public.rental_payments (provider_ref) where settles;

create table if not exists public.rental_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.rental_orders(id),
  provider_ref text not null references public.rental_payment_bindings(provider_ref),
  seq bigint not null check (seq >= 0),                -- cumulative refunded on this ref before this row
  reason text not null check (reason in ('underpaid','overpaid','late','duplicate','cap_exceeded','delivery_failed','kill_switch')),
  atomic bigint not null check (atomic > 0),
  rail text not null,
  status text not null default 'pending_owner' check (status in ('pending_owner','approved','paid')),
  approved_by text, at timestamptz not null default now(),
  unique (provider_ref, seq)
);

create table if not exists public.rental_jobs (
  job_id uuid primary key,
  order_ref text not null,
  kid text not null check (kid ~ '^[a-z0-9-]{1,32}$'),
  payload jsonb not null,
  sig text not null check (sig ~ '^[A-Za-z0-9_-]{86}$'),
  nonce text unique not null check (nonce ~ '^[0-9a-f]{32}$'),
  exp timestamptz not null,
  created_at timestamptz not null default now(),
  check (nonce = (payload->>'nonce')),
  check (job_id::text = (payload->>'job_id')),
  check (order_ref = (payload->>'order_ref'))
);

create table if not exists public.rental_job_results (
  id bigserial primary key,
  job_id uuid not null references public.rental_jobs(job_id),
  result text not null check (result in ('applied','rejected','reverted','delivered')),
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  at timestamptz not null default now()
);

create table if not exists public.rental_events (
  id bigserial primary key, order_id uuid, from_state text, to_state text, actor text, at timestamptz not null default now()
);
-- Alerts outbox: Vercel can't reach the operator's private alert relay. The node polls this
-- outbound and forwards them to its alert topic. Staging: MockAlerter.
create table if not exists public.rental_alerts (
  id bigserial primary key, kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  order_ref text, at timestamptz not null default now(), forwarded_at timestamptz
);

-- Append-only guards
create or replace function public.rental_no_update() returns trigger
  language plpgsql set search_path = '' as $$ begin raise exception 'append-only'; end $$;
drop trigger if exists rental_jobs_ro on public.rental_jobs;
create trigger rental_jobs_ro before update or delete on public.rental_jobs for each row execute function public.rental_no_update();
drop trigger if exists rental_events_ro on public.rental_events;
create trigger rental_events_ro before update or delete on public.rental_events for each row execute function public.rental_no_update();
drop trigger if exists rental_payments_ro on public.rental_payments;
create trigger rental_payments_ro before update or delete on public.rental_payments for each row execute function public.rental_no_update();

-- Atomic settle: order CAS + payment + refunds + job + events + alerts in one transaction.
-- Any unique violation or a stale version raises, and the whole call rolls back.
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
    end if;
    update public.rental_orders o set
      state = coalesce(c->'order'->'patch'->>'state', o.state),
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
  for e in select * from jsonb_array_elements(coalesce(c->'events', '[]'::jsonb)) loop
    insert into public.rental_events (order_id, from_state, to_state, actor) values ((e->>'order_id')::uuid, e->>'from', e->>'to', e->>'actor');
  end loop;
  for a in select * from jsonb_array_elements(coalesce(c->'alerts', '[]'::jsonb)) loop
    insert into public.rental_alerts (kind, order_ref) values (a->>'kind', a->>'order_ref');
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- RLS: deny by default
alter table public.rental_settings enable row level security;
alter table public.rental_orders enable row level security;
alter table public.rental_idempotency enable row level security;
alter table public.rental_payment_bindings enable row level security;
alter table public.rental_payments enable row level security;
alter table public.rental_refunds enable row level security;
alter table public.rental_jobs enable row level security;
alter table public.rental_job_results enable row level security;
alter table public.rental_events enable row level security;
alter table public.rental_alerts enable row level security;
revoke all on public.rental_settings, public.rental_orders, public.rental_idempotency, public.rental_payment_bindings, public.rental_payments,
  public.rental_refunds, public.rental_jobs, public.rental_job_results, public.rental_events, public.rental_alerts from anon, authenticated, public;
-- Scoped to rental objects only. Never a blanket revoke or a default-privilege
-- change in public. This migration never touches functions it does not own.
revoke all on sequence public.rental_job_results_id_seq, public.rental_events_id_seq, public.rental_alerts_id_seq from anon, authenticated, public;
revoke execute on function public.rental_settle(jsonb), public.rental_no_update() from anon, authenticated, public;
-- Only the Vercel service role may settle.
grant execute on function public.rental_settle(jsonb) to service_role;

-- node controller login (decision): a dedicated Postgres LOGIN role, NOINHERIT,
-- no BYPASSRLS, password set OUT OF BAND by the operator (`alter role gm_node password '...'`)
-- and stored only on the node in a 0600 file. It connects outbound to the
-- Supabase pooler over TLS. Chosen over JWT-claims-via-authenticator so no JWT
-- secret or long-lived service JWT ever has to be minted or stored.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gm_node') then
    create role gm_node login noinherit nobypassrls connection limit 3;
  end if;
end $$;
grant usage on schema public to gm_node;
grant select on public.rental_jobs to gm_node;
grant select (rentals_enabled) on public.rental_settings to gm_node;
grant insert (job_id, result, reason) on public.rental_job_results to gm_node;
grant usage on sequence public.rental_job_results_id_seq to gm_node;
grant select, update (forwarded_at) on public.rental_alerts to gm_node;
create policy node_read_jobs on public.rental_jobs for select to gm_node using (exp > now() - interval '1 day');
create policy node_read_settings on public.rental_settings for select to gm_node using (id = 1);
-- Results only for a job that exists and was issued in the last 31 days (30 d cap + 1 d).
create policy node_write_results on public.rental_job_results for insert to gm_node
  with check (exists (select 1 from public.rental_jobs j where j.job_id = rental_job_results.job_id and j.created_at > now() - interval '31 days'));
create policy node_alerts on public.rental_alerts for select to gm_node using (forwarded_at is null);
create policy node_alerts_mark on public.rental_alerts for update to gm_node using (forwarded_at is null) with check (forwarded_at is not null);
