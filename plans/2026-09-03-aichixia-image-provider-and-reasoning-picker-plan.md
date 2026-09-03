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
- 2026-09-03 13:55:00 — **Implementasi selesai & semua check hijau** (unit 329, contract 107, hosted 142/142 vs dev live, db:lint 46 ok, db:types:check ok, lint 0 error, typecheck ok, format ok; build EPERM = known Windows issue). Temuan kunci: (a) MCP `apply_migration` merekam versi UTC-apply-time (052207/052614/060043) bukan file timestamp → file di-rename agar nama=versi dev + DML/DDL idempotent + marker no-op 060043; `supabase migration list` kini 45/45 lokal=remote, no pending. (b) `reasoning_picked_default:<uuid>:orM3`=66B > limit 64B Telegram → action default dipendek jadi `reasoning_default` (59B). (c) 99 baris `provider_configs` di-UPDATE massal 05:22 UTC di dev (DML, bukan DDL) — verifikasi tidak ada objek baru selain milik saya.
- 2026-09-03 14:40:00 — **Provisioning key Aichixia DEV SELESAI** (4/4 config, 1 key fingerprint 43658ea80bdf..., is_active, no cooldown) via wrapper temp (fix: `.env.local` Vercel snapshot berisi placeholder `SUPABASE_URL`/`PROVIDER_KEY_ENCRYPTION_KEY` invalid — wrapper pre-set env valid dari `.env` ke child process, nilai tak pernah dicetak).
- 2026-09-03 15:10:00 — **Commit** (2 commit terpisah sesuai keputusan user): `d6f2b23` `feat(providers): add Aichixia image provider and reasoning model picker` (29 file; `.env.example` hanya hunk Aichixia via `git apply --cached` patch; file T7a tidak ikut) + `cf427f9` `chore(ci): remove dev bot and enable auto production deploy chain` (15 file T7a yang sudah ada di working tree sebelum sesi). Working tree clean; `.env`/`.env.local` tidak pernah ter-commit. **Belum di-push** (main ahead 2).
- 2026-09-03 15:40:00 — **Prod provisioning**: prod masih 43 migration (tanpa config Aichixia) → upsert tidak bisa jalan (lookup `provider_configs` gagal, diverifikasi live: wrapper guard host prod `pcexxtckvwmiquseznaz` lolos, gagal tepat di lookup, 0 key ter-write). Dibuat `scripts/seed-prod-aichixia.mjs` (pola `seed-prod-bynara.mjs`, guard ref prod, dry-run diverifikasi). **URUTAN FINAL**: (1) `git push origin main` → `migrate-production` auto-apply 3 migration, (2) tunggu sukses, (3) `node scripts/seed-prod-aichixia.mjs` → 4 key prod.
- 2026-09-03 16:35:00 — **Push user + insiden CI + prod key selesai**: user push 4 commit → `migrate-production` run 33733416461 **SUKSES** (prod 43→46, 4 config Aichixia aktif) → **4 key Aichixia PROD ter-provision** via `node scripts/seed-prod-aichixia.mjs` (fingerprint `43658ea80bdf...` = sama dengan dev, is_active, no cooldown, diverifikasi SQL). Dua failure CI: (a) `validate` run 33733416521 — step `Format check` gagal: `scripts/seed-prod-aichixia.mjs` belum di-prettier saat commit → fixed commit `777ce23` (belum di-push); (b) `deploy-production` run 33733536728 — step `Pull Vercel project settings` gagal: **`VERCEL_TOKEN` kosong di GitHub environment `production`** (env auto-created tanpa secret; env dump runner: `VERCEL_TOKEN:` tanpa nilai, probe HTTP 403, `No existing credentials`). User action: isi `VERCEL_TOKEN` (team-scoped) di Settings → Environments → production, lalu re-run `deploy-production` via workflow_dispatch. **Konsekuensi sementara (aman)**: DB prod sudah schema baru (additive only), kode prod masih versi lama (Aichixia di DB tapi adapter tak ada di runtime → selector tidak memilih; failover tidak rusak).

## Notes
- Endpoint Aichixia: `POST https://www.aichixia.xyz/api/v1/images/generations`, response `data[0].b64_json` (b64) atau `url`. Param: `size` (WxH), `steps` (default 25–30), `seed`, `guidance`, `negative_prompt`, `response_format` (`b64_json` default / `url`), `n` (default 1), `image` (data URL, required utk gemini).
- Prioritas image: Pixazo 0/5 → **Aichixia 110–113** → Pollinations 151 → Bynara image 160+ → picker 200+.
- Reasoning codes: `cf0`=openai_compatible (Cloudflare gpt-oss-120b), `poll`=pollinations (gpt-oss), `byn`=bynara (laguna-s-2.1), `orF/orIn/orLa/orGl/orM3`=openrouter_free/ing/laguna/glm/m3.
- Standar: TOGAF proporsional (fitur bot, tanpa ceremony enterprise); tidak ada deviasi ODA/C2M.
- **Urutan go-live (final):** 1) `git push origin main` (auto `migrate-development` + `migrate-production` + `deploy-production`); 2) tunggu `migrate-production` sukses (prod 43→46, config Aichixia ada); 3) `node scripts/seed-prod-aichixia.mjs` (4 key prod; satu key, fingerprint sama). Dev sudah di-provision.
- **`.env.local` = snapshot Vercel** berisi placeholder `SUPABASE_URL`/`PROVIDER_KEY_ENCRYPTION_KEY` invalid (len 11) → script `upsert-provider-key` (memuat `.env.local` dulu, no-overwrite) gagal; pakai wrapper (`scripts/seed-prod-aichixia.mjs` / wrapper temp dev) yang pre-set env valid dari `.env`.
