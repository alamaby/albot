-- RLS and grants for albot core schema (Milestone 1)
--
-- Security boundary:
-- - RLS enabled and forced on every exposed core table.
-- - No permissive policies in Milestone 1 (browser/anonymous access is denied).
-- - Direct table privileges revoked from `anon` and `authenticated`.
-- - `service_role` keeps server-side access (Supabase bypasses RLS for it).
-- - Custom functions get service-role-only EXECUTE in the atomic-functions migration.

do $$
declare
  t text;
  core_tables text[] := array[
    'bot_users',
    'provider_configs',
    'provider_keys',
    'prompt_sessions',
    'prompt_revisions',
    'generation_attempts',
    'jobs',
    'provider_requests',
    'telegram_updates',
    'callback_events',
    'job_events'
  ];
begin
  foreach t in array core_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end;
$$;
