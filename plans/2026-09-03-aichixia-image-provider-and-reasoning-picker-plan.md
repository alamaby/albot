# Aichixia Image Provider + Reasoning/Enhance Picker

Created: 2026-09-03 11:55:00

## Objective
Menambahkan provider image generation baru **Aichixia** (4 model: `flux-2-dev`, `lucid-origin`, `phoenix-1.0`, `gemini-3-pro-image`) dengan prioritas **setelah Pixazo (0/5) tapi sebelum Pollinations/Bynara (151/160+)** → priority **110–113**, serta **picker provider/model reasoning** (untuk enhance + revise prompt) di keyboard Telegram — per-sesi + default per-user, menyamakan UX dengan image picker yang sudah ada.

## Scope
- **In:**
  - Adapter `src/server/providers/image/aichixia.adapter.ts` (OpenAI-style `b64_json`, size mapping, seed/steps/guidance, negative_prompt)
  - 4 `adapter_type` di registry: `aichixia_flux2`, `aichixia_lucid`, `aichixia_phoenix`, `aichixia_gemini`
  - Migration `provider_configs` (4 rows, priority 110–113)
  - Migration reasoning preference: `prompt_sessions.preferred_reasoning_provider_config_id` + tabel `user_reasoning_preferences` (RLS service_role-only, mirror `user_image_preferences`)
  - Keyboard: 4 code image Aichixia (`axf2/axlc/axph/axgm`) + 8 code reasoning (`cf0/poll/byn/orF/orIn/orLa/orGl/orM3`), actions `reasoning_picker/picked/picked_default/picker_back`, dual picker di confirmation/result keyboard
  - Parser: 4 callback action reasoning baru
  - `SessionRepository.setPreferredReasoningProvider` + `UserReasoningPreferenceRepository` (baru)
  - Callback state machine: handler reasoning picker (mirror image picker)
  - `EnhancePromptUseCase.selectProvider` hybrid: session preferred → user default → selector fallback; `enhanceOnly` honor user default
  - Confirmation message: dual label (reasoning + image model)
  - `/enhance-prompt` enhance-only: hasil teks + baris `Reasoning: label`
  - `.env.example`: placeholder `AICHIXIA_API_KEY`
  - Tests: aichixia contract, keyboard unit, registry, callback reasoning picker
- **Out:**
  - Image-to-image gemini (`image` param wajib) — `GenerateImageInput` text-only; fase 1 gemini text-to-image, forward `parameters.image` bila ada (log warn bila tak ada)
  - Perubahan prioritas reasoning existing (0/150/160+ tetap)
  - Reasoning capability Aichixia (tidak di-dokumentasi sebagai image endpoint)

## Milestones
1. Aichixia image adapter + registry + migration provider_configs
2. DB reasoning preference (session column + user table + RLS)
3. Keyboard + parser + repos + callback state machine
4. Use-case wiring (enhance hybrid + dual label + enhance-only info)
5. Tests + verifikasi migrasi/types + semua check hijau

## Tasks
- [x] Plan file ini
- [x] `src/server/providers/image/aichixia.adapter.ts` — POST `https://www.aichixia.xyz/api/v1/images/generations`, Bearer, body `{model, prompt, n:1, size, response_format:"b64_json", negative_prompt?, seed?, steps?, guidance?, image?}`, parse `data[0].b64_json` → `imageBytes` (fallback `url` https), timeout 40s (flux2/lucid/phoenix) / 55s (gemini), error taxonomy via `makeErrorFromHttpStatus`/`makeRetryable`/`makeNonRetryable`, `readProviderRequestId`, log `aichixia_upstream_error`
- [x] `src/server/providers/index.ts` — register 4 adapterType
- [x] `supabase/migrations/20260903052207_add_aichixia_image_configs.sql` — 4 INSERT `WHERE NOT EXISTS`, priority 110/111/112/113 (nama versi MCP — lihat Progress Log)
- [x] `supabase/migrations/20260903052614_add_reasoning_provider_preference.sql` — alter `prompt_sessions` add column + FK, create `user_reasoning_preferences` (PK `telegram_user_id` → `bot_users` cascade, FK config restrict), RLS enable+force, revoke api roles + grant service_role, trigger `set_updated_at`, index; **idempotent** (`if not exists` + `do $$`)
- [x] `supabase/migrations/20260903060043_mcp_marker_reasoning_default_action_fix.sql` — no-op marker `select 1;`
- [x] `src/server/telegram/keyboards.ts` — kode image + reasoning, `REASONING_PICKER_ACTIONS` (`reasoning_picker/picked/default/picker_back` — "default" bukan "picked_default" demi limit 64B), `reasoningPickerKeyboard`, `parseReasoningPickerData`, dual-label keyboard builders (backward-compat)
- [x] `src/server/telegram/parser.ts` — `CALLBACK_ACTIONS` += 4 reasoning
- [x] `src/server/repositories/session.repository.ts` — kolom `preferred_reasoning_provider_config_id`, setter
- [x] `src/server/repositories/user-reasoning-preference.repository.ts` (baru)
- [x] `src/server/application/callback-state-machine.ts` — handler reasoning picker + raw parser + resolveSelectedReasoningCode + reshowContextWithPickers (back handler image & reasoning berbagi)
- [x] `src/server/application/enhance-prompt.ts` — hybrid select (session → user default → selector), dual-label confirmation, `enhanceOnly` user default
- [x] `src/server/telegram/messages.ts` — `buildEnhanceOnlyMessage` + baris reasoning + `buildReasoningPickerMessage`/`buildReasoningSelectedMessage`
- [x] `src/server/application/handle-telegram-update.ts` — `/enhance-prompt` resolve user default preference ke payload job
- [x] `src/server/jobs/enhance-prompt-only.handler.ts` — parse payload preference + tampilkan label reasoning di hasil
- [x] `.env.example` — `AICHIXIA_API_KEY=` (placeholder kosong, tanpa nilai)
- [x] Tests: `tests/contract/aichixia-provider.contract.test.ts` (16 test), keyboard unit (+3 describe), registry resolve 4 type, callback reasoning picker (5 test), enhance hybrid select (5 test)
- [x] `tests/integration/schema.integration.test.ts` — `EXPECTED_MIGRATIONS` +3 (052207/052614/060043), `EXPECTED_TABLES` += `user_reasoning_preferences`, `COLUMN_SPECS`, `FK_FRAGMENTS`, `CONSTRAINT_FRAGMENTS` (action check), `EXPECTED_TRIGGERS`
- [x] Regenerate `src/server/supabase/database.types.ts` via `supabase gen types` (linked dev) + `db:types:check` ok
- [x] Semua check hijau: `db:lint` ok, `db:check-migrations` 46 ok, `db:types:check` ok, `test:unit` 329/329, `test:contract` 107/107, `test:hosted` 142/142, `lint` 0 error (2 warn existing), `typecheck` ok, `format:check` ok; `build` EPERM symlink = known issue Windows (sukses di CI Linux)

