import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { getDbConfig, assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

const EXPECTED_TABLES = [
  "bot_users",
  "provider_configs",
  "provider_keys",
  "prompt_sessions",
  "prompt_revisions",
  "generation_attempts",
  "jobs",
  "provider_requests",
  "telegram_updates",
  "callback_events",
  "job_events",
  "user_image_preferences",
  "prompt_audit",
];

// name: [data_type, is_nullable, column_default]
type ColSpec = [string, "YES" | "NO", string | null];
const COLUMN_SPECS: Record<string, Record<string, ColSpec>> = {
  bot_users: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    telegram_user_id: ["bigint", "NO", null],
    telegram_chat_id: ["bigint", "YES", null],
    username: ["text", "YES", null],
    is_allowed: ["boolean", "NO", "false"],
    is_admin: ["boolean", "NO", "false"],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
    last_seen_at: ["timestamp with time zone", "YES", null],
  },
  provider_configs: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    capability: ["text", "NO", null],
    adapter_type: ["text", "NO", null],
    name: ["text", "NO", null],
    base_url: ["text", "NO", null],
    model: ["text", "YES", null],
    settings: ["jsonb", "NO", "'{}'::jsonb"],
    selection_strategy: ["text", "NO", "'priority_failover'::text"],
    key_selection_strategy: ["text", "YES", null],
    priority: ["integer", "NO", "100"],
    weight: ["integer", "NO", "1"],
    config_version: ["integer", "NO", "1"],
    is_active: ["boolean", "NO", "true"],
    activated_at: ["timestamp with time zone", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
  },
  provider_keys: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    provider_config_id: ["uuid", "NO", null],
    key_ciphertext: ["text", "NO", null],
    key_iv: ["text", "NO", null],
    key_auth_tag: ["text", "NO", null],
    key_fingerprint: ["text", "NO", null],
    label: ["text", "YES", null],
    weight: ["integer", "NO", "1"],
    priority: ["integer", "NO", "100"],
    is_active: ["boolean", "NO", "true"],
    failure_count: ["integer", "NO", "0"],
    cooldown_until: ["timestamp with time zone", "YES", null],
    last_used_at: ["timestamp with time zone", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
  },
  prompt_sessions: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    telegram_user_id: ["bigint", "NO", null],
    telegram_chat_id: ["bigint", "NO", null],
    status: ["text", "NO", "'received'::text"],
    telegram_status_message_id: ["bigint", "YES", null],
    active_revision_id: ["uuid", "YES", null],
    active_generation_attempt_id: ["uuid", "YES", null],
    preferred_image_provider_config_id: ["uuid", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
    expires_at: ["timestamp with time zone", "NO", null],
    completed_at: ["timestamp with time zone", "YES", null],
  },
  prompt_revisions: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    session_id: ["uuid", "NO", null],
    revision_number: ["integer", "NO", null],
    source_prompt: ["text", "NO", null],
    previous_prompt: ["text", "YES", null],
    revision_instruction: ["text", "YES", null],
    enhanced_prompt: ["text", "YES", null],
    negative_prompt: ["text", "YES", null],
    aspect_ratio: ["text", "YES", null],
    reasoning_provider_config_id: ["uuid", "YES", null],
    status: ["text", "NO", "'pending'::text"],
    instruction_kind: ["text", "NO", "'source'::text"],
    created_at: ["timestamp with time zone", "NO", "now()"],
    completed_at: ["timestamp with time zone", "YES", null],
  },
  generation_attempts: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    session_id: ["uuid", "NO", null],
    revision_id: ["uuid", "NO", null],
    attempt_number: ["integer", "NO", null],
    status: ["text", "NO", "'queued'::text"],
    image_provider_config_id: ["uuid", "YES", null],
    provider_request_id: ["text", "YES", null],
    parameters: ["jsonb", "NO", "'{}'::jsonb"],
    telegram_message_id: ["bigint", "YES", null],
    error_code: ["text", "YES", null],
    error_message_redacted: ["text", "YES", null],
    started_at: ["timestamp with time zone", "YES", null],
    completed_at: ["timestamp with time zone", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
  },
  jobs: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    job_type: ["text", "NO", null],
    prompt_session_id: ["uuid", "YES", null],
    prompt_revision_id: ["uuid", "YES", null],
    generation_attempt_id: ["uuid", "YES", null],
    status: ["text", "NO", "'queued'::text"],
    payload: ["jsonb", "NO", "'{}'::jsonb"],
    attempt_count: ["integer", "NO", "0"],
    max_attempts: ["integer", "NO", "3"],
    available_at: ["timestamp with time zone", "NO", "now()"],
    locked_at: ["timestamp with time zone", "YES", null],
    locked_by: ["text", "YES", null],
    lease_expires_at: ["timestamp with time zone", "YES", null],
    last_error_code: ["text", "YES", null],
    last_error_message_redacted: ["text", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
    completed_at: ["timestamp with time zone", "YES", null],
  },
  provider_requests: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    job_id: ["uuid", "YES", null],
    provider_config_id: ["uuid", "NO", null],
    provider_key_id: ["uuid", "YES", null],
    capability: ["text", "NO", null],
    provider_request_id: ["text", "YES", null],
    status: ["text", "NO", null],
    http_status: ["integer", "YES", null],
    latency_ms: ["integer", "YES", null],
    error_code: ["text", "YES", null],
    error_message_redacted: ["text", "YES", null],
    request_messages: ["jsonb", "YES", null],
    response_content: ["text", "YES", null],
    reasoning_model: ["text", "YES", null],
    telegram_user_id: ["bigint", "YES", null],
    telegram_chat_id: ["bigint", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    completed_at: ["timestamp with time zone", "YES", null],
  },
  telegram_updates: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    update_id: ["bigint", "NO", null],
    telegram_user_id: ["bigint", "YES", null],
    telegram_chat_id: ["bigint", "YES", null],
    telegram_message_id: ["bigint", "YES", null],
    update_type: ["text", "NO", null],
    received_at: ["timestamp with time zone", "NO", "now()"],
    processed_at: ["timestamp with time zone", "YES", null],
  },
  callback_events: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    callback_query_id: ["text", "NO", null],
    prompt_session_id: ["uuid", "YES", null],
    action: ["text", "NO", null],
    telegram_user_id: ["bigint", "NO", null],
    received_at: ["timestamp with time zone", "NO", "now()"],
    processed_at: ["timestamp with time zone", "YES", null],
  },
  job_events: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    job_id: ["uuid", "YES", null],
    prompt_session_id: ["uuid", "YES", null],
    event_type: ["text", "NO", null],
    payload: ["jsonb", "NO", "'{}'::jsonb"],
    created_at: ["timestamp with time zone", "NO", "now()"],
  },
  user_image_preferences: {
    telegram_user_id: ["bigint", "NO", null],
    preferred_provider_config_id: ["uuid", "NO", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
    updated_at: ["timestamp with time zone", "NO", "now()"],
  },
  prompt_audit: {
    id: ["uuid", "NO", "gen_random_uuid()"],
    session_id: ["uuid", "YES", null],
    revision_id: ["uuid", "YES", null],
    attempt_id: ["uuid", "YES", null],
    telegram_user_id: ["bigint", "NO", null],
    telegram_chat_id: ["bigint", "NO", null],
    telegram_message_id: ["bigint", "YES", null],
    stage: ["text", "NO", null],
    source_prompt: ["text", "YES", null],
    previous_prompt: ["text", "YES", null],
    revision_instruction: ["text", "YES", null],
    enhanced_prompt: ["text", "YES", null],
    image_prompt: ["text", "YES", null],
    provider_config_id: ["uuid", "YES", null],
    provider_request_id: ["text", "YES", null],
    model: ["text", "YES", null],
    status: ["text", "NO", null],
    error_code: ["text", "YES", null],
    created_at: ["timestamp with time zone", "NO", "now()"],
  },
};

