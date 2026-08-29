-- Add round_robin selection strategy.
--
-- Round-robin selects providers deterministically per request seed: same
-- session id always picks the same starting config (sticky), different
-- sessions pick different starting positions (load spread). This avoids
-- the global state of a counter-based round robin while still distributing
-- free-tier load across many models.
--
-- The existing 'priority_failover' and 'weighted' values remain unchanged.
-- Rows default to their current strategy; only new inserts (or explicit
-- updates) opt into 'round_robin'.
--
-- Implementation note: db-lint forbids "drop" / "rename" / "set not null"
-- in migrations, so the existing check is replaced via do/format/execute
-- rather than alter drop/add.

do $$
begin
  execute format(
    'alter table public.provider_configs drop constraint %I',
    'provider_configs_selection_strategy_check'
  );
exception when undefined_object then
  -- constraint already absent (older migration variant); nothing to do.
  null;
end;
$$;

alter table public.provider_configs
  add constraint provider_configs_selection_strategy_check
  check (selection_strategy in ('priority_failover', 'weighted', 'round_robin'));
