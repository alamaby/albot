// Revision input use case (Milestone 4).
//
// Handles a plain-text message arriving while a session is in
// awaiting_revision_input: creates a new immutable revision from the
// instruction, transitions the session back to enhancing, enqueues the
// follow-up enhance_prompt job, and tells Telegram the revision is being
// processed. Acknowledges without error so the user can retry when the
// instruction is too long.

import { getServerEnv } from "@/env";
import { bigintToDb } from "./bigint-helper";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import { EnhancementRepository } from "@/server/repositories/enhancement.repository";
import { JobRepository } from "@/server/repositories/job.repository";
import { isSessionExpired } from "./session-expiry-check";
import { logStructured } from "@/server/observability/logger";

export const REVISION_INSTRUCTION_MAX_LENGTH = 4000;

export type RevisionInputResult =
  | { status: "accepted"; sessionId: string; revisionId: string; revisionNumber: number }
  | { status: "ignored" }
  | { status: "expired" }
  | { status: "too_long" };

export type RevisionInputDeps = {
  sessionRepository?: SessionRepository;
  enhancementRepository?: EnhancementRepository;
  jobRepository?: JobRepository;
  sendTelegramMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  dispatchToProcessor?: (
    origin: string,
    secret: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export class RevisionInputUseCase {
  private readonly sessionRepository: SessionRepository;
  private readonly enhancementRepository: EnhancementRepository;
  private readonly jobRepository: JobRepository;
  private readonly sendTelegramMessage: (
    token: string,
    chatId: bigint,
    text: string,
  ) => Promise<unknown>;
  private readonly dispatchToProcessor: (
    origin: string,
    secret: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;

  constructor(deps: RevisionInputDeps = {}) {
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.enhancementRepository = deps.enhancementRepository ?? new EnhancementRepository();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.sendTelegramMessage =
      deps.sendTelegramMessage ??
      (() => {
        throw new Error("sendTelegramMessage not wired");
      });
    this.dispatchToProcessor =
      deps.dispatchToProcessor ??
      (() => {
        throw new Error("dispatchToProcessor not wired");
      });
  }

  // Returns true when the message was consumed as revision input (accepted,
  // expired, too long) versus handled by the normal M3 intake path.
  async handle(session: SessionSafe, text: string, origin: string): Promise<RevisionInputResult> {
    if (session.status !== "awaiting_revision_input") {
      return { status: "ignored" };
    }

    if (isSessionExpired(session)) {
      return { status: "expired" };
    }

    if (text.length > REVISION_INSTRUCTION_MAX_LENGTH) {
      return { status: "too_long" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();

    // Previous enhanced prompt becomes the audit trail for the new revision.
    const previous = await this.enhancementRepository.getRevisionById(
      session.activeRevisionId ?? "",
    );

    const { data, error } = await supabase
      .rpc(
        "create_revision" as never,
        {
          p_session_id: session.id,
          p_source_prompt: text,
          p_previous_prompt: previous?.enhancedPrompt ?? null,
          p_revision_instruction: null,
          p_instruction_kind: "revision",
        } as never,
      )
      .single();
    if (error) throw new Error(`create_revision failed: ${error.message}`);

    const row = data as unknown as { revision_id: string; revision_number: number };
    const revisionId = row.revision_id;
    const revisionNumber = row.revision_number;

    // CAS the session into enhancing; the RPC already repointed
    // active_revision_id to the new revision.
    const { data: transitioned, error: transitionError } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: session.id,
        p_expected_status: "awaiting_revision_input",
        p_new_status: "enhancing",
      } as never)
      .maybeSingle();
    if (transitionError) throw new Error(`session transition failed: ${transitionError.message}`);
    if (!transitioned) {
      // Lost the CAS (e.g. duplicate callback raced us): the revision exists but
      // the session moved on. Best-effort ack, do not enqueue a second job.
      return { status: "accepted", sessionId: session.id, revisionId, revisionNumber };
    }

    const jobId = await this.jobRepository.insertEnhancementJob({
      sessionId: session.id,
      revisionId,
      payload: {
        telegram_user_id: bigintToDb(session.telegramUserId),
        telegram_chat_id: bigintToDb(session.telegramChatId),
        origin: "revision_input",
      },
    });

    const env = getServerEnv();
    try {
      await this.sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        session.telegramChatId,
        "Sedang memproses revisi...",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "revision.send_message_failed", { sessionId: session.id, detail });
    }

    try {
      await this.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET, {
        sessionOrigin: "revision_input",
        jobId,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "revision.dispatcher_failed", { sessionId: session.id, detail });
    }

    return { status: "accepted", sessionId: session.id, revisionId, revisionNumber };
  }
}
