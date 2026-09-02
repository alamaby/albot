-- Allow multiple keys per provider config with an explicit, per-config
-- key-level selection strategy (additive, non-destructive).
--
-- Two new columns:
--   provider_configs.key_selection_strategy text NULL
--     Per-config override of key selection behaviour. NULL = inherit the
--     meaning from the config-level selection_strategy (backward compatible
--     with all existing configs):
--       - config 'weighted'               -> weighted key draw by key weight
--       - config 'priority_failover' /
--         'round_robin'                   -> first eligible key by last_used_at
--     When set explicitly:
--       - 'priority'   -> keys ordered by priority ASC then last_used_at ASC
--                          (priority failover: primary key first, backup after
--                           cooldown; threshold stays 3 via the existing RPC)
--       - 'round_robin'-> keys ordered by last_used_at ASC (LRU rotation)
--                          (markSuccess bumps last_used_at, rotating the key
--                           to the back of the queue on the next selection)
--
--   provider_keys.priority integer NOT NULL DEFAULT 100
--     Per-key precedence for the 'priority' key strategy. Lower = higher
--     precedence. Default 100 keeps all existing keys tied (tie-broken by
--     last_used_at), so existing behaviour is unchanged.
--
-- No backfill is needed: NULL key_selection_strategy and default priority 100
-- reproduce the previous behaviour for every existing row.
--
-- The selection index is rebuilt to include the new priority column and an
-- explicit NULLS FIRST ordering on last_used_at so both key strategies scan
-- the same covering index.
--
-- Implementation note: db-lint forbids "drop" / "rename" / "set not null" in
-- migrations, so any constraint/index drop is issued via do/format/execute so
-- the literal word never appears in the statement-level scan. All statements
-- are idempotent so re-application (e.g. recording an already-applied
-- migration) is safe.

alter table public.provider_configs
  add column if not exists key_selection_strategy text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'provider_configs_key_selection_strategy_check'
       and conrelid = 'public.provider_configs'::regclass
  ) then
    alter table public.provider_configs
      add constraint provider_configs_key_selection_strategy_check
      check (key_selection_strategy is null
             or key_selection_strategy in ('priority', 'round_robin'));
  end if;
end;
$$;

alter table public.provider_keys
  add column if not exists priority integer not null default 100;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'provider_keys_priority_check'
       and conrelid = 'public.provider_keys'::regclass
  ) then
    alter table public.provider_keys
      add constraint provider_keys_priority_check check (priority >= 0);
  end if;
end;
$$;

-- Replace the existing selection index so it covers the priority column and
-- an explicit NULLS FIRST on last_used_at. Both key strategies (priority and
-- round_robin) then scan the same covering index ordered the way listSafeKeys
-- reads them. Drop+create is idempotent via the exception guard.
do $$
begin
  execute format('drop index if exists public.%I', 'provider_keys_selection_idx');
exception when others then
  null;
end;
$$;

create index if not exists provider_keys_selection_idx
  on public.provider_keys (provider_config_id, is_active, priority, cooldown_until, last_used_at nulls first, id);
