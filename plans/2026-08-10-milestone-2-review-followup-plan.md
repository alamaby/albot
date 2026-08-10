# Milestone 2 Post-Closure Review Follow-Up Plan

Created: 2026-08-10 11:45:00

## Objective

Tutup residual findings dari code review post-closure M2 (commit `b5d5a64`). Review mengkonfirmasi semua 5 fix closure M2 match plan (M1/M4/M5/M6/C-Low A), lalu menemukan 8 temuan baru. Plan ini mengeksekusi 7 findings material/trivial dan meng-accept 1 (Review-7) dengan dokumentasi.

## Scope

- Pixazo https-only validation, body request_id fallback, metadata enrichment.
- Extract `readProviderRequestId` helper (dedupe duplikasi di 2 adapters).
- `markSuccess` affected-rows check.
- Hosted contract tests: `rotateKey` rollback (2 skenario) + `markSuccess` unknown key.
- `selectProvider` dual-strategy JSDoc (design decision documentation).
- Verifikasi penuh + commit + push.

## Out Of Scope

- Schema change.
- Provider adapter baru.
- Perubahan yang bukan dari review findings.
- Perilaku weighted selection (sudah selesai di closure M2).

## Milestones

1. Phase 1: Pixazo adapter hardening (Review-1/6/8).
2. Phase 2: Extract `readProviderRequestId` (Review-4).
3. Phase 3: `markSuccess` affected rows (Review-5).
4. Phase 4: `rotateKey` rollback hosted tests (Review-2).
5. Phase 5: `selectProvider` JSDoc (Review-3).
6. Phase 6: Verifikasi + commit + push.

## Tasks

### Phase 1 — Pixazo adapter hardening

- [x] P1.1: Ganti `output.startsWith("http")` → `https://` check di flux branch (`pixazo.adapter.ts:146`). → `isHttpsUrl` dari `http.ts`.
- [x] P1.2: Ganti `imageUrl.startsWith("http")` → `https://` check di SDXL branch (`pixazo.adapter.ts:166`). → `isHttpsUrl`.
- [x] P1.3: Body field fallback `json["request_id"] ?? json["id"]` di kedua branch. → `readBodyRequestId` helper.
- [x] P1.4: Pixazo `metadata: { model: this.model, providerRequestId }`.
- [x] P1.5: Contract tests: `http://` → reject `provider_response_invalid`; SDXL `request_id` field ter-capture. → 4 test baru.
- [x] P1.6: `npm test` pass.

### Phase 2 — Extract readProviderRequestId

- [x] P2.1: Tambah `readProviderRequestId(response): string | undefined` di `src/server/providers/http.ts`. (+ `isHttpsUrl`)
- [x] P2.2: Ganti helper lokal di `openai-compatible.adapter.ts` + `pixazo.adapter.ts`.
- [x] P2.3: `npm test` + lint.

### Phase 3 — markSuccess affected rows

- [x] P3.1: `markSuccess` tambah `.select("id")` + check `data?.length === 0` → throw `key not found`.
- [x] P3.2: Hosted test `markSuccess on unknown key throws`.

### Phase 4 — rotateKey rollback hosted tests

- [x] P4.1: Hosted test — vault `getDecryptableKey` melempar error → new key deleted + error rethrown. → vault stub injected via constructor (vault jadi injectable).
- [x] P4.2: Hosted test — decrypt verification mismatch (non-throwing) → new key deleted + error rethrown.

### Phase 5 — selectProvider JSDoc

- [x] P5.1: JSDoc `selectProvider` menjelaskan dua dimensi strategi (top-level config selection vs config row key selection).
- [x] P5.2: Tanpa code change lain.

### Phase 6 — Verifikasi + commit + push

- [x] P6.1: `npm run lint`, `npm run typecheck` — bersih.
- [x] P6.2: `npm test` — 150 pass (17 files).
- [x] P6.3: `npm run test:hosted` (REQUIRE_HOSTED_TESTS=true) — 74 pass, 0 skip.
- [x] P6.4: `npm run format:check`, `npm run build` — lulus.
- [x] P6.5: `npm run db:lint`, `db:check-migrations`, `db:types:check` — lulus.
- [x] P6.6: Update plan ini (check off + Progress Log).
- [x] P6.7: Update `.memory/<ts>-review-followup.md` + `.memory/README.md`.
- [x] P6.8: Commit + push.

## Risks

- **P1 (https-only)**: Pixazo output CDN sudah dikonfirmasi https di M2; risk reject rendah. Tests cover http → reject.
- **P3 (markSuccess throw)**: Caller M3 belum ada; behavior jadi lebih ketat (fail-fast) — diinginkan.
- **P4 (hosted test)**: Butuh hosted dev credentials di `.env` lokal (gitignored).
- **Review-7 accepted**: `selectKey` signature tetap `ProviderStrategy` wide untuk future flexibility.

## Verification Commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:hosted   # REQUIRE_HOSTED_TESTS=true
npm run format:check
npm run build
npm run db:lint
npm run db:check-migrations
npm run db:types:check
```

## Acceptance Criteria

- [x] Pixazo menolak `http://` image URL dengan `provider_response_invalid`.
- [x] Pixazo body request_id fallback ke `id` jika `request_id` absent (dan sebaliknya).
- [x] Pixazo metadata berisi `model` + `providerRequestId`.
- [x] `readProviderRequestId` extracted, tidak ada duplikasi di adapters.
- [x] `markSuccess` melempar error jika key tidak ditemukan.
- [x] `rotateKey` rollback hosted tests lulus (2 skenario).
- [x] `selectProvider` JSDoc menjelaskan dual-strategy design.
- [x] Semua verifikasi commands lulus.
- [x] Plan + memory ter-update.
- [x] Commit + push ke `main`.

## Progress Log

- 2026-08-10 11:45:00 — Plan dibuat setelah code review post-closure M2. 8 findings teridentifikasi: Review-1 (Pixazo https), Review-2 (rotate rollback test), Review-3 (doc), Review-4 (extract readRequestId), Review-5 (markSuccess check), Review-6 (body field fallback), Review-7 (accept), Review-8 (metadata). Semua kecuali Review-7 dieksekusi.
- 2026-08-10 14:10 — Implementasi selesai. Detail: `src/server/providers/http.ts` (readProviderRequestId + isHttpsUrl); Pixazo adapter pakai https-only + `readBodyRequestId` fallback + metadata model; OpenAI adapter pakai helper; `ProviderKeyVaultRepository` vault injectable di `ProviderKeyRepository` constructor; `markSuccess` throw bila key not found; JSDoc `selectProvider` dual-strategy. Contract test hosted butuh pemetaan base env names (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) dari `getHostedEnv()` + `resetServerEnvCache()` karena repository memakai `getServerEnv()`. Verifikasi: 150 unit, hosted 74/0 skip, lint/typecheck/format/build/db lulus.

## Notes

- Domain tidak masuk telecom/billing; Oracle C2M tidak relevan. TOGAF proporsional.
- Database MCP read-only; tidak ada schema change.
- Conventional Commit proposal: `fix(provider): apply post-closure review findings (medium/low)`.