// [constraint-name, fragments that must appear in pg_get_constraintdef]
const CONSTRAINT_FRAGMENTS: [string, string[]][] = [
  ["provider_configs_capability_check", ["'reasoning'::text", "'image_generation'::text"]],
  [
    "provider_configs_selection_strategy_check",
    ["'priority_failover'::text", "'weighted'::text", "'round_robin'::text"],
  ],
  [
    "provider_configs_key_selection_strategy_check",
    ["key_selection_strategy", "'priority'", "'round_robin'"],
  ],
  ["provider_configs_priority_check", ["priority >= 0"]],
  ["provider_configs_weight_check", ["weight > 0"]],
  ["provider_configs_config_version_check", ["config_version > 0"]],
  ["provider_configs_settings_object_check", ["jsonb_typeof(settings)", "'object'"]],
  ["provider_keys_ciphertext_check", ["length(btrim(key_ciphertext)) > 0"]],
  ["provider_keys_weight_check", ["weight > 0"]],
  ["provider_keys_priority_check", ["priority >= 0"]],
  ["prompt_sessions_status_check", ["'awaiting_confirmation'::text", "'completed'::text"]],
  ["prompt_sessions_expires_at_check", ["expires_at > created_at"]],
  ["prompt_revisions_source_prompt_check", ["length(btrim(source_prompt)) > 0"]],
  ["prompt_revisions_status_check", ["'pending'::text", "'cancelled'::text"]],
  ["generation_attempts_attempt_number_check", ["attempt_number > 0"]],
  ["generation_attempts_status_check", ["'succeeded'::text", "'cancelled'::text"]],
  ["generation_attempts_parameters_object_check", ["jsonb_typeof(parameters)", "'object'"]],
  ["jobs_status_check", ["'retry_scheduled'::text", "'cancelled'::text"]],
  ["jobs_payload_object_check", ["jsonb_typeof(payload)", "'object'"]],
  ["jobs_attempt_count_max_check", ["attempt_count <= max_attempts"]],
  ["jobs_lock_consistency_check", ["locked_at", "locked_by", "lease_expires_at"]],
  ["provider_requests_capability_check", ["'image_generation'::text"]],
  ["provider_requests_status_check", ["'succeeded'::text", "'cancelled'::text"]],
  ["provider_requests_http_status_check", ["http_status >= 100", "http_status <= 599"]],
  ["provider_requests_latency_check", ["latency_ms >= 0"]],
  ["telegram_updates_type_check", ["'message'::text", "'callback_query'::text"]],
  [
    "callback_events_action_check",
    [
      "'regenerate'::text",
      "'complete'::text",
      "'model_picker'::text",
      "'model_picked'::text",
      "'model_picked_default'::text",
      "'model_picker_back'::text",
    ],
  ],
  ["job_events_event_type_check", ["'lease_expired'::text", "'cancelled'::text"]],
  ["job_events_payload_object_check", ["jsonb_typeof(payload)", "'object'"]],
];

