# Recovery Workflow Review Fix

Created: 2026-08-25
Source: review implementasi `plans/2026-08-25-recovery-production-cron.md` (commit `ab6e729`)

## Objective

Hardening workflow recovery (script injection + diagnostics) dan sinkronisasi docs cadence 20 menit + cron prod. Tidak ada perubahan perilaku runtime, jadwal, endpoint, atau secret.

## Temuan Review

| # | Severity | Temuan | Lokasi |
|---|---|---|---|
| F1 | LOW (security hardening) | `${{ inputs.recovery_url }}` diinterpolasi langsung ke blok `run:` — injection vector (mitigasi: dispatch butuh write access) | recovery-production.yml:36 + recovery-development.yml:43 |
| F2 | LOW (diagnostics) | `curl -f` suppress body+status saat HTTP ≥400 → pesan error "returned HTTP " kosong; check eksplisit `!= 200` sudah ada | recovery-production.yml:49 + recovery-development.yml:56 |
| F3 | INFO (docs drift) | Stale "5 menit/5-minute" (cadence kini */20 + ada cron prod) | env-vars:48, retention.md:13, recovery-development.yml:23 comment, milestone-6-incident-response.md:103 |
| F4 | INFO (cosmetic) | Summary `if: always()` render kosong saat early failure — tertutup fix F2 | recovery-production.yml:66 |

Kesesuaian plan asli: 100% (semua item plan terimplementasi). Tidak ditemukan masalah fungsional/race/secret leak.

## Tasks

- [ ] T-1: `recovery-production.yml` — input via `env:` (bukan interpolasi inline), hapus `curl -f`
- [ ] T-2: `recovery-development.yml` — fix sama + comment "5-minute" → "20-minute"
- [ ] T-3: Docs — env-vars:48, retention.md:13, milestone-6-incident-response.md:103 (cadence 20 menit + cron prod). M6 closure plan = historis, tidak diubah.
- [ ] T-4: Verifikasi lokal (format:check memvalidasi YAML, lint, test:unit sanity)
- [ ] T-5: Commit + push — tanpa redeploy Vercel (workflow dibaca repo saat trigger)
- [ ] T-6: Progress log + memory follow-up note

## Risks

| Risiko | Mitigasi |
|---|---|
| Perubahan workflow mem-break dispatch | Struktur step sama; hanya passing input + flag curl. User verifikasi manual dispatch ulang (digabung T-6/T-7 plan recovery-production yang belum dilakukan) |
| YAML syntax error | `format:check` prettier memvalidasi parsing YAML |

## Progress Log

- 2026-08-25 — Plan dibuat setelah review implementasi; menunggu eksekusi.

## Notes

- F1/F2 diperbaiki di kedua workflow agar tidak menyisakan pola lama.
- Commit proposal: `fix: harden recovery workflows (env input, curl status) + sync cadence docs`
