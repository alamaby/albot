# Repair Production Migration History 20260904090215

Created: 2026-09-04 13:25 WIB

## Objective
Sinkronkan `supabase_migrations.schema_migrations` production (`pcexxtckvwmiquseznaz`) dengan repo sehingga `supabase db push` di `migrate-production.yml:68` tidak lagi gagal `Remote migration versions not found in local migrations directory` untuk `20260904090215`, dan migration pending `20260904150000` dapat di-deploy.

## Scope
- Production project `pcexxtckvwmiquseznaz` (verifikasi `migrate-production.yml:35`).
- Satu versi yatim `20260904090215 recover_stuck_received_sessions` (hanya di Remote, DDL identik dengan `20260904150000_recover_stuck_received_sessions.sql:9`).
- Update `tests/integration/schema.integration.test.ts:492 EXPECTED_MIGRATIONS` (tambah `20260904090215`; pertahankan `20260904150000` sebagai re-apply idempotent `CREATE OR REPLACE`).
- Regenerate `src/server/supabase/database.types.ts:1` via `npm run db:types` jika perlu (DDL sama, drift tidak diharapkan).
- Out-of-scope: normalisasi versi dev `04065812/04065924/04091004` (follow-up terpisah).
- Out-of-scope: perubahan C2M/TM Forum ODA domain model.

## Milestones
1. Validasi isi yatim (selesai — MCP prod read-only membuktikan identik via `pg_get_functiondef`).
2. Eksekusi Strategi A duplikat-copy (non-destruktif, preserve history).
3. Verifikasi lokal dan push.
4. Rerun `migrate-production` hingga `Apply pending migrations` + `Read-only post-migration checks` + `Fail on generated type drift` hijau.

## Tasks
- [x] Validasi `list_migrations` prod/dev dan `pg_get_functiondef` untuk `recover_stuck_received_sessions`
- [x] Copy `supabase/migrations/20260904150000_recover_stuck_received_sessions.sql` → `supabase/migrations/20260904090215_recover_stuck_received_sessions.sql` (konten identik SHA256 0A78..., jangan edit)
- [x] Update `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts:492` — sisipkan `"20260904090215"` antara `"20260904090000"` dan `"20260904120000"`; pertahankan `"20260904150000"` sebagai entri terakhir (re-apply idempotent)
- [x] `npm run db:types && npm run db:types:check` — [ok] no drift (database.types.ts tidak berubah selain regenerasi)
- [x] `npm run db:lint` [ok], `npm run db:check-migrations` [ok] 50 migrations, `npm run lint` [ok] (2 pre-existing warnings), `npm run typecheck` [ok], `npm run build` windows EPERM symlink (pre-existing, typecheck passed), `npm run format:check` [ok], `npm run test:unit` [ok] 357/357
- [x] `npm run test:hosted` (skip lokal — butuh dev live DB; akan divalidasi di CI)
- [x] Commit `7dd0f9f fix(db): align production migration history 04090215`, push, verifikasi `gh run view 33915262478` — SUCCESS (Apply migrations to hosted production 56s, semua step hijau)

## Risks
- Histori dobel: prod akan punya `04090215` + `04150000` untuk fungsi yang sama — aman karena `CREATE OR REPLACE` idempotent, tapi histori berisik. Mitigasi: dokumentasikan di `EXPECTED_MIGRATIONS` comment; alternatif rename-only lebih bersih tapi butuh hapus file dan tidak preserve history yatim — ditolak untuk Strategi A.
- `db:types:check` dieksekusi setelah `db push` di workflow; committed `database.types.ts` harus hasil `npm run db:types` alfabetik, jangan hand-edit (kegagalan `2026-09-02` `prompt_configs` — 185 baris diff urutan alfabet salah).
- Concurrent push = race `migrate-production`; gabung perubahan ke satu push (hindari push beruntun).
- Dev history `04065812/04091004` tetap divergen — tidak blokir `migrate-production`, tapi `migrate-development` bisa divergen di masa depan; catat follow-up.

## Progress Log
- 2026-09-04 13:15 WIB — Validasi MCP `supabase-albot-be-production:list_migrations` & `execute_sql` (`pg_get_functiondef`): `20260904090215` ada di prod, tidak di repo; DDL identik `20260904150000`; preflight `supabase migration list` di `33860118139` membuktikan `Local 04150000 | Remote 04090215`.
- 2026-09-04 13:20 WIB — Plan disetujui Strategi A (duplikat-copy non-destruktif). Plan mode read-only — eksekusi ditunda sampai exit plan mode.
- 2026-09-04 13:25 WIB — Exit plan mode; mulai eksekusi.
- 2026-09-04 13:33 WIB — Copy `04090215` identik SHA256, update `EXPECTED_MIGRATIONS`, `db:types:check` [ok], `db:lint`/`db:check-migrations`/`lint`/`typecheck`/`format:check`/`test:unit` [ok]; `build` gagal EPERM symlink Windows (pre-existing, bukan regresi). Siap commit.
- 2026-09-04 20:14 WIB — Push `7dd0f9f` → `main`, `gh run watch 33915262478` SUCCESS; prod `list_migrations` sekarang 50 versi termasuk `04090215` + `04150000` (re-apply).

## Notes
- Validasi MCP (read-only):
  - `supabase-albot-be-production:list_migrations` → `20260904090215 recover_stuck_received_sessions` di antara `04090000` dan `04120000`.
  - `supabase-albot-be-production:execute_sql` `pg_get_functiondef` → `SECURITY DEFINER`, `search_path=pg_catalog, public`, `prosecdef=true`, grant `service_role`, logic `received/enhancing` + `queued attempt 0` → `enhancement_failed` — identik `20260904150000_recover_stuck_received_sessions.sql:9`.
  - `supabase-albot-be-development:list_migrations` → dev punya `04065812/04065924/04091004` (artifact `apply_migration` MCP) — tidak blokir prod, follow-up terpisah.
- Commit `a489380` tidak bawa `.sql` baru — tetap terblokir karena histori yatim.
- Contoh patch `EXPECTED_MIGRATIONS` (Strategi A):
  ```ts
  "20260904090000",
  "20260904090215", // <- yatim production, isi = 20260904150000 (CREATE OR REPLACE idempotent)
  "20260904120000",
  "20260904150000", // re-apply idempotent — akan dipush ke prod sebagai pending
  ```
- Standards: tidak ada perubahan C2M/TM Forum ODA; ini fix infra migrasi.
