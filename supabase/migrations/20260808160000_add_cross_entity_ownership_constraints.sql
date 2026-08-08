-- Cross-entity ownership invariants (Milestone 1 remediation)
--
-- The standalone foreign keys in the core schema permit inconsistent records:
-- e.g. a generation_attempt may reference a revision from another session, or a
-- job may combine a session with a revision/attempt belonging to a different
-- session. This additive migration enforces parent identity with composite
-- unique keys + composite foreign keys.
--
-- Nullable composite-FK semantics: a composite foreign key is satisfied when
-- ANY participating column is NULL. That keeps jobs/provider_requests rows that
-- reference only a subset of parents valid while still enforcing consistency
-- whenever the relevant columns are populated.

-- Parent composite unique keys (FK targets)
alter table public.prompt_revisions
  add constraint prompt_revisions_session_id_key unique (session_id, id);
alter table public.generation_attempts
  add constraint generation_attempts_session_id_key unique (session_id, id);
alter table public.generation_attempts
  add constraint generation_attempts_session_revision_id_key unique (session_id, revision_id, id);
alter table public.provider_keys
  add constraint provider_keys_config_id_key unique (provider_config_id, id);

-- generation_attempts.revision_id must belong to generation_attempts.session_id
alter table public.generation_attempts
  add constraint generation_attempts_session_revision_fkey
    foreign key (session_id, revision_id)
    references public.prompt_revisions (session_id, id)
    on delete restrict;

-- jobs.prompt_revision_id must belong to jobs.prompt_session_id
alter table public.jobs
  add constraint jobs_session_revision_fkey
    foreign key (prompt_session_id, prompt_revision_id)
    references public.prompt_revisions (session_id, id)
    on delete restrict;

-- jobs.generation_attempt_id must belong to jobs.prompt_session_id
alter table public.jobs
  add constraint jobs_session_generation_attempt_fkey
    foreign key (prompt_session_id, generation_attempt_id)
    references public.generation_attempts (session_id, id)
    on delete restrict;

-- jobs.generation_attempt_id.revision must match jobs.prompt_revision_id when all
-- three parent columns are populated
alter table public.jobs
  add constraint jobs_session_revision_attempt_fkey
    foreign key (prompt_session_id, prompt_revision_id, generation_attempt_id)
    references public.generation_attempts (session_id, revision_id, id)
    on delete restrict;

-- provider_requests.provider_key_id must belong to provider_requests.provider_config_id
alter table public.provider_requests
  add constraint provider_requests_config_key_fkey
    foreign key (provider_config_id, provider_key_id)
    references public.provider_keys (provider_config_id, id)
    on delete restrict;

-- prompt_sessions.active_revision_id must belong to the session itself
alter table public.prompt_sessions
  add constraint prompt_sessions_active_revision_session_fkey
    foreign key (id, active_revision_id)
    references public.prompt_revisions (session_id, id)
    on delete restrict;

-- prompt_sessions.active_generation_attempt_id must belong to the session itself
alter table public.prompt_sessions
  add constraint prompt_sessions_active_attempt_session_fkey
    foreign key (id, active_generation_attempt_id)
    references public.generation_attempts (session_id, id)
    on delete restrict;
