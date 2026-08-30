import { z } from "zod";
import { parseEncryptionKey } from "@/server/security/encryption";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "production"]).optional(),
  VERCEL_ENV: z.string().optional(),
  SUPABASE_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, "")),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1)
    .regex(/^sb_secret_/, "SUPABASE_SECRET_KEY must start with sb_secret_"),
  PROVIDER_KEY_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        parseEncryptionKey(value);
        return true;
      } catch {
        return false;
      }
    }, "PROVIDER_KEY_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes"),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(
      /^[0-9]+:[A-Za-z0-9_-]+$/,
      "TELEGRAM_BOT_TOKEN must match the Telegram bot token format",
    ),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "TELEGRAM_WEBHOOK_SECRET must contain only URL-safe base64 characters",
    )
    .min(8, "TELEGRAM_WEBHOOK_SECRET must be at least 8 characters"),
  JOB_PROCESSOR_SECRET: z.string().min(32, "JOB_PROCESSOR_SECRET must be at least 32 characters"),
  // Optional provider attribution (HTTP-Referer / X-Title sent to
  // OpenRouter-compatible gateways). Defaults keep the legacy Vercel URL.
  PROVIDER_APP_URL: z.string().url().optional(),
  PROVIDER_APP_NAME: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type AppEnvironment = "development" | "production";

export function resolveAppEnv(source: Record<string, string | undefined>): AppEnvironment {
  if (source.APP_ENV === "production" || source.APP_ENV === "development") {
    return source.APP_ENV;
  }
  if (source.VERCEL_ENV === "production") {
    return "production";
  }
  return "development";
}

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse({
    NODE_ENV: source.NODE_ENV,
    APP_ENV: source.APP_ENV,
    VERCEL_ENV: source.VERCEL_ENV,
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY,
    PROVIDER_KEY_ENCRYPTION_KEY: source.PROVIDER_KEY_ENCRYPTION_KEY,
    TELEGRAM_BOT_TOKEN: source.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: source.TELEGRAM_WEBHOOK_SECRET,
    JOB_PROCESSOR_SECRET: source.JOB_PROCESSOR_SECRET,
    PROVIDER_APP_URL: source.PROVIDER_APP_URL,
    PROVIDER_APP_NAME: source.PROVIDER_APP_NAME,
  });
}

export function getServerEnv(): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(process.env);
  }
  return cached;
}

export function resetServerEnvCache(): void {
  cached = undefined;
}
