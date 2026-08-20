// Dev-only data fix: unstick prompt_sessions stranded in 'enhancing' after a
// terminal enhance_prompt failure. For each stuck session it CAS-transitions
// enhancing -> enhancement_failed and best-effort sends a "Coba Lagi" retry
// message so the user can retry.
//
// Stuck = status 'enhancing' with no live enhance job
// (queued/processing/retry_scheduled). Detected 3 sessions on dev (2026-08-20):
//   98a061ef (user 83540732), aff6d19f (user 790008574), 5a730955 (user 790000912)
//
// Usage:
//   node scripts/fix-stuck-enhancing-sessions.mjs            # dry-run (report only)
//   node scripts/fix-stuck-enhancing-sessions.mjs --apply    # transition + notify
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadDotEnv() {
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL_DEV ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

if (!url || !key) {
  console.error("missing dev supabase credentials");
  process.exit(1);
}
if (!telegramToken) {
  console.error("missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const RETRY_TEXT = "Gagal memproses prompt. Silakan coba lagi.";

function retryKeyboardMarkup(sessionId) {
  return { inline_keyboard: [[{ text: "Coba Lagi", callback_data: `retry:${sessionId}` }]] };
}

async function sendRetryMessage(chatId, sessionId) {
  const body = {
    chat_id: String(chatId),
    text: RETRY_TEXT,
    reply_markup: retryKeyboardMarkup(sessionId),
  };
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`telegram sendMessage failed: ${response.status}`);
  }
}

async function findStuckSessions() {
  const { data, error } = await admin
    .from("prompt_sessions")
    .select("id, telegram_user_id, telegram_chat_id, status")
    .eq("status", "enhancing");
  if (error) throw new Error(`session lookup failed: ${error.message}`);

  const stuck = [];
  for (const session of data ?? []) {
    const { data: jobs, error: jobError } = await admin
      .from("jobs")
      .select("id")
      .eq("prompt_session_id", session.id)
      .eq("job_type", "enhance_prompt")
      .in("status", ["queued", "processing", "retry_scheduled"]);
    if (jobError) throw new Error(`job lookup failed: ${jobError.message}`);
    if ((jobs ?? []).length === 0) {
      stuck.push(session);
    }
  }
  return stuck;
}

const sessions = await findStuckSessions();
console.log(`Found ${sessions.length} stuck 'enhancing' session(s):`);
for (const session of sessions) {
  console.log(`  ${session.id}  user=${session.telegram_user_id} chat=${session.telegram_chat_id}`);
}

if (!APPLY) {
  console.log("\nDry-run. Re-run with --apply to transition + send retry messages.");
  process.exit(0);
}

let transitioned = 0;
let notified = 0;
for (const session of sessions) {
  const { data: row, error } = await admin
    .rpc("transition_prompt_session", {
      p_session_id: session.id,
      p_expected_status: "enhancing",
      p_new_status: "enhancement_failed",
    })
    .maybeSingle();
  if (error) {
    console.log(`  [skip] ${session.id}: transition failed: ${error.message}`);
    continue;
  }
  if (!row) {
    console.log(`  [skip] ${session.id}: session no longer in enhancing (moved on)`);
    continue;
  }
  transitioned += 1;
  console.log(`  [ok]   ${session.id}: enhancing -> enhancement_failed`);

  try {
    await sendRetryMessage(session.telegram_chat_id, session.id);
    notified += 1;
  } catch (e) {
    console.log(`  [warn] ${session.id}: retry message failed: ${e.message}`);
  }
}

console.log(`\nDone. transitioned=${transitioned} notified=${notified}`);
