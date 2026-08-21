# Pixazo PixelForge Dev Migrate Aman — 2026-08-22

## Task / Problem

Migrate development 23/23 (Pixazo PF2 + review-fix `20260822100000/22110000`) → types drift → regen → re-migrate aman; user konfirm 2026-08-22.

## Key Files Changed

- `supabase/migrations/20260822100000_fix_callback_events_action_check.sql` + `20260822110000_fix_user_image_preferences_rls.sql` (FORCE RLS, public revoke, minimal grants, dedup FK, `model_picker_back`)
- `src/server/supabase/database.types.ts` regen via `npm run db:types` (FK `prompt_sessions_preferred_image_provider_config_id_fkey`, `isOneToOne:true`, order `user_image_preferences` setelah `provider_requests`, functions `recover/transition` include `preferred_image_provider_config_id`)
- `tests/integration/schema.integration.test.ts` FK name fix `preferred_image_provider_config_id_fkey`
- `plans/2026-08-21` + `2026-08-22` fix plan Progress Log, `TODO.md` Pending Pixazo → Completed, `.memory/README.md` current state.

## Decisions

- Forward-fix additive (bukan amend `cc4a44f`) sesuai Migration Workflow.
- `database.types.ts` patch manual → regen canonical via `supabase gen types`.

## Verification

- `migrate-development.yml` `87e23ee` 23/23 Local==Remote (user konfirm aman)
- `db:types:check` `[ok]` setelah regen
- Next: seed `pixazo_pixelforge_v2` via `seed-provider-config.mjs` + E2E Telegram hybrid picker → prod.

## Commit

- `87e23ee` `chore(types): regen database types after pixelforge migrations`

## Related

- `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md`
- `plans/2026-08-22-pixazo-pixelforge-review-fix-plan.md`
