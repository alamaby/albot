import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, isHostedConfigured } from "../helpers/hosted";

const skip = !isHostedConfigured();

let cleanupIds: { table: string; id: string }[] = [];

afterEach(async () => {
  const admin = getAdminClient();
  for (const { table, id } of cleanupIds.reverse()) {
    await admin
      .from(table as "bot_users")
      .delete()
      .eq("id", id as never);
  }
  cleanupIds = [];
});

describe.skipIf(skip)("service role smoke", () => {
  it("can write and read a bot_user fixture", async () => {
    const admin = getAdminClient();
    const { data: inserted, error: insertError } = await admin
      .from("bot_users")
      .insert({ telegram_user_id: 999000111, username: "m1-service-role-smoke" })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(inserted?.id).toBeTruthy();
    cleanupIds.push({ table: "bot_users", id: inserted!.id });

    const { data: read, error: readError } = await admin
      .from("bot_users")
      .select("telegram_user_id, username")
      .eq("id", inserted!.id)
      .single();
    expect(readError).toBeNull();
    expect(read).toMatchObject({ telegram_user_id: 999000111, username: "m1-service-role-smoke" });
  });

  it("can claim and persist a job via RPC (service role)", async () => {
    const admin = getAdminClient();
    const tag = `sr_${Date.now()}`;
    const { data: job, error: insertError } = await admin
      .from("jobs")
      .insert({ job_type: "reasoning_enhance", payload: { test_tag: tag } })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    cleanupIds.push({ table: "jobs", id: job!.id });

    const { data: claimed, error: rpcError } = await admin.rpc("claim_job", {
      p_worker_id: "service-role-smoke",
      p_lease_seconds: 300,
    });
    expect(rpcError).toBeNull();
    expect(claimed).toHaveLength(1);
    expect(claimed![0].id).toBe(job!.id);
    expect(claimed![0].status).toBe("processing");
    expect(claimed![0].attempt_count).toBe(1);
    expect(claimed![0].locked_by).toBe("service-role-smoke");
  });
});
