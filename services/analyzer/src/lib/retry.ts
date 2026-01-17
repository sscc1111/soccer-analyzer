/**
 * Retry utility with exponential backoff
 */

import { AnalyzerError, isRetryableError, TimeoutError } from "./errors";
import type { ILogger } from "./logger";

export type RetryConfig = {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Timeout for each attempt in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Function to determine if error is retryable (default: retries on 429, 5xx) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback for retry logging */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Logger instance for structured logging */
  logger?: ILogger;
  /** Operation name for logging context */
  operationName?: string;
};

type InternalConfig = Required<Omit<RetryConfig, "onRetry" | "logger" | "operationName">> &
  Pick<RetryConfig, "onRetry" | "logger" | "operationName">;

const DEFAULT_CONFIG: InternalConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 60000,
  isRetryable: isRetryableError, // Use unified error classification
  onRetry: undefined,
  logger: undefined,
  operationName: undefined,
};

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with timeout
 * P0修正: settled フラグで二重resolve/reject防止
 */
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(operationName || "operation", timeoutMs));
      }
    }, timeoutMs);

    fn()
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
  });
}

/**
 * Calculate delay with jitter for backoff
 */
function calculateDelay(attempt: number, config: InternalConfig): number {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Execute a function with retry and exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
  const mergedConfig: InternalConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    try {
      return await withTimeout(fn, mergedConfig.timeoutMs, mergedConfig.operationName);
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt === mergedConfig.maxRetries;
      const shouldRetry = !isLastAttempt && mergedConfig.isRetryable(error);

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delayMs = calculateDelay(attempt, mergedConfig);

      // Log retry attempt via logger if provided
      if (mergedConfig.logger) {
        mergedConfig.logger.warn("retry_attempt", {
          operation: mergedConfig.operationName,
          attempt: attempt + 1,
          maxRetries: mergedConfig.maxRetries,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error instanceof AnalyzerError ? error.code : undefined,
        });
      }

      // Also call onRetry callback if provided
      if (mergedConfig.onRetry) {
        mergedConfig.onRetry(attempt + 1, error, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function makeRetryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: RetryConfig = {}
): T {
  return ((...args: Parameters<T>) => withRetry(() => fn(...args), config)) as T;
}
