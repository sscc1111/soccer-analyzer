/**
 * Unified error types for the analyzer service
 *
 * Error classification enables:
 * - Targeted retry strategies (transient vs permanent)
 * - Better user-facing error messages
 * - Error metrics and monitoring
 */

/**
 * Error codes for categorization
 */
export const ErrorCode = {
  // Validation errors (never retry)
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_FORMAT: "INVALID_FORMAT",

  // External service errors (may retry)
  GEMINI_API_ERROR: "GEMINI_API_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Storage errors (may retry)
  STORAGE_DOWNLOAD_ERROR: "STORAGE_DOWNLOAD_ERROR",
  STORAGE_UPLOAD_ERROR: "STORAGE_UPLOAD_ERROR",
  FIRESTORE_ERROR: "FIRESTORE_ERROR",

  // Processing errors
  FFMPEG_ERROR: "FFMPEG_ERROR",
  DETECTION_ERROR: "DETECTION_ERROR",
  TRACKING_ERROR: "TRACKING_ERROR",

  // Infrastructure errors
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",

  // Unknown
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base error class for analyzer service
 */
export class AnalyzerError extends Error {
  public readonly timestamp: string;

  constructor(
    message: string,
    public readonly code: ErrorCodeType,
    public readonly context: Record<string, unknown> = {},
    public readonly isRetryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "AnalyzerError";
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      isRetryable: this.isRetryable,
      timestamp: this.timestamp,
      cause: this.cause?.message,
    };
  }
}

/**
 * Validation error - bad input, never retry
 */
export class ValidationError extends AnalyzerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_ERROR, context, false);
    this.name = "ValidationError";
  }
}

/**
 * Missing required field error
 */
export class MissingFieldError extends AnalyzerError {
  constructor(fieldName: string, context?: Record<string, unknown>) {
    super(`Missing required field: ${fieldName}`, ErrorCode.MISSING_REQUIRED_FIELD, { fieldName, ...context }, false);
    this.name = "MissingFieldError";
  }
}

/**
 * External service error (Gemini API, etc.)
 */
export class ExternalServiceError extends AnalyzerError {
  constructor(
    service: string,
    message: string,
    context?: Record<string, unknown>,
    isRetryable = true,
    cause?: Error
  ) {
    const code = service === "gemini" ? ErrorCode.GEMINI_API_ERROR : ErrorCode.UNKNOWN_ERROR;
    super(`${service} error: ${message}`, code, { service, ...context }, isRetryable, cause);
    this.name = "ExternalServiceError";
  }
}

/**
 * Rate limit error - always retryable with backoff
 */
export class RateLimitError extends AnalyzerError {
  constructor(service: string, context?: Record<string, unknown>, cause?: Error) {
    super(`Rate limit exceeded for ${service}`, ErrorCode.RATE_LIMIT_EXCEEDED, { service, ...context }, true, cause);
    this.name = "RateLimitError";
  }
}

/**
 * Storage error (Cloud Storage / Firestore)
 */
export class StorageError extends AnalyzerError {
  constructor(
    operation: "download" | "upload" | "read" | "write",
    message: string,
    context?: Record<string, unknown>,
    isRetryable = true,
    cause?: Error
  ) {
    const code =
      operation === "download"
        ? ErrorCode.STORAGE_DOWNLOAD_ERROR
        : operation === "upload"
          ? ErrorCode.STORAGE_UPLOAD_ERROR
          : ErrorCode.FIRESTORE_ERROR;
    super(`Storage ${operation} error: ${message}`, code, { operation, ...context }, isRetryable, cause);
    this.name = "StorageError";
  }
}

/**
 * FFmpeg processing error
 */
export class FfmpegError extends AnalyzerError {
  constructor(operation: string, message: string, context?: Record<string, unknown>, cause?: Error) {
    super(`FFmpeg ${operation} error: ${message}`, ErrorCode.FFMPEG_ERROR, { operation, ...context }, false, cause);
    this.name = "FfmpegError";
  }
}

/**
 * Detection/tracking error
 */
export class DetectionError extends AnalyzerError {
  constructor(
    stage: "detection" | "tracking" | "classification",
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    const code = stage === "tracking" ? ErrorCode.TRACKING_ERROR : ErrorCode.DETECTION_ERROR;
    super(`${stage} error: ${message}`, code, { stage, ...context }, false, cause);
    this.name = "DetectionError";
  }
}

/**
 * Timeout error - retryable
 */
export class TimeoutError extends AnalyzerError {
  constructor(operation: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(
      `Operation timed out after ${timeoutMs}ms: ${operation}`,
      ErrorCode.TIMEOUT_ERROR,
      { operation, timeoutMs, ...context },
      true
    );
    this.name = "TimeoutError";
  }
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AnalyzerError) {
    return error.isRetryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Rate limits
    if (message.includes("429") || message.includes("rate limit")) return true;
    // Server errors
    if (/\b5\d{2}\b/.test(message)) return true;
    // Network errors
    if (message.includes("timeout") || message.includes("etimedout")) return true;
    if (message.includes("econnreset") || message.includes("enotfound")) return true;
    // Fetch errors (Node.js undici)
    if (message.includes("fetch failed")) return true;
    if (message.includes("socket hang up")) return true;
    if (message.includes("econnrefused")) return true;
    // AbortError from signal timeout
    if (error.name === "AbortError") return true;
  }

  return false;
}

/**
 * Wrap an unknown error as AnalyzerError
 */
export function wrapError(error: unknown, context?: Record<string, unknown>): AnalyzerError {
  if (error instanceof AnalyzerError) {
    return error;
  }

  if (error instanceof Error) {
    return new AnalyzerError(error.message, ErrorCode.UNKNOWN_ERROR, context, isRetryableError(error), error);
  }

  return new AnalyzerError(String(error), ErrorCode.UNKNOWN_ERROR, context, false);
}

/**
 * Extract error info for logging
 */
export function extractErrorInfo(error: unknown): {
  message: string;
  code: ErrorCodeType;
  isRetryable: boolean;
  context?: Record<string, unknown>;
} {
  if (error instanceof AnalyzerError) {
    return {
      message: error.message,
      code: error.code,
      isRetryable: error.isRetryable,
      context: error.context,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: ErrorCode.UNKNOWN_ERROR,
      isRetryable: isRetryableError(error),
    };
  }

  return {
    message: String(error),
    code: ErrorCode.UNKNOWN_ERROR,
    isRetryable: false,
  };
}
