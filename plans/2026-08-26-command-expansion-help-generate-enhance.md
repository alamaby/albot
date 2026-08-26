# Command Expansion — /help, /generate-image, /enhance-prompt

Created: 2026-08-26
Status: In progress

## Objective

Empat command baru: `/help` (daftar command), `/start` revisi (welcome + daftar command), `/generate-image <prompt>` (skip enhance, langsung generate), `/enhance-prompt <prompt>` (enhance-only, balas teks hasil enhancement tanpa sesi/generation). Plus registrasi command ke menu Telegram (setMyCommands).

## Keputusan (confirmed user 2026-08-26)

1. `/enhance-prompt` = **enhance-only** (b): balas teks hasil enhancement, tanpa sesi/generation — user copy manual
2. `/generate-image` tanpa argumen → usage message
3. Hasil `/generate-image` pakai result keyboard standar `[Regenerate][Revise Prompt][Selesai]`
4. Daftarkan command ke menu Telegram (`setMyCommands`)

## Desain

- `/generate-image`: migration extend `create_initial_session` RPC (`p_enhanced_prompt text default null`) — saat diisi: revision `completed` + enhanced_prompt, session `generating`, job `generate_image`. Handler webhook: guards (panjang/rate/active) → RPC → dispatch → status message + persist id.
- `/enhance-prompt`: job baru `enhance_only` (tanpa session, `jobs.prompt_session_id` nullable) + handler baru (provider select → enhance → zod → balas teks; retry bounded). Accepted limitation: tidak terhitung rate limit berbasis sesi (allowlist gate tetap).
- Parser: terima varian hyphen + underscore + `@botname`; args kosong → usage.
- Menu Telegram hanya terima underscore → `setMyCommands` daftar `generate_image`, `enhance_prompt`, dll; parser terima dua varian.

## Tasks

- [x] T-1: Migration extend RPC (+ job_type check — tidak perlu, hanya non-blank) + `EXPECTED_MIGRATIONS` (26) + schema/contract tests + `db:types` regen (union overload `b76cc42`)
- [x] T-2: Parser command
- [x] T-3: Handler `/generate-image`
- [x] T-4: Job `enhance_only` + handler + registry
- [x] T-5: `/help` + revisi `/start`
- [x] T-6: Script `set-my-commands.mjs`
- [x] T-7: Unit tests (274 pass) + hosted contract test direct-mode (initial-session.contract)
- [x] T-8: Verifikasi lokal 8 checks (db:types:check hijau pasca-regen)
- [x] T-9: `migrate-development` (32952466785, run ke-3 setelah F8 types + fix test) → `migrate-production` (32953970159, prod 26/26, attestation `2323678` match) → deploy Vercel (auto, health ok)
- [ ] T-10: E2E dev/prod Telegram
- [ ] T-11: Docs sync + evidence

## Risks

| Risiko | Mitigasi |
|---|---|
| Enhance-only tanpa rate limit | Allowlist gate; limitation terdokumentasi |
| RPC extend salah backward-compat | Default null = jalur lama utuh; contract test regression net — TERBUKTI (5-arg test lama tetap hijau) |
| Menu Telegram tak terima hyphen | Parser dua varian; menu underscore |
| Kualitas prompt mentah direct generate | By design; Regenerate/Revise tersedia |
| Types overload union (F8) | Regen pasca-dev migrate — sudah dieksekusi `b76cc42` |

## Progress Log

- 2026-08-26 — Plan disetujui user, eksekusi dimulai.
- 2026-08-26 — T-1..T-9 DONE (3 run migrate-dev: types union + fix test; prod 26/26 attestation `2323678`). Sisa T-10 E2E + T-11 docs.
