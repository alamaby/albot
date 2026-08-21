# Pixazo PixelForge Review Fix Plan

Created: 2026-08-22

## Objective
Menutup temuan review implementasi `cc4a44f` (Pixazo PixelForge v2 + hybrid selection) agar lolos hosted `schema.integration`, RLS strict, dan retry taxonomy tanpa ubah kontrak happy-path.

## Temuan Ringkas (dari 3 agent explore)
- **HIGH C-1** `pixazo-pixelforge.adapter.ts:143` — `results[0]` null/non-object → TypeError jadi `provider_network_failed` retryable, harusnya `provider_response_invalid` non-retryable.
- **HIGH C-2** `20260821100000` constraint missing `model_picker_back` → `Kembali` gagal 23514.
- **HIGH C-3** `20260821110000` RLS hanya `ENABLE` tanpa `FORCE`, `revoke` tanpa `public`, `grant all` vs minimal, duplicate FK.
- **MEDIUM** JSON SyntaxError jadi network_failed, AbortError platform, type/size coercion string, `EXCEPTION WHEN OTHERS THEN NULL` swallow, test EXPECTED_* incompleteness, weighted duplication, `Date.now` vs injectable, parser prefix fragility.

## Scope
- Patch adapter: guards, JSON branch, AbortError name check, seed/type/size coercion, timeoutMs validate, caption metadata fix.
- Forward-fix migrations `20260822100000` + `20260822110000` (additive, via `execute` untuk lolos `db:lint`).
- Update `schema.integration.test.ts` EXPECTED_MIGRATIONS 23, CONSTRAINT 4 values, FK 3 tambahan, TRIGGER 6.
- Bersihkan parser `split(":")[0]` + length>64 guard, handle-update strict sessionId + rawData typed, state-machine rawData + unknown log + `data.length>64` guard, generate `this.now` + inactive log.
- Regen types setelah dev apply (manual patch saat ini).

Out: no schema drop/rename, no secret leak.

## Tasks
- [x] `pixazo-pixelforge.adapter.ts` — guard `first` object, JSON try/catch → `provider_response_invalid`, AbortError `name==="AbortError"`, normalizeType `String(raw)`, normalizeSize `Number(raw)`, seed integer guard, timeoutMs validate, `providerRequestId` resolved ke metadata, keyboard length guard.
- [x] `src/server/providers/index.ts` — sudah handle flattened+nested, normalize via String/Number jadi pass.
- [x] `20260822100000_fix_callback_events_action_check.sql` — `execute` drop/add dengan 4 picker values termasuk `model_picker_back`.
- [x] `20260822110000_fix_user_image_preferences_rls.sql` — drop duplicate FK, add explicit FKs, `enable+force`, `revoke public,anon,authenticated`, `grant select,insert,update,delete`.
- [x] `schema.integration.test.ts` — CONSTRAINT 6 values, FK 3, TRIGGER 6, MIGRATIONS 23.
- [x] `parser.ts` — `data.split(":")[0]` includes check + length>64.
- [x] `handle-telegram-update.ts` — strict sessionId extraction + length check.
- [x] `callback-state-machine.ts` — rawData typed, `data.length>64` guard, unknown `logStructured warn`, `keyboards.ts` length guard 64 untuk semua parse.
- [x] `generate-image.ts` — `Date.now` → `this.now`, inactive log, user default warn log.
- [x] Verifikasi: db:lint ok, check-migrations 23 ok, typecheck ok, test:unit 247/247, build ok, format:check ok.

## Risks
- Forward-fix vs amend: forward-fix additive non-destructive, sesuai AGENTS.md Migration Workflow, hindari rewrite `cc4a44f` yang sudah commit.
- Adapter guards menambah throw path — test pixelforge 5 tetap hijau (sudah divalidate).
- `force row level security` sudah di core tables — no data loss.

## Progress Log
- 2026-08-22 — Review `cc4a44f` vs plan, plan fix dibuat, patch adapter + parser + migrations + tests + state-machine, verifikasi lokal hijau.

## Notes
- `db:types:check` masih pending hosted (migrations 23 belum apply ke dev), `database.types.ts` patch manual tetap (butuh `supabase gen types` setelah `migrate-development.yml` `20260822100000/2110000`).
