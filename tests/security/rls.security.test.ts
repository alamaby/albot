import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, getAnonClient, isHostedConfigured } from "../helpers/hosted";

const skip = !isHostedConfigured();

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

interface FixtureSet {
  ids: Record<string, string>;
}

let fixtures: FixtureSet | null = null;

async function insertFixtures(): Promise<FixtureSet> {
  const admin = getAdminClient();
  const tag = `rls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ids: Record<string, string> = {};

  const { data: config } = await admin
    .from("provider_configs")
    .insert({
      capability: "reasoning",
      adapter_type: "openai_compatible",
      name: "m1-rls-config",
      base_url: "https://example.invalid",
    })
    .select("id")
    .single();
  ids.provider_configs = config!.id;

  const { data: key } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: config!.id,
      key_ciphertext: "deadbeefcipher",
      key_iv: "deadbeefiv",
      key_auth_tag: "deadbeeftag",
      key_fingerprint: `fp-${tag}`,
    })
    .select("id")
    .single();
  ids.provider_keys = key!.id;

  const { data: user } = await admin
    .from("bot_users")
    .insert({ telegram_user_id: 880000001, username: tag })
    .select("id")
    .single();
  ids.bot_users = user!.id;

  const { data: session } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: 880000001,
      telegram_chat_id: 880000002,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  ids.prompt_sessions = session!.id;

  const { data: revision } = await admin
    .from("prompt_revisions")
    .insert({
      session_id: session!.id,
      revision_number: 1,
      source_prompt: "m1 rls fixture",
      reasoning_provider_config_id: config!.id,
    })
    .select("id")
    .single();
  ids.prompt_revisions = revision!.id;

  const { data: attempt } = await admin
    .from("generation_attempts")
    .insert({
      session_id: session!.id,
      revision_id: revision!.id,
      attempt_number: 1,
      image_provider_config_id: config!.id,
    })
    .select("id")
    .single();
  ids.generation_attempts = attempt!.id;

  const { data: job } = await admin
    .from("jobs")
    .insert({
      job_type: "reasoning_enhance",
      prompt_session_id: session!.id,
      prompt_revision_id: revision!.id,
      generation_attempt_id: attempt!.id,
      payload: { test_tag: tag },
    })
    .select("id")
    .single();
  ids.jobs = job!.id;

  const { data: providerRequest } = await admin
    .from("provider_requests")
    .insert({
      job_id: job!.id,
      provider_config_id: config!.id,
      provider_key_id: key!.id,
      capability: "reasoning",
      status: "requested",
    })
    .select("id")
    .single();
  ids.provider_requests = providerRequest!.id;

  const { data: update } = await admin
    .from("telegram_updates")
    .insert({ update_id: 990000001, update_type: "message" })
    .select("id")
    .single();
  ids.telegram_updates = update!.id;

  const { data: callback } = await admin
    .from("callback_events")
    .insert({
      callback_query_id: `cq-${tag}`,
      prompt_session_id: session!.id,
      action: "generate",
      telegram_user_id: 880000001,
    })
    .select("id")
    .single();
  ids.callback_events = callback!.id;

  const { data: jobEvent } = await admin
    .from("job_events")
    .insert({
      job_id: job!.id,
      prompt_session_id: session!.id,
      event_type: "queued",
      payload: { test_tag: tag },
    })
    .select("id")
    .single();
  ids.job_events = jobEvent!.id;

  return { ids };
}

async function cleanupFixtures(f: FixtureSet): Promise<void> {
  const admin = getAdminClient();
  const order = [
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
  for (const table of order) {
    const id = f.ids[table];
    if (!id) continue;
    await admin
      .from(table as "jobs")
      .delete()
      .eq("id", id as never);
  }
}

afterEach(async () => {
  if (fixtures) await cleanupFixtures(fixtures);
  fixtures = null;
});

describe.skipIf(skip)("RLS security boundary", () => {
  it("denies anonymous reads of every core table even with fixtures present", async () => {
    fixtures = await insertFixtures();
    const anon = getAnonClient();
    for (const table of CORE_TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error, `${table} must deny anonymous read`).not.toBeNull();
      expect(data, `${table} must not leak rows`).toBeNull();
    }
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
});
