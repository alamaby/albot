# Seed Policy

Milestone 1 tidak menyediakan seed production atau data pengguna nyata.

- File seed lokal (`supabase/seed.sql`) hanya untuk eksperimen local development dan wajib mengandung data dummy yang dapat dihapus.
- Migration test fixture dibuat di dalam test harness dengan `service_role` dan diberi tag khusus (mis. kolom/prefix `test_`), lalu dibersihkan setelah run.
- Dilarang menaruh provider API key asli, Telegram token, service role key, atau data pengguna nyata di seed.
