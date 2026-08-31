# Pivot to manual Vercel CLI deploy — Next.js 16 adapter + disable deploy-development CI

Created: 2026-08-31 14:53:40

## Objective

1. **Fix `vercel build` failure** yang muncul setelah Node 22 pin: `next build` Next.js 16 + Turbopack masih refer ke `@vercel/next/dist/server-launcher.js` (old adapter) meski `engines.node` sudah benar. Akar: Next.js 16 pakai **Deployment Adapter API** baru (`adapterPath` config), bukan old `@vercel/next`. `vercel build` CLI 47 tidak auto-inject adapter untuk Next.js 16 (auto-inject hanya untuk Vercel platform Git integration).
2. **Disable `deploy-development.yml` CI workflow** per keputusan user (2026-08-31 14:50): workflow auto-deploy terlalu rumit (3-layer RCA sebelumnya: secrets, project.json, scope token; lalu Node version; lalu build adapter). User pilih deploy manual via Vercel CLI di lokal.
3. **Tulis `docs/runbooks/manual-deploy.md`** untuk prosedur deploy manual.

## Scope

- `package.json` — add `"@next-community/adapter-vercel": "0.0.1-beta.29"` ke `dependencies` (BUKAN `latest` 0.0.0 placeholder; pin beta.29 yang peerDeps `next: 16.3.0-canary.96`, terdekat dengan stable 16.3.0)
- `next.config.ts` — add top-level `adapterPath: require.resolve("@next-community/adapter-vercel")` (per Next.js 16.3.0 type def `node_modules/next/dist/server/config-shared.d.ts:1306`)
- `.github/workflows/deploy-development.yml` — rename ke `deploy-development.yml.disabled` (GitHub Actions abaikan non-`.yml`; preserve konten; reversible)
- `docs/runbooks/manual-deploy.md` — baru
- `.memory/2026-08-31/<ts>-manual-deploy-pivot.md` — memory entry
- `TODO.md`, `.memory/README.md`, `plans/2026-08-30-repo-analysis-remediation-plan.md` — update pivot

## Milestones

1. **Phase 1** — Adapter fix + verifikasi lokal
2. **Phase 2** — Disable CI workflow
3. **Phase 3** — Runbook manual deploy
4. **Phase 4** — Memory/TODO/plan closure + push

## Tasks

### Phase 1 — Adapter fix

- [x] Plan file dibuat
- [x] `npm install @next-community/adapter-vercel@0.0.1-beta.29` (lockfile update)
- [x] Edit `next.config.ts`:
  ```ts
  import type { NextConfig } from "next";
  import { createRequire } from "module";
  const require = createRequire(import.meta.url);
  const nextConfig: NextConfig = {
    adapterPath: require.resolve("@next-community/adapter-vercel"),
  };
  export default nextConfig;
  ```
- [x] Gate lokal hijau: `format:check`, `lint` (0 error; 2 pre-existing warning unrelated), `typecheck`, `test:unit` 297/297, `build`
- [x] Commit `chore(deps): add @next-community/adapter-vercel@0.0.1-beta.29` (tanpa `Co-authored-by:`)
- [x] Commit `chore(next): configure adapterPath for Vercel deployment`

### Phase 2 — Disable CI workflow

- [x] Rename `.github/workflows/deploy-development.yml` → `.github/workflows/deploy-development.yml.disabled`
- [x] Commit `chore(ci): disable deploy-development in favor of manual Vercel CLI deploys`

### Phase 3 — Runbook

- [x] Tulis `docs/runbooks/manual-deploy.md` (prerequisites, link, schema check, deploy preview/prod, verify, rollback, troubleshooting)
- [x] Commit `docs(runbook): add manual deploy via Vercel CLI`

### Phase 4 — Memory closure + push

- [x] Update `.memory/README.md` (timestamp, Open Blockers closure, Recent Entries, Related Plans)
- [x] Update `TODO.md` (mark deploy-development CLOSED via manual pivot)
- [x] Update `plans/2026-08-30-repo-analysis-remediation-plan.md` (Phase 4 final closure, progress log)
- [x] New `.memory/2026-08-31/<ts>-manual-deploy-pivot.md` entry
- [x] Commit `docs(memory): pivot to manual deploy + closure of CI deploy thread`
- [x] Push → `validate` ✓ + `migrate-development` ✓; `deploy-development` skip via filename

## Risks

- **Beta package** (`@next-community/adapter-vercel@0.0.1-beta.29`) — pin spesifik, reproducibilitas OK; npm `latest` tag `0.0.0` adalah placeholder, JANGAN dipakai
- **Build tool di `dependencies`** — secara semantik `devDependencies`, tapi `vercel build` strip devDeps (log "removed 204 packages" sebelumnya). Trade-off: prod install +~470 KB; acceptable
- **`adapterPath` override Vercel platform auto-config** — untuk prod Git-integration, Vercel platform mungkin pakai adapter versinya sendiri (override). Mitigasi: observasi prod build setelah push pertama; jika divergen, pindah ke `NEXT_ADAPTER_PATH` env var
- **Disable CI deploy hilangkan auto-deploy** — user tanggung jawab manual. `migrate-development` CI tetap jalan (DB tidak drift). Mitigasi: runbook + disiplin

## Progress Log

- 2026-08-31 14:53 — Plan dibuat setelah pivot user (workflow terlalu rumit, deploy manual via Vercel CLI).
- 2026-08-31 15:00 — RCA: Next.js 16 + Vercel CLI 47.0.2 tidak auto-inject `@next-community/adapter-vercel` (auto hanya untuk Vercel platform Git integration). Build trace masih cari old `@vercel/next/dist/server-launcher.js`. Fix: add adapter dep + `adapterPath` config.
- 2026-08-31 15:05 — `npm install @next-community/adapter-vercel@0.0.1-beta.29` OK (lockfile updated, no peer warnings).
- 2026-08-31 15:10 — `next.config.ts` edited. Gate lokal: format:check ✓, lint ✓, typecheck ✓, test:unit 297/297 ✓, build ✓ (kompilasi Next.js 16 via adapter, output Vercel format).
- 2026-08-31 15:15 — Commit `chore(deps)` + `chore(next)`.
- 2026-08-31 15:20 — Rename `deploy-development.yml` → `.yml.disabled`. Commit `chore(ci)`.
- 2026-08-31 15:25 — Tulis `docs/runbooks/manual-deploy.md`. Commit `docs(runbook)`.
- 2026-08-31 15:30 — Memory/TODO/remediation plan updates. Commit `docs(memory)`.
- 2026-08-31 15:35 — Push `validate` + `migrate-development` triggers (deploy-development skip).

## Notes

- `engines.node: "22.x"` (commit `08ad863`) tetap di main — guardrail valid untuk prod Git-integration builds.
- `migrate-development` CI tetap aktif — schema apply otomatis saat push main, sehingga DB selalu selaras dengan kode yang di-push. Ini critical untuk menghindari drift saat deploy manual.
- Prod (Vercel Git integration) kemungkinan masih auto-deploy seperti biasa (di luar workflow `deploy-development.yml`). Adapter di `next.config.ts` mungkin di-override oleh Vercel platform; observasi build log setelah push berikutnya.
- Plan info reasoning provider+model Telegram tetap standing by (sesi berikutnya).
- Plan `2026-08-30-repo-analysis-remediation-plan.md` (Phase 4 final user action) closed via pivot ini, bukan via bukti hijau CI.
