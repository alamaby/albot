import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAdminClient,
  getAnonClient,
  getAuthenticatedClient,
  assertHostedOrSkip,
} from "../helpers/hosted";
import type { Database } from "@/server/supabase/database.types";

const skip = assertHostedOrSkip();

const CORE_TABLES = [
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
] as const;

type Tracked = { table: string; id: string };
let tracked: Tracked[] = [];
let authUserId: string | undefined;
let authClient: SupabaseClient<Database> | undefined;

function randomTelegramUserId(): number {
  return 800000000 + Math.floor(Math.random() * 1000000);
}

async function insertFixtures(): Promise<void> {
  const admin = getAdminClient();
  const tag = `rls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = randomTelegramUserId();

  const { data: config, error: e1 } = await admin
    .from("provider_configs")
    .insert({
      capability: "reasoning",
      adapter_type: "openai_compatible",
      name: "m1-rls-config",
      base_url: "https://example.invalid",
    })
    .select("id")
    .single();
  if (e1 || !config) throw new Error(`provider_configs insert failed: ${e1?.message}`);
  tracked.push({ table: "provider_configs", id: config.id });

  const { data: key, error: e2 } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: config.id,
      key_ciphertext: "deadbeefcipher",
      key_iv: "deadbeefiv",
      key_auth_tag: "deadbeeftag",
      key_fingerprint: `fp-${tag}`,
    })
    .select("id")
    .single();
  if (e2 || !key) throw new Error(`provider_keys insert failed: ${e2?.message}`);
  tracked.push({ table: "provider_keys", id: key.id });

  const { data: user, error: e3 } = await admin
    .from("bot_users")
    .insert({ telegram_user_id: userId, username: tag })
    .select("id")
    .single();
  if (e3 || !user) throw new Error(`bot_users insert failed: ${e3?.message}`);
  tracked.push({ table: "bot_users", id: user.id });

  const { data: session, error: e4 } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: userId,
      telegram_chat_id: userId + 1,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  if (e4 || !session) throw new Error(`prompt_sessions insert failed: ${e4?.message}`);
  tracked.push({ table: "prompt_sessions", id: session.id });

  const { data: revision, error: e5 } = await admin
    .from("prompt_revisions")
    .insert({
      session_id: session.id,
      revision_number: 1,
      source_prompt: "m1 rls fixture",
      reasoning_provider_config_id: config.id,
    })
    .select("id")
    .single();
  if (e5 || !revision) throw new Error(`prompt_revisions insert failed: ${e5?.message}`);
  tracked.push({ table: "prompt_revisions", id: revision.id });

  const { data: attempt, error: e6 } = await admin
    .from("generation_attempts")
    .insert({
      session_id: session.id,
      revision_id: revision.id,
      attempt_number: 1,
      image_provider_config_id: config.id,
    })
    .select("id")
    .single();
  if (e6 || !attempt) throw new Error(`generation_attempts insert failed: ${e6?.message}`);
  tracked.push({ table: "generation_attempts", id: attempt.id });

  const { data: job, error: e7 } = await admin
    .from("jobs")
    .insert({
      job_type: "reasoning_enhance",
      prompt_session_id: session.id,
      prompt_revision_id: revision.id,
      generation_attempt_id: attempt.id,
      payload: { test_tag: tag },
    })
    .select("id")
    .single();
  if (e7 || !job) throw new Error(`jobs insert failed: ${e7?.message}`);
  tracked.push({ table: "jobs", id: job.id });

  const { data: providerRequest, error: e8 } = await admin
    .from("provider_requests")
    .insert({
      job_id: job.id,
      provider_config_id: config.id,
      provider_key_id: key.id,
      capability: "reasoning",
      status: "requested",
    })
    .select("id")
    .single();
  if (e8 || !providerRequest) throw new Error(`provider_requests insert failed: ${e8?.message}`);
  tracked.push({ table: "provider_requests", id: providerRequest.id });

  const { data: update, error: e9 } = await admin
    .from("telegram_updates")
    .insert({ update_id: 900000000 + Math.floor(Math.random() * 1000000), update_type: "message" })
    .select("id")
    .single();
  if (e9 || !update) throw new Error(`telegram_updates insert failed: ${e9?.message}`);
  tracked.push({ table: "telegram_updates", id: update.id });

  const { data: callback, error: e10 } = await admin
    .from("callback_events")
    .insert({
      callback_query_id: `cq-${tag}`,
      prompt_session_id: session.id,
      action: "generate",
      telegram_user_id: userId,
    })
    .select("id")
    .single();
  if (e10 || !callback) throw new Error(`callback_events insert failed: ${e10?.message}`);
  tracked.push({ table: "callback_events", id: callback.id });

  const { data: jobEvent, error: e11 } = await admin
    .from("job_events")
    .insert({
      job_id: job.id,
      prompt_session_id: session.id,
      event_type: "queued",
      payload: { test_tag: tag },
    })
    .select("id")
    .single();
  if (e11 || !jobEvent) throw new Error(`job_events insert failed: ${e11?.message}`);
  tracked.push({ table: "job_events", id: jobEvent.id });
}

const CLEANUP_ORDER = [
  "job_events",
  "callback_events",
  "telegram_updates",
  "provider_requests",
  "jobs",
  "generation_attempts",
  "prompt_revisions",
  "prompt_sessions",
  "bot_users",
  "provider_keys",
  "provider_configs",
];

async function cleanupTracked(): Promise<void> {
  const admin = getAdminClient();
  const errors: string[] = [];
  for (const table of CLEANUP_ORDER) {
    for (const item of tracked.filter((t) => t.table === table)) {
      const { error } = await admin
        .from(table as "jobs")
        .delete()
        .eq("id", item.id as never);
      if (error) errors.push(`${table}:${item.id} -> ${error.message}`);
    }
  }
  tracked = [];
  if (errors.length > 0) {
    throw new Error(`cleanup failed:\n${errors.join("\n")}`);
  }
}

async function createAuthUser(): Promise<void> {
  const admin = getAdminClient();
  const anon = getAnonClient();
  const email = `m1rls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const password = "TestPassword123!";

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user)
    throw new Error(`auth user creation failed: ${createErr?.message}`);
  authUserId = created.user.id;

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signIn?.session) throw new Error(`auth sign-in failed: ${signInErr?.message}`);
  authClient = getAuthenticatedClient(signIn.session.access_token);
}

