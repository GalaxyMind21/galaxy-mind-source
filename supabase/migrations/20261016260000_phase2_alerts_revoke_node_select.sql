-- Export copy: role, policy and status names here are the neutral ones (gm_node, node_*, node_hold, pending_owner); the original deployment reached them through a later rename migration.
-- The node relays alerts only through rental_alerts_pending / rental_alerts_mark_forwarded
-- (poller: "RPCs only, gm_node has no table grant"). Drop its direct table access.
revoke all on table public.rental_alerts from gm_node;
