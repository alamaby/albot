-- Per-session and per-user preferred reasoning provider (hybrid selection),
-- mirroring the image preference pattern (20260821100000 / 20260821110000 with
-- the strict RLS fix from 20260822110000 applied from the start).
--
-- NOTE: this file is named after the version recorded on hosted development
-- by an MCP apply_migration (which records a UTC apply-time version instead of
-- a file timestamp). The DDL is fully idempotent (if not exists / do $$
-- guards) so `supabase db push` can safely re-apply it on a fresh database.
--
-- 1. prompt_sessions.preferred_reasoning_provider_config_id — set via the
--    Telegram reasoning picker for the current session.
-- 2. user_reasoning_preferences — per-user default reasoning provider so new
--    sessions (and the session-less /enhance-prompt flow) can preload it.
-- 3. callback_events action check extended with the reasoning picker actions.

-- 1. prompt_sessions preferred reasoning column
alter table public.prompt_sessions
  add column if not exists preferred_reasoning_provider_config_id uuid
  references public.provider_configs (id) on delete restrict;

create index if not exists prompt_sessions_preferred_reasoning_provider_idx
  on public.prompt_sessions (preferred_reasoning_provider_config_id)
  where preferred_reasoning_provider_config_id is not null;

comment on column public.prompt_sessions.preferred_reasoning_provider_config_id
  is 'Per-session preferred reasoning provider config (hybrid selection). Set via Telegram reasoning picker; null = use selector fallback.';

-- 2. user_reasoning_preferences
create table if not exists public.user_reasoning_preferences (
  telegram_user_id bigint not null primary key,
  preferred_provider_config_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_reasoning_preferences_config_fkey foreign key (preferred_provider_config_id)
    references public.provider_configs (id) on delete restrict,
  constraint user_reasoning_preferences_user_fkey foreign key (telegram_user_id)
    references public.bot_users (telegram_user_id) on delete cascade
);

do $$
begin
  execute 'drop trigger if exists user_reasoning_preferences_set_updated_at on public.user_reasoning_preferences';
  execute 'create trigger user_reasoning_preferences_set_updated_at before update on public.user_reasoning_preferences for each row execute function public.set_updated_at()';
end;
$$;

comment on table public.user_reasoning_preferences is 'Per-user default reasoning provider preference for hybrid enhancement selection.';

-- RLS: strict service_role-only pattern (enable + force, no policies, minimal grants)
alter table public.user_reasoning_preferences enable row level security;
alter table public.user_reasoning_preferences force row level security;

revoke all on table public.user_reasoning_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_reasoning_preferences to service_role;

create index if not exists user_reasoning_preferences_config_idx
  on public.user_reasoning_preferences (preferred_provider_config_id);

-- 3. callback_events action check: add reasoning picker actions
do $$
begin
  execute 'alter table public.callback_events drop constraint if exists callback_events_action_check';
  execute 'alter table public.callback_events add constraint callback_events_action_check check (action in (''generate'', ''revise'', ''cancel'', ''retry'', ''regenerate'', ''complete'', ''model_picker'', ''model_picked'', ''model_picked_default'', ''model_picker_back'', ''reasoning_picker'', ''reasoning_picked'', ''reasoning_default'', ''reasoning_picker_back''))';
end;
$$;
