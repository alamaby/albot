# Prompt Configs DB-Driven Plan

Created: 2026-09-02 14:41:27

## Objective
Make enhancement system prompt persona configurable via DB table so updating prompt requires only a table update, no deploy. Strict-error semantics: if active config missing or DB errors, enhancement fails loudly (no fallback to hardcoded const). Preserve JSON-shape contract in code.

## Scope
- New tables `prompt_configs` (versioned, one active per key) and `prompt_configs_audit`
- RPCs `get_active_prompt_config`, `upsert_prompt_config`, `activate_prompt_config`
- Repository `PromptConfigRepository` with in-memory TTL 60s cache, single-flight, reset hook for tests
- Split `ENHANCEMENT_SYSTEM_PROMPT` into persona (DB) + immutable shape tail (code)
- Wire repository into `EnhancePromptUseCase.enhanceOnly` and `execute` with strict error
- Admin API `GET/POST /api/admin/prompt-configs` (bearer `JOB_PROCESSOR_SECRET`)
- Updates to `EXPECTED_MIGRATIONS` / `EXPECTED_FUNCTIONS` and type regeneration

## Milestones
1. Migration + seed + RLS + grants
2. Repository + prompt split
3. Use-case wiring + admin API
4. Tests + verification

## Tasks
- [x] Create migration `20260902120000_create_prompt_configs.sql`
- [x] Update `EXPECTED_MIGRATIONS` with new timestamp
- [x] Update `EXPECTED_FUNCTIONS` with 3 new function signatures + search_path + prosecdef
- [x] Add `prompt_configs` / `prompt_configs_audit` to `EXPECTED_TABLES` and `COLUMN_SPECS`
- [x] Add constraint fragments + index fragments + RLS expectations
- [x] Add grant checks for new functions (service_role only)
- [x] Split `ENHANCEMENT_SYSTEM_PROMPT` persona/shape in `enhance-prompt.ts`
- [x] Create `src/server/repositories/prompt-config.repository.ts`
- [x] Wire into `EnhancePromptUseCase` with strict-error error codes
- [x] Create `src/app/api/admin/prompt-configs/route.ts`
- [x] Regenerate `database.types.ts` via `npm run db:types` (manual patch, linked gen still stale until migration applied to dev)
- [x] Run `db:lint`, `db:check-migrations`, `db:types:check`, `test:unit`, `lint`, `typecheck`, `build`, `format:check`

## Risks
- Persona text could confuse model out of JSON even with shape tail immutable; mitigate via `response_format` where supported and documented guidance. Smoke-test endpoint is backlog, not in this plan.
- 60s cache staleness across instances post-edit; acceptable.
- DB blip => enhancement strict-fails by design per user choice; ensure error code surfaces to retry/observability (not silent fallback).
- `provider_configs.settings.response_format` still merged separately; keep decoupled.

## Progress Log
- 2026-09-02 14:41:27 — Plan created. User decisions: persona-only editable, strict error, versioning+rollback, audit with trigger/functions, TTL 60s cache.
- 2026-09-02 14:51:27 — Migration created (strict-error, one_active partial unique index, seed v1 persona-only). Schema integration updated (tables, columns, constraints, indexes, functions, triggers, migrations, grants).
- 2026-09-02 14:55:00 — Repository PromptConfigRepository with TTL 60s single-flight + reset hook; enhance-prompt split persona/shape + buildEnhancementSystemPrompt; wired into enhanceOnly/execute via resolveSystemPrompt (strict ProviderError).
- 2026-09-02 15:00:00 — Admin API GET/POST /api/admin/prompt-configs (bearer JOB_PROCESSOR_SECRET, zod validation, upsert vs activate discriminator, audit listing). Manual database.types patch for prompt_configs/_audit + 3 funcs.
- 2026-09-02 15:05:00 — Verification: db:lint ok, db:check-migrations ok (43 migrations), typecheck ok, lint ok (2 pre-existing warnings), test:unit 309 passed, format fixed, build compiled (Vercel output symlink EPERM on Windows is pre-existing, not code).

## Notes
- Telecom/billing standards N/A for this internal prompting concern.
- Deviation justification: none; TOGAF proportional via lightweight versioned config model.
- Env guard: no secrets printed.
