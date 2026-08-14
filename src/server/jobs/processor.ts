// Job processor skeleton for Milestone 3.
//
// The processor endpoint claims a durable job via the claim_job RPC, then
// dispatches it to a registered handler. Milestone 3 ships no handlers, so a
// claimed job without a registered handler is rescheduled (retry_scheduled
// with a future available_at) instead of failed: this keeps the job available
// for Milestone 4's enhance_prompt handler and is non-destructive.
//
// Idempotency: claim_job guarantees a single owner per job; releasing a job
// back to retry_scheduled is safe to run once per owner.

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/server/supabase/admin";
import { enhancePromptHandler } from "./enhance-prompt.handler";
import type { Database } from "@/server/supabase/database.types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export type { JobRow };

export type JobHandler = (job: JobRow) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  enhance_prompt: enhancePromptHandler,
};

const WORKER_PREFIX = "processor";
const LEASE_SECONDS = 300;
const RESCHEDULE_DELAY_MS = 5 * 60_000;

export function generateWorkerId(): string {
  return `${WORKER_PREFIX}-${randomUUID()}`;
}

export function isRegisteredJobType(jobType: string): boolean {
  return jobType in handlers;
}

// Claims one due job for a worker. Returns null when nothing is claimable.
export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .rpc("claim_job", {
      p_worker_id: workerId,
      p_lease_seconds: LEASE_SECONDS,
    })
    .maybeSingle();

  if (error) throw new Error(`claim_job failed: ${error.message}`);
  return data as JobRow | null;
}

// Reschedules a claimed job for which no handler is registered. Locks are
// cleared and available_at moved into the future so the job is not hot-looped
// but remains claimable by a later milestone's handler.
export async function rescheduleUnhandledJob(
  jobId: string,
  workerId: string,
  errorCode: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("jobs")
    .update({
      status: "retry_scheduled",
      available_at: new Date(Date.now() + RESCHEDULE_DELAY_MS).toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error_code: errorCode,
    })
    .eq("id", jobId)
    .eq("locked_by", workerId);
  if (error) throw new Error(`reschedule job failed: ${error.message}`);
}

// Entry point used by the processor route. Claims one job and dispatches it.
// Returns the claimed job id (or null when idle) so the route can respond.
export async function processNextJob(): Promise<{ status: "processed" | "idle"; jobId?: string }> {
  const workerId = generateWorkerId();
  const job = await claimNextJob(workerId);
  if (!job) return { status: "idle" };

  const handler = handlers[job.job_type];
  if (!handler) {
    await rescheduleUnhandledJob(job.id, workerId, "unknown_job_type");
    return { status: "processed", jobId: job.id };
  }

  try {
    await handler(job);
  } catch (error) {
    // A handler that throws unexpectedly must not lose the durable job. The
    // worker ownership guard keeps the reschedule safe.
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`job processor: handler failed for ${job.job_type} (${detail})`);
    await rescheduleUnhandledJob(job.id, workerId, "handler_error");
  }
  return { status: "processed", jobId: job.id };
}
