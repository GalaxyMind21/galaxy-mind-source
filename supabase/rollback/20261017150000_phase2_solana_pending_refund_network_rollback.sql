-- Rollback of 20261017150000_phase2_solana_pending_refund_network.sql. Refuses if a pending Solana signature or a
-- Solana refund exists (dropping them would lose the only record of money that moved).
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.rental_x402_pending)
     or exists (select 1 from public.rental_refunds where refund_network like 'solana:%') then
    raise exception 'rollback refused: Solana pending settlements or Solana refunds exist; resolve them by hand first';
  end if;
end $$;
alter table public.rental_refunds drop constraint rental_refunds_payout_matches_settlement;
drop trigger rental_refunds_fill_network on public.rental_refunds;
drop function public.rental_refunds_fill_network();
alter table public.rental_refunds drop column refund_network;
drop function public.rental_record_x402_pending(jsonb);
drop table public.rental_x402_pending;
