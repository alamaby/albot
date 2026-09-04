import { describe, expect, it } from "vitest";
import {
  ProviderError,
  classificationFromHttpStatus,
  makeErrorFromHttpStatus,
  withProviderContext,
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

describe("withProviderContext", () => {
  it("preserves the retry taxonomy while attaching provider attribution", () => {
    const inner = makeErrorFromHttpStatus(400, "openai-compatible provider returned 400");
    const wrapped = withProviderContext(inner, {
      label: "Bynara Agnes 2.5 Flash",
      model: "agnes-2.5-flash",
    });
    expect(wrapped.code).toBe("provider_request_invalid");
    expect(wrapped.retryable).toBe(false);
    expect(wrapped.httpStatus).toBe(400);
    expect(wrapped.safeMessage).toBe("openai-compatible provider returned 400");
    expect(wrapped.providerLabel).toBe("Bynara Agnes 2.5 Flash");
    expect(wrapped.providerModel).toBe("agnes-2.5-flash");
    expect(wrapped.toJSON()).toMatchObject({
      code: "provider_request_invalid",
      providerLabel: "Bynara Agnes 2.5 Flash",
      providerModel: "agnes-2.5-flash",
    });
    // The original error is kept as cause for server-side logs.
    expect(wrapped.cause).toBe(inner);
  });

  it("works without a model", () => {
    const wrapped = withProviderContext(makeErrorFromHttpStatus(429, "slow down"), {
      label: "Pollinations gpt-oss",
    });
    expect(wrapped.providerLabel).toBe("Pollinations gpt-oss");
    expect(wrapped.providerModel).toBeUndefined();
    expect(wrapped.retryable).toBe(true);
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
