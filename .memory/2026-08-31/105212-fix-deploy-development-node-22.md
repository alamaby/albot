# Fix deploy-development Node version (engines + dashboard 22.x)

Date: 2026-08-31

## Task / Problem
`deploy-development` masih gagal di step "Build (preview target)" dengan error `Found invalid Node.js Version: "24.x". Please set Node.js Version to 22.x in your Project Settings to use Node.js 22.` Setelah user re-scope `VERCEL_TOKEN` ke personal access token (run `0054340` → 403 issue resolved), langkah `vercel pull` sekarang sukses menarik project settings dari Vercel; langkah `vercel build` CLI 47 menolak nilai `nodeVersion: "24.x"` hasil pull tersebut sebagai invalid.

RCA: `package.json` tidak punya `engines` dan `vercel.json` tidak punya `engines` (hanya `functions.maxDuration`). Vercel jatuh ke Project Settings dashboard (24.x) untuk `vercel build` CLI. Precedence: `package.json` `engines.node` override dashboard **untuk platform build** (prod git-integration) tapi CLI `vercel build` lokal **validasi project-setting hasil `vercel pull`** — jadi untuk dev CI perlu dashboard 22.x, tidak cukup engines saja.

## Work Done
- Tambah `"engines": { "node": "22.x" }` ke `package.json` (setelah `"private": true`) — guardrail repo
- Gate lokal hijau: `format:check` ✓, `lint` ✓ (0 errors; 2 warning pre-existing di `scripts/e2e-m6-fault-injection.mjs` yang sudah di-accept di remediation 30 Ags), `typecheck` ✓, `test:unit` 297/297 ✓, `build` ✓
- Skip bump `@types/node` ^20 → ^22 (deferred) — types Node 20 tetap kompatibel dengan runtime 22; bump tambah lockfile noise tanpa nilai langsung
- Skip workflow hack (override `.vercel/project.json` `nodeVersion` setelah `vercel pull`) — fragile, tidak fix prod, dashboard fix lebih clean
- Commit terpisah per topik (tanpa trailer `Co-authored-by:`):
  - `08ad863` `chore(ci): pin node 22.x via package.json engines`
  - `6a961ea` `docs(plan): add plan for fix deploy-development node 22`
- Push `2baeef6..6a961ea main` → `validate` akan auto-trigger; `migrate-development` kemudian `deploy-development` (manual workflow_dispatch setelah user action)
- Plan file: `plans/2026-08-31-fix-deploy-development-node-22.md`

## Decisions
- **engines.node + dashboard 22.x** (bukan salah satu): engines sebagai guardrail untuk prod + konsistensi local; dashboard untuk fix definitif dev CI `vercel build`
- **Tidak bump @types/node**: types additive/backward-compat; noise vs value tidak sepadan
- **Tidak ubah workflow**: `validate.yml` dan `deploy-development.yml` sudah pakai `actions/setup-node@22` — konsisten dengan engines
- **engines tidak enforce runtime lokal**: hanya metadata; `npm ci` tidak break, validate lokal tidak affected

## Open Items / Blockers
- **USER ACTION 1 — set Vercel dashboard Node.js Version = 22.x** (satu-satunya tersisa untuk deploy-development):
  1. Vercel dashboard → Project Settings → General → Node.js Version = **22.x** untuk project dev `prj_joLciwdA37o6er3DKRSkiWlOhgJs`
  2. Set juga project **prod** untuk konsistensi
  3. `gh workflow run deploy-development.yml` (atau `workflow_dispatch` di GitHub Actions tab)
  4. Verifikasi step "Build (preview target)" hijau; alias `albot-dev.vercel.app` deploy sukses; health `status:ok`
- Setelah bukti hijau: update `plans/2026-08-30-repo-analysis-remediation-plan.md` Phase 4 final (closure) + `.memory/README.md` Open Blockers + `TODO.md`

## Commit Proposal
- `chore(ci): pin node 22.x via package.json engines` (done, `08ad863`)
- `docs(plan): add plan for fix deploy-development node 22` (done, `6a961ea`)