// [constraint-name, fragments for FK def (REFERENCES ... ON DELETE ...)]
const FK_FRAGMENTS: [string, string[]][] = [
  [
    "provider_keys_provider_config_id_fkey",
    ["REFERENCES public.provider_configs(id)", "ON DELETE RESTRICT"],
  ],
  [
    "prompt_revisions_session_id_fkey",
    ["REFERENCES public.prompt_sessions(id)", "ON DELETE RESTRICT"],
  ],
  [
    "generation_attempts_session_id_fkey",
    ["REFERENCES public.prompt_sessions(id)", "ON DELETE RESTRICT"],
  ],
  [
    "generation_attempts_revision_id_fkey",
    ["REFERENCES public.prompt_revisions(id)", "ON DELETE RESTRICT"],
  ],
  ["jobs_prompt_session_fkey", ["REFERENCES public.prompt_sessions(id)", "ON DELETE RESTRICT"]],
  [
    "provider_requests_config_fkey",
    ["REFERENCES public.provider_configs(id)", "ON DELETE RESTRICT"],
  ],
  ["callback_events_session_fkey", ["REFERENCES public.prompt_sessions(id)", "ON DELETE RESTRICT"]],
  [
    "generation_attempts_session_revision_fkey",
    ["REFERENCES public.prompt_revisions(session_id, id)"],
  ],
  ["jobs_session_revision_fkey", ["REFERENCES public.prompt_revisions(session_id, id)"]],
  [
    "jobs_session_generation_attempt_fkey",
    ["REFERENCES public.generation_attempts(session_id, id)"],
  ],
  [
    "jobs_session_revision_attempt_fkey",
    ["REFERENCES public.generation_attempts(session_id, revision_id, id)"],
  ],
  [
    "provider_requests_config_key_fkey",
    ["REFERENCES public.provider_keys(provider_config_id, id)"],
  ],
  [
    "prompt_sessions_active_revision_session_fkey",
    ["REFERENCES public.prompt_revisions(session_id, id)"],
  ],
  [
    "prompt_sessions_active_attempt_session_fkey",
    ["REFERENCES public.generation_attempts(session_id, id)"],
  ],
  [
    "user_image_preferences_user_fkey",
    ["REFERENCES public.bot_users(telegram_user_id)", "ON DELETE CASCADE"],
  ],
  [
    "user_image_preferences_config_fkey",
    ["REFERENCES public.provider_configs(id)", "ON DELETE RESTRICT"],
  ],
  [
    "prompt_sessions_preferred_image_provider_config_id_fkey",
    ["REFERENCES public.provider_configs(id)", "ON DELETE RESTRICT"],
  ],
];

