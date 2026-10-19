-- Rollback of 20261017200000_phase2_bay_availability.sql.
-- Run only with RENTALS_AVAIL_GATE unset (the site then ignores availability) and gm-rental-poller on the node no longer reporting availability (otherwise its rental_report_bay_availability calls fail once the writer is gone).
-- Refuses if any bay_unavailable refund exists (those rows must be paid or re-labelled by hand first).
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.rental_refunds where reason = 'bay_unavailable') then
    raise exception 'bay_unavailable refunds exist; resolve them before rolling back';
  end if;
end $$;
alter table public.rental_refunds drop constraint if exists rental_refunds_reason_check;
alter table public.rental_refunds add constraint rental_refunds_reason_check
  check (reason in ('underpaid','overpaid','late','duplicate','cap_exceeded','delivery_failed','kill_switch','cancelled','expired_unapplied'));
drop trigger if exists rental_orders_bays_guard on public.rental_orders;
drop function if exists public.rental_orders_bays_guard();
drop function if exists public.rental_free_bays(int);
drop function if exists public.rental_bay_availability_read(int);
drop function if exists public.rental_report_bay_availability(jsonb);
drop table if exists public.rental_bay_availability;
