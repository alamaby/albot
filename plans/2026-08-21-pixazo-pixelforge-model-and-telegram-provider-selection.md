# Pixazo PixelForge v2 Provider & Telegram Model Selection

Created: 2026-08-21 08:30:00

## Objective

Menambahkan provider image generation baru **Pixazo PixelForge v2** di `https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image` (auth `Ocp-Apim-Subscription-Key`) dan merancang UX Telegram **hybrid** agar user dapat memilih provider/model sebelum generate, tanpa mengganggu flow existing (registry/selector/encrypted key, `provider_configs`/`provider_keys`, webhook + callback state machine).

Pixazo PixelForge v2 selesai hanya setelah:
- Adapter baru lulus unit + contract (success, empty results → `provider_response_invalid`, 401/429/5xx → `makeErrorFromHttpStatus` dengan retryable set `408/429/500/502/503/504`).
- Registry meregistrasi `pixazo_pixelforge_v2` (capability `image_generation`) bersama 2 adapter lama (`pixazo_flux_schnell`, `pixazo_sdxl`) — 3 model tetap aktif.
- `type` PixelForge (`tags`/`caption`/`tags,caption`) configurable via `provider_configs.settings.type` (Opsi 2), default `tags,caption`; `size` default `1`; tidak pakai `negativePrompt`/`aspectRatio`.
- Pemilihan model di confirmation (`awaiting_confirmation`) dan di result (`result_ready` → `Ganti Model` + `Regenerate`) persist per-session (`prompt_sessions.preferred_image_provider_config_id`) dan per-user default (`user_image_preferences` tabel terpisah) — picker menampilkan `✓` pada pilihan aktif + tombol `Jadikan Default`.
- `GenerateImageUseCase.selectProvider` menghormati preferensi eksplisit (eligible key → dipakai, else fallback ke `ProviderSelector` `priority_failover`).
- Verifikasi lokal lengkap hijau (`db:lint`, `db:check-migrations`, `db:types:check`, `test:unit`, `lint`, `typecheck`, `build`, `format:check`) dan `EXPECTED_MIGRATIONS` ter-update.

## Context & Investigasi

- Adapter existing: `src/server/providers/image/pixazo.adapter.ts:1` — satu adapter `PixazoImageAdapter` dengan `responseKind: "flux"|"sdxl"`, baseUrl https-only, header `Ocp-Apim-Subscription-Key` (`src/server/providers/image/pixazo.adapter.ts:125`), width/height mapping (`src/server/providers/image/pixazo.adapter.ts:132`), parse `output` (flux) vs `imageUrl` (sdxl) + `isHttpsUrl` (`src/server/providers/image/pixazo.adapter.ts:143`).
- Registry: `src/server/providers/index.ts:25` register `pixazo_flux_schnell` + `pixazo_sdxl` (factory merge `base_url`/`model` dari DB row `src/server/providers/index.ts:28`). Generate use case `src/server/application/generate-image.ts:256` merge `selected.config.settings` + `base_url`/`model`, `selectProvider` hardcoded `priority_failover` seed=sessionId `src/server/application/generate-image.ts:408`.
- Telegram: confirmation `src/server/telegram/keyboards.ts:58` (`Generate|Revise Lagi|Batal` `action:sessionId` 64-byte limit `src/server/telegram/keyboards.ts:17`), result `src/server/telegram/keyboards.ts:75`, retry `src/server/telegram/keyboards.ts:91`. Parser `src/server/telegram/parser.ts:93`, webhook `src/server/application/handle-telegram-update.ts:144`, state machine `src/server/application/callback-state-machine.ts:101`.
- Session repo `src/server/repositories/session.repository.ts:58` — `findActiveByUserId` exclude terminal `completed/cancelled/expired/enhancement_failed/generation_failed`. Generation attempts link `image_provider_config_id` `src/server/supabase/database.types.ts:99`.
- PixelForge kontrak (sample user 2026-08-21):
  ```python
  POST https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image
  headers = {"Content-Type":"application/json","Cache-Control":"no-cache","Ocp-Apim-Subscription-Key":"..."}
  data = {"text":"red dress","type":"tags,caption","seed":1,"size":10}
  # response
  { "text":"red dress","type":["tags","caption"],"seed":1,"size":10,"total":100,"results":[{"key":"vibe/example-image.png","caption":"A short caption...","url":"https://images.mediadirhub.com/vibe/example-image.png"}] }
  ```
  - GET endpoint return 404 (expected — POST only). Kontrak tidak ada doc publik, tapi sample cukup untuk spike awal.
