/**
 * Example usage of CostTracker for tracking Gemini API costs
 *
 * This file demonstrates how to integrate cost tracking into your
 * Gemini API calls to monitor spending and cache effectiveness.
 */

import { getCostTracker, createCostRecordBuilder } from './costTracker';
import { getDb } from '../firebase/admin';

/**
 * Example 1: Track cost for a single Gemini API call
 */
async function exampleBasicTracking(matchId: string) {
  const db = getDb();
  const costTracker = getCostTracker(db);

  // Create a cost record builder for this step
  const costRecord = createCostRecordBuilder(matchId, 'detect_events_gemini');

  // Make your Gemini API call...
  const response = await callGeminiAPI();

  // Extract token usage from response metadata
  const usageMetadata = response.usageMetadata;

  // Update cost record with actual usage
  costRecord.inputTokens = usageMetadata.promptTokenCount || 0;
  costRecord.outputTokens = usageMetadata.candidatesTokenCount || 0;
  costRecord.cachedInputTokens = usageMetadata.cachedContentTokenCount || 0;
  costRecord.usedCache = costRecord.cachedInputTokens > 0;
  costRecord.cacheId = 'cache-xyz-123'; // Optional: track which cache was used

  // Record the cost
  await costTracker.recordCost(costRecord);
}

/**
 * Example 2: Track cost with proper error handling
 */
async function exampleWithErrorHandling(matchId: string, step: string) {
  const db = getDb();
  const costTracker = getCostTracker(db);

  const costRecord = createCostRecordBuilder(matchId, step);

  try {
    const response = await callGeminiAPI();

    const usageMetadata = response.usageMetadata;
    costRecord.inputTokens = usageMetadata.promptTokenCount || 0;
    costRecord.outputTokens = usageMetadata.candidatesTokenCount || 0;
    costRecord.cachedInputTokens = usageMetadata.cachedContentTokenCount || 0;
    costRecord.usedCache = costRecord.cachedInputTokens > 0;

    // Record cost even if the API call succeeds
    await costTracker.recordCost(costRecord).catch(err => {
      // Don't fail the main operation if cost tracking fails
      console.error('Failed to record cost:', err);
    });

    return response;
  } catch (error) {
    // Even on error, try to record partial costs if available
    // (some errors may still return usage metadata)
    if (error && typeof error === 'object' && 'usageMetadata' in error) {
      const usageMetadata = (error as any).usageMetadata;
      costRecord.inputTokens = usageMetadata.promptTokenCount || 0;
      costRecord.outputTokens = usageMetadata.candidatesTokenCount || 0;
      costRecord.cachedInputTokens = usageMetadata.cachedContentTokenCount || 0;
      costRecord.usedCache = costRecord.cachedInputTokens > 0;

      await costTracker.recordCost(costRecord).catch(err => {
        console.error('Failed to record cost on error:', err);
      });
    }

    throw error;
  }
}

/**
 * Example 3: Get cost summary for a match
 */
async function exampleGetSummary(matchId: string) {
  const db = getDb();
  const costTracker = getCostTracker(db);

  const summary = await costTracker.getMatchCostSummary(matchId);

  if (summary) {
    console.log('Match Cost Summary:');
    console.log(`Total Cost: $${summary.totalCost.toFixed(4)}`);
    console.log(`Estimated Cost Without Cache: $${summary.estimatedCostWithoutCache.toFixed(4)}`);
    console.log(`Savings: $${summary.savings.toFixed(4)} (${summary.savingsPercent.toFixed(1)}%)`);
    console.log(`Request Count: ${summary.requestCount}`);
    console.log(`Total Input Tokens: ${summary.totalInputTokens.toLocaleString()}`);
    console.log(`Total Output Tokens: ${summary.totalOutputTokens.toLocaleString()}`);
    console.log(`Total Cached Tokens: ${summary.totalCachedTokens.toLocaleString()}`);
  }
}

/**
 * Example 4: Get detailed breakdown by step
 */
async function exampleGetBreakdown(matchId: string) {
  const db = getDb();
  const costTracker = getCostTracker(db);

  const breakdown = await costTracker.getCostBreakdownByStep(matchId);

  console.log('Cost Breakdown by Step:');
  for (const step of breakdown) {
    console.log(`\n${step.step}:`);
    console.log(`  Cost: $${step.totalCost.toFixed(4)}`);
    console.log(`  Requests: ${step.requestCount}`);
    console.log(`  Input Tokens: ${step.inputTokens.toLocaleString()}`);
    console.log(`  Output Tokens: ${step.outputTokens.toLocaleString()}`);
    console.log(`  Cached Tokens: ${step.cachedTokens.toLocaleString()}`);
  }
}

/**
 * Example 5: Integration with existing Gemini wrapper
 */
async function exampleIntegrateWithWrapper(
  matchId: string,
  step: string,
  prompt: string
) {
  const db = getDb();
  const costTracker = getCostTracker(db);

  const costRecord = createCostRecordBuilder(matchId, step);

  // Your existing Gemini call
  const model = getGeminiModel();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  // Extract usage and record cost
  const response = await result.response;
  const usageMetadata = response.usageMetadata;

  if (usageMetadata) {
    costRecord.inputTokens = usageMetadata.promptTokenCount || 0;
    costRecord.outputTokens = usageMetadata.candidatesTokenCount || 0;
    costRecord.cachedInputTokens = usageMetadata.cachedContentTokenCount || 0;
    costRecord.usedCache = costRecord.cachedInputTokens > 0;

    await costTracker.recordCost(costRecord).catch(err => {
      console.error('Cost tracking failed:', err);
    });
  }

  return response;
}

// Mock functions for examples
async function callGeminiAPI(): Promise<any> {
  return {
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 500,
      cachedContentTokenCount: 800,
    },
  };
}

function getGeminiModel(): any {
  return null;
}
