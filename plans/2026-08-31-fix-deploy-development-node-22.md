# Fix deploy-development Node version (engines + dashboard 22.x)

Created: 2026-08-31 10:47:09

## Objective
Unblock `deploy-development` CI: step "Build (preview target)" gagal karena `vercel build` (CLI 47) menolak pulled project setting Node.js Version = "24.x" sebagai invalid, meminta "22.x". Fix definitif via dua jalur: (1) repo guardrail `engines.node: "22.x"` di `package.json` untuk prod git-integration builds + konsistensi local dev, (2) USER ACTION set Vercel dashboard Node.js Version = 22.x untuk dev (dan prod) project karena `vercel build` CLI validasi project-setting hasil `vercel pull`.

## Scope
- `package.json` — add `"engines": { "node": "22.x" }`
- (USER ACTION) Vercel dashboard → Project Settings → General → Node.js Version = 22.x (dev + prod)
- No migration, no workflow change, no `@types/node` bump (deferred; ^20 tetap kompatibel runtime 22)

## Milestones
1. Phase 1 — Repo guardrail + verifikasi lokal
2. Phase 2 — Commit + push
3. Phase 3 — User action: dashboard + workflow_dispatch
4. Phase 4 — Tutup plan; update memory/TODO

## Tasks
- [x] Tambah `"engines": { "node": "22.x" }` ke `package.json`
- [x] Gate lokal hijau: `lint`, `typecheck`, `test:unit` 297/297, `build`, `format:check`
- [x] Commit `fix(ci): pin node 22.x via package.json engines` (tanpa `Co-authored-by:`)
- [x] Push → `validate` ✓ di `validate.yml`
- [ ] **USER ACTION**: set Vercel dashboard → Project Settings → General → Node.js Version = 22.x untuk **dev** `prj_joLciwdA37o6er3DKRSkiWlOhgJs` dan **prod**
- [ ] `workflow_dispatch` `deploy-development` → step "Build (preview target)" hijau
- [ ] Update `.memory/README.md` (Open Blockers deploy-development CLOSED), `TODO.md`, `plans/2026-08-30-repo-analysis-remediation-plan.md` Phase 4 task final (setelah bukti hijau)
- [ ] Backfill entri `.memory/2026-08-31/` — closure deploy-development thread

## Risks
- **engines.node alone TIDAK cukup** untuk dev CI `vercel build` — CLI validasi project-setting hasil `vercel pull`; `engines` override di platform-build (prod git-integration) tapi belum tentu di CLI-build lokal. Dashboard 22.x adalah fix definitif untuk dev CI; engines = guardrail prod + konsistensi local dev.
- Pin 22.x lock future bump ke edit `package.json` — standar practice, mencegah drift seperti sekarang (dashboard pernah diset 24.x tanpa repos awareness).
- Prod auto-deploy (Vercel Git integration): `engines.node` kemungkinan override di platform-build sehingga prod tetap build walau dashboard prod 24.x; tapi set dashboard prod 22.x untuk konsistensi + defensif.
- `validate.yml` & `deploy-development.yml` sudah pakai `actions/setup-node` `node-version: 22` (line 20 & 35) — konsisten dengan engines. Tidak ada perubahan workflow.

## Progress Log
- 2026-08-31 10:47:09 — Plan dibuat. RCA: package.json tidak punya `engines`, fallback ke dashboard 24.x → `vercel build` reject. Fix: engines.node 22.x + dashboard 22.x.
- 2026-08-31 10:48 — Repo guardrail ditulis. Gate lokal hijau (lint/typecheck/test:unit/build/format:check). Commit + push.
- 2026-08-31 10:50 — Sisa user action: dashboard 22.x + workflow_dispatch. Setelah bukti hijau, update memory/TODO/plan.

## Notes
- `@types/node: "^20"` tidak di-bump ke ^22 (deferred) — types Node 20 kompatibel dengan runtime 22; bump akan add lockfile noise tanpa nilai langsung.
- `vercel.json` (sudah dicek): hanya berisi `framework: nextjs` + `functions.maxDuration`. Tidak ada `engines` di sana.
- Plan lain standing by: `plans/2026-08-31-telegram-reasoning-provider-info.md` (akan dibuat terpisah setelah deploy-development hijau, eksekusi beda sesi).
