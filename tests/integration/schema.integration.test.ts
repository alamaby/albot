import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { getDbConfig, isHostedConfigured } from "../helpers/hosted";

const skip = !isHostedConfigured();

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
];

const EXPECTED_COLUMNS: Record<string, string[]> = {
  bot_users: [
    "id",
    "telegram_user_id",
    "telegram_chat_id",
    "username",
    "is_allowed",
    "is_admin",
    "created_at",
    "updated_at",
    "last_seen_at",
  ],
  provider_configs: [
    "id",
    "capability",
    "adapter_type",
    "name",
    "base_url",
    "model",
    "settings",
    "selection_strategy",
    "priority",
    "weight",
    "config_version",
    "is_active",
    "activated_at",
    "created_at",
    "updated_at",
  ],
  provider_keys: [
    "id",
    "provider_config_id",
    "key_ciphertext",
    "key_iv",
    "key_auth_tag",
    "key_fingerprint",
    "label",
    "weight",
    "is_active",
    "failure_count",
    "cooldown_until",
    "last_used_at",
    "created_at",
    "updated_at",
  ],
  prompt_sessions: [
    "id",
    "telegram_user_id",
    "telegram_chat_id",
    "status",
    "telegram_status_message_id",
    "active_revision_id",
    "active_generation_attempt_id",
    "created_at",
    "updated_at",
    "expires_at",
    "completed_at",
  ],
  prompt_revisions: [
    "id",
    "session_id",
    "revision_number",
    "source_prompt",
    "previous_prompt",
    "revision_instruction",
    "enhanced_prompt",
    "negative_prompt",
    "aspect_ratio",
    "reasoning_provider_config_id",
    "status",
    "created_at",
    "completed_at",
  ],
  generation_attempts: [
    "id",
    "session_id",
    "revision_id",
    "attempt_number",
    "status",
    "image_provider_config_id",
    "provider_request_id",
    "parameters",
    "telegram_message_id",
    "error_code",
    "error_message_redacted",
    "started_at",
    "completed_at",
    "created_at",
  ],
  jobs: [
    "id",
    "job_type",
    "prompt_session_id",
    "prompt_revision_id",
    "generation_attempt_id",
    "status",
    "payload",
    "attempt_count",
    "max_attempts",
    "available_at",
    "locked_at",
    "locked_by",
    "lease_expires_at",
    "last_error_code",
    "last_error_message_redacted",
    "created_at",
    "updated_at",
    "completed_at",
  ],
  provider_requests: [
    "id",
    "job_id",
    "provider_config_id",
    "provider_key_id",
    "capability",
    "provider_request_id",
    "status",
    "http_status",
    "latency_ms",
    "error_code",
    "error_message_redacted",
    "created_at",
    "completed_at",
  ],
  telegram_updates: [
    "id",
    "update_id",
    "telegram_user_id",
    "telegram_chat_id",
    "update_type",
    "received_at",
    "processed_at",
  ],
  callback_events: [
    "id",
    "callback_query_id",
    "prompt_session_id",
    "action",
    "telegram_user_id",
    "received_at",
    "processed_at",
  ],
  job_events: ["id", "job_id", "prompt_session_id", "event_type", "payload", "created_at"],
};

const EXPECTED_FUNCTIONS = [
  "claim_job(p_worker_id text, p_lease_seconds integer)",
  "transition_prompt_session(p_session_id uuid, p_expected_status text, p_new_status text, p_active_revision_id uuid, p_active_generation_attempt_id uuid)",
];

const EXPECTED_INDEXES = [
  "bot_users_telegram_user_id_key",
  "provider_configs_selection_idx",
  "provider_keys_provider_config_fingerprint_key",
  "provider_keys_selection_idx",
  "prompt_sessions_active_lookup_idx",
  "prompt_revisions_session_revision_key",
  "generation_attempts_session_attempt_key",
  "jobs_claim_idx",
  "jobs_lease_recovery_idx",
  "telegram_updates_update_id_key",
  "callback_events_callback_query_id_key",
  "callback_events_session_received_idx",
];

const EXPECTED_TRIGGERS = [
  "bot_users_set_updated_at",
  "provider_configs_set_updated_at",
  "provider_keys_set_updated_at",
  "prompt_sessions_set_updated_at",
  "jobs_set_updated_at",
];

const EXPECTED_MIGRATIONS = [
  "20260808145500",
  "20260808145600",
  "20260808145700",
  "20260808145800",
];

let pool: pg.Pool | undefined;

beforeAll(async () => {
  if (skip) return;
  const cfg = await getDbConfig();
  pool = new pg.Pool({ ...cfg, max: 2 });
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

  it("has expected columns on every core table", async () => {
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const res = await pool!.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table],
      );
      const names = res.rows.map((r) => r.column_name as string);
      expect(names.sort()).toEqual([...cols].sort());
    }
  });

  it("has expected named functions with exact signatures", async () => {
    const res = await pool!.query(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('claim_job', 'transition_prompt_session', 'set_updated_at')`,
    );
    const sigs = res.rows.map((r) => `${r.proname}(${r.args})`);
    for (const fn of EXPECTED_FUNCTIONS) expect(sigs).toContain(fn);
    expect(sigs).toContain("set_updated_at()");
  });

  it("has named constraints", async () => {
    const res = await pool!.query(
      `select conrelid::regclass::text as rel, conname
         from pg_constraint
        where connamespace = 'public'::regnamespace
          and contype in ('c', 'u', 'f', 'p')`,
    );
    const named = res.rows.map((r) => `${r.rel}:${r.conname}`);
    for (const expected of [
      "bot_users:bot_users_pkey",
      "bot_users:bot_users_telegram_user_id_key",
      "provider_configs:provider_configs_capability_check",
      "prompt_sessions:prompt_sessions_status_check",
      "prompt_sessions:prompt_sessions_active_revision_fkey",
      "prompt_revisions:prompt_revisions_session_revision_key",
      "generation_attempts:generation_attempts_session_attempt_key",
      "jobs:jobs_status_check",
      "jobs:jobs_lock_consistency_check",
      "callback_events:callback_events_action_check",
      "provider_requests:provider_requests_http_status_check",
    ]) {
      expect(named).toContain(expected);
    }
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

  it("has expected indexes", async () => {
    const res = await pool!.query(
      `select i.relname
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
        where t.relnamespace = 'public'::regnamespace`,
    );
    const names = res.rows.map((r) => r.relname as string);
    for (const idx of EXPECTED_INDEXES) expect(names).toContain(idx);
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

  it("records applied migrations", async () => {
    const res = await pool!.query(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const versions = res.rows.map((r) => r.version as string);
    expect(versions).toEqual(expect.arrayContaining(EXPECTED_MIGRATIONS));
  });
});
