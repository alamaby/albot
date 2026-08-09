# Environment Variable Inventory

Status nilai: `empty` = harus diisi, `reserved` = belum dipakai pada milestone saat ini, `recorded` = nilai non-secret sudah dicatat.

## Rules

- Variable Supabase hanya boleh dipakai server-side. Dilarang memakai prefix `NEXT_PUBLIC_`.
- Secret dimasukkan langsung ke Vercel Environment / GitHub Secrets, bukan ke chat, commit, migration, atau plan.
- Development dan production harus memiliki nilai berbeda untuk semua variable di bawah ini.
- Project reference (non-secret) boleh dicatat di dokumen ini; secret (password, token, service role key) tidak pernah dicatat di sini.
- Migration development/production berjalan lewat GitHub Environments `development` dan `production` (manual approval). CLI Supabase memakai `SUPABASE_ACCESS_TOKEN` dan `SUPABASE_DB_PASSWORD` environment-specific.

## Project References (non-secret)

| Environment | Project ref            | Notes                                         |
| ----------- | ---------------------- | --------------------------------------------- |
| Development | `ceqcitzbosqzxpbtlpfn` | Dedicated hosted Supabase development project |
| Production  | `pcexxtckvwmiquseznaz` | Dedicated hosted Supabase production project  |

Kedua ref berbeda dari project lain di org (mis. BagiStruk `cxgllbkbcwnqlyjoshsb`). Milestone 1 hanya boleh mengeksekusi migration ke development. Workflow production memverifikasi target terhadap ref repository-reviewed di atas (`pcexxtckvwmiquseznaz`), terlepas dari nilai secret, agar secret yang salah tidak bisa mengalihkan target.

## Variables

| Variable                      | Scope                   | Status                                              | Dipakai mulai |
| ----------------------------- | ----------------------- | --------------------------------------------------- | ------------- |
| `NODE_ENV`                    | Semua                   | `development` / `test` / `production`               | Milestone 0   |
| `APP_ENV`                     | Opsional                | `development` / `production`; override manual       | Milestone 0   |
| `VERCEL_ENV`                  | Otomatis oleh Vercel    | `production` / `preview` / `development`            | Milestone 0   |
| `SUPABASE_URL`                | Development, Production | `empty` (nilai `https://<ref>.supabase.co` di env)  | Milestone 0   |
| `SUPABASE_SERVICE_ROLE_KEY`   | Development, Production | `empty` (secret)                                    | Milestone 0   |
| `SUPABASE_PROJECT_REF`        | GitHub Environment      | `recorded` di dokumen ini; secret tersimpan per env | Milestone 1   |
| `SUPABASE_ACCESS_TOKEN`       | GitHub Environment      | `empty` (secret personal access token CLI)          | Milestone 1   |
| `SUPABASE_DB_PASSWORD`        | GitHub Environment      | `empty` (secret)                                    | Milestone 1   |
| `SUPABASE_PUBLISHABLE_KEY`    | Development, Production | `empty` (publishable/anon key untuk RLS test)       | Milestone 1   |
| `PROVIDER_KEY_ENCRYPTION_KEY` | Development, Production | `required` (base64, decode 32 bytes)                | Milestone 2   |
| `TELEGRAM_BOT_TOKEN`          | Development, Production | `reserved`                                          | Milestone 3   |
| `TELEGRAM_WEBHOOK_SECRET`     | Development, Production | `reserved`                                          | Milestone 3   |
| `JOB_PROCESSOR_SECRET`        | Development, Production | `reserved`                                          | Milestone 3   |

## GitHub Environment Secrets

Nama secret sama di kedua environment; nilainya berbeda.

### `development`

- `SUPABASE_PROJECT_REF` = `ceqcitzbosqzxpbtlpfn`
- `SUPABASE_DB_PASSWORD` = password DB project development
- `SUPABASE_ACCESS_TOKEN` = personal access token Supabase (CLI)
- `SUPABASE_URL` = `https://ceqcitzbosqzxpbtlpfn.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = service role key project development
- `SUPABASE_PUBLISHABLE_KEY` = publishable/anon key project development
- `PROVIDER_KEY_ENCRYPTION_KEY` = base64 32-byte root key project development

### `production`

- `SUPABASE_PROJECT_REF` = `pcexxtckvwmiquseznaz`
- `SUPABASE_DB_PASSWORD` = password DB project production
- `SUPABASE_ACCESS_TOKEN` = personal access token Supabase (CLI)
- `SUPABASE_URL` = `https://pcexxtckvwmiquseznaz.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = service role key project production
- `SUPABASE_PUBLISHABLE_KEY` = publishable/anon key project production
- `PROVIDER_KEY_ENCRYPTION_KEY` = base64 32-byte root key project production

## Requirements by Milestone

### Milestone 0 (current)

- `SUPABASE_URL`: URL dari Supabase project, contoh `https://<project-ref>.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: service role key dari Supabase project. Minimal 1 karakter.
- `NODE_ENV` diisi otomatis oleh platform; tidak perlu di-set manual di Vercel.
- Label `environment` pada `/api/health` diturunkan dari `VERCEL_ENV` (Vercel menetapkan otomatis), atau di-override dengan `APP_ENV`.

### Milestone 1

- GitHub Environments `development` dan `production` dengan required reviewer.
- Secret migration/CLI per environment seperti di atas.
- Migration hanya dieksekusi ke development selama Milestone 1.
- Supabase CLI dipin via `devDependencies` (`supabase@2.108.0`); workflow memakai `npx --no-install supabase`.
- Workflow dev menetapkan `REQUIRE_HOSTED_TESTS=true` sehingga hosted tests gagal (bukan skip) jika credential hilang.
- Production workflow wajib input `development_run_id`; attestation dev (conclusion + head_sha) diverifikasi sebelum apply.

### Milestone 2

- `PROVIDER_KEY_ENCRYPTION_KEY`: minimal 32 karakter, sesuai encoding yang dipakai algorithm AES-GCM.

### Milestone 3

- `TELEGRAM_BOT_TOKEN`: token dari BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: string acak dengan karakter `A-Z a-z 0-9 _ -`.
- `JOB_PROCESSOR_SECRET`: minimal 32 karakter untuk shared-secret internal processor.

## Verification

Validasi environment dilakukan oleh `src/env.ts`. Variabel yang belum `empty` (reserved) tidak divalidasi sampai milestone terkait mulai.
