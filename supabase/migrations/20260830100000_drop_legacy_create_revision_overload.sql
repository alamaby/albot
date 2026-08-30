-- Drop the legacy 4-arg create_revision overload.
--
-- The 5-arg version (20260829180000) added p_instruction_kind with a default,
-- but PostgREST cannot resolve between two overloads when the caller omits
-- the optional parameter (PGRST203). Since all callers now go through the
-- 5-arg version (the 4-arg is unreachable from the TypeScript repo), drop it.

do $$
begin
  execute format(
    'drop function if exists public.create_revision(uuid, text, text, text)'
  );
exception when undefined_function then
  null;
end;
$$;
