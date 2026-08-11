import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { safeEqual } from "@/server/telegram/webhook-auth";
import { parseTelegramUpdate, reduceTelegramUpdate } from "@/server/telegram/parser";
import { handleTelegramUpdate } from "@/server/application/handle-telegram-update";

export const runtime = "nodejs";

// Telegram webhook payloads are small text updates; reject anything that tries
// to smuggle a large body past the parser.
const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MiB

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();

  const secretHeader = request.headers.get(SECRET_HEADER);
  if (!safeEqual(secretHeader, env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ ok: false, reason: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    // Malformed JSON: Telegram expects a 200 to stop retrying; log and drop.
    console.error("webhook: received malformed JSON body");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let update;
  try {
    update = parseTelegramUpdate(body);
  } catch {
    // Unsupported/malformed update shape: acknowledge so Telegram stops
    // retrying; do not persist anything.
    console.error("webhook: update failed validation");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const origin = request.nextUrl.origin;
  const parsed = reduceTelegramUpdate(update);

  try {
    await handleTelegramUpdate(parsed, origin);
  } catch (error) {
    // Never fail the webhook on an internal error; Telegram would retry and we
    // prefer idempotent handling on the next delivery. Persist a sanitized log.
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`webhook: handler failed (${detail})`);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
