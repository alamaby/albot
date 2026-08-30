// App attribution sent to OpenRouter-compatible gateways via the HTTP-Referer
// and X-Title headers. Overridable via env so the identity follows the
// deployed domain; unset env keeps the legacy default.
import { getServerEnv } from "@/env";

const DEFAULT_APP_URL = "https://albot-ten.vercel.app";
const DEFAULT_APP_NAME = "albot";

export function getAppIdentity(): { appUrl: string; appName: string } {
  try {
    const env = getServerEnv();
    return {
      appUrl: env.PROVIDER_APP_URL ?? DEFAULT_APP_URL,
      appName: env.PROVIDER_APP_NAME ?? DEFAULT_APP_NAME,
    };
  } catch {
    // Env not configured (adapter unit tests construct adapters directly) —
    // fall back to the legacy defaults instead of failing construction.
    return { appUrl: DEFAULT_APP_URL, appName: DEFAULT_APP_NAME };
  }
}
