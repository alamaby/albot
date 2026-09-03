# Aichixia image provider + reasoning picker (enhance/revise)

Tanggal: 2026-09-03 13:56

## Masalah

User minta provider image generation baru **Aichixia** (`POST https://www.aichixia.xyz/api/v1/images/generations`, model `flux-2-dev`/`lucid-origin`/`phoenix-1.0`/`gemini-3-pro-image`, response `data[0].b64_json`), priority **setelah Pixazo (0/5) tapi sebelum Pollinations/Bynara (151/160+)** → 110-113. Ditambah **picker provider/model reasoning** (untuk enhance + revise prompt) di keyboard Telegram, per-sesi + default per-user, dan info provider di hasil `/enhance-prompt` (session-less).

## Keputusan (user)

- 4 `adapter_type` per-model: `aichixia_flux2/lucid/phoenix/gemini`.
- Priority 110/111/112/113.
- Default timeout/steps (adapter: 40s flux2/lucid/phoenix, 55s gemini — di bawah Vercel 60s).
- Picker sekarang, dengan info provider: 4 code image (`axf2/axlc/axph/axgm`) + 8 code reasoning (`cf0/poll/byn/orF/orIn/orLa/orGl/orM3`).
- `AICHIXIA_API_KEY` sudah di-set user di `.env` — **jangan bocorkan**; hanya placeholder di `.env.example`.
- Picker reasoning juga di `/enhance-prompt` (honor user default, session-less).

## Temuan teknis penting

- **MCP `apply_migration` merekam versi UTC apply-time** (052207/052614/060043), BUKAN timestamp file. Solusi: file migration di-rename agar `nama file = versi yang tercatat di dev` (source of truth 1:1, di-enforce `check-migrations.mjs`); DML/DDL dibuat **idempotent** (`WHERE NOT EXISTS`, `if not exists`, `do $$`) supaya `supabase db push` aman di database fresh. Marker no-op `select 1;` untuk 060043 (re-apply constraint). `supabase migration list` kini 45/45 lokal=remote, no pending.
- **Limit callback data Telegram 64B**: `reasoning_picked_default:<uuid>:orM3` = 66B → action default dipendek jadi `reasoning_default` (59B).
- Hybrid select reasoning: session preferred → user default → selector fallback (mirror image picker). `enhanceOnly` honor user default via payload job.
- Gemini: `size/steps/seed/guidance/negative_prompt` di-omit; `image` (data URL) opsional via `parameters.image`. Text-to-image default.
- Prioritas dev sebelum kerja: 99 baris `provider_configs` di-UPDATE massal 05:22 UTC (DML, bukan DDL — tidak ada objek baru selain milik saya).

## Files changed

