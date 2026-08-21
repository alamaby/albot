-- Fix callback_events action check: include model_picker_back and remove swallowed exception.
-- Previous migration omitted model_picker_back and used EXCEPTION WHEN OTHERS THEN NULL which hides failures.

do $$
begin
  execute 'alter table public.callback_events drop constraint if exists callback_events_action_check';
  execute
    'alter table public.callback_events add constraint callback_events_action_check check (action in (''generate'', ''revise'', ''cancel'', ''retry'', ''regenerate'', ''complete'', ''model_picker'', ''model_picked'', ''model_picked_default'', ''model_picker_back''))';
end;
$$;
