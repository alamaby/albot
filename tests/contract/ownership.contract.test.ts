import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/supabase/database.types";

const skip = assertHostedOrSkip();

interface Fixture {
  sessionA: string;
  sessionB: string;
  revisionA: string;
  revisionB: string;
  attemptA: string;
  configX: string;
  configY: string;
  keyX: string;
  keyY: string;
}

let tracked: { table: string; id: string }[] = [];

function push(table: string, id: string) {
  tracked.push({ table, id });
}

async function insertFixtures(admin: SupabaseClient<Database>): Promise<Fixture> {
  const tag = `own_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { data: cX } = await admin
    .from("provider_configs")
    .insert({
      capability: "reasoning",
      adapter_type: "openai_compatible",
      name: `config-x-${tag}`,
      base_url: "https://example.invalid",
    })
    .select("id")
    .single();
  push("provider_configs", cX!.id);
  const { data: cY } = await admin
    .from("provider_configs")
    .insert({
      capability: "reasoning",
      adapter_type: "openai_compatible",
      name: `config-y-${tag}`,
      base_url: "https://example.invalid",
    })
    .select("id")
    .single();
  push("provider_configs", cY!.id);

  const { data: kX } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: cX!.id,
      key_ciphertext: "cipher-x",
      key_iv: "iv-x",
      key_auth_tag: "tag-x",
      key_fingerprint: `fp-x-${tag}`,
    })
    .select("id")
    .single();
  push("provider_keys", kX!.id);
  const { data: kY } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: cY!.id,
      key_ciphertext: "cipher-y",
      key_iv: "iv-y",
      key_auth_tag: "tag-y",
      key_fingerprint: `fp-y-${tag}`,
    })
    .select("id")
    .single();
  push("provider_keys", kY!.id);

  const uid = 700000000 + Math.floor(Math.random() * 1000000);
  const { data: sA } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: uid,
      telegram_chat_id: uid + 1,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  push("prompt_sessions", sA!.id);
  const { data: sB } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: uid + 2,
      telegram_chat_id: uid + 3,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  push("prompt_sessions", sB!.id);

  const { data: rA } = await admin
    .from("prompt_revisions")
    .insert({ session_id: sA!.id, revision_number: 1, source_prompt: "revision-a" })
    .select("id")
    .single();
  push("prompt_revisions", rA!.id);
  const { data: rB } = await admin
    .from("prompt_revisions")
    .insert({ session_id: sB!.id, revision_number: 1, source_prompt: "revision-b" })
    .select("id")
    .single();
  push("prompt_revisions", rB!.id);

  const { data: aA } = await admin
    .from("generation_attempts")
    .insert({ session_id: sA!.id, revision_id: rA!.id, attempt_number: 1 })
    .select("id")
    .single();
  push("generation_attempts", aA!.id);

  return {
    sessionA: sA!.id,
    sessionB: sB!.id,
    revisionA: rA!.id,
    revisionB: rB!.id,
    attemptA: aA!.id,
    configX: cX!.id,
    configY: cY!.id,
    keyX: kX!.id,
    keyY: kY!.id,
  };
}

const CLEANUP_ORDER = [
  "provider_requests",
  "jobs",
  "generation_attempts",
  "prompt_revisions",
  "prompt_sessions",
  "provider_keys",
  "provider_configs",
];

afterEach(async () => {
  const admin = getAdminClient();
  for (const table of CLEANUP_ORDER) {
    for (const item of tracked.filter((t) => t.table === table)) {
      await admin
        .from(table as "jobs")
        .delete()
        .eq("id", item.id as never);
    }
  }
  tracked = [];
});

describe.skipIf(skip)("cross-entity ownership invariants", () => {
  it("rejects a generation attempt referencing a revision from another session", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { error } = await admin.from("generation_attempts").insert({
      session_id: f.sessionA,
      revision_id: f.revisionB,
      attempt_number: 2,
    });
    expect(error, "cross-session attempt must fail").not.toBeNull();
  });

  it("rejects a job combining a session with another session's revision", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { error } = await admin.from("jobs").insert({
      job_type: "reasoning_enhance",
      prompt_session_id: f.sessionA,
      prompt_revision_id: f.revisionB,
      payload: {},
    });
    expect(error, "cross-session job revision must fail").not.toBeNull();
  });

  it("rejects a job combining a session with another session's generation attempt", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { data: attemptB } = await admin
      .from("generation_attempts")
      .insert({ session_id: f.sessionB, revision_id: f.revisionB, attempt_number: 1 })
      .select("id")
      .single();
    push("generation_attempts", attemptB!.id);
    const { error } = await admin.from("jobs").insert({
      job_type: "reasoning_enhance",
      prompt_session_id: f.sessionA,
      generation_attempt_id: attemptB!.id,
      payload: {},
    });
    expect(error, "cross-session job attempt must fail").not.toBeNull();
  });

  it("rejects a job whose attempt revision differs from the job revision", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    // attempt in session A whose revision is a NEW revision A2 (not rA)
    const { data: rA2 } = await admin
      .from("prompt_revisions")
      .insert({ session_id: f.sessionA, revision_number: 2, source_prompt: "revision-a2" })
      .select("id")
      .single();
    push("prompt_revisions", rA2!.id);
    const { data: attemptA2 } = await admin
      .from("generation_attempts")
      .insert({ session_id: f.sessionA, revision_id: rA2!.id, attempt_number: 2 })
      .select("id")
      .single();
    push("generation_attempts", attemptA2!.id);
    const { error } = await admin.from("jobs").insert({
      job_type: "reasoning_enhance",
      prompt_session_id: f.sessionA,
      prompt_revision_id: f.revisionA,
      generation_attempt_id: attemptA2!.id,
      payload: {},
    });
    expect(error, "job revision/attempt mismatch must fail").not.toBeNull();
  });

  it("rejects a provider request whose key belongs to another config", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { error } = await admin.from("provider_requests").insert({
      provider_config_id: f.configX,
      provider_key_id: f.keyY,
      capability: "reasoning",
      status: "requested",
    });
    expect(error, "cross-config provider request must fail").not.toBeNull();
  });

  it("rejects a session transition attaching another session's active revision", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { error } = await admin.rpc("transition_prompt_session", {
      p_session_id: f.sessionA,
      p_expected_status: "received",
      p_new_status: "enhancing",
      p_active_revision_id: f.revisionB,
    });
    expect(error, "cross-session active revision must fail").not.toBeNull();
  });

  it("rejects a session transition attaching another session's active generation attempt", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { data: attemptB } = await admin
      .from("generation_attempts")
      .insert({ session_id: f.sessionB, revision_id: f.revisionB, attempt_number: 1 })
      .select("id")
      .single();
    push("generation_attempts", attemptB!.id);
    const { error } = await admin.rpc("transition_prompt_session", {
      p_session_id: f.sessionA,
      p_expected_status: "received",
      p_new_status: "enhancing",
      p_active_generation_attempt_id: attemptB!.id,
    });
    expect(error, "cross-session active attempt must fail").not.toBeNull();
  });

  it("still allows a consistent job chain", async () => {
    const admin = getAdminClient();
    const f = await insertFixtures(admin);
    const { data, error } = await admin
      .from("jobs")
      .insert({
        job_type: "reasoning_enhance",
        prompt_session_id: f.sessionA,
        prompt_revision_id: f.revisionA,
        generation_attempt_id: f.attemptA,
        payload: {},
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    push("jobs", data!.id);
  });
});
