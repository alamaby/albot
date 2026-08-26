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

- [ ] T-1 (F1): parsePayload BigInt try/catch → null + test payload non-numerik
- [ ] T-2 (F2): contract test direct path 6-arg (session generating, revision completed+enhanced_prompt, job generate_image) + reject blank/over-length
- [ ] T-3 (F3+F4): unit test persist status sukses + dispatch-failure path
- [ ] T-4 (F5): rename `helpCommand` → `command`
- [ ] T-5 (F6): export `extractMessageId` dari callback-state-machine, hapus duplikat
- [ ] T-6 (F7): dokumentasi Progress Log
- [ ] T-7: Verifikasi lokal (lint/typecheck/test:unit/build/format; db:types:check expected-red sampai migrate-dev)
- [ ] T-8: Commit + push
- [ ] T-9: User trigger migrate-development (HEAD baru) → migrate-production → deploy → E2E

## Risks

| Risiko | Mitigasi |
|---|---|
| Contract test direct-path gagal di hosted | Menunjukkan bug migration nyata — justru nilai test |
| F8 types overload | Kontingensi regen+commit setelah dev migrate |
| Attestation SHA bergeser | Memang disengaja — migrate-dev di-trigger setelah commit fix |

## Progress Log

- 2026-08-26 — Plan dibuat setelah review; eksekusi dimulai.
