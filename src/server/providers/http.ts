// Shared HTTP helpers for provider adapters.
// Provider request ids are captured from standard response headers so callers
// can correlate adapter failures with upstream provider logs.

// Reads the provider request id from response headers where available.
export function readProviderRequestId(response: Response): string | undefined {
  const headerId = response.headers.get("x-request-id");
  if (headerId) return headerId;
  const requestId = response.headers.get("x-request-trace-id");
  return requestId ?? undefined;
}

// Returns true when `value` is a non-empty string starting with an https URL.
// Used to validate image URLs from upstream responses; plain http URLs are
// rejected so downstream Telegram delivery never fetches over an insecure
// scheme (fail closed on unexpected response).
export function isHttpsUrl(value: string): boolean {
  return typeof value === "string" && /^https:\/\//i.test(value);
}
