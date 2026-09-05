# Flux Negative Prompt Fix (Option A — Persona Anatomy Guards)

Created: 2026-09-05 07:10:00

## Objective

Menghilangkan extra kepala/kaki pada hasil FLUX dengan memperkuat
`enhancement_system_persona` (LLM-driven) agar selalu memancarkan positive
anatomical anchoring + negative anatomy guards untuk figur manusia.

## Scope

- Migration `supabase/migrations/20260905120000_update_enhancement_persona_anatomy.sql`
- `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts`
- Fallback `ENHANCEMENT_SYSTEM_PROMPT_PERSONA` di `src/server/application/enhance-prompt.ts`
- Tidak menyentuh adapter (opsi B hard-default ditunda per user)

## Milestones

1. Persona v2 ter-apply di dev + prod
2. Verifikasi LLM memancarkan anatomy guards
3. A/B generate Flux sebelum/sesudah

## Tasks

- [x] Buat migration persona v2 (deactivate v1 → activate v2, idempotent + audit)
- [x] Update `EXPECTED_MIGRATIONS` (`20260905120000`)
- [x] Sinkronkan fallback persona di `enhance-prompt.ts`
- [x] Verifikasi lokal: `db:lint`, `check-migrations`, unit 357/357, lint, typecheck, prettier
- [ ] Push + workflow `migrate-development` apply ke dev
- [ ] `npm run db:types:check` (no DDL — harus tetap OK)
- [ ] `npm run test:hosted` melawan dev live
- [ ] Migrate prod (manual attestation), verifikasi persona aktif v2
- [ ] Uji `/enhance-prompt` sampel manusia → assert `negative_prompt` mengandung `extra head|extra limbs`
- [ ] Bandingkan generate Pixazo `flux-1-schnell` sebelum/sesudah (curl A/B bila perlu)

## Risks

- Over-constrain pose kaku bila LLM terlalu harfiah — mitigasi: instruksi
  "adjust counts if multiple people", persona tetap tunable via DB rollback
  (`activate_prompt_config` ke v1).
- Flux tetap lemah merespons negative — positive anchoring adalah mitigasi
  utama; bila tidak cukup, opsi B (hard-default) atau promosi Aichixia jadi
  follow-up.
- Pixazo kemungkinan silent-drop `negative_prompt` — perlu bukti curl bila
  artefak bertahan.

## Progress Log

- 2026-09-05 07:10:00 — Migration v2 + fallback + EXPECTED_MIGRATIONS selesai;
  unit 357/357, lint (2 pre-existing warnings), typecheck OK, prettier OK.
  Menunggu push + migrate dev.

## Notes

- TM Forum ODA / C2M tidak relevan (bot Telegram image gen, bukan
  telecom rating/billing); tidak ada deviasi standar domain yang perlu
  dijustifikasi.
- Persona v1 generik terbukti dari 5 log prod 2026-09-04: semua negative
  generik (`blurry, deformed hands...`) tanpa `extra head/duplicate head/3 legs`.
- Opsi B (`Avoid:` → positive anchoring di Pollinations/Bynara) ditunda per user.
