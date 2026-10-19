-- Rollback for 20261019030000_pricing_daily_revoke_anon_select.sql (not run). PERMISSIONS AND POLICIES ONLY; no data
-- touched. Restores the pre-2026-10-19 state: SELECT for anon and authenticated, and the open read policy
-- pricing_daily_read (recreated as FOR SELECT TO public USING (true); check it against the pre-change pg_policies
-- row before running). Removes the pricing_reader role. service_role keeps its grant.
set local lock_timeout = '5s';

drop policy if exists pricing_daily_read_server on public.pricing_daily;
drop policy if exists pricing_daily_read on public.pricing_daily;
create policy pricing_daily_read on public.pricing_daily
  for select to public
  using (true);

grant select on table public.pricing_daily to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pricing_reader') then
    revoke select on table public.pricing_daily from pricing_reader;
    revoke usage on schema public from pricing_reader;
    revoke pricing_reader from authenticator;
    drop role pricing_reader;
  end if;
end
$$;
