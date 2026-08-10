import { describe, expect, it } from "vitest";
import {
  ProviderError,
  classificationFromHttpStatus,
  makeErrorFromHttpStatus,
} from "@/server/providers/errors";

describe("ProviderError", () => {
  it("creates error with correct code", () => {
    const error = new ProviderError({
      code: "provider_request_invalid",
      retryable: false,
      message: "test error",
    });
    expect(error.code).toBe("provider_request_invalid");
    expect(error.retryable).toBe(false);
    expect(error.safeMessage).toBe("test error");
  });

  it("serializes to JSON without sensitive data", () => {
    const error = new ProviderError({
      code: "provider_timeout",
      retryable: true,
      httpStatus: 408,
      message: "request timed out",
    });
    const json = error.toJSON();
    expect(json).toMatchObject({
      code: "provider_timeout",
      retryable: true,
      httpStatus: 408,
      safeMessage: "request timed out",
    });
  });
});

describe("classificationFromHttpStatus", () => {
  it("maps 400 to request_invalid", () => {
    expect(classificationFromHttpStatus(400)).toBe("provider_request_invalid");
  });
  it("maps 401 to authentication_failed", () => {
    expect(classificationFromHttpStatus(401)).toBe("provider_authentication_failed");
  });
  it("maps 403 to authorization_failed", () => {
    expect(classificationFromHttpStatus(403)).toBe("provider_authorization_failed");
  });
  it("maps 429 to rate_limited", () => {
    expect(classificationFromHttpStatus(429)).toBe("provider_rate_limited");
  });
  it("maps 500 to upstream_failed", () => {
    expect(classificationFromHttpStatus(500)).toBe("provider_upstream_failed");
  });
});

describe("makeErrorFromHttpStatus", () => {
  it("derives retryable from status", () => {
    expect(makeErrorFromHttpStatus(500, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(502, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(503, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(504, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(408, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(429, "boom").retryable).toBe(true);
    expect(makeErrorFromHttpStatus(400, "boom").retryable).toBe(false);
    expect(makeErrorFromHttpStatus(401, "boom").retryable).toBe(false);
    expect(makeErrorFromHttpStatus(404, "boom").retryable).toBe(false);
    // 501/505 are terminal 5xx and must not be retried.
    expect(makeErrorFromHttpStatus(501, "boom").retryable).toBe(false);
    expect(makeErrorFromHttpStatus(505, "boom").retryable).toBe(false);
  });

  it("maps code and http status", () => {
    const error = makeErrorFromHttpStatus(429, "rate limited");
    expect(error.code).toBe("provider_rate_limited");
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it("carries provider request id", () => {
    const error = makeErrorFromHttpStatus(500, "boom", { providerRequestId: "req-1" });
    expect(error.providerRequestId).toBe("req-1");
  });
});
