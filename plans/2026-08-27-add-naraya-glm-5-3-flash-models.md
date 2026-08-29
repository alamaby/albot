# Add Naraya GLM 5.3 Flash Models

Created: 2026-08-27 00:00:00

## Objective
Menambahkan dua model GLM 5.3 ke provider `naraya` di opencode agar selectable sebagai `naraya/glm-5.3-flash` dan `naraya/glm-5.3-flash-free` via NaraRouter (`https://router.bynara.id/v1`).

## Scope
- In: Edit `C:\Users\alama\.config\opencode\opencode.json` → `provider.naraya.models`
- Out: Rotasi `apiKey`, perubahan `baseURL`, perubahan `model` default, provider baru

## Milestones
1. Backup & validasi pre-edit
2. Patch `opencode.json` (2 model baru)
3. Validasi post-edit & restart opencode
4. Smoke test model

## Tasks
- [x] Inspeksi `C:\Users\alama\.config\opencode\opencode.json:87-152` — 8 model existing terkonfirmasi
- [x] Backup `opencode.json` → `opencode.json.bak-2026-08-27-glm53` (4464 bytes)
- [x] Patch `provider.naraya.models` — append `glm-5.3-flash-free` & `glm-5.3-flash` setelah `muse-spark-1.2-contributor` (`opencode.json:151-164`)
- [x] Validasi JSONC — `JSONC_VALID`, 10 models, `ASSERT_OK` (python strip comments + trailing comma)
- [ ] Restart opencode (user action — config tidak hot-reload)
- [ ] Smoke test `/model` atau prompt singkat per model

## Risks
- **Nama model salah** — ID diasumsikan `glm-5.3-flash` / `glm-5.3-flash-free` (dot notation sesuai request). Jika NaraRouter pakai `glm-5-3-flash`, call 404. Mitigasi: cek `GET /v1/models` di `router.bynara.id`.
- **Modalities mismatch** — diasumsikan `input:[text,image], output:[text]` seperti 8 model lain. Jika GLM 5.3 text-only, UI clamp. Mitigasi: sesuaikan `modalities` setelah konfirmasi katalog.
- **JSONC invalid** — trailing comma di `9router` & comment `//` di `oracle-sqlcl` harus di-preserve, salah brace → `ConfigInvalidError`.
- **Secret exposure** — `apiKey` plain di file global (gitignored via `~/.config/opencode/.gitignore`).
- **Config tidak hot-reload** — harus quit & restart opencode.

## Progress Log
- 2026-08-27 00:00:00 — Plan dibuat (plan-mode). Temuan: 8 model existing, struktur identik, `model` default `naraya/nemotron-3-ultra`.
- 2026-08-27 00:00:00 — Build-mode: backup + patch `opencode.json:144-152` dieksekusi.
- 2026-08-27 22:52:00 — Backup `opencode.json.bak-2026-08-27-glm53` OK, patch `opencode.json:151-164` applied, JSONC valid (10 models).

## Notes
Diff rencana (`opencode.json:144-152`):

```jsonc
        "muse-spark-1.2-contributor": {
          "name": "muse-spark-1.2-contributor",
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        },
        "glm-5.3-flash-free": {
          "name": "glm-5.3-flash-free",
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        },
        "glm-5.3-flash": {
          "name": "glm-5.3-flash",
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        }
```

Validasi katalog opsional: `curl -s https://router.bynara.id/v1/models -H "Authorization: Bearer sk-nry-...\" | jq .`
