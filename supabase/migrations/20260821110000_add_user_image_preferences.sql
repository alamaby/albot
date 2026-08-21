-- Per-user default image provider preference (hybrid selection, tabel terpisah).
-- Stores the user's default model choice so new sessions can preload it.

create table public.user_image_preferences (
  telegram_user_id bigint not null primary key,
  preferred_provider_config_id uuid not null
    references public.provider_configs (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_image_preferences_user_fkey foreign key (telegram_user_id)
    references public.bot_users (telegram_user_id) on delete cascade,
  constraint user_image_preferences_config_fkey foreign key (preferred_provider_config_id)
    references public.provider_configs (id) on delete restrict
);

create trigger user_image_preferences_set_updated_at
  before update on public.user_image_preferences
  for each row execute function public.set_updated_at();

comment on table public.user_image_preferences is 'Per-user default image provider preference for hybrid model selection.';

-- RLS: service_role only (same as provider tables — no anon/authenticated grants)
alter table public.user_image_preferences enable row level security;
-- No policies needed: service_role bypasses RLS (force RLS disabled by not adding policies)
-- Explicit revoke for anon/authenticated to be safe (mirrors other service-only tables via grants migration)
revoke all on table public.user_image_preferences from anon, authenticated;
grant all on table public.user_image_preferences to service_role;

create index user_image_preferences_config_idx
  on public.user_image_preferences (preferred_provider_config_id);
