-- Seed allowlisted admin user for Milestone 3 (development).
--
-- The webhook allowlist check reads bot_users.telegram_user_id. This seed
-- registers the development admin so the Telegram bot accepts prompts from
-- this user. Idempotent: ON CONFLICT upserts so re-running does not error.
--
-- telegram_user_id 83540732 is the developer's Telegram account (bigint).

insert into public.bot_users
  (telegram_user_id, is_allowed, is_admin, username)
values
  (83540732, true, true, 'alamaby')
on conflict (telegram_user_id) do update
  set is_allowed = excluded.is_allowed,
      is_admin = excluded.is_admin,
      username = excluded.username;
