-- Export copy: receive addresses in this file are placeholders; deployments configure their own.
-- Solana USDC rail (x402 "exact" on SVM): widen the tx-id / payer / network / pay_to checks so a
-- Solana settlement can be stored, network-aware. the operator approved widening the prod payment tables
-- (2026-10-17) AFTER security review.
--
-- ADDITIVE ONLY: every rule that applied to Base rows (eip155:84532 / eip155:8453) is unchanged,
-- byte for byte; Solana rows get their own branch. Every existing row passes (they are all Base
-- with lowercase 0x hex), and the re-added checks are VALIDATED against existing rows here.
-- Tables touched: rental_x402_settlements, rental_refunds (+1 nullable column), rental_test_orders.
-- Nothing else; pricing_daily untouched. No row is written or deleted. UNIQUE (tx_hash) and
-- UNIQUE (payout_tx_hash) stay as they are, across both networks.
--
-- Solana formats: transaction signature = base58 of 64 bytes (64-88 chars; we store what the
-- facilitator returns, case-sensitive); payer / pay_to = base58 public key (32-44 chars).
-- Networks (CAIP-2): solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp (mainnet),
--                    solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 (devnet, staging only).
-- rental_test_orders (the one-time $1 test): pay_to stays pinned per network: Base = the operator's 0xAe80..
-- (unchanged), Solana = the operator's 11111111111111111111111111111111. amount stays 1000000.
-- rental_refunds: new nullable payout_network. NULL = Base (every existing row, and the current
-- manual payout flow), so the old 0x rule still applies to them. A Solana payout must set it.
-- (Both branches coalesce payout_network: a bare NULL there would make the OR evaluate to NULL and
-- a CHECK passes on NULL, letting a base58 hash through with no network. Caught on staging.)
--
-- Apply: staging project first. Production project ONLY by the operator after
-- Review PASS. Apply ONLY via `supabase db push` or the apply_migration tool (one transaction:
-- drop + add of a check is atomic, so there is never a moment with no check).
-- Rollback: supabase/rollback/20261017120000_phase2_solana_tx_ids_rollback.sql (refuses to run if
-- any Solana row exists).
-- No IF EXISTS on the drops on purpose: a wrong name fails loudly. Names confirmed read-only
-- (pg_constraint) on staging and prod, 2026-10-17.
set local lock_timeout = '5s';

-- rental_x402_settlements
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_network_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_network_check
  check (network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_payer_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_payer_check
  check ((network in ('eip155:84532','eip155:8453') and payer ~ '^0x[0-9a-fA-F]{40}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'));
alter table public.rental_x402_settlements drop constraint rental_x402_settlements_tx_hash_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_tx_hash_check
  check ((network in ('eip155:84532','eip155:8453') and tx_hash ~ '^0x[0-9a-f]{64}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'));

-- rental_refunds (manual payouts only; never automatic)
alter table public.rental_refunds add column payout_network text
  constraint rental_refunds_payout_network_check
  check (payout_network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
alter table public.rental_refunds drop constraint rental_refunds_payout_tx_hash_check;
alter table public.rental_refunds add constraint rental_refunds_payout_tx_hash_check
  check ((coalesce(payout_network, 'eip155:8453') in ('eip155:84532','eip155:8453') and payout_tx_hash ~ '^0x[0-9a-f]{64}$')
      or (coalesce(payout_network, '') in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and payout_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'));

-- rental_test_orders (one row forever, id = 1)
alter table public.rental_test_orders drop constraint rental_test_orders_network_check;
alter table public.rental_test_orders add constraint rental_test_orders_network_check
  check (network in ('eip155:84532','eip155:8453','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
alter table public.rental_test_orders drop constraint rental_test_orders_pay_to_check;
alter table public.rental_test_orders add constraint rental_test_orders_pay_to_check
  check ((network in ('eip155:84532','eip155:8453') and lower(pay_to) = lower('0x0000000000000000000000000000000000000000'))
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and pay_to = '11111111111111111111111111111111'));
alter table public.rental_test_orders drop constraint rental_test_orders_tx_hash_check;
alter table public.rental_test_orders add constraint rental_test_orders_tx_hash_check
  check ((network in ('eip155:84532','eip155:8453') and tx_hash ~ '^0x[0-9a-f]{64}$')
      or (network in ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1','solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') and tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'));
