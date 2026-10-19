-- USDC on Ethereum (ERC-20) direct-transfer rail (human checkout only). ADDITIVE ONLY. pricing_daily untouched.
-- Staging project only for now. Production project ONLY after security review PASS and the operator's yes.
-- Rollback: supabase/rollback/20261017210000_phase2_eth_usdc_rollback.sql (not a migration; refuses if any Ethereum row exists).
--
-- 1. Widens the network-aware checks so an Ethereum settlement / refund can be stored: adds eip155:1 (mainnet) and
--    eip155:11155111 (Sepolia, staging) as EVM networks. Every rule that applied to existing rows is unchanged
--    (same pattern as 20261017120000). The refund lists are written as a SUPERSET that already includes the bip122
--    values from PR #107 (20261017190000), so this file is correct whether or not #107's migration ran first.
--    If #107's migration is applied AFTER this one, it must carry 'eip155:1','eip155:11155111' too (see PR notes).
-- 2. A refund of an Ethereum settlement can only be marked paid with payout_network = that same network.
-- 3. New tables rental_eth_quotes (one per order, unique tag), rental_eth_claims (customer tx hashes, keyed by tx_hash),
--    rental_eth_claim_resolutions (append-only), and four SECURITY DEFINER RPCs (service_role only, search_path='').
-- One transaction (apply_migration / db push): each drop + add of a check is atomic.
set local lock_timeout = '5s';