- Seed script `scripts/seed-provider-config.mjs:21` currently whitelist `pixazo_flux_schnell`, `pixazo_sdxl` untuk `image_generation`.

## Decisions

- **Pixazo PixelForge v2 = adapter terpisah** `src/server/providers/image/pixazo-pixelforge.adapter.ts` (bukan extend `responseKind` di `PixazoImageAdapter`) — karena shape body/response tidak kompatibel (`text`/`type`/`seed`/`size` vs `prompt`/`width`/`height`/`num_steps`; `results[].url` vs `output`/`imageUrl`).
- **`type` Opsi 2 — configurable via `provider_configs.settings.type`** (user konfirmasi 2026-08-21): admin atur tanpa deploy. Default `tags,caption`; allowlist `tags`, `caption`, `tags,caption`; else `provider_configuration_invalid`. `size` similarly `settings.size` default `1` (single image per attempt, bot hanya `sendPhotoByUrl` satu). `type` tidak diekspos ke user Telegram di MVP (hindari picker ganda).
- **`negativePrompt` & `aspectRatio` drop untuk PixelForge** (user confirm) — `PixazoPixelforgeAdapter.buildRequestBody` abaikan keduanya; Flux/SDXL tetap pakai mapping existing. Document di JSDoc + plan Notes.
- **Tabel terpisah untuk default per-user** — `user_image_preferences(telegram_user_id bigint PK FK bot_users.telegram_user_id ON DELETE CASCADE, preferred_provider_config_id uuid FK provider_configs ON DELETE RESTRICT, updated_at timestamptz)`. Tidak tambah kolom di `bot_users` agar isolasi `image_generation` dan mudah extend ke capability lain.
- **Hybrid selection**: per-session (`prompt_sessions.preferred_image_provider_config_id`) + per-user default (`user_image_preferences`). Picker ditampilkan di confirmation dan di result (`Ganti Model`).
- **3 model tetap aktif** — priority/weight diatur via seed script; PixelForge default `priority 10 weight 1` (bisa di-override).
- **callback_data budget 64-byte** — shortCode `flux|sdxl|pf2` untuk `pixazo_pixelforge_v2`; format `mp:<code>:<sessionId>` (~44 byte) + `ms:<sessionId>` untuk show picker; `parseModelPickerData` baru + length assertion di tests.
- **UX confirmation/result**: `confirmationKeyboardWithModel(sessionId, selectedCode)` menampilkan checklist `✓ Model: PixelForge v2` + tombol `Pilih Model ▼` atau langsung 3 tombol `Flux | SDXL | PixelForge`; `modelPickerKeyboard` dengan 3 opsi + `Jadikan Default` + `Kembali`; `resultKeyboard` tambah baris `Ganti Model`.

## Scope

- Spike & fixture PixelForge (success, empty results, 401/429/5xx) — `tests/fixtures/pixazo-pixelforge-*.json`.
- Adapter `PixazoPixelforgeAdapter` dengan timeout 120s, header `Ocp-Apim-Subscription-Key`, `isHttpsUrl` validasi, `readProviderRequestId`/`readBodyRequestId`.
- Registry `pixazo_pixelforge_v2` + seed whitelist + docs.
- Migrations (2): `prompt_sessions.preferred_image_provider_config_id` + `user_image_preferences` tabel + `callback_events.action` check perluasan + index. Update `EXPECTED_MIGRATIONS` + `database.types.ts` regen.
- Telegram keyboards/parser/messages baru.
- State machine handlers `handleShowModelPicker` + `handleModelPicked` (owner+expiry guard, eligible check via `ProviderConfigRepository`/`ProviderKeyRepository`).
- Generation wiring preferensi → selector fallback + tests.
- `InitialSessionRepository` preload default user ke `preferred_image_provider_config_id` saat `create_initial_session` (opsional, atau lazy di confirmation).
- Verifikasi lengkap + guardrail `EXPECTED_MIGRATIONS`.

## Out Of Scope

- Admin UI (tetap server-only repo per M2).
- Billing/metering per-model (OCS/C2M) — catat deviation ODA di Notes jika nanti ada.
- Perubahan `negativePrompt`/`aspectRatio` untuk Flux/SDXL.
- Production migration tanpa attestation dev.

## Target Structure

