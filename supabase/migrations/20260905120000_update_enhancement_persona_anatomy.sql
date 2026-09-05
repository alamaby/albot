-- Enhancement persona v2: FLUX anatomy guards (option A, LLM-driven).
--
-- Context:
-- - Prod 2026-09-04: 5 latest generation_attempts all carried a generic
--   negative_prompt ("blurry, deformed hands, extra fingers...") yet FLUX
--   still rendered extra heads/legs.
-- - Root cause: persona v1 is generic ("professional prompt engineer..."),
--   so the LLM emits generic quality negatives without explicit extra-head /
--   extra-limb guards and without positive anatomical anchoring in "prompt".
--   FLUX (rectified-flow transformer) largely ignores negative_prompt
--   (Pixazo flux-1-schnell likely silent-drops the unknown field), so only
--   positive anchoring ("single head, two arms, two legs...") is heard.
-- - Fix (user-approved option A): teach the persona to emit both, DB-driven
--   so tunable/rollback without code deploy. No DDL, no RPC change.
--   Option B (hard-default injection in generate-image.ts) explicitly deferred.
--
-- Design:
-- - New row key='enhancement_system_persona' version=2, is_active=true;
--   deactivate v1 in the same transaction (partial unique index allows one
--   active per key). Idempotent: on conflict do nothing + conditional updates.
-- - Audit rows mirror upsert_prompt_config semantics (create + activate v2,
--   deactivate v1), guarded by not exists so re-apply is a no-op.
-- - Body <= 8000 chars (prompt_configs_body_check); ~1.1k chars.

-- v2 row (inactive insert first to avoid transient double-active) ------------
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'enhancement_system_persona',
  'You are a professional prompt engineer for FLUX image generation.' || chr(10) ||
  'Rewrite the user''s prompt into a detailed, high-quality image generation prompt.' || chr(10) ||
  'When the image contains a person or human figure:' || chr(10) ||
  '- In "prompt", explicitly state anatomical correctness: "anatomically correct, single head, two arms, two legs, natural proportions, coherent anatomy" (adjust counts if the user asked for multiple people).' || chr(10) ||
  '- In "negative_prompt", ALWAYS include anatomy guards: "extra head, duplicate head, two heads, extra limbs, extra legs, extra arms, three legs, fused limbs, conjoined, deformed, bad anatomy, mutated, disfigured, extra fingers" plus quality guards "blurry, low resolution, low quality, cartoon, anime, watermark".' || chr(10) ||
  'For non-human subjects, keep negative_prompt focused on quality only (blurry, low resolution, low quality, watermark).' || chr(10) ||
  'Preserve the user''s intent; never add nsfw or nudity beyond what was asked.',
  2,
  false,
  'system'
)
on conflict (key, version) do nothing;

-- deactivate v1 first, then activate v2 (order keeps the partial unique
-- index prompt_configs_one_active_idx happy: at most one active per key) --
update public.prompt_configs set is_active = false
 where key = 'enhancement_system_persona' and version = 1 and is_active = true
   and exists (
     select 1 from public.prompt_configs
      where key = 'enhancement_system_persona' and version = 2
   );

update public.prompt_configs set is_active = true
 where key = 'enhancement_system_persona' and version = 2 and is_active = false;

-- audit rows (idempotent) ----------------------------------------------------
insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'enhancement_system_persona', 2, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'enhancement_system_persona' and version = 2
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'enhancement_system_persona' and version = 2 and action = 'create'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'enhancement_system_persona', 2, 'activate',
  (select body from public.prompt_configs where key = 'enhancement_system_persona' and version = 1),
  body, 'system'
  from public.prompt_configs
 where key = 'enhancement_system_persona' and version = 2
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'enhancement_system_persona' and version = 2 and action = 'activate'
   );

insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'enhancement_system_persona', 1, 'deactivate', body, null, 'system'
  from public.prompt_configs
 where key = 'enhancement_system_persona' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'enhancement_system_persona' and version = 1 and action = 'deactivate'
   );
