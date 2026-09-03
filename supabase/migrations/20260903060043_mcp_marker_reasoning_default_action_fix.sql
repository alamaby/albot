-- Marker migration (no-op): the callback_events action check re-apply with the
-- corrected "reasoning_default" action name was pre-applied to the hosted
-- development database via MCP apply_migration, which recorded this
-- UTC apply-time version. The canonical, idempotent constraint definition
-- lives in 20260903052614_add_reasoning_provider_preference.sql, so this
-- marker applies nothing: on dev the constraint already exists, on a fresh
-- database the canonical file installs it.

select 1;
