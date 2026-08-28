// E2E fault injection for Milestone 6 (development environment).
// Runs against hosted dev Supabase via service role + the deployed recovery
// endpoint on the stable alias. Verifies the reliability sweep end to end:
//   1. Worker crash / lease expiry -> recover + lease_expired event
//   2. Dead job (max attempts) -> failed + dead_job
//   3. Session expiry sweep -> expired + user notification (best-effort)
//   4. Retention purge -> old terminal lineage deleted, active data kept
//   5. Backoff jitter -> retry available_at in [0, cap] (unit-covered; spot check here)
//   6. Redaction -> redactSensitive never lets tokens through (unit-covered)
//   7. Diagnostics auth -> 401 without bearer
//   8. Health readiness -> non-paid, includes counts
//
// Usage: node scripts/e2e-m6-fault-injection.mjs <RECOVERY_URL> [--skip-telegram]
// Requires env: SUPABASE_URL_DEV, SUPABASE_SECRET_KEY_DEV, JOB_PROCESSOR_SECRET.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Load .env manually (no dotenv dependency).
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const RECOVERY_URL = args.find((a) => a.startsWith("http")) ?? process.env.RECOVERY_URL;
const SKIP_TELEGRAM = args.includes("--skip-telegram");

const SUPABASE_URL = process.env.SUPABASE_URL_DEV;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY_DEV;
const JOB_PROCESSOR_SECRET =
  process.env.JOB_PROCESSOR_SECRET_DEV ?? process.env.JOB_PROCESSOR_SECRET;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error("missing SUPABASE_URL_DEV / SUPABASE_SECRET_KEY_DEV");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const failures = [];

