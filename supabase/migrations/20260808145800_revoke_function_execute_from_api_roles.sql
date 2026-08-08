-- Harden function execute grants (Milestone 1)
--
-- Supabase auto-grants EXECUTE on newly created functions in exposed schemas to
-- `anon`, `authenticated`, and `service_role`. Milestone 1 policy requires the
-- atomic functions to be callable only by `service_role`. This additive migration
-- explicitly revokes the auto-granted API-role execute privileges.
revoke all on function public.claim_job(text, integer) from public, anon, authenticated;
revoke all on function public.transition_prompt_session(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_job(text, integer) to service_role;
grant execute on function public.transition_prompt_session(uuid, text, text, uuid, uuid)
  to service_role;
