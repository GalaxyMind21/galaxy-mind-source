-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- Phase 2 MVP (STAGING ONLY, staging project; never the production project).
-- USDC via x402 on Base only. Adds: accepted Rental Terms version, bay numbers
-- (never rig ids), renter cancel refunds, delivered TH on job results, and a
-- claim/lease RPC for the node's outbound poll.

alter table public.rental_orders
  add column if not exists terms_version text check (terms_version is null or terms_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists bays text check (bays is null or bays ~ '^[0-9]{1,3}(,[0-9]{1,3}){0,3}$');
-- New orders must record the accepted terms.
alter table public.rental_orders drop constraint if exists rental_orders_terms_required;
alter table public.rental_orders add constraint rental_orders_terms_required check (terms_version is not null and terms_accepted_at is not null) not valid;

alter table public.rental_refunds drop constraint if exists rental_refunds_reason_check;
alter table public.rental_refunds add constraint rental_refunds_reason_check
  check (reason in ('underpaid','overpaid','late','duplicate','cap_exceeded','delivery_failed','kill_switch','cancelled'));

alter table public.rental_job_results
  add column if not exists delivered_th numeric check (delivered_th is null or (delivered_th >= 0 and delivered_th <= 1080));
grant insert (delivered_th) on public.rental_job_results to gm_node;

-- Claim + lease. The node polls outbound; a claim leases a job for p_lease_sec
-- (30..300 s). A job with a result, an expired exp, or a live lease is skipped.
create table if not exists public.rental_job_leases (
  job_id uuid primary key references public.rental_jobs(job_id),
  lease_until timestamptz not null,
  claims int not null default 1 check (claims between 1 and 20)
);
alter table public.rental_job_leases enable row level security;
revoke all on public.rental_job_leases from anon, authenticated, public;

create or replace function public.rental_claim_jobs(p_lease_sec int default 120, p_limit int default 10)
  returns table (job_id uuid, kid text, payload jsonb, sig text, lease_until timestamptz, rentals_enabled boolean)
  language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare lease int := least(greatest(coalesce(p_lease_sec, 120), 30), 300);
  lim int := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  -- Access is the grant below (gm_node only); security definer so the lease table stays private.
  return query
  with cand as (
    select j.job_id from public.rental_jobs j
    left join public.rental_job_leases l on l.job_id = j.job_id
    where j.exp > now()
      and not exists (select 1 from public.rental_job_results r where r.job_id = j.job_id)
      and (l.job_id is null or (l.lease_until < now() and l.claims < 20))
    order by j.created_at
    limit lim
    for update of j skip locked
  ), up as (
    insert into public.rental_job_leases as x (job_id, lease_until)
    select cand.job_id, now() + make_interval(secs => lease) from cand
    on conflict (job_id) do update set lease_until = excluded.lease_until, claims = x.claims + 1
    returning x.job_id, x.lease_until
  )
  select j.job_id, j.kid, j.payload, j.sig, up.lease_until,
         coalesce((select s.rentals_enabled from public.rental_settings s where s.id = 1), false)
  from up join public.rental_jobs j on j.job_id = up.job_id;
end $$;
revoke all on function public.rental_claim_jobs(int, int) from public, anon, authenticated;
grant execute on function public.rental_claim_jobs(int, int) to gm_node;

-- Settle now also writes the assigned bays and refuses overlapping bays.
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
