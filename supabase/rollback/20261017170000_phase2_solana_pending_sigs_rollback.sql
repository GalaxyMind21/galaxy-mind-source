-- Rollback of 20261017170000_phase2_solana_pending_sigs.sql. Refuses if any pending signature exists (it may be the only
-- record of money that moved); resolve those by hand first.
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.rental_x402_pending_sigs) then
    raise exception 'rollback refused: Solana pending signatures exist; resolve them by hand first';
  end if;
end $$;
drop function if exists public.rental_list_unresolved_pending(text, integer);
drop function public.rental_record_pending_resolution(jsonb);
drop function public.rental_record_x402_pending_sig(jsonb);
drop index if exists public.rental_x402_pending_resolutions_one_terminal;
drop table public.rental_x402_pending_resolutions;
drop function public.rental_pending_resolution_guard();
drop table public.rental_x402_pending_sigs;
