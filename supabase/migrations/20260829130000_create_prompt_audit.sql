-- Create prompt_audit table for cross-purge audit (180-day retention).
--
-- Stores per-stage copies of prompts and the provider/model used so that
-- RCA can answer "what did this user prompt to which model, and what came
-- back" after the 30-day transactional tables have been purged.
--
-- Three stages captured per user prompt:
--   enhance_input   — the raw user text (or revision instruction) that was
--                     sent to the reasoning provider
--   enhance_output  — the enhanced prompt returned (with negative_prompt,
--                     aspect_ratio)
--   generate_input  — the enhanced prompt sent to the image provider
--
-- The table is intentionally FK-free so purge_prompt_audit can drop old
-- rows without touching prompt_sessions; we only need the prompt_audit
-- rows themselves to remain self-contained for audit.

create table public.prompt_audit (
  id uuid not null default gen_random_uuid(),
  session_id uuid,
  revision_id uuid,
  attempt_id uuid,
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint,
  stage text not null,
  source_prompt text,
  enhanced_prompt text,
  image_prompt text,
  provider_config_id uuid,
  provider_request_id text,
  model text,
  status text not null,
  error_code text,
  created_at timestamptz not null default now(),
  constraint prompt_audit_pkey primary key (id),
  constraint prompt_audit_stage_check
    check (stage in ('enhance_input', 'enhance_output', 'generate_input')),
  constraint prompt_audit_status_check
    check (status in ('ok', 'failed')),
  constraint prompt_audit_telegram_user_id_check
    check (telegram_user_id is not null)
);

create index prompt_audit_user_created_idx
  on public.prompt_audit (telegram_user_id, created_at desc);
create index prompt_audit_session_idx
  on public.prompt_audit (session_id);
create index prompt_audit_created_idx
  on public.prompt_audit (created_at desc);

-- service_role only. RLS enabled+forced (same posture as other tables;
-- service_role bypasses RLS, so no policies needed).
alter table public.prompt_audit enable row level security;
alter table public.prompt_audit force row level security;
revoke all on table public.prompt_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.prompt_audit to service_role;
