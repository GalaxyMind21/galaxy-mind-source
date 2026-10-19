-- Manual refund payout record (operator pays from Coinbase after approving). Never automatic.
alter table public.rental_refunds add column if not exists payout_tx_hash text unique check (payout_tx_hash ~ '^0x[0-9a-f]{64}$');
alter table public.rental_refunds add column if not exists approved_at timestamptz;
alter table public.rental_refunds add column if not exists paid_at timestamptz;
alter table public.rental_refunds drop constraint if exists rental_refunds_paid_has_tx;
alter table public.rental_refunds add constraint rental_refunds_paid_has_tx check (status <> 'paid' or (payout_tx_hash is not null and paid_at is not null)) not valid;
