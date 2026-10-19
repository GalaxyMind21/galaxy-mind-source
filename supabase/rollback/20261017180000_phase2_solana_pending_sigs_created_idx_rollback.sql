-- Rollback of 20261017180000_phase2_solana_pending_sigs_created_idx.sql. Drops the index only (no data touched).
set local lock_timeout = '5s';
drop index if exists public.rental_x402_pending_sigs_created_idx;
