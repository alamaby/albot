# Pooled image provider — dibatalkan (endpoint image tidak ada)

Tanggal: 2026-09-03 09:31

## Masalah

User minta provider image baru via `ai.pooled.dev` (sample: `POST /v1/images/generations`, model `dall-e-3`, key prefix `poold_`). Plan disetujui: fallback priority 152 (antara Pollinations 151 dan Bynara 160), dev-first, cek `/v1/models` dulu sebelum tulis migration.

## Temuan (probe live 2026-09-03, key dari `.env` — tidak pernah di-echo)

- `GET /v1/models` → 200, 25 model — **semua LLM chat** (kimi/qwen/deepseek/minimax/glm/claude); tidak ada satu pun model image, `dall-e-3` tidak terdaftar.
- `POST /v1/images/generations` (persis payload sample) → **404 "Cannot POST"** (HTML Express — route tidak ter-deploy). Path alternatif (`/v1/images`, `/v1/image/generations`, `/v1/images/generate`) 404 semua.
- `api.pooled.dev` / `images.pooled.dev` → Cloudflare SSL 525 (host tidak dikonfigurasi).
- `POST /v1/chat/completions` sanity (glm-5.1-official, max_tokens 5) → 503 `{"error":{"message":"Model out of quota","type":"no_keys_available"}}` — **key VALID** (bukan 401), tapi pool model itu sedang habis kuota saat probe.
- Kesimpulan: gateway pooled.dev **belum melayani API image sama sekali**; sample script user tidak cocok dengan kondisi live.

## Keputusan

- User memilih **BATALKAN**: tidak ada adapter/migration/registry/.env.example yang dibuat.
- `POOLED_API_KEY` tetap di `.env` lokal (tidak dipakai; berlaku chat-only, pool kuota per-model bisa habis).
- Rantai failover image tidak berubah: Pixazo 0/5 → Pollinations 151 → Bynara 160-180 → picker 200-203.

## Files changed

- Tidak ada file aplikasi. Hanya entry memory ini + index `.memory/README.md`.
- Probe scripts di temp dir sudah dihapus.

## Verification

- Probe via wrapper node sekali-jalan; nilai key tidak pernah di-print, semua output di-redact terhadap nilai key (pola AGENTS.md "Safe env read").

## Follow-up bila ingin diaktifkan kembali

1. Konfirmasi ke provider pooled: endpoint image yang benar / kapan rilis (sample yang beredar menunjukkan `/v1/images/generations` + `dall-e-3`, tapi belum ter-deploy).
2. Bila endpoint sudah ada: blueprint plan lama masih berlaku — `PooledImageAdapter` (pattern `src/server/providers/image/pollinations.adapter.ts`, body `{model, prompt, n:1, size}` tanpa `response_format`, parser url+b64_json, timeout 55s), registry type `pooled_image`, migration `INSERT ... WHERE NOT EXISTS` priority 152 + update `EXPECTED_MIGRATIONS` (43→44), provisioning via `node scripts/upsert-provider-key.mjs pooled_image <model> --capability image_generation --env-key POOLED_API_KEY`.
3. Ulangi probe envelope respons (url vs b64_json, field `revised_prompt`) sebelum finalisasi contract test — asumsi OpenAI envelope belum pernah terverifikasi live.

## Conventional Commit proposal

(tidak ada commit — tanpa perubahan aplikasi)
