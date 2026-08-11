-- create_initial_session for albot (Milestone 3)
--
-- Atomically creates the initial prompt_session, the first prompt_revision,
-- and the enhancement job for a new Telegram prompt. Invoked by the Telegram
-- webhook handler after allowlist, rate-limit, active-session, and prompt-length
-- checks have passed.
--
-- Security posture (matches Milestone 1 functions):
-- - `security definer` with fixed search_path and schema-qualified references.
-- - Input validation with descriptive exceptions.
-- - Public EXECUTE revoked; only `service_role` may call this RPC.
--
-- Contract:
-- - p_telegram_user_id / p_telegram_chat_id: required bigint.
-- - p_source_prompt: required, 1..4000 chars.
-- - p_update_id: required bigint (dedupe context for audit; the webhook already
--   enforces telegram_updates(update_id) uniqueness before calling this RPC).
-- - p_job_type: defaults to 'enhance_prompt' (must be non-blank).
-- Returns (session_id, revision_id, job_id).

create or replace function public.create_initial_session(
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_source_prompt text,
  p_update_id bigint,
  p_job_type text default 'enhance_prompt'
)
returns table (session_id uuid, revision_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_id uuid;
  v_revision_id uuid;
  v_job_id uuid;
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  if p_telegram_user_id is null then
    raise exception 'create_initial_session: telegram_user_id required';
  end if;
  if p_telegram_chat_id is null then
    raise exception 'create_initial_session: telegram_chat_id required';
  end if;
  if p_update_id is null then
    raise exception 'create_initial_session: update_id required';
  end if;
  if p_source_prompt is null
     or length(btrim(p_source_prompt)) = 0
     or length(p_source_prompt) > 4000 then
    raise exception 'create_initial_session: source_prompt must be 1..4000 characters';
  end if;
  if p_job_type is null or length(btrim(p_job_type)) = 0 then
    raise exception 'create_initial_session: job_type required';
  end if;

  insert into public.prompt_sessions
    (telegram_user_id, telegram_chat_id, status, expires_at)
  values
    (p_telegram_user_id, p_telegram_chat_id, 'received', v_expires_at)
  returning id into v_session_id;

  insert into public.prompt_revisions
    (session_id, revision_number, source_prompt, status)
  values
    (v_session_id, 1, p_source_prompt, 'pending')
  returning id into v_revision_id;

  update public.prompt_sessions
     set active_revision_id = v_revision_id
   where id = v_session_id;

  insert into public.jobs
    (job_type, prompt_session_id, prompt_revision_id, status, payload)
  values
    (p_job_type, v_session_id, v_revision_id, 'queued',
     jsonb_build_object(
       'telegram_user_id', p_telegram_user_id,
       'telegram_chat_id', p_telegram_chat_id,
       'update_id', p_update_id
     ))
  returning id into v_job_id;

  return query select v_session_id, v_revision_id, v_job_id;
end;
$$;

-- Supabase auto-grants EXECUTE on new functions to anon/authenticated; revoke
-- them so only service_role may create initial sessions.
revoke all on function public.create_initial_session(bigint, bigint, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_initial_session(bigint, bigint, text, bigint, text)
  to service_role;
