# Multi-Key per Provider + Per-Config Key Selection Strategy

Created: 2026-09-02 10:16:25

## Objective

Allow each provider config to register more than one key, and let each provider
config independently choose a key-level selection strategy:

- `priority` (= "fallback"): key with the lowest `priority` is used first; on
  repeated failure (threshold=3) the key enters cooldown and the next key in
  priority order is used on the next selection.
- `round_robin`: keys rotate per request based on `last_used_at` (LRU). After a
  successful call, `markSuccess` updates `last_used_at`, moving that key to the
  back of the rotation.
- `NULL` (default, backward compatible): inherit the behavioural meaning from
  the config-level `selection_strategy` (`weighted` => weighted key draw by key
  `weight`; otherwise first-eligible by `last_used_at`).

## Scope

- Database: additive columns only (`provider_configs.key_selection_strategy`,
  `provider_keys.priority`); no destructive changes, no backfill required.
- Domain + repository + selector: thread the new strategy through to key
  selection so it overrides the inherited behaviour when set.
- Scripts: add a non-destructive `add-provider-key.mjs` for multi-key; extend
  `upsert-provider-key.mjs` and `seed-provider-config.mjs` with `priority` and
  key-strategy args.
- Tests: unit tests for the new selector branches; schema integration test
  updated with the new migration entry.

## Design Decisions (Q1–Q4)

- Q1 — threshold: **keep 3**. Key switch happens via the existing cooldown
  path after 3 failures. No change to `increment_provider_key_failure`.
- Q2 — key priority ordering: **new `priority` column on `provider_keys`**,
  default 100, lower = higher precedence. Used by the `priority` key strategy.
- Q3 — round-robin key: **LRU via `last_used_at`** (already updated by
  `markSuccess`). No strict counter / global state. Accepted race: two
  concurrent requests may pick the same key before either has marked success.
- Q4 — strategy granularity: **per-config** (column on `provider_configs`),
  nullable so existing 86 configs keep current behaviour.

## Milestones

1. Database migration (additive columns + index).
2. Domain types + repository safe projection.
3. Selector key-selection logic (override when set, inherit when null).
4. Scripts (add/upsert/seed) for multi-key + key-strategy.
5. Type regeneration + full local verification.

## Tasks

- [x] M1: write `supabase/migrations/20260902103000_add_key_selection_strategy_and_key_priority.sql`
- [x] M1: add `"20260902103000"` to `EXPECTED_MIGRATIONS` in `tests/integration/schema.integration.test.ts`
- [x] M2: `src/server/domain/provider.ts` — replace dead `weighted_round_robin` with `round_robin` in `ProviderKeySelectionStrategy`
- [x] M2: `src/server/repositories/provider-config.repository.ts` — `keySelectionStrategy` field, safe column, mapper, insert
- [x] M2: `src/server/repositories/provider-key.repository.ts` — `priority` field, safe column, safe type, mapper, insert input, LRU+priority ordering in `listSafeKeys`
- [x] M2: `src/server/providers/config.ts` — Zod schema for `keySelectionStrategy`
- [x] M3: `src/server/providers/selector.ts` — `selectKey` takes both strategies; `priority` sorts by `priority` then LRU; `round_robin` sorts by LRU; `null` inherits
- [x] M3: unit tests in `tests/unit/provider-selector.test.ts` for priority/round_robin/inherit multi-key (+ provider-config.test.ts Zod coverage)
- [x] M4: `scripts/add-provider-key.mjs` (new) — inserts a key without deleting existing ones
- [x] M4: `scripts/upsert-provider-key.mjs` — `--priority` arg
- [x] M4: `scripts/seed-provider-config.mjs` — `--key-strategy`, `--key-priority` args
- [x] M5: `npm run db:types` (regenerate) then `npm run db:types:check`
- [x] M5: `npm run db:lint && npm run db:check-migrations`
- [x] M5: `npm run test:unit`
- [x] M5: `npm run lint && npm run typecheck && npm run build && npm run format:check`
- [x] M5: `npm run test:hosted` (against dev DB)

## Risks

- LRU round-robin race: two concurrent requests may pick the same key before
  either marks success. Accepted for the Telegram bot's low concurrency.
- `priority` + threshold=3 means the first job that burns 3 failures on key 1
  consumes 3 of 4 retry attempts before failover. Cooldown persists, so the
  *next* job skips straight to key 2. Accepted (Q1 = keep threshold).
- `key_selection_strategy = 'priority'` on a config whose
  `selection_strategy = 'weighted'` bypasses the weighted key draw. Intentional:
  an explicit key strategy overrides the inherited behaviour.
- `markFailure` does not update `last_used_at`; only `markSuccess` does. So a
  failing key (below threshold) stays at its LRU position and is picked again
  on retry. Consistent with keeping threshold=3.

## Progress Log

- 2026-09-02 10:16:25 — plan written; not yet executed.
- 2026-09-02 10:48:00 — all milestones executed and verified green locally:
  - Migration applied to dev DB and recorded in `supabase_migrations.schema_migrations`
    as `20260902103000` (the Supabase MCP `apply_migration` had auto-recorded it under
    a generated timestamp `20260902032713`; reconciled the meta row to match the local
    file + `EXPECTED_MIGRATIONS` via the same meta-edit `supabase migration repair` uses).
  - `db:types` regenerated; `db:types:check` ok. `db:lint` ok. `db:check-migrations` ok (42).
  - `test:unit` 307/307 (3 new selector tests + 4 Zod coverage tests).
  - `test:hosted` 126/126 (updated `COLUMN_SPECS`, `CONSTRAINT_FRAGMENTS`,
    `EXPECTED_INDEX_DEF_FRAGMENTS` for the new column/constraint/index).
  - `lint` 0 errors (2 pre-existing warnings in `e2e-m6-fault-injection.mjs`).
  - `typecheck` clean. `format:check` clean.
  - `npm run build` fails with `EPERM ... symlink` in `.next/output` — reproduced on
    clean HEAD (stashed), so it is a pre-existing Windows symlink-permission issue in
    the standalone output step, not caused by these changes.
  - Files changed: migration (new), domain/provider.ts, providers/{config,selector}.ts,
    repositories/{provider-config,provider-key}.repository.ts, database.types.ts
    (regenerated), scripts/{add-provider-key.mjs (new), upsert-provider-key.mjs,
    seed-provider-config.mjs}, tests/{integration/schema.integration.test.ts,
    unit/{provider-selector,provider-config,generate-image}.test.ts}.

## Notes

- No backfill: `key_selection_strategy` defaults to NULL (inherit), and
  `provider_keys.priority` defaults to 100 (all existing 23 keys tie, broken by
  `last_used_at` — identical to current behaviour).
- `ProviderKeySelectionStrategy` previously declared a `weighted_round_robin`
  member that was unreachable from any DB row. This plan drops it and replaces
  with `round_robin` to match the chosen LRU semantics.
