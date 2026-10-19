-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- Harden test-order SECURITY DEFINER functions: empty search_path (all names are schema-qualified).
-- Issue (or re-issue while unpaid and expired) the single test challenge.
create or replace function public.rental_test_order_issue(r jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.rental_test_orders;
begin
  select * into cur from public.rental_test_orders where id = 1 for update;
  if found then
    if cur.tx_hash is not null then return jsonb_build_object('status','used'); end if;
    if cur.expires_at > now() then return jsonb_build_object('status','open','row',to_jsonb(cur)); end if;
    update public.rental_test_orders set provider_ref = r->>'provider_ref', network = r->>'network', requirements = r->'requirements',
      expires_at = (r->>'expires_at')::timestamptz where id = 1 and tx_hash is null returning * into cur;
    return jsonb_build_object('status','open','row',to_jsonb(cur));
  end if;
  insert into public.rental_test_orders (id, provider_ref, network, amount_atomic, pay_to, requirements, expires_at)
  values (1, r->>'provider_ref', r->>'network', (r->>'amount_atomic')::bigint, r->>'pay_to', r->'requirements', (r->>'expires_at')::timestamptz)
  returning * into cur;
  return jsonb_build_object('status','open','row',to_jsonb(cur));
end $$;

-- Record the settlement once. A second settle (or another ref) is refused.
create or replace function public.rental_test_order_settle(r jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.rental_test_orders set tx_hash = r->>'tx_hash', payer = r->>'payer', settled_at = now()
   where id = 1 and tx_hash is null and provider_ref = r->>'provider_ref';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $$;
revoke all on function public.rental_test_order_issue(jsonb) from public, anon, authenticated;
revoke all on function public.rental_test_order_settle(jsonb) from public, anon, authenticated;
grant execute on function public.rental_test_order_issue(jsonb) to service_role;
grant execute on function public.rental_test_order_settle(jsonb) to service_role;

-- Staging check before validating: 0 rows with status='paid' lacking payout_tx_hash/paid_at (2 rows, all pending_owner).
alter table public.rental_refunds validate constraint rental_refunds_paid_has_tx;
