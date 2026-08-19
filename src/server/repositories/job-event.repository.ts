// Server-only job event repository (Milestone 6).
// Appends audit events to job_events. Payloads must never carry secrets or
// decrypted credentials (enforced by the structured logger's redaction layer).

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

export type JobEventType =
  "queued" | "claimed" | "retry_scheduled" | "succeeded" | "failed" | "cancelled" | "lease_expired";

export type RecordJobEventInput = {
  jobId?: string | null;
  sessionId?: string | null;
  eventType: JobEventType;
  payload?: Record<string, unknown>;
};

export class JobEventRepository {
  async record(input: RecordJobEventInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("job_events").insert({
      job_id: input.jobId ?? null,
      prompt_session_id: input.sessionId ?? null,
      event_type: input.eventType,
      payload: input.payload ?? {},
    } as Database["public"]["Tables"]["job_events"]["Insert"]);

    if (error) throw new Error(`job event record failed: ${error.message}`);
  }
}
