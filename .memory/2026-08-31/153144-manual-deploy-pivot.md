# Manual deploy pivot — Next.js 16 Vercel adapter + disable deploy-development CI

Date: 2026-08-31

## Task / Problem

`deploy-development` CI workflow masih gagal di step "Build (preview target)" setelah fix Node 22.x pin (`08ad863`). Error baru:

```
Tracing initial Next.js server files due to missing build trace: 11.413s
Traced Next.js server files in: 12.011s
Error: ENOENT: no such file or directory, open '.../node_modules/@vercel/next/dist/server-launcher.js'
```

RCA: Next.js 16 pakai **Deployment Adapter API** baru (`adapterPath` di `next.config`). Vercel CLI 47.0.2 tidak auto-inject adapter untuk Next.js 16 (auto-inject hanya untuk Vercel platform Git integration builds). Build trace masih cari old `@vercel/next/dist/server-launcher.js` yang tidak ada. Window symlink issue di local build (`EPERM: operation not permitted, symlink`) — perlu Developer Mode / WSL untuk lokal, tidak block CI.

User pivot: workflow terlalu rumit (3-layer RCA + 2x fix + adapter issue). Pilih deploy manual via Vercel CLI, disable CI.

## Work Done

### Adapter fix
- Tambah `"@next-community/adapter-vercel": "0.0.1-beta.29"` ke `dependencies` (BUKAN `latest` 0.0.0 placeholder; pin beta.29 yang peerDeps `next: 16.3.0-canary.96`)
- Tambah `"@vercel/build-utils": "13.6.2"` dan `"@vercel/routing-utils": "5.2.1"` ke `dependencies` (devDeps adapter yang di-require saat `next.config.ts` load time untuk `next typegen`)
- Edit `next.config.ts`:
  ```ts
  import type { NextConfig } from "next";
  import { createRequire } from "module";
  const require = createRequire(import.meta.url);
  const nextConfig: NextConfig = {
    adapterPath: require.resolve("@next-community/adapter-vercel"),
  };
  export default nextConfig;
  ```
- Gate lokal: `format:check` ✓, `lint` ✓ (2 pre-existing warning unrelated), `typecheck` ✓, `test:unit` 297/297 ✓. `npm run build` lokal Windows gagal `EPERM symlink` (Dev Mode requirement), bukan code issue

### Disable CI
- Rename `.github/workflows/deploy-development.yml` → `.github/workflows/deploy-development.yml.disabled` (GitHub Actions abaikan non-`.yml`; reversible; preserve konten)

### Runbook
- Tulis `docs/runbooks/manual-deploy.md` — prosedur deploy manual via Vercel CLI: prerequisites, link, env pull, pre-deploy checklist (schema sync via `migrate-development` CI), deploy commands (preview + prod), verify, rollback, schema migration manual prod, troubleshooting

### Commits (no Co-authored-by)
- `bb4c885` `chore(deps): add @next-community/adapter-vercel@0.0.1-beta.29 and peer build-utils`
- `f150b01` `chore(next): configure adapterPath for Vercel deployment`
- `43b32cb` `chore(ci): disable deploy-development in favor of manual Vercel CLI deploys`
- `a5dcbb0` `docs(runbook): add manual deploy via Vercel CLI` + plan file

## Decisions

- **Adapter di `dependencies` (bukan devDeps)**: `vercel build` strip devDeps ("removed 204 packages" log sebelumnya). Trade-off: prod install +~470 KB; acceptable
- **Pin `0.0.1-beta.29` (bukan `latest` 0.0.0)**: npm `latest` tag adalah placeholder; beta.29 peerDeps `next 16.3.0-canary.96` (terdekat stable 16.3.0)
- **Rename `.yml` → `.yml.disabled` (bukan delete)**: preserve konten untuk re-enable di masa depan; GitHub Actions ignore non-`.yml`
- **`migrate-development` CI tetap aktif**: schema apply otomatis saat push main → DB tidak drift meskipun deploy manual
- **Vercel Git integration prod tetap auto-deploy paralel**: tidak di-touch; user bisa pakai salah satu atau keduanya

## Open Items / Blockers

- **User verify manual deploy**: jalankan `npx vercel@47 deploy --yes` lokal di Linux/Mac/WSL setelah push ke main; observasi URL preview + health. Saya bisa bantu debug jika ada error
- **Vercel platform mungkin override `adapterPath`**: untuk prod Git-integration builds, Vercel pakai adapter versinya sendiri. Observasi build log prod setelah push berikutnya; jika divergen (error), pindah ke `NEXT_ADAPTER_PATH` env var
- **Plan info reasoning provider+model Telegram**: standing by untuk sesi berikutnya (sudah ada audit lengkap)

## Commit Proposal
- `bb4c885`, `f150b01`, `43b32cb`, `a5dcbb0` (done)