const EXPECTED_INDEX_DEF_FRAGMENTS: [string, string[]][] = [
  ["provider_configs_selection_idx", ["btree (capability, is_active, priority, id)"]],
  [
    "provider_keys_selection_idx",
    [
      "btree (provider_config_id, is_active, priority, cooldown_until, last_used_at NULLS FIRST, id)",
    ],
  ],
  ["prompt_sessions_active_lookup_idx", ["btree (telegram_user_id, status, updated_at DESC)"]],
  ["generation_attempts_session_status_idx", ["btree (session_id, status, created_at DESC)"]],
  [
    "jobs_claim_idx",
    [
      "btree (status, available_at, created_at, id)",
      "'queued'::text",
      "'retry_scheduled'::text",
      "'processing'::text",
    ],
  ],
  ["jobs_lease_recovery_idx", ["btree (locked_at, id)", "'processing'::text"]],
  [
    "prompt_sessions_one_active_idx",
    [
      "btree (telegram_user_id)",
      "'completed'::text",
      "'cancelled'::text",
      "'expired'::text",
      "'enhancement_failed'::text",
      "'generation_failed'::text",
    ],
  ],
  ["prompt_sessions_status_idx", ["btree (status, updated_at DESC)"]],
  ["provider_requests_config_created_idx", ["btree (provider_config_id, created_at DESC)"]],
  ["callback_events_session_received_idx", ["btree (prompt_session_id, received_at DESC)"]],
];

const EXPECTED_FUNCTIONS: [string, string, boolean][] = [
  // [signature, expected search_path, prosecdef]
  ["claim_job(p_worker_id text, p_lease_seconds integer)", "search_path=pg_catalog, public", true],
  [
    "transition_prompt_session(p_session_id uuid, p_expected_status text, p_new_status text, p_active_revision_id uuid, p_active_generation_attempt_id uuid)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "increment_provider_key_failure(p_provider_config_id uuid, p_key_id uuid, p_threshold integer)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "mark_revision_failed(p_revision_id uuid, p_error_code text, p_error_message_redacted text)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "create_revision(p_session_id uuid, p_source_prompt text, p_previous_prompt text, p_revision_instruction text, p_instruction_kind text)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "create_generation_attempt(p_session_id uuid, p_revision_id uuid)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "mark_generation_attempt_failed(p_attempt_id uuid, p_error_code text, p_error_message_redacted text)",
    "search_path=pg_catalog, public",
    true,
  ],
  [
    "mark_generation_attempt_succeeded(p_attempt_id uuid, p_provider_request_id text, p_telegram_message_id bigint)",
    "search_path=pg_catalog, public",
    true,
  ],
  ["complete_prompt_session(p_session_id uuid)", "search_path=pg_catalog, public", true],
  [
    "recover_stuck_generating_sessions(p_max_sessions integer, p_stuck_minutes integer)",
    "search_path=pg_catalog, public",
    true,
  ],
  ["set_updated_at()", "search_path=pg_catalog, public", false],
];

const EXPECTED_TRIGGERS = [
  "bot_users_set_updated_at",
  "provider_configs_set_updated_at",
  "provider_keys_set_updated_at",
  "prompt_sessions_set_updated_at",
  "jobs_set_updated_at",
  "user_image_preferences_set_updated_at",
];

const EXPECTED_MIGRATIONS = [
  "20260808145500",
  "20260808145600",
  "20260808145700",
  "20260808145800",
  "20260808160000",
  "20260808160100",
  "20260809171800",
  "20260810150719",
  "20260813074037",
  "20260813091942",
  "20260813100000",
  "20260818100000",
  "20260819100000",
  "20260819110000",
  "20260819120000",
  "20260819130000",
  "20260820100000",
  "20260820110000",
  "20260821090000",
  "20260821100000",
  "20260821110000",
  "20260822100000",
  "20260822110000",
  "20260822120000",
  "20260823100000",
  "20260826100000",
  "20260827100000",
  "20260828100000",
  "20260828120000",
  "20260829100000",
  "20260829110000",
  "20260829120000",
  "20260829130000",
  "20260829140000",
  "20260829150000",
  "20260829160000",
  "20260829170000",
  "20260829180000",
  "20260830100000",
  "20260901113116",
  "20260902085338",
  "20260902103000",
];

