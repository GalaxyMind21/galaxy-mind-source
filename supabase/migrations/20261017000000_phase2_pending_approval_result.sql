-- Outside pools (2026-10-16): allow the node's optional, NON-FINAL result row
-- result = 'pending_approval' (reason pool_not_in_catalog | port_not_listed) while a
-- custom-pool order waits for the owner's approval. Additive only: the allowed set
-- is widened, nothing existing is changed or removed. No other table is touched
-- (pricing_daily untouched).
-- NOT APPLIED anywhere by this PR. Staging project first; production
-- project only with the operator's go. Until it is applied, a node insert
-- of 'pending_approval' fails the check (the node ignores that failure).
-- The site treats 'pending_approval' as non-final: reofferOrExpire only stops on
-- 'applied' / 'delivered', and a held order gets 2 h 15 min from settlement.
-- Apply ONLY via `supabase db push` or the apply_migration tool: SET LOCAL below needs the
-- migration's transaction (outside one it only warns and the lock timeout is lost).
-- Rollback: delete from public.rental_job_results where result = 'pending_approval';
-- then drop rental_job_results_result_check and re-add the 4-value check
-- (result in ('applied','rejected','reverted','delivered')).
-- No IF EXISTS on purpose: a wrong name must fail loudly instead of leaving the old
-- check in place next to the new one. Name confirmed read-only (pg_constraint) on
-- staging and prod, 2026-10-16. Short lock timeout: never queue behind a long lock.
set local lock_timeout = '5s';
alter table public.rental_job_results drop constraint rental_job_results_result_check;
alter table public.rental_job_results add constraint rental_job_results_result_check
  check (result in ('applied','rejected','reverted','delivered','pending_approval'));
