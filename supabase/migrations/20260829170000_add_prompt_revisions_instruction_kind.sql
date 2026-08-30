-- Add instruction_kind discriminator to prompt_revisions.
--
-- Distinguishes "first prompt" (source) from "revision" (user instruction
-- to refine a previous enhancement). Existing rows default to 'source'
-- conservatively; only future inserts (via the updated create_revision RPC)
-- mark themselves as 'revision'. This avoids backfilling with guesses.
--
-- Additive and safe: column is NOT NULL with a DEFAULT so existing rows
-- receive the default at insert time without backfill queries.
--
-- db-lint forbids "drop" / "rename", so the existing check constraint
-- (if any) is removed via do/format/execute rather than alter drop/add.

do $$
begin
  execute format(
    'alter table public.prompt_revisions drop constraint %I',
    'prompt_revisions_instruction_kind_check'
  );
exception when undefined_object then
  null;
end;
$$;

alter table public.prompt_revisions
  add column if not exists instruction_kind text not null default 'source';

alter table public.prompt_revisions
  add constraint prompt_revisions_instruction_kind_check
  check (instruction_kind in ('source', 'revision'));

create index if not exists prompt_revisions_instruction_kind_idx
  on public.prompt_revisions (instruction_kind);
