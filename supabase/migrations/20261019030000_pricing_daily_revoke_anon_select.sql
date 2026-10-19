-- pricing_daily: stop anon and authenticated from reading the table (security audit 2026-10-18, L4, plus the
-- Review follow-up). PERMISSIONS AND POLICIES ONLY. No row is written, updated or deleted; no column, constraint,
-- trigger or function changes.
--   1. Drops the open policy pricing_daily_read (roles public, USING true), so a later grant cannot re-expose the table.
--   2. Revokes SELECT from anon and authenticated.
--   3. Adds a narrow NOLOGIN role pricing_reader that can only SELECT this table, with a policy scoped to it. The site
--      prefers a key for that role (RENTALS_PRICING_READ_KEY, a JWT with role=pricing_reader signed with the
--      project's JWT secret) over the service_role key. service_role keeps its grant as the fallback.
-- upsert_pricing_daily (token-checked SECURITY DEFINER rpc) keeps writing exactly as before: definer rights, not the
-- caller's table grants, decide that.
-- NOT APPLIED. Staging project first, then production only with a security review PASS and the operator's own yes.
-- Before applying: every other reader that uses the public anon key must move to a server-only key first, or it
-- fails closed once this lands. Rollback: supabase/rollback/20261019030000_pricing_daily_revoke_anon_select_rollback.sql
set local lock_timeout = '5s';

drop policy if exists pricing_daily_read on public.pricing_daily;

revoke select on table public.pricing_daily from anon, authenticated;
grant select on table public.pricing_daily to service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pricing_reader') then
    create role pricing_reader nologin noinherit;
  end if;
end
$$;
grant pricing_reader to authenticator;
grant usage on schema public to pricing_reader;
grant select on table public.pricing_daily to pricing_reader;

drop policy if exists pricing_daily_read_server on public.pricing_daily;
create policy pricing_daily_read_server on public.pricing_daily
  for select to pricing_reader
  using (true);
