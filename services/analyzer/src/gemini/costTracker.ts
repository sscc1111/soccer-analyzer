import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { defaultLogger } from '../lib/logger';

/**
 * Record of a single Gemini API call cost
 */
export interface CostRecord {
  matchId: string;
  requestId: string;
  step: string; // e.g., 'detect_events_gemini', 'segment_video', etc.
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number; // tokens from cache (discounted)
  inputCost: number; // in USD
  outputCost: number; // in USD
  totalCost: number;
  usedCache: boolean;
  cacheId?: string;
}

/**
 * Aggregated cost summary for a match
 */
export interface MatchCostSummary {
  matchId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCost: number;
  estimatedCostWithoutCache: number;
  savings: number;
  savingsPercent: number;
  requestCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tracks costs for Gemini API usage with context caching support
 */
export class CostTracker {
  // Pricing for Gemini 1.5 Flash (verify against latest pricing)
  private static PRICE_INPUT_PER_1M = 0.075; // $0.075 per 1M tokens
  private static PRICE_OUTPUT_PER_1M = 0.30; // $0.30 per 1M tokens
  private static PRICE_CACHED_INPUT_PER_1M = 0.01875; // $0.01875 per 1M tokens (75% discount)

  constructor(private db: Firestore) {}

  /**
   * Calculate costs for given token counts
   */
  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number
  ): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  } {
    // Regular input tokens (not cached)
    const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens);

    const inputCost =
      (regularInputTokens / 1_000_000) * this.PRICE_INPUT_PER_1M +
      (cachedInputTokens / 1_000_000) * this.PRICE_CACHED_INPUT_PER_1M;

    const outputCost = (outputTokens / 1_000_000) * this.PRICE_OUTPUT_PER_1M;

    const totalCost = inputCost + outputCost;

    return {
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000, // Round to 6 decimal places
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
      totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    };
  }

  /**
   * Record a single API call cost
   */
  async recordCost(
    record: Omit<CostRecord, 'inputCost' | 'outputCost' | 'totalCost'>
  ): Promise<CostRecord> {
    try {
      const { inputCost, outputCost, totalCost } = CostTracker.calculateCost(
        record.inputTokens,
        record.outputTokens,
        record.cachedInputTokens
      );

      const costRecord: CostRecord = {
        ...record,
        inputCost,
        outputCost,
        totalCost,
      };

      // Store in Firestore
      const docRef = this.db
        .collection('matches')
        .doc(record.matchId)
        .collection('costRecords')
        .doc(record.requestId);

      await docRef.set(costRecord);

      defaultLogger.info('Cost record saved', {
        matchId: record.matchId,
        requestId: record.requestId,
        step: record.step,
        totalCost: formatCost(totalCost),
        usedCache: record.usedCache,
      });

      // Update match cost summary
      await this.updateMatchCostSummary(record.matchId);

      return costRecord;
    } catch (error) {
      defaultLogger.error('Failed to record cost', {
        matchId: record.matchId,
        step: record.step,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get cost summary for a match
   */
  async getMatchCostSummary(matchId: string): Promise<MatchCostSummary | null> {
    try {
      const docRef = this.db
        .collection('matches')
        .doc(matchId)
        .collection('costTracking')
        .doc('summary');

      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      return doc.data() as MatchCostSummary;
    } catch (error) {
      defaultLogger.error('Failed to get match cost summary', {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update match cost summary by aggregating all cost records
   */
  async updateMatchCostSummary(matchId: string): Promise<void> {
    try {
      // Fetch all cost records for this match
      const recordsSnapshot = await this.db
        .collection('matches')
        .doc(matchId)
        .collection('costRecords')
        .get();

      if (recordsSnapshot.empty) {
        defaultLogger.warn('No cost records found for match', { matchId });
        return;
      }

      const records = recordsSnapshot.docs.map(
        (doc) => doc.data() as CostRecord
      );

      // Calculate aggregated values
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCachedTokens = 0;
      let totalCost = 0;

      for (const record of records) {
        totalInputTokens += record.inputTokens;
        totalOutputTokens += record.outputTokens;
        totalCachedTokens += record.cachedInputTokens;
        totalCost += record.totalCost;
      }

      // Calculate what it would cost without caching (all tokens at regular price)
      const estimatedCostWithoutCache =
        ((totalInputTokens / 1_000_000) * CostTracker.PRICE_INPUT_PER_1M) +
        ((totalOutputTokens / 1_000_000) * CostTracker.PRICE_OUTPUT_PER_1M);

      const savings = Math.max(0, estimatedCostWithoutCache - totalCost);
      const savingsPercent =
        estimatedCostWithoutCache > 0
          ? (savings / estimatedCostWithoutCache) * 100
          : 0;

      const now = new Date().toISOString();

      // Check if summary already exists
      const summaryRef = this.db
        .collection('matches')
        .doc(matchId)
        .collection('costTracking')
        .doc('summary');

      const existingSummary = await summaryRef.get();
      const createdAt = existingSummary.exists
        ? (existingSummary.data() as MatchCostSummary).createdAt
        : now;

      const summary: MatchCostSummary = {
        matchId,
        totalInputTokens: Math.round(totalInputTokens),
        totalOutputTokens: Math.round(totalOutputTokens),
        totalCachedTokens: Math.round(totalCachedTokens),
        totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
        estimatedCostWithoutCache:
          Math.round(estimatedCostWithoutCache * 1_000_000) / 1_000_000,
        savings: Math.round(savings * 1_000_000) / 1_000_000,
        savingsPercent: Math.round(savingsPercent * 100) / 100,
        requestCount: records.length,
        createdAt,
        updatedAt: now,
      };

      await summaryRef.set(summary);

      defaultLogger.info('Match cost summary updated', {
        matchId,
        totalCost: formatCost(summary.totalCost),
        savings: formatCost(summary.savings),
        savingsPercent: `${summary.savingsPercent.toFixed(1)}%`,
        requestCount: summary.requestCount,
      });
    } catch (error) {
      defaultLogger.error('Failed to update match cost summary', {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get detailed cost breakdown by step for a match
   */
  async getCostBreakdownByStep(matchId: string): Promise<
    Array<{
      step: string;
      totalCost: number;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
    }>
  > {
    try {
      const recordsSnapshot = await this.db
        .collection('matches')
        .doc(matchId)
        .collection('costRecords')
        .get();

      if (recordsSnapshot.empty) {
        return [];
      }

      const records = recordsSnapshot.docs.map(
        (doc) => doc.data() as CostRecord
      );

      // Group by step
      const breakdown = new Map<
        string,
        {
          step: string;
          totalCost: number;
          requestCount: number;
          inputTokens: number;
          outputTokens: number;
          cachedTokens: number;
        }
      >();

      for (const record of records) {
        const existing = breakdown.get(record.step) || {
          step: record.step,
          totalCost: 0,
          requestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
        };

        existing.totalCost += record.totalCost;
        existing.requestCount += 1;
        existing.inputTokens += record.inputTokens;
        existing.outputTokens += record.outputTokens;
        existing.cachedTokens += record.cachedInputTokens;

        breakdown.set(record.step, existing);
      }

      return Array.from(breakdown.values()).sort(
        (a, b) => b.totalCost - a.totalCost
      );
    } catch (error) {
      defaultLogger.error('Failed to get cost breakdown by step', {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Singleton instance
let costTrackerInstance: CostTracker | null = null;

/**
 * Get the global CostTracker instance
 */
export function getCostTracker(db?: Firestore): CostTracker {
  if (!costTrackerInstance) {
    if (!db) {
      throw new Error('Firestore instance required to initialize CostTracker');
    }
    costTrackerInstance = new CostTracker(db);
  }
  return costTrackerInstance;
}

/**
 * Format cost in USD with appropriate precision
 * @example formatCost(0.002345) => "$0.0023"
 * @example formatCost(1.234567) => "$1.23"
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    // For very small amounts, show 4 decimal places
    return `$${usd.toFixed(4)}`;
  } else if (usd < 1) {
    // For amounts less than $1, show 3 decimal places
    return `$${usd.toFixed(3)}`;
  } else {
    // For larger amounts, show 2 decimal places
    return `$${usd.toFixed(2)}`;
  }
}

/**
 * Format token count with appropriate unit
 * @example formatTokenCount(1234) => "1.2K tokens"
 * @example formatTokenCount(1234567) => "1.2M tokens"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens} tokens`;
  } else if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}K tokens`;
  } else {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
}

/**
 * Create a new cost record (generates requestId automatically)
 */
export function createCostRecordBuilder(matchId: string, step: string) {
  return {
    matchId,
    requestId: randomUUID(),
    step,
    timestamp: new Date().toISOString(),
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    usedCache: false,
  } as Omit<CostRecord, 'inputCost' | 'outputCost' | 'totalCost'>;
}
