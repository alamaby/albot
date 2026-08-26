# Command Expansion Review Fix

Created: 2026-08-26
Source: review implementasi `plans/2026-08-26-command-expansion-help-generate-enhance.md` (commit `6f86f1b`)

## Objective

Menutup temuan review F1-F6 sebelum migration workflow. F2 (hosted contract test direct-generation) wajib — workflow `migrate-development` menjalankan hosted tests. Zero runtime behavior change pada happy path.

## Temuan

| # | Severity | Temuan |
|---|---|---|
| F1 | MEDIUM (robustness) | `parsePayload`: `BigInt("abc")` throw di luar try/catch → retry loop (harusnya `malformed_payload` non-retryable immediate) |
| F2 | MEDIUM (test gap vs plan) | Hosted contract test path 6-arg direct-generation tidak dibuat (plan T-7) |
| F3 | LOW (test gap) | Tidak ada test persist status message sukses |
| F4 | LOW (test gap) | Tidak ada test dispatch-failure /generate-image |
| F5 | INFO (naming) | Variabel `helpCommand` dipakai untuk semua command |
| F6 | INFO (duplication) | `extractSentMessageId` duplikat `extractMessageId` callback-state-machine |
| F7 | INFO (UX, by design) | `/generate-image` saat `awaiting_revision_input` ditolak guard active-session — dokumentasikan |
| F8 | RISK (kontingensi) | Representasi types overload 6-arg — regen+commit jika workflow check gagal (M6 pattern) |

## Tasks

- [x] T-1 (F1): parsePayload BigInt try/catch → null + test payload non-numerik
- [x] T-2 (F2): contract test direct path 6-arg (session generating, revision completed+enhanced_prompt, job generate_image) + reject blank/over-length
- [x] T-3 (F3+F4): unit test persist status sukses + dispatch-failure path
- [x] T-4 (F5): rename `helpCommand` → `command`
- [x] T-5 (F6): export `extractMessageId` dari callback-state-machine, hapus duplikat
- [x] T-6 (F7): dokumentasi Progress Log — `/generate-image` saat `awaiting_revision_input` ditolak guard active-session (by design; user /cancel dulu atau kirim revisi)
- [x] T-7: Verifikasi lokal (lint 0 error/2 warning pre-existing, typecheck ok, 274 unit, build ok, format ok; db:types:check expected-red sampai migrate-dev — types pre-staged)
- [x] T-8: Commit + push `c92b4e8`
- [ ] T-9: User trigger migrate-development (`c92b4e8f06a5c2926b94901c2c6a17cb93443e43`) → migrate-production → deploy → E2E

## Risks

| Risiko | Mitigasi |
|---|---|
| Contract test direct-path gagal di hosted | Menunjukkan bug migration nyata — justru nilai test |
| F8 types overload | Kontingensi regen+commit setelah dev migrate |
| Attestation SHA bergeser | Memang disengaja — migrate-dev di-trigger setelah commit fix |

## Progress Log

- 2026-08-26 — Plan dibuat setelah review; eksekusi dimulai.
- 2026-08-26 — T-1..T-8 DONE, pushed `c92b4e8` (274 unit pass). Sisa T-9: user trigger migrate-development dengan SHA `c92b4e8f06a5c2926b94901c2c6a17cb93443e43`.
- 2026-08-26 — **F8 kontingensi tereksekusi**: migrate-development gagal di `db:types:check` — gen types merepresentasikan overload sebagai UNION (`5-arg | 6-arg`), bukan merged optional seperti pre-stage manual. Migration SUDAH ter-apply ke dev (push sukses sebelum types check). Regen lokal `b76cc42` → semua check hijau.
- 2026-08-26 — Re-run migrate-dev `fc207aa` gagal di hosted tests: (1) bug test saya — direct-mode select 5 kolom tapi assert 7 field (fixed select); (2) flaky dedupe contract (seed space 9999, leftover collision) → beforeAll cleanup. Full hosted suite lokal **126/126 hijau**. Pushed `15fd84a`. **Re-trigger migrate-development dengan `15fd84a06d97a7fb497261618e5b30bd95d86289`** (db push no-op, hosted tests harus hijau sekarang).
