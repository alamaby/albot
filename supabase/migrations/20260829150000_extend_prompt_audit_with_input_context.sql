-- Add per-stage input context columns to prompt_audit.
--
-- Stores the additional context that flows into the reasoning provider's
-- request (previous enhanced prompt + revision instruction) so post-purge
-- RCA can reconstruct what the model saw. Additive; safe to apply to a
-- table that already exists.

alter table public.prompt_audit
  add column if not exists previous_prompt text,
  add column if not exists revision_instruction text;
