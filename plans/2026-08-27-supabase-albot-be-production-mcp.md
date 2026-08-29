# Supabase Albot BE Production MCP Integration

Created: 2026-08-27 00:00:00

## Objective
Menambahkan MCP Supabase untuk project `pcexxtckvwmiquseznaz` (albot-be-production) ke config global opencode agar tersedia tools `docs, database, debugging, development, functions`.

## Scope
- Config global `~/.config/opencode/opencode.json` (`C:\Users\alama\.config\opencode\opencode.json`)
- Key baru `supabase-albot-be-production` (remote)
- Tidak mengubah project-level config (tidak ada `opencode.json` di repo)
- Validasi JSONC dan restart opencode

## Milestones
1. Backup & inspeksi config existing
2. Merge entry MCP baru
3. Validasi & dokumentasi plan
4. Restart & verifikasi runtime

## Tasks
- [x] Inspeksi config global existing — 4 MCP (oracle-sqlcl + 3 supabase) di `C:\Users\alama\.config\opencode\opencode.json:3`
- [x] Konfirmasi lokasi global + rename key ke `supabase-albot-be-production`
- [x] Edit `C:\Users\alama\.config\opencode\opencode.json:20` — tambah entry remote `pcexxtckvwmiquseznaz`
- [x] Validasi string `supabase-albot-be-production` & `pcexxtckvwmiquseznaz` ada di file, struktur JSONC preserve
- [x] Buat plan file `plans/2026-08-27-supabase-albot-be-production-mcp.md`
- [ ] Restart opencode untuk load config baru (user action)
- [ ] Verifikasi `mcp` ter-load (cek tools Supabase muncul, test `list_tables`/`execute_sql` read-only)

## Risks
- JSONC invalid → `ConfigInvalidError` opencode gagal start. Mitigasi: file preserve comment `//`, escape `C:\\Apps\\...`; backup tersedia `opencode.json.bak-*`; escape hatch `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
- `project_ref` salah atau URL encoding salah → MCP auth error. Mitigasi: URL exact `https://mcp.supabase.com/mcp?project_ref=pcexxtckvwmiquseznaz&features=docs%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions`.
- Naming collision — key generik `supabase` dihindari dengan `supabase-albot-be-production` konsisten pola existing.

## Progress Log
- 2026-08-27 00:00:00 — Inspeksi `C:\Users\alama\.config\opencode\opencode.json` (91 lines, 4 MCP). User request `supabase` → dikonfirmasi global + rename.
- 2026-08-27 00:00:00 — Edit applied via `default.edit` di `C:\Users\alama\.config\opencode\opencode.json:20-29` — entry baru ditambah, file 96 lines.
- 2026-08-27 00:00:00 — Verifikasi via bash string search — key & project_ref ditemukan. Plan file dibuat.

## Notes
- Schema authoritative: `https://opencode.ai/config.json` — `$schema` tetap `https://opencode.ai/config.json` di `opencode.json:2`.
- Config tidak hot-reload — harus quit & restart opencode (skill `customize-opencode`).
- Global vs project deep-merge: project override global, tapi untuk MCP Supabase shared lebih tepat di global sesuai 3 entry sebelumnya.
