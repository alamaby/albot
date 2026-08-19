// Recovery scheduler orchestration (Milestone 6).
//
// Runs the reliability sweep in dependency order:
//   1. Recover expired job leases (worker crash / timeout) -> lease_expired events.
//   2. Mark dead jobs terminal (max attempts exhausted) -> failed events.
//   3. Expire stale sessions and notify the user best-effort.
//   4. Purge metadata older than the retention window.
// Logs one structured summary line per run. Never spends provider credit.

import { RecoveryRepository } from "@/server/repositories/recovery.repository";
import { JobEventRepository } from "@/server/repositories/job-event.repository";
import { getServerEnv } from "@/env";
import { sendMessage } from "@/server/telegram/client";
import { buildBotMessage } from "@/server/telegram/messages";
import { logStructured } from "@/server/observability/logger";
import { getCorrelationId } from "@/server/observability/correlation";

export type RecoveryRunResult = {
  recoveredLeases: number;
  deadJobsMarked: number;
  staleSessionsExpired: number;
  purgedRows: number;
};

export const RETENTION_DAYS = 30;
export const RECOVERY_BATCH_LEASES = 5;
export const RECOVERY_BATCH_DEAD = 25;
export const RECOVERY_BATCH_SESSIONS = 100;

export type RecoveryDeps = {
  recoveryRepository?: RecoveryRepository;
  jobEventRepository?: JobEventRepository;
  sendTelegramMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
};

export async function runRecovery(deps: RecoveryDeps = {}): Promise<RecoveryRunResult> {
  const recoveryRepository = deps.recoveryRepository ?? new RecoveryRepository();
  const jobEventRepository = deps.jobEventRepository ?? new JobEventRepository();
  const sendTelegramMessage =
    deps.sendTelegramMessage ?? ((token, chatId, text) => sendMessage(token, chatId, text));

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
        buildBotMessage("session_expired"),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "recovery.notify_failed", { sessionId: session.id, detail });
    }
  }

  // 4. Retention purge.
  const purge = await recoveryRepository.purgeExpiredMetadata(RETENTION_DAYS, 1000);

  const result: RecoveryRunResult = {
    recoveredLeases: recoveredLeases.length,
    deadJobsMarked: deadJobs.length,
    staleSessionsExpired: staleSessions.length,
    purgedRows: purge.purgedRows,
  };

  logStructured("info", "recovery.run", {
    recoveredLeases: result.recoveredLeases,
    deadJobsMarked: result.deadJobsMarked,
    staleSessionsExpired: result.staleSessionsExpired,
    purgedRows: result.purgedRows,
  });

  return result;
}
