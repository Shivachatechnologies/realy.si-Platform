export type ErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "mfa_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "payload_too_large"
  | "rate_limited"
  | "not_configured"
  | "not_available"
  | "service_unavailable"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  mfa_required: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 422,
  idempotency_in_progress: 409,
  payload_too_large: 413,
  rate_limited: 429,
  not_configured: 501,
  not_available: 422,
  service_unavailable: 503,
  internal_error: 500,
};

/** Expected, client-visible error. Anything else is reported as internal_error. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const notFound = (what: string) => new AppError("not_found", `${what} not found`);
export const forbidden = (message: string, details?: Record<string, unknown>) =>
  new AppError("forbidden", message, details);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("conflict", message, details);
export const invalid = (message: string, details?: Record<string, unknown>) =>
  new AppError("validation_error", message, details);
