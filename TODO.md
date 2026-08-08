# TODO

Source of truth untuk tracking progress implementasi. Detail acceptance criteria dan gate ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`.

## Current Milestone

Milestone 1: Database Foundation

## In Progress

- (none)

## Pending

- [ ] Provision hosted Supabase development dan production projects
- [ ] Implement Milestone 1 dan record verification evidence
- [ ] Implement Milestone 2 dan record verification evidence
- [ ] Implement Milestone 3 dan record verification evidence
- [ ] Implement Milestone 4 dan record verification evidence
- [ ] Implement Milestone 5 dan record verification evidence
- [ ] Implement Milestone 6 dan record verification evidence
- [ ] Implement Milestone 7 dan record verification evidence
- [ ] Execute production release checklist dan operational handoff

## Blocked

- (none)

## Completed

### Milestone 0: Repository Foundation

- [x] Initialize Next.js app (16.3.0, src/ layout, TypeScript strict, ESLint)
- [x] Add lint, typecheck, test, build scripts
- [x] Add validated server environment module (`src/env.ts`, zod)
- [x] Add `/api/health` route (Node.js runtime, DB reachability sanitized)
- [x] Add Supabase server client wrapper (`src/server/supabase/admin.ts`)
- [x] Add vitest + baseline unit test (6 passing)
- [x] Add vercel.json + Node.js runtime defaults
- [x] Add GitHub Actions validate.yml + gitleaks secret scan
- [x] Add prettier formatter + `.env.example` + docs/environment-variables.md

### Verification (Milestone 0)

- [x] `npm ci`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run format:check`
- [x] Health endpoint smoke test: HTTP 200 `{"status":"ok","environment":"production","database":"unconfigured"}` (tanpa env Supabase, tidak membocorkan detail)

### Belum terverifikasi (butuh platform)

- [x] CI passes from clean checkout (commit `b38f410`, validate green)
- [x] Vercel Preview/Production deployment succeeds
- [x] Health endpoint reaches hosted Supabase (production reachable on https://albot-ten.vercel.app/api/health)

### Evidence M0

- [x] Commit SHA: `bd9d67a` (foundation), `b38f410` (CI fix), `13c0a55` (probe fix) — committed
- [x] CI run URL: https://github.com/alamaby/albot/actions/runs/31156751229 (validate green)
- [x] Vercel URL: https://albot-ten.vercel.app/
- [x] Health response (`GET /api/health`): `{"status":"ok","environment":"production","database":"reachable"}` (terverifikasi live)
- [x] Secret scan result: gitleaks ada di workflow validate (terverifikasi via run CI di atas)

## Decisions Needed

- [ ] Supabase development project dibuat / reference
- [ ] Supabase production project dibuat / reference
- [ ] Vercel team/account dan domain alias development
- [ ] Reasoning provider dan model awal (sebelum Milestone 2 selesai)
- [ ] Pixazo documentation URL dan model (sebelum adapter Pixazo)
- [ ] Admin approach: CLI/API atau web UI

## Enhancement Backlog

- [ ] Image-reference poster composition menggunakan foto properti (setelah plan awal selesai)
