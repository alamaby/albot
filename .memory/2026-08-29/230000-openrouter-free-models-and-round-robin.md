# OpenRouter Free Models + round_robin Strategy + Architecture Doc

Date: 2026-08-29 (backfill 2026-08-30)

## Task / Problem
Menambah 5 model reasoning gratis OpenRouter untuk fallback dan strategi distribusi beban antar free model; mendokumentasikan arsitektur.

## Key Files Changed
- `src/server/domain/provider.ts` + `src/server/providers/selector.ts` — strategy `round_robin` untuk key selection (hash-seeded)
- `src/server/providers/index.ts` — 5 adapter_types OpenRouter free (`openrouter_free/_ing/_laguna/_glm/_m3`) via satu class `openai-compatible.adapter.ts` (timeout 30s ketat, header `HTTP-Referer`/`X-Title`)
- Migrations `20260829100000` (check constraint + `round_robin`), `20260829110000` (4 config free, pri 200–203), `20260829120000` (MiniMax M3, pri 230)
- `docs/architecture.md` baru (`60e8d4e`, `48aefae`)

## Decisions
- Free model di-prioritaskan 200–230 (fallback terakhir setelah Cloudflare 0 / Pollinations 150)
- `selection_strategy: 'round_robin'` di-seed di config level dengan niat "sessions distribute across the 4 free models" — **namun call sites tetap hardcode `priority_failover` sehingga niat ini tidak tereksekusi** (temuan F1 analisa 2026-08-30, remediation berjalan)

## Verification
Unit + build hijau; migrate-development sukses di SHA terkait.

## Risks / Notes
- Satu API key OpenRouter dipakai bersama 5 config (rate limit bersama)
- Migration `20260830100000` (30 Ags) drop overload legacy `create_revision` 4-arg (PGRST203)

## Commit Proposal
`feat(providers): register 5 OpenRouter free reasoning models`