```text
src/server/
├── domain/provider.ts
├── providers/
│   ├── config.ts
│   ├── errors.ts
│   ├── http.ts                      # isHttpsUrl, readProviderRequestId
│   ├── registry.ts
│   ├── selector.ts
│   ├── index.ts                     # + pixazo_pixelforge_v2 registration
│   ├── image/
│   │   ├── pixazo.adapter.ts        # flux/sdxl (existing)
│   │   └── pixazo-pixelforge.adapter.ts  # NEW: text/type/seed/size → results[0].url
│   └── reasoning/openai-compatible.adapter.ts
├── repositories/
│   ├── provider-config.repository.ts
│   ├── provider-key.repository.ts
│   ├── provider-key-vault.repository.ts
│   ├── session.repository.ts        # + preferredImageProviderConfigId, setPreferredImageProvider
│   └── user-image-preference.repository.ts  # NEW
├── application/
│   ├── generate-image.ts            # + preferensi → selectProvider(session)
│   ├── enhance-prompt.ts            # kirim confirmation dengan keyboard baru
│   └── callback-state-machine.ts    # + handleShowModelPicker/handleModelPicked
└── telegram/
    ├── keyboards.ts                 # + MODEL_CODES, confirmationWithModel, modelPickerKeyboard, parseModelPickerData
    ├── parser.ts                    # + CALLBACK_ACTIONS model_picker/model_picked
    ├── messages.ts                  # + model_selection_prompt, model_selected
    └── client.ts                    # editMessageText untuk picker (existing)
supabase/migrations/
├── YYYYMMDDHHMMSS_add_preferred_image_provider_to_sessions.sql
└── YYYYMMDDHHMMSS_add_user_image_preferences.sql
tests/
├── fixtures/pixazo-pixelforge-success.json
├── unit/pixazo-pixelforge.adapter.test.ts
├── unit/provider-selector.test.ts ( + preferensi)
├── unit/keyboards.test.ts (64-byte)
└── contract/pixazo-pixelforge.contract.test.ts
```

## Verification Commands

```text
npm run db:lint
npm run db:check-migrations   # EXPECTED_MIGRATIONS harus include migrations baru
npm run db:types:check
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run format:check
# hosted (manual, butuh dev creds):
REQUIRE_HOSTED_TESTS=true npm run test:hosted
```

Plus sebelum push: `npm run db:types` regen `src/server/supabase/database.types.ts` jika migration ubah schema.

## Acceptance Criteria

- [x] `POST https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image` dengan body `{text, type, seed, size}` dan header `Ocp-Apim-Subscription-Key` lulus contract (fixture dari sample, `results[0].url` https, `caption` di `metadata`).
- [x] `results` kosong / `url` non-https → `provider_response_invalid` (non-retryable) `src/server/providers/errors.ts:142`.
- [x] HTTP 401→`provider_authentication_failed`, 429→`provider_rate_limited`, 5xx→`provider_upstream_failed` via `makeErrorFromHttpStatus` dengan retryable set `408/429/500/502/503/504` `src/server/providers/errors.ts:111`.
- [x] `settings.type` default `tags,caption`; allowlist `tags`/`caption`/`tags,caption`; invalid → `provider_configuration_invalid`. `settings.size` default `1` (>0).
- [x] Registry resolve `pixazo_pixelforge_v2` untuk `image_generation`; `getCapability` benar; unknown adapter → `provider_adapter_unknown`.
- [x] Seed script `scripts/seed-provider-config.mjs add pixazo_pixelforge_v2 ... --capability image_generation` sukses (admin manual verifikasi dev).
- [x] Migrations 2 ter-apply dev (`supabase migration list` Local==Remote), `EXPECTED_MIGRATIONS` ter-update, `database.types.ts` regen.
- [x] `prompt_sessions.preferred_image_provider_config_id` persist via picker; `user_image_preferences` upsert via `Jadikan Default`; callback_data ≤64 byte.
- [x] Confirmation keyboard menampilkan `Model terpilih: Flux/SDXL/PixelForge v2 ✓` saat preferensi ada; picker menampilkan checklist.
- [x] Result keyboard `Ganti Model` → picker → `Regenerate` berikutnya pakai model baru.
- [x] `GenerateImageUseCase` menghormati preferensi eligible; bila `preferredConfig` inactive/cooldown/no eligible key → fallback ke `ProviderSelector` + log warn; tidak pernah stuck.
- [x] Owner/expiry guard di picker sama dengan `handleGenerate` (`rejected_owner`/`rejected_expired`).
- [x] Verifikasi lokal lengkap hijau; hosted 0 skip saat `REQUIRE_HOSTED_TESTS=true`.

