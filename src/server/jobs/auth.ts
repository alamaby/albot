// Authentication for the internal job processor endpoint.
// Uses constant-time comparison so a remote attacker cannot infer the shared
// secret from response timing. The bearer token is never logged.

import { safeEqual } from "@/server/telegram/webhook-auth";

export function verifyProcessorSecret(
  authorizationHeader: string | null | undefined,
  expected: string,
): boolean {
  if (!authorizationHeader) return false;
  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token) return false;
  return safeEqual(token, expected);
}
