import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "production"]).optional(),
  VERCEL_ENV: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
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
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
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
