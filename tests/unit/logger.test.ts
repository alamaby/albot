import { afterEach, describe, expect, it, vi } from "vitest";
import { logStructured, type LogFields } from "@/server/observability/logger";
import { setCorrelationId, withCorrelation } from "@/server/observability/correlation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logStructured", () => {
  it("emits a single-line JSON record with ts, level and event", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logStructured("info", "webhook.received", { updateId: 42 });
    expect(info).toHaveBeenCalledTimes(1);
    const record = JSON.parse(info.mock.calls[0][0] as string);
    expect(record.level).toBe("info");
    expect(record.event).toBe("webhook.received");
    expect(record.updateId).toBe(42);
    expect(typeof record.ts).toBe("string");
  });

  it("redacts sensitive values inside fields", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logStructured("error", "job.failed", {
      message: "token 123456789:AAExampleBotToken0123456789_abcdef leaked",
    });
    const record = JSON.parse(error.mock.calls[0][0] as string);
    expect(record.message).not.toContain("AAExampleBotToken");
    expect(record.message).toContain("[REDACTED]");
  });

  it("includes the correlation id when one is set in context", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await withCorrelation("trace-123", async () => {
      logStructured("info", "processor.claimed", {});
    });
    const record = JSON.parse(info.mock.calls[0][0] as string);
    expect(record.correlationId).toBe("trace-123");
  });

  it("omits correlation id when none is set", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logStructured("info", "plain.event", {});
    const record = JSON.parse(info.mock.calls[0][0] as string);
    expect(record.correlationId).toBeUndefined();
  });

  it("serializes undefined fields as null", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fields: LogFields = { maybe: undefined };
    logStructured("info", "event", fields);
    const record = JSON.parse(info.mock.calls[0][0] as string);
    expect(record.maybe).toBeNull();
  });

  it("does not cross-contaminate correlation ids between concurrent contexts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await Promise.all([
      withCorrelation("ctx-a", async () => {
        logStructured("info", "a", {});
      }),
      withCorrelation("ctx-b", async () => {
        logStructured("info", "b", {});
      }),
    ]);
    const records = info.mock.calls.map((call) => JSON.parse(call[0] as string));
    const a = records.find((r) => r.event === "a");
    const b = records.find((r) => r.event === "b");
    expect(a.correlationId).toBe("ctx-a");
    expect(b.correlationId).toBe("ctx-b");
  });

  it("setCorrelationId leaks into the current context (enterWith semantics)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    setCorrelationId("entered-id");
    logStructured("info", "leaked", {});
    const record = JSON.parse(info.mock.calls[0][0] as string);
    expect(record.correlationId).toBe("entered-id");
  });
});