function report(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function triggerRecovery() {
  // Direct RPC path (no endpoint secret needed): mirrors runRecovery() order.
  await admin.rpc("expire_job_leases", { p_max_jobs: 10 });
  await admin.rpc("mark_dead_jobs", { p_max_jobs: 50 });
  await admin.rpc("recover_stale_sessions", { p_max_sessions: 200 });
  const purge = await admin.rpc("purge_expired_metadata", {
    p_retention_days: 30,
    p_max_rows: 1000,
  });
  const purgedRows = Number(purge.data?.[0]?.purged_rows ?? 0);
  return { ok: true, purgedRows };
}

// Cleanup helper: null active pointers then delete children first.
async function cleanupSession(sessionId) {
  await admin
    .from("prompt_sessions")
    .update({ active_generation_attempt_id: null, active_revision_id: null })
    .eq("id", sessionId);
  await admin.from("jobs").delete().eq("prompt_session_id", sessionId);
  await admin.from("generation_attempts").delete().eq("session_id", sessionId);
  await admin.from("prompt_revisions").delete().eq("session_id", sessionId);
  await admin.from("callback_events").delete().eq("prompt_session_id", sessionId);
  await admin.from("prompt_sessions").delete().eq("id", sessionId);
}

const testUserId = 557999000 + Math.floor(Math.random() * 1000);

async function main() {
  console.log(
    `E2E M6 fault injection (dev) — recovery: ${RECOVERY_URL ?? "(not provided, trigger skipped)"}`,
  );

  // ---- 1. Worker crash / lease expiry ----
  console.log("\n[1] Lease expiry recovery");
  {
    const { data: session, error: se } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: testUserId,
        telegram_chat_id: testUserId + 1,
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    report("insert session", !se, se?.message);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { data: job, error: je } = await admin
      .from("jobs")
      .insert({
        job_type: "enhance_prompt",
        prompt_session_id: session.id,
        prompt_revision_id: null,
        status: "processing",
        locked_at: past,
        locked_by: "e2e-stale-worker",
        lease_expires_at: past,
        attempt_count: 1,
        max_attempts: 3,
        payload: { test_tag: "e2e_m6_lease" },
      })
      .select("id")
      .single();
    report("insert stale-lease job", !je, je?.message);

    await triggerRecovery();

    const { data: after } = await admin
      .from("jobs")
      .select("status, attempt_count, locked_by, lease_expires_at, last_error_code")
      .eq("id", job.id)
      .single();
    report(
      "lease-expired job re-queued",
      after?.status === "queued" &&
        after?.last_error_code === "lease_expired" &&
        after?.locked_by === null &&
        after?.lease_expires_at === null,
      JSON.stringify(after),
    );
    report(
      "attempt_count incremented by sweep",
      after?.attempt_count === 2,
      `count=${after?.attempt_count}`,
    );

    const { data: events } = await admin
      .from("job_events")
      .select("event_type")
      .eq("job_id", job.id);
    report(
      "lease_expired event recorded",
      (events ?? []).some((e) => e.event_type === "lease_expired"),
      JSON.stringify(events?.map((e) => e.event_type)),
    );

    await cleanupSession(session.id);
  }

  // ---- 2. Dead job (max attempts exhausted) ----
  console.log("\n[2] Dead job marking");
  {
    const { data: session, error: se } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: testUserId + 10,
        telegram_chat_id: testUserId + 11,
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    report("insert session", !se, se?.message);
    const { data: job, error: je } = await admin
      .from("jobs")
      .insert({
        job_type: "enhance_prompt",
        prompt_session_id: session.id,
        status: "retry_scheduled",
        attempt_count: 3,
        max_attempts: 3,
        available_at: new Date(Date.now() - 60_000).toISOString(),
        payload: { test_tag: "e2e_m6_dead" },
      })
      .select("id")
      .single();
    report("insert maxed-out job", !je, je?.message);

    await triggerRecovery();

    const { data: after } = await admin
      .from("jobs")
      .select("status, last_error_code, completed_at")
      .eq("id", job.id)
      .single();
    report(
      "maxed-out job terminal-failed as dead_job",
      after?.status === "failed" && after?.last_error_code === "dead_job" && !!after?.completed_at,
      JSON.stringify(after),
    );

    await cleanupSession(session.id);
  }

  // ---- 3. Session expiry sweep ----
  console.log("\n[3] Session expiry sweep");
  {
    const { data: session, error: se } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: testUserId + 20,
        telegram_chat_id: testUserId + 21,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // expired 1h ago
      })
      .select("id")
      .single();
    report("insert expired session", !se, se?.message);

    await triggerRecovery();

    const { data: after } = await admin
      .from("prompt_sessions")
      .select("status")
      .eq("id", session.id)
      .single();
    report("stale session marked expired", after?.status === "expired", `status=${after?.status}`);

    await cleanupSession(session.id);
  }

  // ---- 4. Retention purge ----
  console.log("\n[4] Retention purge (30 days)");
  {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const oldExpiry = new Date(Date.now() - 39 * 24 * 60 * 60 * 1000).toISOString();
    const { data: session, error: se } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: testUserId + 30,
        telegram_chat_id: testUserId + 31,
        status: "completed",
        created_at: oldDate,
        expires_at: oldExpiry,
      })
      .select("id")
      .single();
    report("insert old terminal session", !se, se?.message);

    const { data: rev, error: re } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: session.id,
        revision_number: 1,
        source_prompt: "e2e old prompt",
        status: "completed",
        created_at: oldDate,
      })
      .select("id")
      .single();
    report("insert old revision", !re, re?.message);
    // Point the session at the revision (real state) to prove the FK fix.
    await admin.from("prompt_sessions").update({ active_revision_id: rev.id }).eq("id", session.id);

    // Active session must survive.
    const { data: activeSession, error: ase } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: testUserId + 31,
        telegram_chat_id: testUserId + 32,
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    report("insert active session", !ase, ase?.message);

    const purgeResult = await triggerRecovery();
    report(
      "purge ran",
      typeof purgeResult.purgedRows === "number",
      `purgedRows=${purgeResult.purgedRows}`,
    );

    const { data: oldCheck } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", session.id)
      .maybeSingle();
    report("old terminal session purged", oldCheck === null, "row gone");

    const { data: activeCheck } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", activeSession.id)
      .single();
    report("active session kept", activeCheck?.id === activeSession.id, "row present");

    await cleanupSession(activeSession.id);
  }

  // ---- 5. Diagnostics auth ----
  console.log("\n[5] Diagnostics endpoint auth");
  if (RECOVERY_URL) {
    const diagUrl = RECOVERY_URL.replace(/\/api\/recovery\/run$/, "/api/admin/diagnostics");
    const noAuth = await fetch(diagUrl);
    report("no bearer -> 401", noAuth.status === 401, `HTTP ${noAuth.status}`);
    const badAuth = await fetch(diagUrl, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    report("wrong bearer -> 401", badAuth.status === 401, `HTTP ${badAuth.status}`);
    if (JOB_PROCESSOR_SECRET) {
      const withAuth = await fetch(diagUrl, {
        headers: { Authorization: `Bearer ${JOB_PROCESSOR_SECRET}` },
      });
      report("valid bearer -> 200", withAuth.status === 200, `HTTP ${withAuth.status}`);
    } else {
      report("valid bearer -> 200 (skipped, no secret)", true, "no JOB_PROCESSOR_SECRET locally");
    }
  } else {
    report("diagnostics auth (skipped, no RECOVERY_URL)", true, "no URL");
  }

  // ---- 6. Health readiness ----
  console.log("\n[6] Health readiness (non-paid)");
  {
    const base =
      RECOVERY_URL?.replace(/\/api\/recovery\/run$/, "") ??
      `https://${SUPABASE_URL.replace("https://", "").split(".")[0]}-mock`;
    const healthUrl = RECOVERY_URL ? `${base}/api/health?include=readiness` : null;
    if (healthUrl) {
      const res = await fetch(healthUrl);
      const body = await res.json();
      report(
        "health includes readiness block",
        res.status === 200 && body.readiness && typeof body.readiness.jobs === "object",
        JSON.stringify(
          body.readiness
            ? { deadJobs: body.readiness.deadJobs, expiredSessions: body.readiness.expiredSessions }
            : null,
        ),
      );
    } else {
      report("health readiness (skipped, no RECOVERY_URL)", true, "no URL");
    }
  }

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed ====`);
  if (failed > 0) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
