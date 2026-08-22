// Provider error taxonomy.
// All errors are normalized before crossing adapter boundaries.
// No raw upstream response, API key, or internal detail is exposed.

export type ProviderErrorCode =
  | "provider_configuration_invalid"
  | "provider_adapter_unknown"
  | "provider_capability_mismatch"
  | "provider_key_unavailable"
  | "provider_key_invalid"
  | "provider_authentication_failed"
  | "provider_authorization_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_network_failed"
  | "provider_request_invalid"
  | "provider_content_rejected"
  | "provider_response_invalid"
  | "provider_upstream_failed"
  | "provider_unknown_error"
  | "telegram_delivery_failed";

export type ProviderErrorShape = {
  code: ProviderErrorCode;
  retryable: boolean;
  providerRequestId?: string;
  httpStatus?: number;
  safeMessage: string;
  cause?: unknown;
};

export class ProviderError extends Error implements ProviderErrorShape {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly providerRequestId?: string;
  readonly httpStatus?: number;
  readonly safeMessage: string;
  readonly cause?: unknown;

  constructor(options: {
    code: ProviderErrorCode;
    retryable: boolean;
    providerRequestId?: string;
    httpStatus?: number;
    message: string;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "ProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.providerRequestId = options.providerRequestId;
    this.httpStatus = options.httpStatus;
    this.safeMessage = options.message;
    this.cause = options.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      retryable: this.retryable,
      ...(this.providerRequestId ? { providerRequestId: this.providerRequestId } : {}),
      ...(this.httpStatus ? { httpStatus: this.httpStatus } : {}),
      safeMessage: this.safeMessage,
    };
  }
}

// Classification helpers.
export function isRetryableError(error: ProviderErrorShape): boolean {
  return error.retryable;
}

export function classificationFromHttpStatus(status: number): ProviderErrorCode {
  switch (status) {
    case 400:
      return "provider_request_invalid";
    case 401:
      return "provider_authentication_failed";
    case 403:
      return "provider_authorization_failed";
    case 402:
      return "provider_rate_limited";
    case 404:
      return "provider_configuration_invalid";
    case 408:
      return "provider_timeout";
    case 429:
      return "provider_rate_limited";
    case 500:
      return "provider_upstream_failed";
    case 502:
      return "provider_upstream_failed";
    case 503:
      return "provider_upstream_failed";
    case 504:
      return "provider_timeout";
    default:
      return "provider_unknown_error";
  }
}

export function classificationFromNetworkError(): ProviderErrorCode {
  return "provider_network_failed";
}

// Derives a normalized ProviderError from an upstream HTTP status.
// Retryable derives from the status itself and follows the documented taxonomy
// exactly: 408/429/500/502/503/504 are retryable, 402 pollen exhausted is terminal rate_limited,
// all other statuses are terminal (e.g. 400 malformed, 401/403 auth, 404 config, 501/505 terminal).
// Callers must never pass a precomputed `retryable` that can diverge from the
// actual status.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function makeErrorFromHttpStatus(
  status: number,
  message: string,
  options?: {
    providerRequestId?: string;
    cause?: unknown;
  },
): ProviderError {
  return new ProviderError({
    code: classificationFromHttpStatus(status),
    retryable: RETRYABLE_STATUSES.has(status),
    httpStatus: status,
    ...options,
    message,
  });
}

export function makeRetryable(
  code: ProviderErrorCode,
  message: string,
  options?: {
    providerRequestId?: string;
    httpStatus?: number;
    cause?: unknown;
  },
) {
  return new ProviderError({ code, retryable: true, ...options, message });
}

export function makeNonRetryable(
  code: ProviderErrorCode,
  message: string,
  options?: {
    providerRequestId?: string;
    httpStatus?: number;
    cause?: unknown;
  },
) {
  return new ProviderError({ code, retryable: false, ...options, message });
}
