-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- 20261017200000 · B7 direct-rental bay availability (190000 = #107 btc_onchain, 210000 = #108 eth_usdc) (the operator 2026-10-17).
-- The node reports, every 60 s, which bays are free on the marketplace AND locally (no hold, no
-- revert_failed, no kill file). The site offers, holds and settles only fresh-free bays when
-- RENTALS_AVAIL_GATE=1 (off by default). Stale = NOT free (fail closed).
-- Additive: one new table (RLS on, no policies, no grants), two RPCs, one refund reason.
-- pricing_daily untouched. Staging first. Prod: only with a security review PASS AND the operator's explicit yes for that apply.
set local lock_timeout = '5s';

create table if not exists public.rental_bay_availability (
  bay smallint primary key check (bay between 1 and 64),
  free boolean not null,
  reason text not null check (reason in ('ok','mrr_rented','mrr_disabled','mrr_offline','direct_active','node_hold','revert_failed','killed','read_error')),
  mrr_rented_until timestamptz,
  reported_at timestamptz not null default now(),
  seq bigint not null,
  check (free = (reason = 'ok'))
);
alter table public.rental_bay_availability enable row level security;
revoke all on table public.rental_bay_availability from public, anon, authenticated;
-- Supabase default privileges grant service_role too: no direct table access (readers are SECURITY DEFINER RPCs).
revoke all on table public.rental_bay_availability from service_role;

-- Writer: gm_node only. THE AVAIL1 CONTRACT (staged, not yet installed: AVAIL1 r2, the review-PASSed rev: REVIEW-PASS b56f4f4d, poller 654dc6a8; AVAIL1 kit migration bcb8e1a5):
--   select public.rental_report_bay_availability($1::jsonb) every ~45-60 s with
--   {"v":1,"seq":<int ms, strictly increasing>,"bays":[{"bay":n,"free":bool,"reason":<enum>,"mrr_rented_until":<iso>|null}, ...]}
-- Same checks and error codes as the kit writer: v must be 1; seq 1..16 digits; distinct bays; free = (reason = 'ok');
-- seq replay guard (seq <= the stored max is refused while the stored report is younger than 300 s; an older stored report
-- can be overtaken, e.g. after the node clock stepped back); mrr_rented_until is a hint only and never fails the report
-- (kept only for reason mrr_rented, in the future and at most 90 days out; a non-string non-null value is an error).
-- One deliberate difference: bays are 1..64 and the snapshot may hold 1..64 bays (data-driven fleet; the kit pins exactly 4).
-- A bay missing from a report simply goes stale = not free (fail closed). reported_at is always the server clock.
drop function if exists public.rental_report_bay_availability(jsonb);   -- arg renamed p_rows -> p_doc (staging held the old one)
create function public.rental_report_bay_availability(p_doc jsonb)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_seq bigint; v_bays jsonb; e jsonb; v_bay int; v_free boolean; v_reason text; v_until timestamptz;
  v_seen int[] := '{}'; v_last_seq bigint; v_last_at timestamptz; n int := 0;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'avail_bad_doc'; end if;
  if (p_doc->>'v') is distinct from '1' then raise exception 'avail_bad_version'; end if;
  if jsonb_typeof(p_doc->'seq') is distinct from 'number' or (p_doc->>'seq') !~ '^[0-9]{1,16}$' then raise exception 'avail_bad_seq'; end if;
  v_seq := (p_doc->>'seq')::bigint;
  v_bays := p_doc->'bays';
  if jsonb_typeof(v_bays) is distinct from 'array' or jsonb_array_length(v_bays) < 1 or jsonb_array_length(v_bays) > 64 then raise exception 'avail_bad_bays'; end if;
  -- Serialise writers (N2): concurrent reports can't interleave rows or both pass the seq guard. Lock is released at commit.
  perform pg_advisory_xact_lock(hashtext('rental_bay_availability'));
  -- Out-of-order / replayed reports are refused, unless the stored report is already stale (> 300 s).
  select max(seq), max(reported_at) into v_last_seq, v_last_at from public.rental_bay_availability;
  if v_last_seq is not null and v_seq <= v_last_seq and v_last_at > now() - interval '300 seconds' then raise exception 'avail_stale_seq'; end if;
  for e in select * from jsonb_array_elements(v_bays) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'bay') is distinct from 'number' or (e->>'bay') !~ '^[0-9]{1,2}$' then raise exception 'avail_bad_bay'; end if;
    v_bay := (e->>'bay')::int;
    if v_bay < 1 or v_bay > 64 then raise exception 'avail_bad_bay'; end if;
    if v_bay = any(v_seen) then raise exception 'avail_dup_bay'; end if;
    v_seen := v_seen || v_bay;
    if jsonb_typeof(e->'free') is distinct from 'boolean' then raise exception 'avail_bad_free'; end if;
    v_free := (e->>'free')::boolean; v_reason := e->>'reason';
    if v_reason is null or v_reason not in ('ok','mrr_rented','mrr_disabled','mrr_offline','direct_active','node_hold','revert_failed','killed','read_error') then raise exception 'avail_bad_reason'; end if;
    if v_free <> (v_reason = 'ok') then raise exception 'avail_free_mismatch'; end if;
    v_until := null;
    if e ? 'mrr_rented_until' and jsonb_typeof(e->'mrr_rented_until') = 'string' then
      begin v_until := (e->>'mrr_rented_until')::timestamptz; exception when others then v_until := null; end;
      if v_reason <> 'mrr_rented' or v_until < now() or v_until > now() + interval '90 days' then v_until := null; end if;   -- hint only
    elsif e ? 'mrr_rented_until' and jsonb_typeof(e->'mrr_rented_until') <> 'null' then raise exception 'avail_bad_until';
    end if;
    insert into public.rental_bay_availability as t (bay, free, reason, mrr_rented_until, reported_at, seq)
    values (v_bay, v_free, v_reason, v_until, now(), v_seq)
    on conflict (bay) do update set free = excluded.free, reason = excluded.reason, mrr_rented_until = excluded.mrr_rented_until,
      reported_at = excluded.reported_at, seq = excluded.seq;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Reader (service_role): every row with freshness judged by the DATABASE clock.
