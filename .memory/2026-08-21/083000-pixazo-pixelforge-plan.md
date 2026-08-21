# Pixazo PixelForge v2 Plan & Hybrid Model Selection — 2026-08-21

## Task / Problem

- User minta model baru provider Pixazo di `https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image` + desain cara user memilih provider/model dari chat Telegram.
- Pixazo existing hanya Flux Schnell (`flux-1-schnell/v1/getData` → `output`) dan SDXL (`getImage/v1/getSDXLImage` → `imageUrl`) via `src/server/providers/image/pixazo.adapter.ts:1` dengan discriminator `responseKind`.
- Perlu hybrid: pilihan per-session + default per-user (3 model tetap aktif), picker di confirmation dan di result `Regenerate`.

## Key Files Changed / Plan Created

- Sample request/response Python di-analisis (user provide 2026-08-21):
  `POST pixelforge-image-v2/v1/text-to-image` body `{text, type:"tags,caption", seed, size:10}` → `{type:["tags","caption"], results:[{key, caption, url:https://...}]}`
- Elaborasi `type` (`tags`/`caption`/`tags,caption`) — diputuskan **Opsi 2: configurable via `provider_configs.settings.type`** default `tags,caption`, allowlist, `size` default `1`; tidak expose ke user di MVP.
- Drop `negativePrompt`/`aspectRatio` untuk PixelForge (user confirm); Flux/SDXL tetap.
- Tabel terpisah untuk default per-user disepakati: `user_image_preferences(telegram_user_id PK FK bot_users, preferred_provider_config_id FK provider_configs)`.
- Plan detail baru: `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md` (Created 2026-08-21 08:30) — objective, spike evidence, decisions, scope, target structure, verification, acceptance criteria, risks, progress log, notes (TM Forum ODA deviation jika billing per-model nanti).
- `TODO.md` updated: Pending ditambah task Pixazo PixelForge v2 + sub-checklist (adapter/registry/seed, 2 migrations, Telegram keyboards/parser/messages/state-machine, generation wiring, tests, verifikasi); Decisions Needed dicatat confirmed (`type` Opsi 2, drop params, tabel terpisah, 3 model aktif, hybrid+result picker).
- Investigasi GET 404 di `gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image` confirmed POST-only; spike fixture direncanakan.

## Technical / Business Decisions

- Pixazo PixelForge = adapter terpisah `src/server/providers/image/pixazo-pixelforge.adapter.ts` (shape tidak kompatibel dengan Flux/SDXL) register `pixazo_pixelforge_v2` di `src/server/providers/index.ts:25`.
- `type` Opsi 2 via `settings.type`/`settings.size` (admin tanpa deploy), validasi `provider_configuration_invalid` jika invalid.
- Hybrid storage: `prompt_sessions.preferred_image_provider_config_id` (per-session) + `user_image_preferences` (per-user default) — `Jadikan Default` di picker.
- callback_data shortCode `flux|sdxl|pf2` format `mp:<code>:<sessionId>` ≤64 byte sesuai `src/server/telegram/keyboards.ts:17`.
- Populate `GenerateImageUseCase.selectProvider(session)` honor eligible preferensi else fallback `ProviderSelector` `priority_failover` seed sessionId.

## Assumptions / Risks

- `type` semantics `tags`/`caption` infer dari naming + sample; bisa berubah — mitigasi `settings` override.
- `size` sample `10` vs `results` 1 item ambiguous — diasumsi `size=1` untuk single `sendPhotoByUrl`; butuh real staging call verifikasi.
- `callback_events.action` check `20260808145500` perlu migration tambah `model_picker`/`model_picked` atau reuse — risiko insert fail.
- Plaintext key tidak boleh muncul di fixture/logs — redacted evidence only.

## Blockers / Unresolved

- Real curl staging dengan valid `Ocp-Apim-Subscription-Key` belum dijalankan (butuh secret); spike akan final setelah secret tersedia.
- Priority/weight awal PixelForge (default `10/1` di plan) menunggu konfirmasi operasional.

## Verification Performed / Recommended

- Verifikasi: `npm run db:lint` / `db:check-migrations` / `db:types:check` / `test:unit` / `lint` / `typecheck` / `build` / `format:check` — belum dijalankan (plan baru, no code yet).
- Recommended: after migrations — `npm run db:types` regen `database.types.ts`, hosted `REQUIRE_HOSTED_TESTS=true npm run test:hosted`.

## Commit Proposal

`docs(plan): add pixazo pixelforge v2 provider and hybrid telegram model selection plan`

## Related Plans / Specs / Issues

- `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md`
- `TODO.md` Pending Pixazo PixelForge v2
- Prior context: `src/server/providers/image/pixazo.adapter.ts`, `src/server/providers/registry.ts`, `src/server/application/generate-image.ts`, `src/server/telegram/keyboards.ts`, `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