-- 1a. rental_x402_settlements
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_network_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_network_check
  check (network in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_payer_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_payer_check
  check ((network in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111') and payer ~ '^0x[0-9a-fA-F]{40}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_tx_hash_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_tx_hash_check
  check ((network in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111') and tx_hash ~ '^0x[0-9a-f]{64}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'));

-- 1b. rental_refunds (manual payouts only; never automatic)
alter table public.rental_refunds drop constraint rental_refunds_refund_network_check;
alter table public.rental_refunds add constraint rental_refunds_refund_network_check
  check (refund_network in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
                            'bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c'));
alter table public.rental_refunds drop constraint rental_refunds_payout_network_check;
alter table public.rental_refunds add constraint rental_refunds_payout_network_check
  check (payout_network in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
                            'bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c'));
alter table public.rental_refunds drop constraint rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check
  check ((coalesce(payout_network, 'eip155:8453') in ('eip155:84532','eip155:8453','eip155:1','eip155:11155111') and payout_tx_hash ~ '^0x[0-9a-f]{64}$')
      or (coalesce(payout_network, '') in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payout_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$')
      or (coalesce(payout_network, '') in ('bip122:000000000019d6689c085ae165831e93','bip122:00000008819873e925422c1ff0f99f7c') and payout_tx_hash ~ '^[0-9a-f]{64}$'));
-- 2. New, separate rule (existing rows have no Ethereum refund_network, so they pass).
alter table public.rental_refunds add constraint rental_refunds_eth_payout_same_network
  check (status <> 'paid' or refund_network is null or refund_network not in ('eip155:1','eip155:11155111')
      or (payout_network is not null and payout_network = refund_network));

-- 3a. Quotes: one per order. tag = whole cents (1..99) added to the order price; amount unique per network while reserved.
create table if not exists public.rental_eth_quotes (
  provider_ref text primary key references public.rental_payment_bindings(provider_ref) check (provider_ref ~ '^eth_[0-9a-f]{32}$'),
  order_id uuid not null unique references public.rental_orders(id),
  network text not null check (network in ('eip155:1','eip155:11155111')),
  pay_to text not null check (pay_to ~ '^0x[0-9a-fA-F]{40}$'),
  asset text not null check ((network = 'eip155:1' and asset = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
                          or (network = 'eip155:11155111' and asset = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')),
  base_atomic bigint not null check (base_atomic > 0),
  tag int not null check (tag between 1 and 99),
  amount_atomic bigint not null check (amount_atomic = base_atomic + tag * 10000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reserved_until timestamptz not null check (reserved_until >= expires_at)
);
create index if not exists rental_eth_quotes_amount_idx on public.rental_eth_quotes (network, amount_atomic, reserved_until);
alter table public.rental_eth_quotes enable row level security;
revoke all on public.rental_eth_quotes from anon, authenticated, public;
drop trigger if exists rental_eth_quotes_ro on public.rental_eth_quotes;
create trigger rental_eth_quotes_ro before update or delete on public.rental_eth_quotes for each row execute function public.rental_no_update();

-- 3b. Claims: a tx that paid payTo the exact quoted amount inside the window, not final yet. Never money by itself.
create table if not exists public.rental_eth_claims (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  provider_ref text not null references public.rental_eth_quotes(provider_ref),
  network text not null check (network in ('eip155:1','eip155:11155111')),
  payer text not null check (payer ~ '^0x[0-9a-f]{40}$'),
  log_index int not null check (log_index >= 0),
  amount_atomic bigint not null check (amount_atomic > 0),
  block_number bigint not null check (block_number > 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_time timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists rental_eth_claims_ref_idx on public.rental_eth_claims (provider_ref);
create index if not exists rental_eth_claims_created_idx on public.rental_eth_claims (created_at, tx_hash);
alter table public.rental_eth_claims enable row level security;
revoke all on public.rental_eth_claims from anon, authenticated, public;
drop trigger if exists rental_eth_claims_ro on public.rental_eth_claims;
create trigger rental_eth_claims_ro before update or delete on public.rental_eth_claims for each row execute function public.rental_no_update();

-- 3c. Append-only outcomes. Terminal: settled, dropped, failed_onchain, lost_race (one per tx).
create table if not exists public.rental_eth_claim_resolutions (
  id bigserial primary key,
  tx_hash text not null references public.rental_eth_claims(tx_hash),
  outcome text not null check (outcome in ('settled','dropped','failed_onchain','lost_race','alerted','manual_review')),
  detail text check (detail ~ '^[a-z_]{1,40}$'),
  at timestamptz not null default now(),
  unique (tx_hash, outcome)
);
alter table public.rental_eth_claim_resolutions enable row level security;
revoke all on public.rental_eth_claim_resolutions from anon, authenticated, public;
revoke all on sequence public.rental_eth_claim_resolutions_id_seq from anon, authenticated, public;
drop trigger if exists rental_eth_claim_resolutions_ro on public.rental_eth_claim_resolutions;
create trigger rental_eth_claim_resolutions_ro before update or delete on public.rental_eth_claim_resolutions for each row execute function public.rental_no_update();
create unique index if not exists rental_eth_claim_resolutions_one_terminal on public.rental_eth_claim_resolutions (tx_hash)
  where outcome in ('settled','dropped','failed_onchain','lost_race');

-- Bind: lock the order, return its existing quote, or pick the lowest free tag under an advisory lock and insert the
-- payment binding + quote in this one transaction.
create or replace function public.rental_eth_bind(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  oid uuid := (p->>'order_id')::uuid;
  st text;
  q public.rental_eth_quotes;
  base bigint := (p->>'base_atomic')::bigint;
  t int;
  amt bigint;
begin
  select o.state into st from public.rental_orders o where o.id = oid for update;
  select * into q from public.rental_eth_quotes where order_id = oid;
  if found then return jsonb_build_object('ok', true, 'created', false, 'quote', to_jsonb(q)); end if;
  if st is distinct from 'awaiting_payment' then return jsonb_build_object('ok', false, 'error', 'order_not_payable'); end if;
  perform pg_advisory_xact_lock(hashtext('rental_eth_tags'));
  for t in 1..99 loop
    amt := base + t * 10000;
    if not exists (select 1 from public.rental_eth_quotes x where x.network = p->>'network' and x.amount_atomic = amt and x.reserved_until > now()) then
      insert into public.rental_payment_bindings (provider_ref, order_id, kind, expected_atomic, extend_days, expires_at, challenge)
      values (p->>'provider_ref', oid, 'initial', amt, null, (p->>'expires_at')::timestamptz,
              jsonb_set(jsonb_set(p->'challenge', '{eth,amount}', to_jsonb(amt::text)), '{eth,tag}', to_jsonb(t)));
      insert into public.rental_eth_quotes (provider_ref, order_id, network, pay_to, asset, base_atomic, tag, amount_atomic, expires_at, reserved_until)
      values (p->>'provider_ref', oid, p->>'network', p->>'pay_to', p->>'asset', base, t, amt, (p->>'expires_at')::timestamptz, (p->>'reserved_until')::timestamptz)
      returning * into q;
      return jsonb_build_object('ok', true, 'created', true, 'quote', to_jsonb(q));
    end if;
  end loop;
  return jsonb_build_object('ok', false, 'error', 'tags_exhausted');
end $$;
revoke all on function public.rental_eth_bind(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_bind(jsonb) to service_role;

-- Insert-or-get by tx_hash; returns the stored row (which may belong to another ref: the app refuses then).
create or replace function public.rental_eth_record_claim(c jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare r public.rental_eth_claims;
begin
  insert into public.rental_eth_claims (tx_hash, provider_ref, network, payer, log_index, amount_atomic, block_number, block_hash, block_time, created_at)
  values (c->>'tx_hash', c->>'provider_ref', c->>'network', lower(c->>'payer'), (c->>'log_index')::int, (c->>'amount_atomic')::bigint,
          (c->>'block_number')::bigint, c->>'block_hash', (c->>'block_time')::timestamptz, coalesce((c->>'created_at')::timestamptz, now()))
  on conflict (tx_hash) do nothing;
  select * into r from public.rental_eth_claims where tx_hash = c->>'tx_hash';
  return jsonb_build_object('claim', to_jsonb(r) || jsonb_build_object('outcomes',
    coalesce((select jsonb_agg(x.outcome order by x.id) from public.rental_eth_claim_resolutions x where x.tx_hash = r.tx_hash), '[]'::jsonb)));
end $$;
revoke all on function public.rental_eth_record_claim(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_record_claim(jsonb) to service_role;

create or replace function public.rental_eth_record_resolution(r jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  if r->>'outcome' in ('settled','dropped','failed_onchain','lost_race') and exists (
       select 1 from public.rental_eth_claim_resolutions x
       where x.tx_hash = r->>'tx_hash' and x.outcome in ('settled','dropped','failed_onchain','lost_race') and x.outcome <> r->>'outcome') then
    raise exception 'eth_resolution_conflict';
  end if;
  insert into public.rental_eth_claim_resolutions (tx_hash, outcome, detail, at)
  values (r->>'tx_hash', r->>'outcome', nullif(r->>'detail', ''), coalesce((r->>'at')::timestamptz, now()))
  on conflict (tx_hash, outcome) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rental_eth_record_resolution(jsonb) from public, anon, authenticated;
grant execute on function public.rental_eth_record_resolution(jsonb) to service_role;

-- Claims list (oldest first, capped at 200, plus the total). p_all=false: unresolved only (no terminal outcome).
-- p_limit = 0 returns only the total (schema probe).
create or replace function public.rental_eth_list_claims(p_ref text default null, p_limit integer default 200, p_all boolean default false) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with u as (
    select c.* from public.rental_eth_claims c
    where (p_ref is null or c.provider_ref = p_ref)
      and (p_all or not exists (select 1 from public.rental_eth_claim_resolutions r
                                where r.tx_hash = c.tx_hash and r.outcome in ('settled','dropped','failed_onchain','lost_race')))
  ), page as (select * from u order by created_at, tx_hash limit greatest(0, least(coalesce(p_limit, 200), 200)))
  select jsonb_build_object('total', (select count(*) from u),
    'rows', coalesce((select jsonb_agg(to_jsonb(pg) || jsonb_build_object('outcomes',
        coalesce((select jsonb_agg(r.outcome order by r.id) from public.rental_eth_claim_resolutions r where r.tx_hash = pg.tx_hash), '[]'::jsonb))
      order by pg.created_at, pg.tx_hash) from page pg), '[]'::jsonb));
$$;
revoke all on function public.rental_eth_list_claims(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.rental_eth_list_claims(text, integer, boolean) to service_role;
