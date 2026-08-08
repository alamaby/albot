# Environment Variable Inventory

Status nilai: `empty` = harus diisi, `reserved` = belum dipakai pada milestone saat ini.

## Rules

- Variable Supabase hanya boleh dipakai server-side. Dilarang memakai prefix `NEXT_PUBLIC_`.
- Secret dimasukkan langsung ke Vercel Environment / GitHub Secrets, bukan ke chat, commit, migration, atau plan.
- Development dan production harus memiliki nilai berbeda untuk semua variable di bawah ini.

## Variables

| Variable                      | Scope                   | Status                                                     | Dipakai mulai |
| ----------------------------- | ----------------------- | ---------------------------------------------------------- | ------------- |
| `NODE_ENV`                    | Semua                   | `development` / `test` / `production`                      | Milestone 0   |
| `APP_ENV`                     | Opsional                | `development` / `production`; override manual bila perlu   | Milestone 0   |
| `VERCEL_ENV`                  | Otomatis oleh Vercel    | `production` / `preview` / `development`; sumber label env | Milestone 0   |
| `SUPABASE_URL`                | Development, Production | `empty`                                                    | Milestone 0   |
| `SUPABASE_SERVICE_ROLE_KEY`   | Development, Production | `empty`                                                    | Milestone 0   |
| `PROVIDER_KEY_ENCRYPTION_KEY` | Development, Production | `reserved`                                                 | Milestone 2   |
| `TELEGRAM_BOT_TOKEN`          | Development, Production | `reserved`                                                 | Milestone 3   |
| `TELEGRAM_WEBHOOK_SECRET`     | Development, Production | `reserved`                                                 | Milestone 3   |
| `JOB_PROCESSOR_SECRET`        | Development, Production | `reserved`                                                 | Milestone 3   |

## Requirements by Milestone

### Milestone 0 (current)

- `SUPABASE_URL`: URL dari Supabase project, contoh `https://<project-ref>.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: service role key dari Supabase project. Minimal 1 karakter.
- `NODE_ENV` diisi otomatis oleh platform; tidak perlu di-set manual di Vercel.
- Label `environment` pada `/api/health` diturunkan dari `VERCEL_ENV` (Vercel menetapkan otomatis), atau di-override dengan `APP_ENV`.

### Milestone 2

- `PROVIDER_KEY_ENCRYPTION_KEY`: minimal 32 karakter, sesuai encoding yang dipakai algorithm AES-GCM.

### Milestone 3

- `TELEGRAM_BOT_TOKEN`: token dari BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: string acak dengan karakter `A-Z a-z 0-9 _ -`.
- `JOB_PROCESSOR_SECRET`: minimal 32 karakter untuk shared-secret internal processor.

## Verification

Validasi environment dilakukan oleh `src/env.ts`. Variabel yang belum `empty` (reserved) tidak divalidasi sampai milestone terkait mulai.