beforeAll(async () => {
  if (skip) return;
  await createAuthUser();
});

afterEach(async () => {
  if (tracked.length > 0) await cleanupTracked();
});

afterAll(async () => {
  try {
    if (authUserId) {
      const { error } = await getAdminClient().auth.admin.deleteUser(authUserId);
      if (error) throw new Error(`auth user cleanup failed: ${error.message}`);
    }
  } finally {
    authUserId = undefined;
    authClient = undefined;
  }
});

async function expectReadDenied(client: SupabaseClient<Database>, table: string): Promise<void> {
  const { data, error } = await client
    .from(table as "jobs")
    .select("*")
    .limit(1);
  expect(error, `${table} must deny read`).not.toBeNull();
  expect(data, `${table} must not leak rows`).toBeNull();
}

async function expectWriteDenied(client: SupabaseClient<Database>, table: string): Promise<void> {
  const insert = await client.from(table as "jobs").insert({ test_tag: "denied" } as never);
  expect(insert.error, `${table} must deny insert`).not.toBeNull();
  const update = await client
    .from(table as "jobs")
    .update({ test_tag: "denied" } as never)
    .eq("id", "00000000-0000-0000-0000-000000000000" as never);
  expect(update.error, `${table} must deny update`).not.toBeNull();
  const del = await client
    .from(table as "jobs")
    .delete()
    .eq("id", "00000000-0000-0000-0000-000000000000" as never);
  expect(del.error, `${table} must deny delete`).not.toBeNull();
}

describe.skipIf(skip)("RLS security boundary", () => {
  it("denies anonymous reads of every core table even with fixtures present", async () => {
    await insertFixtures();
    const anon = getAnonClient();
    for (const table of CORE_TABLES) await expectReadDenied(anon, table);
  });

  it("denies anonymous writes on every core table", async () => {
    const anon = getAnonClient();
    for (const table of CORE_TABLES) await expectWriteDenied(anon, table);
  });

  it("denies anonymous execute of atomic functions", async () => {
    const anon = getAnonClient();
    const { error: claimError } = await anon.rpc("claim_job", {
      p_worker_id: "anon",
      p_lease_seconds: 300,
    });
    expect(claimError, "claim_job must be denied to anon").not.toBeNull();

    const { error: transitionError } = await anon.rpc("transition_prompt_session", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
      p_expected_status: "received",
      p_new_status: "enhancing",
    });
    expect(transitionError, "transition_prompt_session must be denied to anon").not.toBeNull();
  });

  it("denies authenticated reads of every core table even with fixtures present", async () => {
    await insertFixtures();
    for (const table of CORE_TABLES) await expectReadDenied(authClient!, table);
  });

  it("denies authenticated writes on every core table", async () => {
    for (const table of CORE_TABLES) await expectWriteDenied(authClient!, table);
  });

  it("denies authenticated execute of atomic functions", async () => {
    const { error: claimError } = await authClient!.rpc("claim_job", {
      p_worker_id: "auth",
      p_lease_seconds: 300,
    });
    expect(claimError, "claim_job must be denied to authenticated").not.toBeNull();

    const { error: transitionError } = await authClient!.rpc("transition_prompt_session", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
      p_expected_status: "received",
      p_new_status: "enhancing",
    });
    expect(
      transitionError,
      "transition_prompt_session must be denied to authenticated",
    ).not.toBeNull();
  });

  it("denies api roles access to provider_keys specifically", async () => {
    await insertFixtures();
    await expectReadDenied(getAnonClient(), "provider_keys");
    await expectReadDenied(authClient!, "provider_keys");
    await expectWriteDenied(getAnonClient(), "provider_keys");
    await expectWriteDenied(authClient!, "provider_keys");
  });
});
