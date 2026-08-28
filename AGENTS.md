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

# Secret Handling (Anti-Exfiltration)

Setiap shell command atau file read yang menampilkan isi `.env`, `.env.local`, `.env.production`, atau env files lainnya ke stdout/stderr akan bocorkan secret ke chat log. **Dilarang**:

- `grep`, `cat`, `head`, `tail`, `awk`, `sed`, `less` terhadap file `.env*` (walaupun dengan `sed 's/=.*/=***/'` — pattern redaction rentan miss).
- `env | grep ...` untuk env yang di-load dari file.
- `node -e "console.log(process.env.SECRET_NAME)"` atau setara.
- `bash -c "...$SECRET..."` interpolation.
- `printenv SECRET_NAME` atau `echo $SECRET_NAME`.
- Print key/id/secret dari response Supabase API (`get_publishable_keys` boleh untuk anoned/publishable, tapi JANGAN untuk service role key).

**Cara aman baca env** (untuk verifikasi atau debugging):

1. **Cek apakah var di-set** (boolean only, tanpa nilai):
   ```sh
   node -e "console.log('VAR_NAME:', process.env.VAR_NAME !== undefined ? 'set' : 'unset')"
   ```
2. **Cek nama var yang ada di file .env** (nama saja, tanpa nilai):
   ```sh
   node -e "const c=require('fs').readFileSync('.env','utf8');for(const l of c.split(/\r?\n/)){const m=l.match(/^\s*([A-Za-z0-9_]+)=/);if(m)console.log(m[1])}"
   ```
3. **Pakai script wrapper** yang baca .env di Node dan oper ke child process via `process.env` (lihat `scripts/seed-prod-bynara.mjs` sebagai pola). Output: hanya fingerprint / config id, bukan secret.

**Kapan env HARUS di-set via inline `KEY=val command`** (mis. run `upsert-provider-key.mjs` ad-hoc):

- Aman selama tidak di-echo atau di-log. `KEY1=val1 KEY2=val2 node script.mjs` — env var tidak muncul di stdout selama script tidak mencetaknya.
- Untuk secret yang sensitif (`PROVIDER_KEY_ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, `BYNARA_*_API_KEY`), **utamakan wrapper script** di atas pola inline. Pola inline hanya untuk debugging cepat di mana output di-truncate.

**Setelah rotasi / kebocoran**:

- Segera rotate secret di dashboard (Supabase / Vercel / Bynara / OpenRouter / dll).
- Update `.env` lokal, Vercel env, dan GitHub Secrets sesuai.
- Untuk `PROVIDER_KEY_ENCRYPTION_KEY`: kalau di-rotate, SEMUA `provider_keys` perlu di-re-encrypt dengan key baru (script re-encrypt belum ada — task terpisah).
