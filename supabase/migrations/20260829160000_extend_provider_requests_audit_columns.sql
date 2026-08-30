-- Add request/response audit columns to provider_requests.
--
-- request_messages: [{role, content}] sent to the reasoning provider (redacted
-- at insert time). NULL for image generation (b64_json too large).
-- response_content: the model's textual response (or redacted error reason)
-- for reasoning providers. NULL for image generation.
-- reasoning_model: snapshot of the model id (free model names drift; useful
-- for audit when provider_configs.model is later updated).
-- telegram_user_id / telegram_chat_id: denormalized for per-user audit
-- queries without joining jobs.

alter table public.provider_requests
  add column if not exists request_messages jsonb,
  add column if not exists response_content text,
  add column if not exists reasoning_model text,
  add column if not exists telegram_user_id bigint,
  add column if not exists telegram_chat_id bigint;

create index if not exists provider_requests_user_created_idx
  on public.provider_requests (telegram_user_id, created_at desc);
