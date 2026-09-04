# Bynara reasoning rotation (nemotron replacement) + failure messages with provider context

## Task

1. Workstream B: `nemotron-3-ultra` terbukti HTTP 400 dari router Bynara (model sudah tidak tersedia — konfirmasi user). Ganti dengan 5 model reasoning: `agnes-2.5-flash`, `minimax-m3-free`, `mistral-medium-3-5`, `muse-spark-1.2-contributor-free`, `qwen3.8-27b` (semua via `https://router.bynara.id/v1`, ID eksak per user, priority 162–166, key `BYNARA_REASONING_API_KEY` sama).
2. Workstream A: pesan gagal Telegram memuat provider + error code + HTTP status + safeMessage redacted — di semua jalur (enhancement sesi, enhance-only, generate image, content-policy).

## Key files changed

- `supabase/migrations/20260904090000_replace_nemotron_with_bynara_reasoning.sql` (baru): INSERT 5 rows + deactivate nemotron. Hapus fisik diblokir FK.
- `tests/integration/schema.integration.test.ts`: `EXPECTED_MIGRATIONS` +1 (47 entri).
- `src/server/providers/index.ts`: 5 `registerReasoning` (`bynara_ag25/mm3f/mm35/ms12/qw38`) via loop `BYNARA_REASONING_MODELS`.
- `src/server/telegram/keyboards.ts`: reasoning picker 8 -> 13 kode (`ag25/mm3f/mm35/ms12/qw38`) + mapping + label.
- `scripts/seed-provider-config.mjs`: allowlist +5 adapter. `scripts/seed-prod-bynara.mjs`: REASONING_ROWS 2 -> 6 (nemotron keluar, 5 baru masuk).
- `src/server/providers/errors.ts`: `providerLabel/providerModel` di shape + class + `toJSON`, helper `withProviderContext()` (taksonomi retry tidak berubah).
- `src/server/telegram/messages.ts`: `FailureContext`, `formatFailureDetail()` (redact + truncate 200), `failureContextFromError()`, wiring ke `enhancement_failed/enhance_only_failed/generation_failed/content_policy_declined` + `buildGenerationStatusMessage("failed")`.
- `src/server/providers/reasoning/openai-compatible.adapter.ts`: safeMessage kini sertakan snippet body upstream ≤200 char (paritas bynara image adapter).
- `src/server/application/enhance-prompt.ts` (2 catch), `generate-image.ts` (1 catch): attach konteks via `withProviderContext(selected.config...)`.
- `src/server/jobs/enhance-prompt.handler.ts`, `enhance-prompt-only.handler.ts`, `generate-image.handler.ts`: teruskan failure context ke builder pesan. `recovery.ts` + `dispatch_failed` tetap generik (tanpa provider).
- Tests: `messages-failure.test.ts` (baru, 11), `provider-errors.test.ts` (+2), `provider-registry.test.ts` (+1), `keyboards.test.ts` (update daftar), `enhance-prompt.handler.test.ts` (+1), `generate-image.handler.test.ts` (2 exact-text update).
- `plans/2026-09-04-bynara-reasoning-replace-nemotron-plan.md`: plan file per AGENTS.md §7.

## Decisions

- Satu `adapter_type` per model (bukan reuse `bynara`): picker resolve per adapter_type ke prioritas tertinggi, jadi reuse membuat 5 model tidak selectable. Preseden: image picker + OpenRouter.
- `failureContextFromError` di `messages.ts` (bukan duplikasi di tiap handler).
- `attemptNumber/revisionNumber` di `buildGenerationStatusMessage` jadi opsional agar `failed` cukup bawa `{ failure }`.
- Recovery + dispatch_failed tetap generik (tidak ada info provider di titik itu).

## Assumptions / risks

- Model ID on-trust dari user (dinyatakan eksak). Wajib uji 1 prompt per model di dev (`provider_requests.http_status`) sebelum prod.
- Semua reasoning satu grup round_robin: priority hanya urutan picker, bukan porsi traffic.
- Satu API key untuk 6 config Bynara = single point of failure (diterima user).
- Picker 13 entri = UX berat di layar kecil (label ringkas sebagai mitigasi).
- safeMessage bisa menggemakan prompt user — truncate 200 + redactSensitive.

## Blockers / unresolved

- `test:hosted` lokal 141/142: `EXPECTED_MIGRATIONS` menunggu migration ter-apply di dev (first-push chicken-egg, expected). Hijau penuh setelah `migrate-development` workflow apply.
- `npm run build` lokal: compile + TS + pages sukses; tahap akhir adapter Vercel gagal `EPERM symlink` (keterbatasan Windows, bukan kode). Verifikasi build final di CI Linux.
- Rollout menunggu: push tunggal -> migrate-development -> seed dev keys -> uji -> migrate-production (manual) -> seed prod -> uji prod. Blocker lama masih berlaku: `VERCEL_TOKEN` env production kosong (deploy-production gagal), tapi push main tetap deploy via Vercel Git integration.

## CI outcomes (2026-09-04 ~11:00 WIB)

- Commits: `f476fdd` (fitur) + `c886f4a` (fix gitleaks fixture `key=sk-...` -> split-literal).
- `validate` @ `c886f4a`: SUCCESS (secret scan + static checks + tests hijau).
- `migrate-production` @ `c886f4a`: SUCCESS — prod terverifikasi via query: 5 rows 162–166 aktif `round_robin`, nemotron `is_active=false`.
- `migrate-development`: FAILURE pre-existing, bukan akibat change ini (gagal juga di `0a84c08`): secrets env development kosong (`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`/`SUPABASE_DB_PASSWORD` empty di log). Butuh user isi ulang secrets environment development.
- `deploy-production`: FAILURE (blocker lama `VERCEL_TOKEN` kosong).
- Next: seed keys 5 model baru di prod (`seed-prod-bynara.mjs` sudah update) + dev (setelah secrets dev diperbaiki), lalu uji 1 prompt per model.

## Verification

- `db:lint` ok, `db:check-migrations` ok (47), `db:types:check` ok (data-only, tanpa regen), `test:unit` 346/346, `lint` ok (2 warning pre-existing di e2e script), `typecheck` ok, `format:check` ok (prettier --write 4 file).
- `test:hosted` 141/142 (1 fail = pending migration di dev, expected pre-push).

## Commit proposal

`feat(providers): replace nemotron-3-ultra with 5 Bynara reasoning models and provider-aware failure messages`

## Related

- Plan: `plans/2026-09-04-bynara-reasoning-replace-nemotron-plan.md`
- RCA sesi prod: session `81844d25`, job `78656d7f`, request `57ec9f51` (400 `provider_request_invalid`, `Bynara nemotron-3-ultra` priority 161).
