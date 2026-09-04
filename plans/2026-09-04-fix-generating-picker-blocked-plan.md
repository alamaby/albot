# Fix Generating Picker Blocked + Model Switch Cancel & Regenerate Plan

Created: 2026-09-04 00:00:00

## Objective
Izinkan `Ganti Model` saat status `Sedang membuat gambar, mohon tunggu.` (`generating`) tanpa toast `Sesi sedang diproses.`; ketika user ganti model di `generating` batalkan job/attempt lama dan regenerate dengan model baru. Izinkan `Ganti Reasoning` di `generating` sebagai save-only (untuk revise berikutnya). Status message di-edit agar user tidak stuck tanpa feedback. Hanya model switch yang boleh restart dari `generating` (keputusan 2026-09-04) — Regenerate tetap diblokir.

## Scope
- `src/server/application/callback-state-machine.ts` — guard `handleModelPicker`/`handleModelPicked` + `handleReasoningPicker`/`handleReasoningPicked` + `cancelAndRegenerateWithModel`
- `src/server/jobs/generate-image.handler.ts` — tidak diubah (reuse `transition generating->generation_failed` hanya untuk terminal, bukan untuk switch)
- `src/server/application/generate-image.ts` — selector sudah honor `preferredImageProviderConfigId` per-attempt (no change)
- `src/server/telegram/messages.ts` — pesan switch (inline)
- `tests/unit/callback-state-machine.test.ts` — coverage baru

## Milestones
1. Picker di `generating` tidak diblokir
2. Model switch di `generating` cancel & regenerate
3. Reasoning switch di `generating` save-only
4. Findings review & hardening, tests, push

## Tasks
- [x] Task 1 — CallbackStateMachine: `handleModelPicker` guard izinkan `generating`; `handleModelPickerRaw` teruskan `origin`; `handleModelPicked` guard izinkan `generating` + cabang `wasGenerating` ke `cancelAndRegenerateWithModel`
- [x] Task 2 — `cancelAndRegenerateWithModel`: query `jobs` queued/processing/retry_scheduled limit 5, update ke `cancelled` (model_switched), fail `processing` attempt via `mark_generation_attempt_failed` / `queued` via update, `insertGenerateImageJob` origin `model_switch_generating`, `dispatchToProcessor`, edit `telegram_status_message_id` + ack
- [x] Task 3 — Reasoning: `handleReasoningPicker`/`handleReasoningPicked` izinkan `generating`; saat `generating` hanya save + ack `Disimpan: {label} (untuk revise berikutnya)`
- [x] Task 4 — Commit awal `feat(callback): allow model switch during generating with cancel and regenerate` (329e6a7)
- [x] Task 5 — Review findings hardening (this plan)
  - [x] F1 — Reorder insert-before-cancel agar gagal insert tidak strand `generating` tanpa job
  - [x] F2 — Hapus param unused `_newProviderConfigId` / rapikan signature
  - [x] F3 — Pastikan `handleModelPickerBack`/`reshowContextWithPickers` konsisten saat `generating` (saat ini tanpa guard — pertahankan, dokumentasikan)
  - [x] F4 — Tambah unit tests untuk `generating` picker (model + reasoning) + switch queue length 1
  - [x] F5 — Pastikan `dispatchToProcessor` origin fallback tidak kosong
  - [x] F6 — Verifikasi lint/typecheck/test:unit + hosted jika tersedia
- [x] Task 6 — Commit fix + push (`4accdd1`, push `9fef500..4accdd1`)
- [x] Task 7 — F7 fix: cancel exclude eksplisit `neq("id", newJobId)` bukan heuristik newest-row (prod `c26a2216` self-cancel, attempt_count 0); Regenerate tetap diblokir dari `generating` (hanya model switch boleh restart); test regenerate-from-generating rejected
- [ ] Task 8 — Commit + push F7

## Risks
- Stale worker race: worker lama masih `processing` saat job di-cancel → `mark_generation_attempt_*` kedua akan log warn `not in processing` (ditangani best-effort). Mitigasi: update `jobs` set `locked_by=null` agar `markFailed` staled tidak match.
- Double-tap model switch → enqueue job ganda: `limit 5` + `neq(newJobId)` + `create_generation_attempt` DB guard mencegah 2 processing simultan; last-write-wins.
- Insert gagal setelah cancel → stuck `generating` tanpa job hingga recovery 15m: mitigasi F1 (insert dulu).
- RLS `FORCE`: direct `supabase.from("jobs").update` via `service_role` aman; `from "generation_attempts" update queued->cancelled` via `service_role` juga aman (bukan anon).

## Progress Log
- 2026-09-04 — Riset prod session `2f6797c2` `generating` + 429 Aichixia `retry_scheduled` → guard picker 819/927 blokir. Implementasi switch-cancel-regenerate + reasoning save-only, commit 329e6a7, typecheck ok, lint 0 error, unit 329 passed.
- 2026-09-04 — Review findings F1-F6 dibuat, plan file ini disusun sebelum hardening kedua.
- 2026-09-04 03:20 — Hardening F1/F2/F5: insert-before-cancel, hapus `_newProviderConfigId`, `dispatchToProcessor` origin fallback `https://model-switch`, keep newest queued job. F4 test generating picker. Fixes.
- 2026-09-04 03:30 — `typecheck` ok, `lint` 0 error, `test:unit` 330 passed (1 test baru generating picker), `build` gagal lokal Windows (symlink EPERM `onBuildComplete` — pre-existing, `typecheck` hijau). Commits `329e6a7` + `4accdd1` pushed `9fef500..4accdd1`.
- 2026-09-04 — F7: heuristik `rows.slice(0,-1)` bunuh diri saat tidak ada in-flight job (prod `c26a2216` `model_switched` `attempt_count 0`); fix `neq("id", newJobId)`. Keputusan: hanya model switch boleh restart — Regenerate tetap `rejected_state` dari `generating` (komentar + test).

## Notes
- Keputusan user: (1) Batalkan job & regenerate langsung (bukan save-only), (2) Ya izinkan reasoning di generating. Implementasi sesuai.
- Alternatif save-only ditolak untuk image (user eksplisit minta cancel), dipertahankan untuk reasoning.
- TOGAF/TM Forum ODA tidak relevan — ini bugfix state machine.
