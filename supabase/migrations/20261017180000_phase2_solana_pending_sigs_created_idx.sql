-- #103 N2: index for the unresolved-pending list (rental_list_unresolved_pending orders by created_at, tx_hash).
-- ADDITIVE ONLY: one index, nothing else changes; pricing_daily untouched. Staging project first; production
-- project only after security review PASS and the operator's yes, and only AFTER 20261017170000.
-- Rollback: supabase/rollback/20261017180000_phase2_solana_pending_sigs_created_idx_rollback.sql.
set local lock_timeout = '5s';
create index if not exists rental_x402_pending_sigs_created_idx on public.rental_x402_pending_sigs (created_at, tx_hash);
