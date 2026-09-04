// Recovery scheduler orchestration (Milestone 6).
//
// Runs the reliability sweep in dependency order:
//   1. Recover expired job leases (worker crash / timeout) -> lease_expired events.
//   2. Mark dead jobs terminal (max attempts exhausted) -> failed events.
//   3. Expire stale sessions and notify the user best-effort.
//   4. Purge transactional metadata older than the 30-day retention window.
//   5. Purge prompt_audit rows older than the 180-day cross-purge window.
// Logs one structured summary line per run. Never spends provider credit.

import { RecoveryRepository } from "@/server/repositories/recovery.repository";
import { JobEventRepository } from "@/server/repositories/job-event.repository";
import { getServerEnv } from "@/env";
import { sendMessage } from "@/server/telegram/client";
import { getBotMessage, getGenerationStatusMessage } from "@/server/telegram/messages";
import { logStructured } from "@/server/observability/logger";
import { getCorrelationId } from "@/server/observability/correlation";

export type RecoveryRunResult = {
  recoveredLeases: number;
  deadJobsMarked: number;
  staleSessionsExpired: number;
  recoveredStuckGenerating: number;
  purgedRows: number;
  promptAuditPurgedRows: number;
  claimedJobs: number;
};

export const RETENTION_DAYS = 30;
export const PROMPT_AUDIT_RETENTION_DAYS = 180;
export const RECOVERY_BATCH_LEASES = 5;
export const RECOVERY_BATCH_DEAD = 25;
export const RECOVERY_BATCH_SESSIONS = 100;
export const RECOVERY_BATCH_CLAIM = 3;
export const RECOVERY_BATCH_STUCK_GENERATING = 25;
export const RECOVERY_STUCK_MINUTES = 15;

export type RecoveryDeps = {
  recoveryRepository?: RecoveryRepository;
  jobEventRepository?: JobEventRepository;
  sendTelegramMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  editTelegramMessage?: (
    token: string,
    chatId: bigint,
    messageId: number,
    text: string,
  ) => Promise<unknown>;
  processNextJob?: () => Promise<{ status: "processed" | "idle"; jobId?: string }>;
};

export async function runRecovery(deps: RecoveryDeps = {}): Promise<RecoveryRunResult> {
  const recoveryRepository = deps.recoveryRepository ?? new RecoveryRepository();
  const jobEventRepository = deps.jobEventRepository ?? new JobEventRepository();
  const sendTelegramMessage =
    deps.sendTelegramMessage ?? ((token, chatId, text) => sendMessage(token, chatId, text));
  const editTelegramMessage =
    deps.editTelegramMessage ??
    (async (token, chatId, messageId, text) => {
      const { editMessageText } = await import("@/server/telegram/client");
      return editMessageText(token, chatId, messageId, text);
    });
  const processNextJobFn =
    deps.processNextJob ??
    (async () => {
      const { processNextJob } = await import("./processor");
      return processNextJob();
    });

  const env = getServerEnv();

  // 1. Lease recovery.
  const recoveredLeases = await recoveryRepository.expireStaleLeases(RECOVERY_BATCH_LEASES);
  for (const job of recoveredLeases) {
    await jobEventRepository.record({
      jobId: job.id,
      sessionId: job.prompt_session_id,
      eventType: "lease_expired",
      payload: { attemptCount: job.attempt_count, correlationId: getCorrelationId() ?? null },
    });
  }

  // 1b. Stuck generating recovery (processing >15m) — moves to generation_failed
  // so the user can Regenerate without manual SQL. Best-effort Telegram edit.
  // Wrapped in try/catch so prod before migration (RPC missing) does not abort recovery.
  let stuckGenerating: Awaited<ReturnType<RecoveryRepository["recoverStuckGeneratingSessions"]>> =
    [];
  try {
    stuckGenerating = await recoveryRepository.recoverStuckGeneratingSessions(
      RECOVERY_BATCH_STUCK_GENERATING,
      RECOVERY_STUCK_MINUTES,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("warn", "recovery.stuck_recover_failed", { detail });
    stuckGenerating = [];
  }
  for (const session of stuckGenerating) {
    try {
      const chatId = BigInt(session.telegram_chat_id);
      const msgId = session.telegram_status_message_id as unknown as number | null;
      const text = await getGenerationStatusMessage("failed");
      if (msgId !== null && msgId !== undefined) {
        await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, Number(msgId), text);
      } else {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "recovery.notify_stuck_failed", {
        sessionId: session.id,
        detail,
      });
    }
  }

  // 1b. Claim due queued/retry_scheduled jobs (Opsi A, cron 20m batch 3).
  // Bounded to RECOVERY_BATCH_CLAIM per sweep to keep the cron light (<5s).
  let claimedJobs = 0;
  for (let i = 0; i < RECOVERY_BATCH_CLAIM; i++) {
    try {
      const result = await processNextJobFn();
      if (result.status === "idle") break;
      claimedJobs++;
      logStructured("info", "recovery.claim", { jobId: result.jobId ?? null, index: i });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "recovery.claim_failed", { detail, index: i });
      break;
    }
  }

  // 2. Dead jobs.
  const deadJobs = await recoveryRepository.markDeadJobs(RECOVERY_BATCH_DEAD);
  for (const job of deadJobs) {
    await jobEventRepository.record({
      jobId: job.id,
      sessionId: job.prompt_session_id,
      eventType: "failed",
      payload: { deadJob: true, errorCode: job.last_error_code },
    });
  }

  // 3. Stale sessions + best-effort user notification (one message per session;
  // duplicate sessions for the same user are unlikely due to the one-active
  // index, and the message is idempotent in spirit).
  const staleSessions = await recoveryRepository.recoverStaleSessions(RECOVERY_BATCH_SESSIONS);
  for (const session of staleSessions) {
    try {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        BigInt(session.telegram_chat_id),
        await getBotMessage("session_expired"),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "recovery.notify_failed", { sessionId: session.id, detail });
    }
  }

  // 4. Retention purge (transactional tables: 30 days).
  const purge = await recoveryRepository.purgeExpiredMetadata(RETENTION_DAYS, 1000);

  // 5. Cross-purge audit retention (180 days, independent of transactional purge).
  const promptAuditPurge = await recoveryRepository.purgePromptAudit(
    PROMPT_AUDIT_RETENTION_DAYS,
    5000,
  );

  const result: RecoveryRunResult = {
    recoveredLeases: recoveredLeases.length,
    deadJobsMarked: deadJobs.length,
    staleSessionsExpired: staleSessions.length,
    recoveredStuckGenerating: stuckGenerating.length,
    purgedRows: purge.purgedRows,
    promptAuditPurgedRows: promptAuditPurge.purgedRows,
    claimedJobs,
  };

  logStructured("info", "recovery.run", {
    recoveredLeases: result.recoveredLeases,
    deadJobsMarked: result.deadJobsMarked,
    staleSessionsExpired: result.staleSessionsExpired,
    recoveredStuckGenerating: result.recoveredStuckGenerating,
    purgedRows: result.purgedRows,
    promptAuditPurgedRows: result.promptAuditPurgedRows,
    claimedJobs: result.claimedJobs,
  });

  return result;
}
