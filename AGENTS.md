<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Migration Workflow

Setiap migration baru (`supabase/migrations/<timestamp>_*.sql`) WAJIB:

1. **Update `EXPECTED_MIGRATIONS`** di `tests/integration/schema.integration.test.ts` — tambahkan 14-digit timestamp migration baru. Workflow `migrate-development.yml` menjalankan hosted test `records exactly the expected applied migrations`; kalau entry tidak di-update, workflow gagal di step "Run hosted tests" SETELAH migration ter-apply ke dev (sudah terjadi 3×: M3, M6 `534dee3`, dan regresi 2026-08-20).
2. **Cek type drift**: `npm run db:types:check` — kalau migration mengubah schema (tabel/kolom/RPC), regenerate `src/server/supabase/database.types.ts` dengan `npm run db:types` sebelum commit.
3. **Verifikasi lokal lengkap sebelum commit**: `npm run db:lint`, `npm run db:check-migrations`, `npm run db:types:check`, `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run format:check` — semuanya harus hijau.
4. Jangan trigger `migrate-development.yml` sebelum semua check hijau dan commit sudah di-push.

# Commit Message Rules

- Commit message tidak boleh mengandung trailer `Co-authored-by:` apa pun (termasuk bot/agent).
- Commit message: subject ringkas (conventional commits) + body deskriptif bila perlu. Tidak ada signature/attribution tambahan.
