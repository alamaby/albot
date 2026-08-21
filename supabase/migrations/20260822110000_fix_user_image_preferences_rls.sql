-- Fix user_image_preferences RLS and grants to match strict RLS pattern.
-- Previous migration missed FORCE ROW LEVEL SECURITY, public revoke, and minimal grants,
-- and created duplicate FK on preferred_provider_config_id (inline + explicit).

do $$
begin
  execute 'alter table public.user_image_preferences drop constraint if exists user_image_preferences_preferred_provider_config_id_fkey';
  execute 'alter table public.user_image_preferences drop constraint if exists user_image_preferences_config_fkey';
  execute 'alter table public.user_image_preferences drop constraint if exists user_image_preferences_user_fkey';
  execute 'alter table public.user_image_preferences add constraint user_image_preferences_config_fkey foreign key (preferred_provider_config_id) references public.provider_configs (id) on delete restrict';
  execute 'alter table public.user_image_preferences add constraint user_image_preferences_user_fkey foreign key (telegram_user_id) references public.bot_users (telegram_user_id) on delete cascade';
end;
$$;

alter table public.user_image_preferences enable row level security;
alter table public.user_image_preferences force row level security;

revoke all on table public.user_image_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_image_preferences to service_role;
