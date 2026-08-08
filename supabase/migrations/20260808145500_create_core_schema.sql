-- Core schema for albot (Milestone 1)
-- Additive migration. Idempotent only via standard migration-history application
-- (Supabase CLI). Tables live in schema `public`; access is guarded by RLS and
-- grants in the follow-up migration.
--
-- Conventions (see plans/2026-08-08-milestone-1-database-foundation-plan.md):
-- - PK: uuid default gen_random_uuid()
-- - timestamps: timestamptz, created_at default now(), immutable by convention
-- - status/capability/action values: text + named CHECK constraints (additive)
-- - jsonb metadata: default '{}'::jsonb + jsonb_typeof = 'object' check
-- - FK delete policy: conservative `on delete restrict`

-- Reusable updated_at trigger (security invoker, fixed search_path)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- bot_users ---------------------------------------------------------------
create table public.bot_users (
  id uuid not null default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_chat_id bigint,
  username text,
  is_allowed boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint bot_users_pkey primary key (id),
  constraint bot_users_telegram_user_id_key unique (telegram_user_id)
);

-- provider_configs ----------------------------------------------------------
create table public.provider_configs (
  id uuid not null default gen_random_uuid(),
  capability text not null,
  adapter_type text not null,
  name text not null,
  base_url text not null,
  model text,
  settings jsonb not null default '{}'::jsonb,
  selection_strategy text not null default 'priority_failover',
  priority integer not null default 100,
  weight integer not null default 1,
  config_version integer not null default 1,
  is_active boolean not null default true,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_configs_pkey primary key (id),
  constraint provider_configs_capability_check check (capability in ('reasoning', 'image_generation')),
  constraint provider_configs_selection_strategy_check check (selection_strategy in ('priority_failover', 'weighted')),
  constraint provider_configs_priority_check check (priority >= 0),
  constraint provider_configs_weight_check check (weight > 0),
  constraint provider_configs_config_version_check check (config_version > 0),
  constraint provider_configs_settings_object_check check (jsonb_typeof(settings) = 'object')
);

-- provider_keys ------------------------------------------------------------
create table public.provider_keys (
  id uuid not null default gen_random_uuid(),
  provider_config_id uuid not null,
  key_ciphertext text not null,
  key_iv text not null,
  key_auth_tag text not null,
  key_fingerprint text not null,
  label text,
  weight integer not null default 1,
  is_active boolean not null default true,
  failure_count integer not null default 0,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_keys_pkey primary key (id),
  constraint provider_keys_provider_config_id_fkey foreign key (provider_config_id)
    references public.provider_configs (id) on delete restrict,
  constraint provider_keys_provider_config_fingerprint_key unique (provider_config_id, key_fingerprint),
  constraint provider_keys_ciphertext_check check (length(btrim(key_ciphertext)) > 0),
  constraint provider_keys_iv_check check (length(btrim(key_iv)) > 0),
  constraint provider_keys_auth_tag_check check (length(btrim(key_auth_tag)) > 0),
  constraint provider_keys_fingerprint_check check (length(btrim(key_fingerprint)) > 0),
  constraint provider_keys_weight_check check (weight > 0),
  constraint provider_keys_failure_count_check check (failure_count >= 0)
);

-- prompt_sessions (base; active pointers added after child tables) ----------
create table public.prompt_sessions (
  id uuid not null default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  status text not null default 'received',
  telegram_status_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint prompt_sessions_pkey primary key (id),
  constraint prompt_sessions_status_check check (status in (
    'received',
    'enhancing',
    'awaiting_confirmation',
    'awaiting_revision_input',
    'generating',
    'result_ready',
    'enhancement_failed',
    'generation_failed',
    'completed',
    'cancelled',
    'expired'
  )),
  constraint prompt_sessions_expires_at_check check (expires_at > created_at)
);

