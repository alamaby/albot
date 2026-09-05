# Flux negative prompt fix — persona v2 anatomy guards (option A)

## Task

User melaporkan hasil Flux masih ada extra kepala/kaki walau negative prompt
sudah di-plumbing. Investigasi: 5 log prod terakhir (2026-09-04) semuanya
punya `negative_prompt` generik (`blurry, deformed hands, extra fingers...`)
tanpa guard `extra head/duplicate head/3 legs`, dan tanpa positive anchoring
di `prompt`. Persona v1 generik; FLUX (rectified-flow) mengabaikan negative.
User pilih opsi A (persona LLM-driven), opsi B (hard-default adapter) ditunda.

## Key files changed

- `supabase/migrations/20260905120000_update_enhancement_persona_anatomy.sql` (baru,
  DDL-free): `enhancement_system_persona` v2 active + v1 deactivated (urutan:
  deactivate dulu agar partial unique index aman), idempotent + audit rows
  (create/activate v2, deactivate v1).
- `tests/integration/schema.integration.test.ts`: `EXPECTED_MIGRATIONS` +1
  (`20260905120000`, total 51).
- `src/server/application/enhance-prompt.ts`: fallback
  `ENHANCEMENT_SYSTEM_PROMPT_PERSONA` disinkronkan ke isi v2 (persona DB
  strict-error; fallback hanya untuk seed/test).
- `plans/2026-09-05-flux-negative-prompt-fix.md` (baru): plan + checklist + risiko.

## Decisions

- Opsi A (DB-driven persona) vs B (hard-default di `generate-image.ts`):
  A dipilih — tunable/rollback tanpa deploy (`activate_prompt_config` ke v1),
  tidak menimpa sinyal LLM untuk subjek non-human. B ditunda eksplisit.
- Instruksi persona pakai `ALWAYS` untuk figur manusia + positive anchoring
  (`single head, two arms, two legs...`) karena itu yang didengar encoder
  CLIP/T5 Flux; negative saja tidak cukup (Pixazo kemungkinan silent-drop).
- Urutan aktivasi di migration: deactivate v1 dulu, baru activate v2
  (koreksi dari draf awal yang terbalik — partial unique index hanya
  mentolerir satu active).
- TM Forum ODA / C2M tidak relevan (bot image gen, bukan telecom); tidak ada
  deviasi standar domain.

## Assumptions / risks

- LLM masih bisa omit bila instruction lemah — mitigasi kata `ALWAYS` +
  daftar eksplisit; sampling tetap `temperature 0.7`.
- Over-constrain (pose kaku) — mitigasi "adjust counts if multiple people"
  + rollback path ke v1.
- Pixazo silent-drop belum terbukti via curl — bila artefak bertahan setelah
  v2, follow-up: bukti curl + promosi Aichixia / ubah `Avoid:` injection.

## Blockers / unresolved

- Belum push; belum migrate dev/prod. `db:types:check` tidak perlu (no DDL)
  tapi wajib `test:hosted` hijau sebelum migrate prod.
- `provider_requests` image kosong di prod — payload aktual Pixazo belum
  terverifikasi; perlu `query_logs` / audit saat uji A/B.

## Verification

- `node scripts/db-lint.mjs` → ok; `node scripts/check-migrations.mjs` →
  51 migrations ok.
- `vitest run tests/unit` → 32 files, 357 tests passed.
- `npm run lint` → 0 errors (2 pre-existing warnings di e2e script).
- `npm run typecheck` → OK (`next typegen` + `tsc --noEmit`).
- `prettier --check` pada 2 file TS → OK (SQL tidak di-cover prettier).
- Belum: `test:hosted`, migrate dev, uji `/enhance-prompt` sampel manusia.

## Conventional commit

`feat(db): flux anatomy guards in enhancement persona v2`

## Related

- `plans/2026-09-05-flux-negative-prompt-fix.md`
- `.memory/2026-09-04/120000-universal-prompt-configurability.md` (no-global-default decision — dipertahankan)
- Prod logs: `generation_attempts` 2026-09-04 (Pixazo flux-1-schnell prio 0 ×3, Aichixia flux-2-dev prio 110 ×2)
