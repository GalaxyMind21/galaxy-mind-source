-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- Alert forwarder for the node (gm_node only). Additive: no table grants, pricing_daily untouched.
-- The node reads unforwarded rental_alerts via rental_alerts_pending() and relays them to ntfy
-- (topic gm-alerts-...), then calls rental_alerts_mark_forwarded(ids).
alter table public.rental_alerts add column if not exists forwarded_at timestamptz;
create index if not exists rental_alerts_pending_idx on public.rental_alerts (id) where forwarded_at is null;

create or replace function public.rental_alerts_pending(p_limit int default 50)
returns table (id bigint, kind text, order_ref text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.kind, a.order_ref from public.rental_alerts a
   where a.forwarded_at is null
   order by a.at, a.id
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

create or replace function public.rental_alerts_mark_forwarded(p_ids bigint[])
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 500 then raise exception 'too_many_ids'; end if;
  update public.rental_alerts set forwarded_at = now() where id = any(p_ids) and forwarded_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.rental_alerts_pending(int) from public, anon, authenticated;
revoke all on function public.rental_alerts_mark_forwarded(bigint[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gm_node') then
    grant execute on function public.rental_alerts_pending(int) to gm_node;
    grant execute on function public.rental_alerts_mark_forwarded(bigint[]) to gm_node;
  else
    raise exception 'gm_node role missing';
  end if;
end $$;