-- prompt_revisions ----------------------------------------------------------
create table public.prompt_revisions (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  revision_number integer not null,
  source_prompt text not null,
  previous_prompt text,
  revision_instruction text,
  enhanced_prompt text,
  negative_prompt text,
  aspect_ratio text,
  reasoning_provider_config_id uuid,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint prompt_revisions_pkey primary key (id),
  constraint prompt_revisions_session_id_fkey foreign key (session_id)
    references public.prompt_sessions (id) on delete restrict,
  constraint prompt_revisions_reasoning_config_fkey foreign key (reasoning_provider_config_id)
    references public.provider_configs (id) on delete restrict,
  constraint prompt_revisions_session_revision_key unique (session_id, revision_number),
  constraint prompt_revisions_revision_number_check check (revision_number > 0),
  constraint prompt_revisions_status_check check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  constraint prompt_revisions_source_prompt_check check (length(btrim(source_prompt)) > 0)
);

-- generation_attempts ---------------------------------------------------------
create table public.generation_attempts (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  revision_id uuid not null,
  attempt_number integer not null,
  status text not null default 'queued',
  image_provider_config_id uuid,
  provider_request_id text,
  parameters jsonb not null default '{}'::jsonb,
  telegram_message_id bigint,
  error_code text,
  error_message_redacted text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint generation_attempts_pkey primary key (id),
  constraint generation_attempts_session_id_fkey foreign key (session_id)
    references public.prompt_sessions (id) on delete restrict,
  constraint generation_attempts_revision_id_fkey foreign key (revision_id)
    references public.prompt_revisions (id) on delete restrict,
  constraint generation_attempts_image_config_fkey foreign key (image_provider_config_id)
    references public.provider_configs (id) on delete restrict,
  constraint generation_attempts_session_attempt_key unique (session_id, attempt_number),
  constraint generation_attempts_attempt_number_check check (attempt_number > 0),
  constraint generation_attempts_status_check check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  constraint generation_attempts_parameters_object_check check (jsonb_typeof(parameters) = 'object')
);

-- Active pointer columns on prompt_sessions (cyclic references now safe) -------
alter table public.prompt_sessions
  add column active_revision_id uuid,
  add column active_generation_attempt_id uuid,
  add constraint prompt_sessions_active_revision_fkey foreign key (active_revision_id)
    references public.prompt_revisions (id) on delete restrict,
  add constraint prompt_sessions_active_generation_attempt_fkey foreign key (active_generation_attempt_id)
    references public.generation_attempts (id) on delete restrict;

-- jobs ------------------------------------------------------------------------
create table public.jobs (
  id uuid not null default gen_random_uuid(),
  job_type text not null,
  prompt_session_id uuid,
  prompt_revision_id uuid,
  generation_attempt_id uuid,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message_redacted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint jobs_pkey primary key (id),
  constraint jobs_prompt_session_fkey foreign key (prompt_session_id)
    references public.prompt_sessions (id) on delete restrict,
  constraint jobs_prompt_revision_fkey foreign key (prompt_revision_id)
    references public.prompt_revisions (id) on delete restrict,
  constraint jobs_generation_attempt_fkey foreign key (generation_attempt_id)
    references public.generation_attempts (id) on delete restrict,
  constraint jobs_job_type_check check (length(btrim(job_type)) > 0),
  constraint jobs_status_check check (status in ('queued', 'processing', 'succeeded', 'retry_scheduled', 'failed', 'cancelled')),
  constraint jobs_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint jobs_attempt_count_check check (attempt_count >= 0),
  constraint jobs_max_attempts_check check (max_attempts > 0),
  constraint jobs_attempt_count_max_check check (attempt_count <= max_attempts),
  constraint jobs_lock_consistency_check check (
    (locked_at is null and locked_by is null and lease_expires_at is null)
    or (locked_at is not null and locked_by is not null and lease_expires_at is not null)
  )
);

-- provider_requests ------------------------------------------------------------
create table public.provider_requests (
  id uuid not null default gen_random_uuid(),
  job_id uuid,
  provider_config_id uuid not null,
  provider_key_id uuid,
  capability text not null,
  provider_request_id text,
  status text not null,
  http_status integer,
  latency_ms integer,
  error_code text,
  error_message_redacted text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint provider_requests_pkey primary key (id),
  constraint provider_requests_job_fkey foreign key (job_id)
    references public.jobs (id) on delete restrict,
  constraint provider_requests_config_fkey foreign key (provider_config_id)
    references public.provider_configs (id) on delete restrict,
  constraint provider_requests_key_fkey foreign key (provider_key_id)
    references public.provider_keys (id) on delete restrict,
  constraint provider_requests_capability_check check (capability in ('reasoning', 'image_generation')),
  constraint provider_requests_status_check check (status in ('requested', 'succeeded', 'failed', 'cancelled')),
  constraint provider_requests_http_status_check check (http_status is null or (http_status >= 100 and http_status <= 599)),
  constraint provider_requests_latency_check check (latency_ms is null or latency_ms >= 0)
);

