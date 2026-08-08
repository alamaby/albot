# albot

Telegram image bot. Spesifikasi lengkap ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`. Tracking progress ada di `TODO.md`.

Status: **Milestone 0 — Repository Foundation** (lulus dengan evidence).

## Stack

- Next.js App Router (server actions dan route handlers, Node.js runtime)
- TypeScript strict
- Supabase (Postgres) sebagai durable job store
- Vercel sebagai deployment platform

## Development

```bash
npm ci
cp .env.example .env.local  # isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Routes

- `GET /api/health` — health check dengan DB reachability yang sanitized.

## Docs

- `docs/environment-variables.md` — inventory dan syarat environment per milestone.
