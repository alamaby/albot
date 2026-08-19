# Milestone 5 Closure Plan

Date: 2026-08-19
Status: Closure

## Objective

Menutup Milestone 5 (Image Generation and Post-Result Actions) dengan evidence lengkap: implementasi, fix review, verifikasi otomatis, E2E dev, acceptance criteria, dan catatan remediasi.

## Milestone Verification (template master plan)

- **Milestone**: 5 — Image Generation and Post-Result Actions
- **Environment**: development
- **Commit**: `ca77783` (feat M5) + fixes: `ae013c1` (attempt processing), `87f3a5f` (chore), `a0ac04e` (selector failover), `155da6f` (expired-session ack), `ef70a8a` (session expiry 24h)
- **Vercel deployment**: `https://albot-6qwa5y8ji-alam-aby-bashits-projects.vercel.app` (final, E2E)
- **Supabase migration version**: 13 (dev), 0 (production)

## Automated Checks

- [x] Install — `npm ci` clean
- [x] Lint — 0 errors/warnings
- [x] Typecheck — clean
- [x] Unit tests — 212 passed
- [x] Contract tests — generation-flow (1), generation-rpc (6), enhancement-flow, revision-rpc, database-functions, dll
- [x] Hosted integration tests — schema integration (13 migrations), service-role smoke, RLS security
- [x] Build — clean (Next.js production build)
- [x] Secret scan — gitleaks green (CI)
- [x] db:lint, db:check-migrations (13), db:types:check — clean
- [x] Total `npm test` — 306 passed (39 files)

### CI Runs (commit -> run)

- `ca77783` -> validate https://github.com/alamaby/albot/actions/runs/32118704351 — success
- `a0ac04e`, `155da6f`, `ef70a8a` — validate success (run pada masing-masing commit)

## Migration

- Dev: 13/13 applied (Local==Remote) — `20260818100000` (M5 generation RPC) + `20260819100000` (session expiry 24h) ditambah dari 11 M4.
- Production: 0 migrations, untouched.

## E2E (dev, Telegram + Vercel Preview)

### Sesi 1 — Generate + Regenerate (session `5a3d7b29`)

1. Prompt "desain poster kafe cozy di malam hari" → enhancement → konfirmasi.
2. Generate → attempt 1 gagal `provider_key_unavailable` (sisa mock config aktif + selector belum failover) → session `generation_failed` → retry Generate → attempt 2 `succeeded` (Pixazo `fcbf7bb8`, telegram_message_id 52).
3. Regenerate → attempt 3 (df99d0f5) menunjuk revisi 1, gambar terkirim. Screenshot: "Gambar 2 dari revisi 1" + tombol Regenerate / Revise Prompt / Selesai.
4. Session `result_ready`.

### Sesi 2 — Alur lengkap (session `66e96dfa`, completed)

1. Prompt "desain poster kafe cozy di pagi hari" → enhancement revisi 1 `completed`.
2. Generate → attempt 1 `succeeded` (revisi 1, telegram_message_id 56).
3. Revise Prompt → instruksi "tambahkan model wanita muda dengan pakaian casual" → revision 2 `completed` (revisi 1 tidak berubah/immutable).
4. Generate → attempt 2 `succeeded` (revisi 2, telegram_message_id 61).
5. Generate lagi (Regenerate) → attempt 3 `succeeded` (revisi 2, telegram_message_id 62).
6. Selesai → session `completed` (completed_at set).

Expected relational state (master plan): 1 session, 2 revisions, 3 attempts (1 → rev 1; 2,3 → rev 2) — **terverifikasi persis**.

## Acceptance Criteria (master plan M5)

- [x] Gambar muncul di Telegram (screenshot sesi 1 & 2).
- [x] Generation sukses menampilkan tiga result actions (Regenerate/Revise Prompt/Selesai).
- [x] Regenerate membuat satu attempt baru tanpa revision baru (attempt 3 → revisi 2, no new revision).
- [x] Revise membuat satu revision baru dan meminta konfirmasi lagi (revisi 2 + konfirmasi ulang).
- [x] Complete menutup sesi (session `completed`).
- [x] Double-click regenerate membuat paling banyak satu attempt (guard RPC `create_generation_attempt` + CAS + dedupe callback; contract test `rejects a new attempt while a generation is in progress`).
- [x] Kode spesifik Pixazo tetap di adapter/config/tests (pixazo.adapter.ts, registry, seed; domain tidak menyebut vendor).
- [x] Image provider alternatif bisa dipilih berdasarkan capability (selector failover unit test).
- [x] Tidak ada objek gambar di Supabase Storage (tidak ada bucket; kirim via URL langsung).
- [x] Delivery retry tidak regenerate bila output reusable ada (sendPhoto immediate; recovery penuh M6).

