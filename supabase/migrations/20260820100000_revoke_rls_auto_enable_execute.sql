-- Milestone 6 advisor remediation (additive).
--
-- Supabase advisor reported two WARN findings:
--   anon_security_definer_function_executable
--   authenticated_security_definer_function_executable
-- on the template event-trigger function public.rls_auto_enable() (used by the
-- ensure_rls event trigger that auto-enables RLS on new tables).
--
-- The function is a SECURITY DEFINER and currently grants EXECUTE to
-- anon/authenticated, exposing it through /rest/v1/rpc/rls_auto_enable. It is
-- never called by the application and needs no API exposure. Event triggers are
-- fired by the database engine itself (not by a role executing the function),
-- so revoking EXECUTE from API roles does not affect ensure_rls.
--
-- service_role keeps EXECUTE so migrations/tooling can still invoke it if ever
-- needed; PUBLIC execute is revoked too (defense in depth).

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;