## Risks
- **Working tree sudah punya perubahan lain** (bot-dev removal/auto-prod, uncommitted) — commit aichixia harus di-scope ke file task ini saja (git add eksplisit per file).
- **Gemini `image` param wajib di docs** — tanpa image bisa 400 dari upstream; mitigasi: text-to-image tetap dikirim (majoritas use case), `parameters.image` forward opsional; monitor `aichixia_upstream_error` bila 400 konsisten.
- **Callback data > 64B** — `reasoning_picked:<uuid>:orM3` = 58B, `reasoning_default:<uuid>:orM3` = 59B (action default dipendek dari `reasoning_picked_default` = 66B, melebihi limit) — aman.
- **2 picker menambah baris keyboard** — konfirmasi jadi 2 baris picker; masih < 8 baris limit Telegram.
- **Versi MCP vs file** — MCP `apply_migration` merekam versi UTC-apply-time (052207/052614/060043), bukan timestamp file. File di-rename agar nama = versi yang tercatat di dev (source of truth 1:1); DML/DDL idempotent sehingga `db push` aman di database fresh.
- **Hosted test flaky** — rerun `--failed` bila race.

## Progress Log
- 2026-09-03 11:55:00 — Plan dibuat; keputusan user: (1) 4 adapterType per-model, (2) priority 110–113 (setelah Pixazo, sebelum Pollinations/Bynara), (3) default timeout/steps, (4) picker + info provider sekarang (image 4 code Aichixia + reasoning 8 code), (5) `AICHIXIA_API_KEY` di-set di `.env` (jangan bocorkan), placeholder di `.env.example`, (6) picker reasoning juga di /enhance-prompt (honor user default).
- 2026-09-03 13:55:00 — **Implementasi selesai & semua check hijau** (unit 329, contract 107, hosted 142/142 vs dev live, db:lint 46 ok, db:types:check ok, lint 0 error, typecheck ok, format ok; build EPERM = known Windows issue). Temuan kunci: (a) MCP `apply_migration` merekam versi UTC-apply-time (052207/052614/060043) bukan file timestamp → file di-rename agar nama=versi dev + DML/DDL idempotent + marker no-op 060043; `supabase migration list` kini 45/45 lokal=remote, no pending. (b) `reasoning_picked_default:<uuid>:orM3`=66B > limit 64B Telegram → action default dipendek jadi `reasoning_default` (59B). (c) Dev ter-UPDATE 99 baris `provider_configs` saat 05:22 UTC (DML, bukan DDL) — verifikasi tidak ada objek baru selain milik saya; tetap perlu perhatian user (lihat Open Items). Tinggal: commit (scope file aichixia saja, hindari file bot-dev removal yang belum di-commit) + provisioning key aichixia via upsert-provider-key.

## Notes
- Endpoint Aichixia: `POST https://www.aichixia.xyz/api/v1/images/generations`, response `data[0].b64_json` (b64) atau `url`. Param: `size` (WxH), `steps` (default 25–30), `seed`, `guidance`, `negative_prompt`, `response_format` (`b64_json` default / `url`), `n` (default 1), `image` (data URL, required utk gemini).
- Prioritas image: Pixazo 0/5 → **Aichixia 110–113** → Pollinations 151 → Bynara image 160+ → picker 200+.
- Reasoning codes: `cf0`=openai_compatible (Cloudflare gpt-oss-120b), `poll`=pollinations (gpt-oss), `byn`=bynara (laguna-s-2.1), `orF/orIn/orLa/orGl/orM3`=openrouter_free/ing/laguna/glm/m3.
- Standar: TOGAF proporsional (fitur bot, tanpa ceremony enterprise); tidak ada deviasi ODA/C2M.