## Failure/Concurrency Scenarios (master plan M5)

- [x] Pixazo timeout/429/401 — classification unit test (retryable vs non-retryable).
- [x] Pending provider request — ditolak non-retryable `provider_response_invalid` (sync-only, unit test).
- [x] Telegram sendPhoto gagal — attempt `failed`, session `generation_failed`, user dapat retry (unit test).
- [x] Double-click regenerate — satu attempt (contract test + RPC guard).
- [x] Revise Prompt saat generation aktif — ditolak state machine (unit test).
- [x] Callback dari stale result message — dedupe callback_query_id + CAS (unit test).
- [x] Session expired — callback di-ack "Sesi telah berakhir. Kirim prompt baru." (fix `155da6f`).

## Remediation During E2E (bugs found & fixed)

1. **Callback generate tidak dispatch job** — `CallbackStateMachine` tidak memanggil `dispatchToProcessor` setelah insert job; job `generate_image` stuck `queued`. Fix: dep `dispatchToProcessor` + `origin` di input, dispatch best-effort setelah insert (fix A, commit `ca77783`).
2. **Attempt stuck `queued` saat selectProvider gagal** — `markProcessing` dipanggil setelah selectProvider; error di luar try membuat attempt tak pernah `processing`, `mark_generation_attempt_failed` (guard processing) menolak. Fix: `markProcessing` segera setelah `createAttempt`, `attachProviderToAttempt` untuk config+seed (commit `ae013c1`).
3. **Session stuck `generating` tanpa retry path** — terminal failure tidak transisi ke `generation_failed`. Fix: handler transisi `generating → generation_failed`, state machine menerima generate/revise dari state itu (commit `ca77783`).
4. **`provider_key_unavailable` karena sisa mock config** — contract test meninggalkan config `mock_image_generation_contract` aktif (tanpa key) dengan priority 0; selector memilihnya lalu gagal, tidak failover ke Pixazo. Fix: selector failover ke config berikutnya yang punya eligible key + deaktivasi sisa mock di dev (commit `a0ac04e`).
5. **Callback expired ditolak diam-diam** — `rejected_expired` tanpa ack, user melihat bot "tidak merespon". Fix: ack "Sesi telah berakhir. Kirim prompt baru." (commit `155da6f`).
6. **Session expiry 30 menit terlalu singkat** untuk alur E2E utuh. Fix: migration forward-fix `20260819100000` → 24 jam dari prompt pertama (commit `ef70a8a`).

## Production Status

- Production Supabase: 0 migrations (untouched).
- Production Vercel (`albot-ten.vercel.app`): belum deploy (M7).
- Production bot/webhook: belum di-set (M7).
- Provider production config: belum ada (M7).

## Evidence Required (master plan)

- [x] Telegram E2E screenshots — sesi 1 (Gambar 2 dari revisi 1 + result buttons), sesi 2 (generate/revise/generate/generate + Selesai).
- [x] Sanitized relational query — session `66e96dfa` (2 revisions, 3 attempts, linkage benar) & `5a3d7b29`.
- [x] Provider request audit rows — provider_requests capability `image_generation` status `succeeded` http 200 (Pixazo `fcbf7bb8`).
- [x] Storage verification — tidak ada bucket/object Supabase Storage dipakai (kirim via URL).
- [x] Duplicate-regenerate test report — contract test `generation-rpc` (reject active attempt) + unit state machine.
- [x] CI run URLs + migration dev run URL (13/13).

## Known Limitations (dictatat, tidak diperbaiki M5)

- `max_attempts` DB default 3 vs classifier `GENERATION_MAX_ATTEMPTS=4` — konsisten dengan M4; job berhenti di attempt 3 oleh `claim_job`.
- Duplikat delivery risk bila persist gagal setelah sendPhoto sukses — recovery M6.
- Recovery scheduler / lease-expiry sweep / dead-job admin — M6.
- Pixazo async/polling (`getResult`) tidak diimplementasikan — sync-only, M6 bila diperlukan.
- Session expiry sweep otomatis (mark `expired`) belum ada — saat ini hanya per-callback check; M6.

## Decision

- [x] Accepted

Approver: @alamaby
Date: 2026-08-19

## Next

- Milestone 6: Reliability, Security, and Observability (recovery poll, lease expiry sweep, jitter, dead-job state, structured logging, redaction tests, session expiry process).
