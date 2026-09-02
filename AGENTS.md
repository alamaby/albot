<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Migration Workflow

Setiap migration baru (`supabase/migrations/<timestamp>_*.sql`) WAJIB:

1. **Update `EXPECTED_MIGRATIONS`** di `tests/integration/schema.integration.test.ts` — tambahkan 14-digit timestamp migration baru. Workflow `migrate-development.yml` menjalankan hosted test `records exactly the expected applied migrations`; kalau entry tidak di-update, workflow gagal di step "Run hosted tests" SETELAH migration ter-apply ke dev (sudah terjadi 3×: M3, M6 `534dee3`, dan regresi 2026-08-20).
2. **Update `EXPECTED_FUNCTIONS`** di `tests/integration/schema.integration.test.ts` — kalau migration menambah/mengubah RPC (CREATE FUNCTION), tambahkan signature + search_path + prosecdef ke array `EXPECTED_FUNCTIONS`, dan tambahkan nama function ke `IN (...)` list di query `pg_proc` serta ke `has_function_privilege` loop di test "grants execute of atomic functions only to service_role". Tanpa ini, hosted test "has correct function signatures" gagal.
3. **Regenerate types sebelum commit**: jalankan `npm run db:types` (bukan hanya `db:types:check`) — kalau migration mengubah schema (tabel/kolom/RPC), ini regenerate `src/server/supabase/database.types.ts`. Lalu `npm run db:types:check` untuk verifikasi match. Kalau `db:types:check` gagal di CI ("Fail on generated type drift"), berarti types belum di-regenerate.
   - **Kenapa step ini sering gagal (contoh 2026-09-02 `prompt_configs`):** workflow `migrate-development.yml` menjalankan `Apply pending migrations` **dulu**, baru `Fail on generated type drift`. Jadi dev **sudah** punya tabel baru saat check dijalankan. Kalau committed `database.types.ts` di-patch manual (urutan tabel salah, `p_actor?: string | null` vs `p_actor?: string`), diff 100+ baris dan CI gagal — persis yang terjadi di run 33606504942 (prompt_configs urutan alfabet salah, 185 baris diff).
   - **Jangan pernah hand-edit `database.types.ts`.** Selalu regenerate via CLI — CLI menaruh tabel & fungsi **urutan alfabet** dan mengetikkan `p_actor?: string` (optional, bukan nullable).
   - **Check lokal yang benar sebelum commit:**
     ```bash
     # 1) pastikan migration list lokal melihat dev (butuh SUPABASE_ACCESS_TOKEN)
     npx supabase migration list | cat   # pending migrations sebelum push
     npm run db:types:check              # akan FAIL sebelum migration ter-apply di dev — ini expected untuk first push
     # 2) setelah dev sudah punya migration (atau untuk fix drift post-push), regenerate yang benar:
     npm run db:types && npm run format && npm run db:types:check  # harus [ok]
     # 3) jika diff spesifik soal urutan, jangan edit manual — overwrite total via db:types
     ```
   - **First-push chicken-egg:** untuk migration baru, `db:types:check` lokal **sebelum push** memang akan FAIL (generated dari dev lama tanpa tabel baru). Itu **bukan** alasan hand-patch — push migration + committed types yang sudah di-regenerate **setelah** `supabase db push` lokal ke dev, atau push dulu lalu segera `npm run db:types` setelah workflow `Apply pending migrations` sukses dan commit follow-up fix. Yang terpenting: di workflow, check dijalankan **setelah** `db push`, jadi committed file harus sama dengan generated **setelah** migration.
4. **Verifikasi lokal lengkap sebelum commit**: `npm run db:lint`, `npm run db:check-migrations`, `npm run db:types:check`, `npm run test:unit`, `npm run test:hosted` (LAWAN DB DEV LIVE — ini yang dijalankan CI di "Run hosted tests"; jika lokal gagal, CI pasti gagal), `npm run lint`, `npm run typecheck`, `npm run build`, `npm run format:check` — semuanya harus hijau.
   - Jika `db:types:check` gagal lokal **dan** `supabase migration list` menunjukkan pending di dev, jangan commit patch manual — biarkan workflow apply dulu, lalu regenerate dan push fix.
5. Jangan trigger `migrate-development.yml` sebelum semua check hijau dan commit sudah di-push. Hindari push beruntun (multiple pushes = concurrent workflow runs = race condition di hosted tests); gabungkan perubahan ke satu commit sebelum push.
6. Jika `test:hosted` flaky (timeout/race), rerun workflow `--failed` setelah concurrent run selesai.

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
