// Constant-time comparison for Telegram webhook secret and internal processor
// shared secrets. Timing-safe so remote attackers cannot use response timing
// to recover the secret character by character.

import { timingSafeEqual } from "node:crypto";

export function safeEqual(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