-- telegram_updates ---------------------------------------------------------------
create table public.telegram_updates (
  id uuid not null default gen_random_uuid(),
  update_id bigint not null,
  telegram_user_id bigint,
  telegram_chat_id bigint,
  update_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint telegram_updates_pkey primary key (id),
  constraint telegram_updates_update_id_key unique (update_id),
  constraint telegram_updates_type_check check (update_type in ('message', 'callback_query'))
);

-- callback_events -----------------------------------------------------------------
create table public.callback_events (
  id uuid not null default gen_random_uuid(),
  callback_query_id text not null,
  prompt_session_id uuid,
  action text not null,
  telegram_user_id bigint not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint callback_events_pkey primary key (id),
  constraint callback_events_callback_query_id_key unique (callback_query_id),
  constraint callback_events_session_fkey foreign key (prompt_session_id)
    references public.prompt_sessions (id) on delete restrict,
  constraint callback_events_action_check check (action in (
    'generate',
    'revise',
    'cancel',
    'retry',
    'regenerate',
    'complete'
  ))
);

-- job_events -----------------------------------------------------------------------
create table public.job_events (
  id uuid not null default gen_random_uuid(),
  job_id uuid,
  prompt_session_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint job_events_pkey primary key (id),
  constraint job_events_job_fkey foreign key (job_id)
    references public.jobs (id) on delete restrict,
  constraint job_events_session_fkey foreign key (prompt_session_id)
    references public.prompt_sessions (id) on delete restrict,
  constraint job_events_event_type_check check (event_type in (
    'queued',
    'claimed',
    'retry_scheduled',
    'succeeded',
    'failed',
    'cancelled',
    'lease_expired'
  )),
  constraint job_events_payload_object_check check (jsonb_typeof(payload) = 'object')
);

-- Indexes ---------------------------------------------------------------------------
create index bot_users_last_seen_idx on public.bot_users (last_seen_at);
create index provider_configs_selection_idx on public.provider_configs (capability, is_active, priority, id);
create index provider_keys_selection_idx on public.provider_keys (provider_config_id, is_active, cooldown_until, last_used_at, id);
create index prompt_sessions_active_lookup_idx on public.prompt_sessions (telegram_user_id, status, updated_at desc);
create index prompt_revisions_session_idx on public.prompt_revisions (session_id, revision_number);
create index generation_attempts_session_status_idx on public.generation_attempts (session_id, status, created_at desc);
create index jobs_claim_idx on public.jobs (status, available_at, created_at, id)
  where status in ('queued', 'retry_scheduled', 'processing');
create index jobs_lease_recovery_idx on public.jobs (locked_at, id) where status = 'processing';
create index provider_requests_config_created_idx on public.provider_requests (provider_config_id, created_at desc);
create index provider_requests_job_created_idx on public.provider_requests (job_id, created_at);
create index telegram_updates_received_at_idx on public.telegram_updates (received_at);
create index callback_events_session_received_idx on public.callback_events (prompt_session_id, received_at desc);
create index job_events_session_created_idx on public.job_events (prompt_session_id, created_at, id);
create index job_events_job_created_idx on public.job_events (job_id, created_at, id);

-- updated_at triggers on mutable tables only --------------------------------------
create trigger bot_users_set_updated_at
  before update on public.bot_users
  for each row execute function public.set_updated_at();
create trigger provider_configs_set_updated_at
  before update on public.provider_configs
  for each row execute function public.set_updated_at();
create trigger provider_keys_set_updated_at
  before update on public.provider_keys
  for each row execute function public.set_updated_at();
create trigger prompt_sessions_set_updated_at
  before update on public.prompt_sessions
  for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();
