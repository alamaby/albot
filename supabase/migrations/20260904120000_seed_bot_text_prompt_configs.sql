-- Seed DB-driven prompt/text keys (v1 active each, idempotent).
--
-- Design:
-- - reasoning_revision_helper: revision helper system message for the
--   OpenAI-compatible reasoning adapter (was hardcoded in the adapter).
-- - reasoning_sampling: JSON {temperature, max_tokens} (was hardcoded 0.7/1024).
-- - bot_messages: JSON map of simple BotMessage templates ({placeholders}).
-- - bot_keyboards: JSON map of inline-keyboard button labels ({label}).
-- - bot_templates: JSON map of composite message templates ({placeholders}).
-- - No DDL: prompt_configs schema/audit/RPCs unchanged (see 20260902120000).
-- - Fallback semantics live in code: reasoning_* strict-error (like the
--   enhancement persona); bot_* fall back to hardcoded defaults with a warn
--   log so the bot never goes silent when the DB is unreachable.
-- - No global image negative-prompt default by user decision: empty means omit.

-- reasoning_revision_helper ----------------------------------------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'reasoning_revision_helper',
  'This is a revision of a previous prompt. Apply the user''s instruction while preserving the original structure and style unless explicitly asked to change them.',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- reasoning_sampling -------------------------------------------------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'reasoning_sampling',
  '{"temperature":0.7,"max_tokens":1024}',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- bot_messages --------------------------------------------------------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'bot_messages',
  '{"access_denied":"Akses ditolak. Akun Telegram Anda belum terdaftar.","prompt_too_long":"Prompt terlalu panjang. Maksimal {maxPromptLength} karakter.","active_session_exists":"Masih ada sesi aktif. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.","rate_limited":"Terlalu banyak permintaan. Maksimal {rateLimitMax} prompt per {rateLimitWindowMinutes} menit.","prompt_received":"Prompt diterima. Sedang dalam antrian...","callback_acknowledged":"Diterima.","revision_instruction_too_long":"Instruksi revisi terlalu panjang. Maksimal {maxPromptLength} karakter.","session_expired":"Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.","enhancement_failed":"Gagal memproses prompt. Silakan coba lagi.","generation_failed":"Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.","content_policy_declined":"Prompt ditolak karena kebijakan konten provider. Ubah prompt dan coba lagi.","session_cancelled":"Sesi dibatalkan.","no_active_session":"Tidak ada sesi aktif untuk dibatalkan.","generate_usage":"Kirim /generate-image <prompt> untuk langsung membuat gambar tanpa penyempurnaan. Contoh: /generate-image kucing oren duduk di atap saat senja","enhance_usage":"Kirim /enhance-prompt <prompt> untuk menyempurnakan prompt. Contoh: /enhance-prompt kucing oren duduk di atap saat senja","enhance_only_received":"Sedang menyempurnakan prompt, mohon tunggu...","enhance_only_failed":"Gagal menyempurnakan prompt. Silakan coba lagi.","dispatch_failed":"Gagal memulai pemrosesan. Silakan coba lagi sebentar.","cancel_in_progress":"Sesi sedang diproses. Coba lagi sebentar.","cancel_failed":"Gagal membatalkan sesi. Coba lagi.","revision_processing":"Sedang memproses revisi...","revision_reprocessing":"Sedang memproses ulang prompt, mohon tunggu...","callback_send_failed":"Gagal mengirim permintaan. Coba lagi.","callback_regenerate_failed":"Gagal memulai ulang dengan model baru. Coba lagi.","callback_complete_failed":"Gagal menyelesaikan sesi. Coba lagi.","callback_model_failed":"Gagal mengatur model. Coba lagi.","callback_reasoning_failed":"Gagal mengatur model reasoning. Coba lagi.","retrying":"Mencoba lagi...","session_busy":"Sesi sedang diproses.","model_invalid":"Model tidak valid.","model_unavailable":"Model tidak tersedia. Pilih lain.","model_cooldown":"Model sedang cooldown, pilih lain.","ack_pick_model":"Pilih model","ack_pick_reasoning":"Pilih model reasoning","ack_back":"Kembali","session_expired_short":"Sesi telah berakhir. Kirim prompt baru.","no_active_revision":"Belum ada revisi aktif.","generate_starting":"Mulai membuat gambar...","generate_restarting":"Mulai membuat gambar lagi...","revise_hint":"Silakan kirim instruksi revisi.","revise_instructions":"Kirim instruksi revisi Anda. Contoh: buat lebih terang, tambah awan, ubah warna.","session_cancelled_new":"Sesi dibatalkan. Kirim prompt baru untuk membuat gambar.","session_done":"Sesi selesai.","session_done_thanks":"Sesi selesai. Terima kasih sudah menggunakan bot ini!","active_session_exists_new":"Masih ada sesi aktif. Selesaikan atau batalkan sesi baru terlebih dahulu."}',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- bot_keyboards -------------------------------------------------------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'bot_keyboards',
  '{"generate":"Generate","revise":"Revise Lagi","cancel":"Batal","pick_model":"Pilih Model","pick_reasoning":"Pilih Reasoning","change_model":"Ganti Model","change_reasoning":"Ganti Reasoning","regenerate":"Regenerate","revise_prompt":"Revise Prompt","done":"Selesai","back":"Kembali","retry":"Coba Lagi","new_prompt":"Prompt Baru","model_picked":"Model: {label} ✓","reasoning_picked":"Reasoning: {label} ✓"}',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- bot_templates ---------------------------------------------------------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'bot_templates',
  '{"command_help":"/generate-image <prompt> — langsung buat gambar tanpa penyempurnaan\n/enhance-prompt <prompt> — sempurnakan prompt (hasil teks saja)\n/cancel atau /batal — batalkan sesi aktif\n/help — bantuan","welcome_1":"Selamat datang! Saya membuat gambar dari prompt Anda.","welcome_2":"Atau kirim teks biasa — prompt otomatis disempurnakan dulu, mis. \"kucing oren duduk di atap saat senja\".","help_1":"Command yang tersedia:","help_2":"Tanpa command: kirim teks biasa untuk flow lengkap dengan penyempurnaan prompt dan konfirmasi.","enhance_only_header":"✨ Prompt hasil penyempurnaan:","enhance_only_negative":"Negative prompt: {value}","enhance_only_aspect":"Aspect ratio: {value}","enhance_only_footer":"Salin prompt di atas, lalu kirim /generate-image <prompt> untuk membuat gambar.","confirmation_header":"Prompt yang akan digunakan (revisi {revisionNumber}):","confirmation_reasoning":"Reasoning: {label}","confirmation_image":"Model gambar: {label} ✓","confirmation_footer":"Pilih aksi di bawah untuk melanjutkan.","picker_model":"Pilih model gambar untuk sesi ini. Tap untuk memilih, tap ★ untuk jadikan default.","picker_model_selected":"Pilih model gambar. Saat ini: {label} ✓","picker_model_set":"Model diatur ke {label} ✓","picker_model_set_default":"Model diatur ke {label} dan disimpan sebagai default ✓","picker_reasoning":"Pilih model reasoning untuk enhance/revise prompt. Tap untuk memilih, tap ★ untuk jadikan default.","picker_reasoning_selected":"Pilih model reasoning (enhance/revise). Saat ini: {label} ✓","picker_reasoning_set":"Reasoning diatur ke {label} ✓ (dipakai untuk enhance/revise berikutnya)","picker_reasoning_set_default":"Reasoning diatur ke {label} dan disimpan sebagai default ✓ (dipakai untuk enhance/revise berikutnya)","result_caption":"Gambar {attempt} dari revisi {revision}.","result_image_line":"Model: {label}","status_generating":"Sedang membuat gambar, mohon tunggu...","status_succeeded":"Gambar {attempt} dari revisi {revision} berhasil dibuat.","status_succeeded_generic":"Gambar berhasil dibuat.","reshow_model_selected":"Model terpilih: {label} ✓","reshow_fallback":"Pilih aksi untuk melanjutkan."}',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- audit rows (idempotent: only when the create action is not yet recorded) --
insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'reasoning_revision_helper', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'reasoning_revision_helper' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'reasoning_revision_helper' and version = 1 and action = 'create'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'reasoning_sampling', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'reasoning_sampling' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'reasoning_sampling' and version = 1 and action = 'create'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'bot_messages', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'bot_messages' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'bot_messages' and version = 1 and action = 'create'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'bot_keyboards', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'bot_keyboards' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'bot_keyboards' and version = 1 and action = 'create'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'bot_templates', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'bot_templates' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'bot_templates' and version = 1 and action = 'create'
   );
