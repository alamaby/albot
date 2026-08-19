-- Milestone 5: dedupe split Telegram messages by message_id.
--
-- Telegram splits a message longer than its own limit into multiple updates
-- with DIFFERENT update_ids but the SAME message_id. The webhook treated each
-- split part as a new prompt: part 1 -> "too long", part 2 -> created a
-- session, part 3 -> "active session exists". Adding telegram_message_id with
-- a partial unique index lets the update repository reject later parts of the
-- same message as duplicates.

alter table public.telegram_updates
  add column telegram_message_id bigint;

-- One message_id belongs to one chat/user; partial so callback rows (null)
-- are not constrained.
create unique index telegram_updates_message_id_key
  on public.telegram_updates (telegram_message_id)
  where telegram_message_id is not null;
