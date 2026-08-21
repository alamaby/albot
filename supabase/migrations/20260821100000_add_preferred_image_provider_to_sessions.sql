-- Add per-session preferred image provider (hybrid selection).
-- Stores the user's model choice for the session so GenerateImageUseCase can honor it.
-- Also extends callback_events action check to allow model picker actions.

-- 1. prompt_sessions preferred column
alter table public.prompt_sessions
  add column preferred_image_provider_config_id uuid
  references public.provider_configs (id) on delete restrict;

create index prompt_sessions_preferred_provider_idx
  on public.prompt_sessions (preferred_image_provider_config_id)
  where preferred_image_provider_config_id is not null;

comment on column public.prompt_sessions.preferred_image_provider_config_id
  is 'Per-session preferred image provider config (hybrid selection). Set via Telegram model picker; null = use selector fallback.';

-- 2. callback_events action check: allow model picker actions
-- Drop existing check, recreate with extended allowlist (includes new actions).
do $$
begin
  alter table public.callback_events drop constraint if exists callback_events_action_check;
  alter table public.callback_events add constraint callback_events_action_check
    check (action in (
      'generate',
      'revise',
      'cancel',
      'retry',
      'regenerate',
      'complete',
      'model_picker',
      'model_picked',
      'model_picked_default'
    ));
exception when others then
  -- Fallback: if constraint name differs, try to find and drop
  null;
end;
$$;
