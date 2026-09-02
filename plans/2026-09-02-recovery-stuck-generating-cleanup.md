# Recovery — Bersihkan Sesi Generating Stuck (15m)

Created: 2026-09-02

## Objective
Recovery `*/20` otomatis ubah `generating` yang `processing` >15m jadi `generation_failed` + edit Telegram `Sedang membuat gambar...` → `Gagal...`, sehingga Regenerate tidak keblok toast `Sesi sedang diproses.` tanpa script manual.

Decisions: 1) 15 menit 2) perlu edit status message 3) batch 25 cukup.

## Scope
- In: migrasi `recover_stuck_generating_sessions`, `recovery.repository`, `recovery.ts`, `api/recovery/run`, tests
- Out: selector/provider (sudah fix)

## Milestones
1. RPC migrasi
2. Integrasi recovery + edit status
3. Tests + deploy

## Tasks
- [x] Migrasi 20260902_recover_stuck_generating (p_max_sessions 25, p_stuck_minutes 15) — loop generating + processing old → mark_generation_attempt_failed + transition_prompt_session generating->generation_failed + return setof sessions
- [x] recovery.repository: recoverStuckGeneratingSessions
- [x] recovery.ts: panggil setelah expireStaleLeases, loop edit Telegram status best-effort (buildGenerationStatusMessage failed), log recoveredGenerating
- [x] schema.integration: EXPECTED_MIGRATIONS + function check, contract test
- [x] Verifikasi db:lint, test:unit, typecheck, build

## Risks
- False positive untuk image lambat >15m — mitigasi lease 5m, jadi >15m pasti 3x lease.
- Edit status best-effort, tidak fail recovery.

## Progress Log
- 2026-09-02 — Plan dibuat, investigasi stuck 77c4 (9 attempts, lease_expired)
- 2026-09-02 — Implementasi migrasi 20260902085338, recovery 15m + edit status, tests hijau, siap deploy

## Notes
- Batch 25 cukup, threshold 15m.
