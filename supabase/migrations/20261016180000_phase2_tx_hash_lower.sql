-- Job schema rev 1.5 (STAGING ONLY, staging project; never the production project).
-- Settlement tx hashes are stored lowercase and stay unique, so one on-chain
-- transaction can never pay (or be signed into a job for) two refs.
alter table public.rental_x402_settlements drop constraint if exists rental_x402_settlements_tx_hash_check;
alter table public.rental_x402_settlements add constraint rental_x402_settlements_tx_hash_check check (tx_hash ~ '^0x[0-9a-f]{64}$');
create unique index if not exists rental_x402_settlements_tx_hash_key on public.rental_x402_settlements (tx_hash);
