# Milestone 0 Review and Remediation Plan

Created: 2026-08-08 14:30:00

## Objective

Align current Milestone 0 implementation with acceptance criteria:

- Vercel Preview deployment uses development Supabase
- Vercel Production deployment uses production Supabase
- Health endpoint returns HTTP 503 when database unreachable/unauthorized/unconfigured
- Environment validation reflects staged approach (partial validation now, full later)
- Evidence tracking matches actual deployment state

## Scope

- Update health endpoint to readiness behavior (HTTP 200/503)
- Add HTTP status and error code classification tests
- Normalize trailing slash in SUPABASE_URL
- Add `APP_ENV` and `VERCEL_ENV` resolution for environment label
- Update TODO and memory with corrected status
- Ensure deployment isolation (Preview vs Production) is verifiable

## Tasks

- [x] Create new plan file for remediation tracking
- [x] Update `TODO.md` with remediation tasks and evidence placeholders
- [x] Create/ update `.memory/2026-08-08-milestone-0-review.md`
- [x] Implement health endpoint HTTP 503 behavior
- [x] Add health endpoint unit tests covering all states
- [x] Update README to reflect current status
- [ ] Verify Vercel Preview deployment succeeds
- [ ] Verify Preview health returns `environment: "development"` and `database: "reachable"`
- [ ] Verify Production health returns `environment: "production"` and `database: "reachable"`
- [ ] Record final evidence in plan Progress Log

## Verification

- Health endpoint returns HTTP 200 with `status: "ok"` when DB reachable
- Health endpoint returns HTTP 503 with `status: "degraded"` when DB unreachable/unauthorized/unconfigured
- Health response never includes raw URL, key, or error details
- Preview uses dev Supabase, Production uses prod Supabase
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass
- CI `validate.yml` passes
- Vercel Preview deployment Ready
- Vercel Production deployment Ready

## Evidence Required

- Commit SHA for remediation changes
- CI run URL (validate workflow)
- Vercel Preview URL
- Preview health response screenshot
- Production health response screenshot
- Updated TODO.md and memory entry

## Risks

- Changing health endpoint may affect existing monitoring (low risk, health endpoint new).
- Trailing slash normalization may break existing env values (unlikely, fixes inconsistency).
- Environment label change may confuse existing logs (low risk, only affects health output).
- Need to redeploy after env changes.

## Progress Log

- 2026-08-08 12:15:00 — Implementasi remediasi health endpoint selesai: `src/app/api/health/route.ts` kini readiness probe (HTTP 200 `status:ok` hanya saat DB reachable; HTTP 503 `status:degraded` untuk unreachable/unauthorized/unconfigured) + `Cache-Control: no-store`. `tests/unit/health.test.ts` ditulis ulang mencakup klasifikasi probe (200, 404 PGRST205/42P01, 401, 403, 500, network failure) dan status HTTP route (200/503, environment production via APP_ENV, no-store). Lokal lulus: typecheck, lint, test (27/27), format:check, build. TODO.md, `.memory/README.md`, dan entry memory harian diperbarui. Task verifikasi Preview/Production deployment masih menunggu provisioning Supabase development + Vercel Preview alias oleh user.

## Notes

- This plan runs concurrently with Milestone 1; both milestones will be completed before Milestone 2.
- Plan does not introduce new dependencies beyond existing ones.
- All changes are additive and backward-compatible.
- After remediation, Milestone 0 acceptance criteria will be fully met.