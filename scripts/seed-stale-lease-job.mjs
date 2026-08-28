// Seed a stale-lease job in dev so the next recovery cron run (or manual
// workflow_dispatch) picks it up, proving end-to-end lease recovery + event
// recording through the real application layer (runRecovery -> job_events).
// Usage: node scripts/seed-stale-lease-job.mjs
// Requires env: SUPABASE_URL_DEV, SUPABASE_SECRET_KEY_DEV.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const admin = createClient(process.env.SUPABASE_URL_DEV, process.env.SUPABASE_SECRET_KEY_DEV, {
  auth: { persistSession: false },
});

const userId = 557999500;
const past = new Date(Date.now() - 120_000).toISOString();

// Clean any previous seed from this script.
const prev = await admin
  .from("prompt_sessions")
  .select("id")
  .eq("telegram_user_id", userId)
  .maybeSingle();
if (prev.data) {
  await admin
    .from("prompt_sessions")
    .update({ active_generation_attempt_id: null, active_revision_id: null })
    .eq("id", prev.data.id);
  await admin.from("jobs").delete().eq("prompt_session_id", prev.data.id);
  await admin.from("prompt_sessions").delete().eq("id", prev.data.id);
}

const { data: session, error: se } = await admin
  .from("prompt_sessions")
  .insert({
    telegram_user_id: userId,
    telegram_chat_id: userId + 1,
    expires_at: "2099-01-01T00:00:00.000Z",
  })
  .select("id")
  .single();
if (se) throw new Error(`session insert: ${se.message}`);

const { data: job, error: je } = await admin
  .from("jobs")
  .insert({
    job_type: "enhance_prompt",
    prompt_session_id: session.id,
    status: "processing",
    locked_at: past,
    locked_by: "e2e-stale-worker",
    lease_expires_at: past,
    attempt_count: 1,
    max_attempts: 3,
    payload: { test_tag: "e2e_m6_seed_lease" },
  })
  .select("id")
  .single();
if (je) throw new Error(`job insert: ${je.message}`);

console.log(JSON.stringify({ sessionId: session.id, jobId: job.id, status: "seeded" }));
