-- Export copy: receive addresses in this file are placeholders; deployments configure their own.
-- One-time $1 x402 test order (operator-approved). Single row forever (id = 1), exactly 1.000000 USDC,
-- payTo pinned, tx_hash unique + lowercase. No rental order, no job, no rig delivery.
create table if not exists public.rental_test_orders (
  id smallint primary key default 1 check (id = 1),
  provider_ref text not null unique check (provider_ref ~ '^x402t_[0-9a-f]{32}$'),
  network text not null check (network in ('eip155:84532','eip155:8453')),
  amount_atomic bigint not null check (amount_atomic = 1000000),
  pay_to text not null check (lower(pay_to) = lower('0x0000000000000000000000000000000000000000')),
  requirements jsonb not null,
  expires_at timestamptz not null,
  tx_hash text unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  payer text,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.rental_test_orders enable row level security;
revoke all on public.rental_test_orders from public, anon, authenticated;
grant select, insert, update on public.rental_test_orders to service_role;

-- Issue (or re-issue while unpaid and expired) the single test challenge.
create or replace function public.rental_test_order_issue(r jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
language plpgsql security definer set search_path = public as $$
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
