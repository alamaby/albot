-- Allow a new prompt after enhancement/generation terminal failures.
--
-- Previously prompt_sessions_one_active_idx counted enhancement_failed and
-- generation_failed as active (WHERE status NOT IN completed/cancelled/expired),
-- so a user with a failed session was blocked by "Masih ada sesi aktif..." and
-- could not send a new prompt without tapping Coba Lagi / waiting 24h expiry.
-- The bot message promises "Silakan coba lagi." / "kirim prompt baru" after a
-- failure, so failed statuses should be terminal for the one-active constraint.
--
-- This revises the partial unique index to exclude the two failure statuses.
-- App layer TERMINAL_STATUSES in session-policy.repository.ts and
-- session.repository.ts findActiveByUserId must stay in sync (updated separately).

do $$
begin
  execute 'drop index if exists public.prompt_sessions_one_active_idx';
  execute
    'create unique index prompt_sessions_one_active_idx on public.prompt_sessions (telegram_user_id) where (status not in (''completed'', ''cancelled'', ''expired'', ''enhancement_failed'', ''generation_failed''))';
end;
$$;
