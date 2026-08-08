# Milestone 1 Database Foundation Plan

Date: 2026-08-08 13:01:28

## Task

Menyusun plan detail Milestone 1 untuk schema inti, RLS/grants, atomic functions, generated database types, hosted tests, migration workflows, dan evidence gate.

## Key Files

- `plans/2026-08-08-milestone-1-database-foundation-plan.md`
- `plans/2026-08-07-telegram-image-bot-implementation-plan.md`
- `.memory/README.md`

## Decisions

- Status/capability memakai text + named check constraints, bukan PostgreSQL enums.
- Semua core tables deny-by-default: RLS enabled/forced, no direct anon/authenticated grants.
- Atomic job claim memakai `FOR UPDATE SKIP LOCKED`; exact lease parameter dipilih saat implementation setelah RPC ergonomics diverifikasi.
- Conditional session transition memakai expected-state compare-and-set dan terminal-state protection.
- Generated TypeScript types berasal dari hosted development schema, bukan ditulis manual.
- Development migration dijalankan melalui approved GitHub Environment workflow.
- Production workflow dibuat pada M1 tetapi tidak dijalankan sampai production release milestone.

## Assumptions And Risks

- Dedicated Supabase development project dan GitHub Environment approvals belum terkonfirmasi.
- Hosted-only tests memengaruhi shared development project; fixture harus tagged, disposable, serialized, dan dibersihkan.
- Static SQL safety scan hanya guardrail; review dan hosted assertions tetap wajib.
- Production/database MCP tetap read-only; tidak ada DDL dijalankan saat plan dibuat.

## Blockers

- Supabase development project belum terkonfirmasi.
- GitHub Environments `development` dan `production` beserta required reviewers belum terkonfirmasi.

## Verification

- Plan dibandingkan dengan data model, migration policy, security model, Milestone 1 deliverables, acceptance criteria, dan evidence requirements pada plan utama.
- Tidak ada schema/database change atau hosted workflow execution.
- Format check dokumen direkomendasikan setelah creation.

## Related

- Parent plan: `plans/2026-08-07-telegram-image-bot-implementation-plan.md`
- Milestone 0 remediation: `plans/2026-08-08-milestone-0-review-remediation-plan.md`

## Conventional Commit Proposal

`docs(plan): detail milestone 1 database foundation`
