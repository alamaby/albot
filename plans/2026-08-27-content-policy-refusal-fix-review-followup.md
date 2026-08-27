# Content-Policy Refusal Fix — Review Follow-up

Created: 2026-08-27
Status: Review of `1ce8f3f`/`1d3271b`

## Objective
Tutup gap review implementasi A+B+C. Klasifikasi refusal (C) dan pesan/kfeyboard (A/B) hanya berfungsi penuh di jalur sesi enhancement; dua jalur lain masih pesan generik.

## Conformity (plan `2026-08-27-content-policy-refusal-fix.md`)
- C: refusal vs malformed — ✅ prompt-structure (termasuk anti false-positive)
- A: message distinct — ⚠️ hanya di `enhance-prompt.handler` (jalur sesi); HILANG di `enhance-prompt-only.handler` (/enhance-prompt) & `generate-image.handler`
- B: keyboard Prompt Baru — ⚠️ hanya `retryKeyboard` jalur enhancement; tidak untuk `generation_failed` (image)

## Temuan
| # | Severity | Temuan |
|---|---|---|
| F2 | MEDIUM (gap A) | `/enhance-prompt` (session-less) terminal `provider_content_rejected` kirim `enhance_only_failed` generik — user tidak dapat info refusal |
| F3 | MEDIUM (gap A) | `generate-image.handler` terminal `provider_content_rejected` edit status ke "Gagal membuat gambar" generik — tidak membedakan refusal image |
| F1 | INFO | `provider_content_rejected` tidak menandai key failure (benar — bukan masalah key), tidak perlu ubah |

## Tasks
- [x] T-1 (F2): `enhance-prompt-only.handler.ts` terminal failure — content_rejected → `content_policy_declined`, else `enhance_only_failed`
- [x] T-2 (F3): `generate-image.handler.ts` status edit — content_rejected → `content_policy_declined`, else `generate_status failed`
- [x] T-3: unit tests F2 & F3 (281 total pass)
- [x] T-4: verifikasi typecheck/lint/build/format — hijau
- [x] T-5: commit + push + next steps

## Progress Log
- 2026-08-27 — Review implementasi 1ce8f3f: conformity A/B/C; gap F2 (/enhance-prompt) & F3 (generate-image) pesan generik. Plan dibuat.
- 2026-08-27 — T-1..T-5 DONE; 281 unit pass; commit + push.

## Risks
- Image refusal belum terbukti di prod — F3 adalah defensive; tidak mengubah happy path
- Menambahkan text refusal di status message image bisa membingungkan bila provider gagal alasan lain → hanya routing by code spesifik

## Notes
- B pada `generation_failed` tetap via `handleCancel` ter-generalisasi (Prompt Baru available bila keyboard menampilkan inferinum) — escape path via tombol Revise/Selesai pada foto lama.