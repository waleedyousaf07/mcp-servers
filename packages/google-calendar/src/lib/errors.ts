export class ToolExecutionError extends Error {
  readonly kind: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      kind?: string;
      status?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "ToolExecutionError";
    this.kind = options?.kind ?? "tool_error";
    this.status = options?.status;
    this.details = options?.details;
  }
}

export interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
    }>;
  };
}

export function isToolExecutionError(value: unknown): value is ToolExecutionError {
  return value instanceof ToolExecutionError;
}

export function mapGoogleApiError(
  status: number,
  payload: unknown,
  operation: string
): ToolExecutionError {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as GoogleErrorBody;
  const googleError = body.error;
  const message = googleError?.message || `Google API request failed during ${operation}.`;
  const reason = googleError?.errors?.[0]?.reason;
  const normalizedKind =
    status === 401
      ? "auth_error"
      : status === 403
        ? "permission_error"
        : status === 404
          ? "not_found"
          : status === 429
            ? "rate_limited"
            : status >= 500
              ? "upstream_unavailable"
              : "api_error";

  return new ToolExecutionError(message, {
    kind: normalizedKind,
    status,
    details: {
      operation,
      googleStatus: googleError?.status,
      reason
    }
  });
}
