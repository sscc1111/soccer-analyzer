/**
 * Unified structured logging for the analyzer service
 *
 * Features:
 * - JSON-formatted logs for Cloud Logging compatibility
 * - Context propagation via child loggers
 * - Trace ID support for distributed tracing
 * - Consistent severity levels
 */

import { AnalyzerError, extractErrorInfo } from "./errors";

/**
 * Log severity levels (Cloud Logging compatible)
 */
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

/**
 * Context that persists across all log entries
 */
export type LogContext = {
  matchId?: string;
  jobId?: string;
  traceId?: string;
  step?: string;
  service?: string;
  version?: string;
  [key: string]: unknown;
};

/**
 * Log entry structure (Cloud Logging compatible)
 */
export type LogEntry = {
  timestamp: string;
  severity: LogLevel;
  message: string;
  matchId?: string;
  jobId?: string;
  traceId?: string;
  step?: string;
  service?: string;
  [key: string]: unknown;
};

/**
 * Logger interface
 */
export interface ILogger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: unknown, extra?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional context
   */
  child(context: Partial<LogContext>): ILogger;

  /**
   * Get current context
   */
  getContext(): LogContext;
}

/**
 * Structured logger implementation
 */
export class Logger implements ILogger {
  constructor(private context: LogContext = {}) {}

  /**
   * Internal log method
   */
  private log(severity: LogLevel, message: string, extra?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      severity,
      message,
      ...this.context,
      ...extra,
    };

    // Remove undefined values
    const cleanEntry = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));

    const json = JSON.stringify(cleanEntry);

    switch (severity) {
      case "ERROR":
        console.error(json);
        break;
      case "WARNING":
        console.warn(json);
        break;
      default:
        console.log(json);
    }
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.log("DEBUG", message, extra);
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.log("INFO", message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.log("WARNING", message, extra);
  }

  error(message: string, error?: unknown, extra?: Record<string, unknown>): void {
    let errorData: Record<string, unknown> = {};

    if (error !== undefined) {
      const errorInfo = extractErrorInfo(error);
      errorData = {
        errorMessage: errorInfo.message,
        errorCode: errorInfo.code,
        isRetryable: errorInfo.isRetryable,
        errorContext: errorInfo.context,
      };

      // Include stack trace if available
      if (error instanceof Error && error.stack) {
        errorData.errorStack = error.stack.split("\n").slice(0, 5).join("\n");
      }
    }

    this.log("ERROR", message, { ...errorData, ...extra });
  }

  child(context: Partial<LogContext>): ILogger {
    return new Logger({ ...this.context, ...context });
  }

  getContext(): LogContext {
    return { ...this.context };
  }
}

/**
 * Create a logger with common context for a pipeline job
 */
export function createPipelineLogger(options: {
  matchId: string;
  jobId?: string;
  version?: string;
  traceId?: string;
}): ILogger {
  return new Logger({
    service: "analyzer",
    matchId: options.matchId,
    jobId: options.jobId,
    version: options.version,
    traceId: options.traceId || generateTraceId(),
  });
}

/**
 * Generate a trace ID for request correlation
 */
export function generateTraceId(): string {
  // Format compatible with Cloud Trace
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Extract trace ID from request headers (Cloud Run)
 */
export function extractTraceId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const traceHeader = headers["x-cloud-trace-context"];
  if (typeof traceHeader === "string") {
    // Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
    return traceHeader.split("/")[0];
  }
  return undefined;
}

/**
 * Timing utility for measuring operation duration
 */
export function withTiming<T>(
  logger: ILogger,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  return fn()
    .then((result) => {
      const durationMs = Date.now() - startTime;
      logger.info(`${operation} completed`, { operation, durationMs });
      return result;
    })
    .catch((error) => {
      const durationMs = Date.now() - startTime;
      logger.error(`${operation} failed`, error, { operation, durationMs });
      throw error;
    });
}

/**
 * Create a step logger with progress tracking
 */
export function createStepLogger(
  parentLogger: ILogger,
  stepName: string,
  options?: { totalItems?: number }
): ILogger & {
  progress(current: number, message?: string): void;
  complete(message?: string, extra?: Record<string, unknown>): void;
} {
  const stepLogger = parentLogger.child({ step: stepName }) as Logger;
  const startTime = Date.now();

  return Object.assign(stepLogger, {
    progress(current: number, message?: string) {
      const extra: Record<string, unknown> = { current };
      if (options?.totalItems) {
        extra.total = options.totalItems;
        extra.percent = Math.round((current / options.totalItems) * 100);
      }
      stepLogger.info(message || `${stepName} progress`, extra);
    },
    complete(message?: string, extra?: Record<string, unknown>) {
      const durationMs = Date.now() - startTime;
      stepLogger.info(message || `${stepName} complete`, { durationMs, ...extra });
    },
  });
}

/**
 * Default logger instance (for quick usage)
 */
export const defaultLogger = new Logger({ service: "analyzer" });
