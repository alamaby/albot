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
- [x] Hapus `migrate-development.yml` per user (secrets dev kosong, dev drift MCP) + update docs (README, architecture, AGENTS)
- [x] Commit gabungan + push tunggal (`206e62b`)
- [ ] `migrate-production` auto on push apply `20260905120000` ke prod → verifikasi persona aktif v2
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
- 2026-09-05 09:40:00 — User putuskan hapus `migrate-development.yml`
  (secrets env development kosong + dev drift versi MCP lama `04065812/04065924/04091004`
  vs repo; `test:hosted` 141/142 pre-existing). Workflow dihapus + docs
  (README/architecture/AGENTS) disesuaikan; pipeline kini
  `validate → migrate-production → deploy-production`. Commit gabungan
  `206e62b` pushed. Build lokal gagal di symlink EPERM Windows (pre-existing,
  compile+TS lolos). `db:types:check` OK (blob HEAD identik generate; diff lokal
  hanya CRLF worktree).

## Notes

- TM Forum ODA / C2M tidak relevan (bot Telegram image gen, bukan
  telecom rating/billing); tidak ada deviasi standar domain yang perlu
  dijustifikasi.
- Persona v1 generik terbukti dari 5 log prod 2026-09-04: semua negative
  generik (`blurry, deformed hands...`) tanpa `extra head/duplicate head/3 legs`.
- Opsi B (`Avoid:` → positive anchoring di Pollinations/Bynara) ditunda per user.
