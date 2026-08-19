// Structured logging (Milestone 6).
//
// Single-line JSON on stdout/stderr so Vercel and log aggregators can parse
// events. Every value is passed through the redaction layer; correlation ids
// from the AsyncLocalStorage context are appended automatically.

import { getCorrelationId } from "./correlation";
import { redactSensitive } from "./redact";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogLevel = "info" | "warn" | "error";

export function logStructured(level: LogLevel, event: string, fields: LogFields = {}): void {
  const record: Record<string, string | number | boolean | null> = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  const correlationId = getCorrelationId();
  if (correlationId) {
    record.correlationId = correlationId;
  }
  for (const [key, value] of Object.entries(fields)) {
    record[key] = value === undefined ? null : value;
  }
  // JSON.stringify never throws for these value types; redact every string
  // field as a final safety net.
  const json = JSON.stringify(record, (_key, value) =>
    typeof value === "string" ? redactSensitive(value) : value,
  );
  console[level](json);
}