const API_ROLES = ["anon", "authenticated", "public"];

let pool: pg.Pool | undefined;

beforeAll(async () => {
  if (skip) return;
  const cfg = await getDbConfig();
  pool = new pg.Pool({ ...cfg, max: 2, options: "-c search_path=pg_catalog" });
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe.skipIf(skip)("schema integration", () => {
  it("has all core tables", async () => {
    const res = await pool!.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = res.rows.map((r) => r.table_name as string);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });

  it("has exact column types, nullability, and defaults", async () => {
    for (const [table, cols] of Object.entries(COLUMN_SPECS)) {
      const res = await pool!.query(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table],
      );
      const rows = res.rows.map((r) => ({ name: r.column_name, ...r }));
      expect(rows.map((r) => r.name).sort()).toEqual(Object.keys(cols).sort());
      for (const [col, [type, nullable, def]] of Object.entries(cols)) {
        const row = rows.find((r) => r.name === col);
        expect(row, `${table}.${col} present`).toBeDefined();
        expect(row.data_type, `${table}.${col} type`).toBe(type);
        expect(row.is_nullable, `${table}.${col} nullable`).toBe(nullable);
        expect(row.column_default, `${table}.${col} default`).toBe(def);
      }
    }
  });

  it("has exact constraint definitions", async () => {
    const res = await pool!.query(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'c'`,
    );
    const byName = new Map(res.rows.map((r) => [r.conname as string, r.def as string]));
    for (const [name, fragments] of CONSTRAINT_FRAGMENTS) {
      const def = byName.get(name);
      expect(def, `constraint ${name} exists`).toBeDefined();
      for (const frag of fragments) {
        expect(def!, `constraint ${name} contains ${frag}`).toContain(frag);
      }
    }
  });

  it("has expected foreign keys with explicit delete actions", async () => {
    const res = await pool!.query(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f'`,
    );
    const byName = new Map(res.rows.map((r) => [r.conname as string, r.def as string]));
    for (const [name, fragments] of FK_FRAGMENTS) {
      const def = byName.get(name);
      expect(def, `fk ${name} exists`).toBeDefined();
      for (const frag of fragments) {
        expect(def!, `fk ${name} contains ${frag}`).toContain(frag);
      }
    }
  });

  it("has unique constraints on composite ownership keys", async () => {
    const res = await pool!.query(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'u'`,
    );
    const byName = new Map(res.rows.map((r) => [r.conname as string, r.def as string]));
    for (const name of [
      "prompt_revisions_session_id_key",
      "generation_attempts_session_id_key",
      "generation_attempts_session_revision_id_key",
      "provider_keys_config_id_key",
    ]) {
      expect(byName.has(name), `unique ${name} exists`).toBe(true);
    }
  });

  it("has exact index definitions including predicates", async () => {
    const res = await pool!.query(
      `select i.relname, pg_get_indexdef(x.indexrelid) as def
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
        where t.relnamespace = 'public'::regnamespace and not x.indisprimary`,
    );
    const byName = new Map(res.rows.map((r) => [r.relname as string, r.def as string]));
    for (const [name, fragments] of EXPECTED_INDEX_DEF_FRAGMENTS) {
      const def = byName.get(name);
      expect(def, `index ${name} exists`).toBeDefined();
      for (const frag of fragments) {
        expect(def!, `index ${name} contains ${frag}`).toContain(frag);
      }
    }
  });

  it("has correct function signatures, search_path, and security definer", async () => {
    const res = await pool!.query(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as args,
              p.prosecdef,
              coalesce(p.proconfig, '{}') as proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('claim_job', 'transition_prompt_session', 'increment_provider_key_failure', 'mark_revision_failed', 'create_revision', 'create_generation_attempt', 'mark_generation_attempt_failed', 'mark_generation_attempt_succeeded', 'complete_prompt_session', 'recover_stuck_generating_sessions', 'set_updated_at')`,
    );
    const rows = res.rows.map((r) => ({
      sig: `${r.proname}(${r.args})`,
      prosecdef: r.prosecdef,
      proconfig: r.proconfig,
    }));
    for (const [sig, searchPath, prosecdef] of EXPECTED_FUNCTIONS) {
      const row = rows.find((r) => r.sig === sig);
      expect(row, `function ${sig} exists`).toBeDefined();
      expect(row!.prosecdef, `function ${sig} prosecdef`).toBe(prosecdef);
      expect(row!.proconfig, `function ${sig} search_path`).toEqual(
        expect.arrayContaining([searchPath]),
      );
    }
  });

  it("has the partial unique index on active sessions", async () => {
    const res = await pool!.query(
      `select i.relname, pg_get_indexdef(x.indexrelid) as def
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
        where t.relnamespace = 'public'::regnamespace
          and i.relname = 'prompt_sessions_one_active_idx'`,
    );
    expect(res.rows).toHaveLength(1);
    const def = res.rows[0].def as string;
    expect(def).toContain("WHERE");
    expect(def).toContain("'completed'::text");
    expect(def).toContain("'cancelled'::text");
    expect(def).toContain("'expired'::text");
    expect(def).toContain("telegram_user_id");
  });

  it("grants execute of atomic functions only to service_role", async () => {
    for (const fn of [
      "claim_job(text, integer)",
      "transition_prompt_session(uuid, text, text, uuid, uuid)",
      "increment_provider_key_failure(uuid, uuid, integer)",
      "mark_revision_failed(uuid, text, text)",
      "create_revision(uuid, text, text, text, text)",
      "create_generation_attempt(uuid, uuid)",
      "mark_generation_attempt_failed(uuid, text, text)",
      "mark_generation_attempt_succeeded(uuid, text, bigint)",
      "complete_prompt_session(uuid)",
      "recover_stuck_generating_sessions(integer, integer)",
    ]) {
      for (const role of API_ROLES) {
        const res = await pool!.query(
          "select has_function_privilege($1, $2, 'EXECUTE') as allowed",
          [role, `public.${fn}`],
        );
        expect(res.rows[0].allowed, `${role} execute ${fn}`).toBe(false);
      }
      const res = await pool!.query(
        "select has_function_privilege('service_role', $1, 'EXECUTE') as allowed",
        [`public.${fn}`],
      );
      expect(res.rows[0].allowed, `service_role execute ${fn}`).toBe(true);
    }
    const trig = await pool!.query(
      "select has_function_privilege($1, 'public.set_updated_at()', 'EXECUTE') as allowed",
      ["authenticated"],
    );
    expect(trig.rows[0].allowed, "authenticated execute set_updated_at").toBe(false);
  });

  it("has RLS enabled and forced on every core table", async () => {
    const res = await pool!.query(
      `select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    for (const t of EXPECTED_TABLES) {
      const row = res.rows.find((r) => r.relname === t);
      expect(row, `table ${t}`).toBeDefined();
      expect(row.enabled, `rls enabled on ${t}`).toBe(true);
      expect(row.forced, `rls forced on ${t}`).toBe(true);
    }
  });

  it("grants no table privileges to api roles and only service_role reads", async () => {
    for (const t of EXPECTED_TABLES) {
      for (const role of API_ROLES) {
        const res = await pool!.query("select has_table_privilege($1, $2, 'SELECT') as allowed", [
          role,
          `public.${t}`,
        ]);
        expect(res.rows[0].allowed, `${role} select ${t}`).toBe(false);
      }
      const res = await pool!.query(
        "select has_table_privilege('service_role', $1, 'SELECT') as allowed",
        [`public.${t}`],
      );
      expect(res.rows[0].allowed, `service_role select ${t}`).toBe(true);
    }
  });

  it("has no permissive policies on core tables", async () => {
    const res = await pool!.query(
      `select count(*)::int as n from pg_policies where schemaname = 'public'`,
    );
    expect(res.rows[0].n).toBe(0);
  });

  it("has updated_at triggers only on mutable tables", async () => {
    const res = await pool!.query(
      `select t.tgname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    );
    const triggered = res.rows.map((r) => r.tgname as string);
    expect(triggered.sort()).toEqual([...EXPECTED_TRIGGERS].sort());
  });

  it("records exactly the expected applied migrations", async () => {
    const res = await pool!.query(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const versions = res.rows.map((r) => r.version as string);
    expect(versions).toEqual(EXPECTED_MIGRATIONS);
  });
});
