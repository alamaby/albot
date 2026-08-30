// Sensitive-value redaction (Milestone 6).
//
// Pure logic, no I/O. Guards every log line and persisted error sample against
// accidental secret leakage: Telegram bot tokens, bearer tokens, provider API
// keys (sk-...), the Supabase service role key, and generic Authorization /
// x-api-key header values.

const SENSITIVE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  // Telegram bot token: <botId>:<base64url> (long tail).
  { label: "telegram_bot_token", regex: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  // Bearer tokens in header-style strings. Replaces the token portion (after
  // "Bearer ") and keeps the prefix so the redacted output remains readable
  // as "Bearer [REDACTED]".
  { label: "bearer_token", regex: /(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/g },
  // OpenAI-style secret keys.
  { label: "api_key", regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  // Supabase service role / JWT-style tokens (long dotted payloads).
  {
    label: "service_role_key",
    regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  // Supabase Secret Keys (sb_secret_...) — 2026 replacement for service role.
  {
    label: "supabase_secret_key",
    regex: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g,
  },
  // Generic x-api-key / Authorization header values.
  {
    label: "authorization_header",
    regex: /(?:(?:authorization|x-api-key)\s*[:=]\s*)[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  // Generic "secret" assignments.
  {
    label: "secret_value",
    regex: /\b(?:secret|token|api[_-]?key|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi,
  },
];

export function redactSensitive(value: string): string {
  let redacted = value;
  for (const { regex } of SENSITIVE_PATTERNS) {
    // bearer_token captures "Bearer " as a prefix group; preserve it.
    redacted = redacted.replace(regex, (match, ...groups) => {
      if (groups.length >= 2 && typeof groups[0] === "string") {
        return `${groups[0]}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return redacted;
}

export function redactError(error: unknown): { message: string } {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { safeMessage?: unknown; message?: unknown };
    // ProviderErrorShape carries a safeMessage that is already redacted at the
    // adapter boundary; prefer it over the raw message / stack.
    if (typeof candidate.safeMessage === "string" && candidate.safeMessage.length > 0) {
      return { message: redactSensitive(candidate.safeMessage) };
    }
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return { message: redactSensitive(candidate.message) };
    }
  }
  return { message: "unknown error" };
}

// Walks a JSON-serializable value and applies redactSensitive to every string
// leaf. Returns a new value (does not mutate the input). Safe for nested
// arrays/objects; non-string primitives pass through.
export function redactJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitive(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactJson(v);
    }
    return out;
  }
  return value;
}