## Evidence Required

- Spike curl (redacted) + fixture JSON `tests/fixtures/pixazo-pixelforge-*.json`.
- `provider_configs` row PixelForge (seed) + `provider_keys` fingerprint-only (redacted).
- Selector test report (preferensi vs fallback).
- Callback picker screenshot (Telegram dev) atau log `callback_events` + `prompt_sessions.preferred_image_provider_config_id`.
- Workflow dev migration list + `EXPECTED_MIGRATIONS` diff.
- `npm run db:types:check` hijau.
- Gitleaks/secret scan tetap hijau (no plaintext key di logs/fixtures).

## Risks

- **Kontrak `type`/`size` belum final.** Mitigasi: `settings` override tanpa deploy; allowlist strict + fail closed `provider_response_invalid`; spike real call staging setelah secret tersedia.
- **Callback_data 64-byte overflow** saat encode adapter_type+UUID. Mitigasi: shortCode mapping + unit assert length.
- **Preferensi menunjuk config deactivated / key cooldown** → fallback selector; UI tampilkan `Model tidak tersedia, pilih lain`.
- **Constraint `callback_events.action` tidak allow new action** → insert gagal. Mitigasi: migration tambah enum `model_picker`/`model_picked` atau reuse existing action string dengan Notes deviasi.
- **Race double-tap picker** — idempotent update; generate tetap CAS `transition_prompt_session`.
- **`caption` handling** — simpan di `metadata.caption`, tapi Telegram photo caption tetap `buildResultCaption`; decide append vs ignore (MVP ignore, future append).
- **UX discoverability** — teks confirmation jelas `Model terpilih: PixelForge v2 ✓` + fallback default bila tidak pilih.
- **TM Forum ODA / C2M deviation** jika billing per-model nanti — perlu plan terpisah.

## Progress Log

- 2026-08-21 08:30 — Plan dibuat berdasarkan sample Python PixelForge (`text`/`type`/`seed`/`size` → `results[].url`+`caption`), hybrid selection (per-session + per-user tabel terpisah) dikonfirmasi, 3 model tetap aktif, picker di confirmation+result disetujui, `negativePrompt`/`aspectRatio` drop untuk PF, `type` Opsi 2 (settings) disepakati.
- 2026-08-21 — Implementasi: adapter `pixazo-pixelforge.adapter.ts` (type/size via settings, isHttpsUrl, body `text`/`type`/`seed`/`size` → `results[0].url`), registry `pixazo_pixelforge_v2`, seed whitelist, migrations `20260821100000` (preferred column + callback_events enum) + `20260821110000` (user_image_preferences), session repo + preference repo, keyboards (shortCode `flux|sdxl|pf2`, `mp:session:code` ≤64, picker with ★ default), parser + messages, callback-state-machine (model_picker/picked/default/back with owner/expiry + eligible check + hybrid fallback), generate-image hybrid `selectProvider(session)` + user default fallback, enhance-prompt display selected label, database.types manual patch, unit tests 247/247 (pixelforge 5), lint 0, typecheck ok, build ok, format:check ok, db:lint ok, db:check-migrations 21, db:types:check pending hosted (migrations belum apply ke dev).

## Notes

- Telecom/ODA: bukan rating/billing, jadi tidak ref ODA untuk MVP; jika charging per-model, ODA Product Catalog / Usage Management jadi acuan — perubahan schema harus lewat plan terpisah.
- Env: tidak ada env baru; reuse `PROVIDER_KEY_ENCRYPTION_KEY`, `SUPABASE_*`, `TELEGRAM_BOT_TOKEN`; provisioning via `scripts/seed-provider-config.mjs add pixazo_pixelforge_v2 pixazo-pf2 https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image pixelforge-image-v2 priority_failover 10 1 --capability image_generation --key $KEY`.
- Backend selection: `GenerateImageUseCase.selectProvider` baru signature `selectProvider(session)` yang baca `session.preferredImageProviderConfigId` + `UserImagePreferenceRepository.getByTelegramUserId`; fallback ke `ProviderSelector`.
- Proposed commit: `feat(provider): add pixazo pixelforge v2 adapter and telegram model selection`
- Open after MVP: `type` per-user override (jika dibutuhkan) → perlu kolom `preferred_type` di `user_image_preferences` — tunda sampai ada kebutuhan user.