create or replace function public.rental_bay_availability_read(p_max_age_s int default 180)
returns table (bay smallint, free boolean, reason text, mrr_rented_until timestamptz, fresh boolean)
language sql stable security definer set search_path = '' as $$
  select a.bay, a.free, a.reason, a.mrr_rented_until,
         a.reported_at > now() - make_interval(secs => least(greatest(coalesce(p_max_age_s, 180), 30), 600))
    from public.rental_bay_availability a order by a.bay;
$$;

-- Spec reader: fresh AND free bays only. Stale or missing rows are never free.
create or replace function public.rental_free_bays(p_max_age_s int default 180)
returns setof smallint
language sql stable security definer set search_path = '' as $$
  select r.bay from public.rental_bay_availability_read(p_max_age_s) r where r.free and r.fresh;
$$;

revoke all on function public.rental_report_bay_availability(jsonb) from public, anon, authenticated;
revoke all on function public.rental_report_bay_availability(jsonb) from service_role; -- writer is gm_node ONLY (default privileges would grant it)
revoke all on function public.rental_bay_availability_read(int) from public, anon, authenticated;
revoke all on function public.rental_free_bays(int) from public, anon, authenticated;
grant execute on function public.rental_bay_availability_read(int) to service_role;
grant execute on function public.rental_free_bays(int) to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gm_node') then
    grant execute on function public.rental_report_bay_availability(jsonb) to gm_node;
  else
    raise exception 'gm_node role missing';
  end if;
end $$;

-- Bay substitution (bay_taken_mrr) re-assigns bays on a delivering order. rental_settle checks bay overlap only
-- when an order starts, so this trigger checks it on EVERY bays change of a committed order, under one
-- transaction-scoped advisory lock (serialises concurrent bay writers). Overlap = 'cap_exceeded' (writes nothing).
create or replace function public.rental_orders_bays_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.bays is not null and new.state in ('paid','delivering','active') and new.bays is distinct from old.bays then
    perform pg_advisory_xact_lock(hashtext('rental_orders_bays'));
    if exists (select 1 from public.rental_orders o
               where o.state in ('paid','delivering','active') and o.id <> new.id and o.bays is not null
                 and string_to_array(o.bays, ',') && string_to_array(new.bays, ',')) then
      raise exception 'cap_exceeded' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.rental_orders_bays_guard() from public, anon, authenticated;
drop trigger if exists rental_orders_bays_guard on public.rental_orders;
create trigger rental_orders_bays_guard before update of bays on public.rental_orders
  for each row execute function public.rental_orders_bays_guard();

-- A never-started order that lost its bay to the marketplace is refunded in full (pending_owner, never auto-sent).
alter table public.rental_refunds drop constraint if exists rental_refunds_reason_check;
alter table public.rental_refunds add constraint rental_refunds_reason_check
  check (reason in ('underpaid','overpaid','late','duplicate','cap_exceeded','delivery_failed','kill_switch','cancelled','expired_unapplied','bay_unavailable'));
