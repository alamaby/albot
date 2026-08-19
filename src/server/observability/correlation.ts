// Correlation ID propagation (Milestone 6).
//
// Generates a request-scoped id and runs a handler inside an AsyncLocalStorage
// context so every structured log line for the request carries the same id.
// Incoming ids are honored (x-correlation-id) so the dispatcher and processor
// share one trace across hops.

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const correlationStorage = new AsyncLocalStorage<string>();

export function generateCorrelationId(): string {
  return randomUUID();
}

export function setCorrelationId(correlationId: string): void {
  correlationStorage.enterWith(correlationId);
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

export function withCorrelation<T>(
  incomingId: string | null | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const correlationId = incomingId && incomingId.length > 0 ? incomingId : generateCorrelationId();
  return correlationStorage.run(correlationId, handler);
}