- `src/server/providers/image/aichixia.adapter.ts` (baru) — `AichixiaImageAdapter` (b64_json/url, size map, seed/steps/guidance, native negative_prompt, gemini special-case).
- `src/server/providers/index.ts` — register 4 adapterType aichixia.
- `src/server/telegram/keyboards.ts` — +4 code image, +8 code reasoning, `REASONING_PICKER_ACTIONS`, `reasoningPickerKeyboard`, `parseReasoningPickerData`, `buildReasoningPickedCallback`/`buildReasoningPickerCallback`, dual-picker di `confirmationKeyboardWithModel`/`resultKeyboardWithModel` (backward-compat).
- `src/server/telegram/parser.ts` — `CALLBACK_ACTIONS` += 4 reasoning.
- `src/server/telegram/messages.ts` — `buildEnhanceOnlyMessage` + baris reasoning; `buildReasoningPickerMessage`/`buildReasoningSelectedMessage`.
- `src/server/repositories/session.repository.ts` — kolom `preferred_reasoning_provider_config_id` + setter.
- `src/server/repositories/user-reasoning-preference.repository.ts` (baru).
- `src/server/application/callback-state-machine.ts` — handler reasoning picker (picker/picked/default/back) + `resolveSelectedReasoningCode` + `reshowContextWithPickers` (di-share image & reasoning back).
- `src/server/application/enhance-prompt.ts` — hybrid `selectProvider` + dual-label confirmation + `enhanceOnly` user default.
- `src/server/application/generate-image.ts` — result keyboard dual picker.
- `src/server/application/handle-telegram-update.ts` — `/enhance-prompt` resolve user default preference.
- `src/server/jobs/enhance-prompt-only.handler.ts` — parse preference + tampilkan label reasoning.
- `src/server/repositories/job.repository.ts` — `insertEnhanceOnlyJob` + `preferredReasoningConfigId`.
- `supabase/migrations/20260903052207_add_aichixia_image_configs.sql` (baru).
- `supabase/migrations/20260903052614_add_reasoning_provider_preference.sql` (baru, idempotent).
- `supabase/migrations/20260903060043_mcp_marker_reasoning_default_action_fix.sql` (baru, no-op).
- `src/server/supabase/database.types.ts` — regenerate via `supabase gen types` (linked dev).
- `.env.example` — `AICHIXIA_API_KEY=` placeholder.
- `tests/contract/aichixia-provider.contract.test.ts` (baru, 16).
- `tests/unit/keyboards.test.ts` (+3 describe), `provider-registry.test.ts` (+1), `callback-state-machine.test.ts` (+5), `enhance-prompt-select.test.ts` (baru, 5), `telegram-webhook.test.ts`/`generate-image.test.ts`/`revision-input.test.ts` (fixture `preferredReasoningProviderConfigId`), `tests/integration/schema.integration.test.ts` (`EXPECTED_MIGRATIONS` +3, tables/columns/fk/constraint/triggers).

## Assumptions / Risks

- Asumsi Aichixia mengikuti OpenAI envelope `data[0].b64_json`/`url` (dari docs user) — **belum terverifikasi live** (butuh key). Contract test mengasumsikan envelope ini.
- Gemini text-to-image tanpa `image` bisa 400 upstream (docs bilang `image` required) — forward opsional; monitor `aichixia_upstream_error`.
- Working tree punya perubahan lain (bot-dev removal/auto-prod) yang belum di-commit — commit aichixia harus di-scope ke file task ini saja.

## Verification

- `test:unit` 329/329, `test:contract` 107/107, `test:hosted` 142/142 (vs dev live), `db:lint` ok, `db:check-migrations` 46 ok, `db:types:check` ok, `lint` 0 error (2 warn existing), `typecheck` ok, `format:check` ok.
- `build` EPERM symlink = known Windows issue (sukses di CI Linux).

## Open items (follow-up user)

1. **VERCEL_TOKEN production** — `deploy-production` run 33733536728 gagal: `VERCEL_TOKEN` kosong di GitHub environment `production` (env auto-created tanpa secret; probe HTTP 403, `No existing credentials`). Fix: Settings → Environments → production → isi `VERCEL_TOKEN` (team-scoped), lalu re-run `deploy-production` (workflow_dispatch). DB prod sudah schema 46 + 4 key Aichixia; kode prod masih versi lama sampai deploy sukses (failover aman).
2. **Push commit `777ce23`** (fix prettier `seed-prod-aichixia.mjs`) — `validate` run 33733416521 gagal di `Format check`; fix sudah di-commit lokal.
3. Verifikasi live Aichixia envelope setelah deploy sukses (b64_json vs url, field `revised_prompt`).
4. T8 (Vercel Preview cleanup) + T9 (verifikasi chain auto-prod) — manual, milik plan T7a.

## Conventional Commit proposal

`feat(providers): add Aichixia image provider and reasoning model picker`

## Related

- Plan: `plans/2026-09-03-aichixia-image-provider-and-reasoning-picker-plan.md`
- Pattern image picker: `src/server/application/callback-state-machine.ts`, `src/server/repositories/user-image-preference.repository.ts`
- Migration idempotency & MCP versioning lesson — lihat Notes di plan.
