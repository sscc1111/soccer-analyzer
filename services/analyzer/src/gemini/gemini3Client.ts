/**
 * Gemini 3 REST API Client
 *
 * The @google-cloud/vertexai SDK does NOT support "global" location.
 * Gemini 3 models require the global endpoint:
 *   https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/...
 *
 * This client uses the REST API directly to call Gemini 3 models.
 */

import { GoogleAuth } from "google-auth-library";
import { defaultLogger as logger } from "../lib/logger";
import { getCostTracker, createCostRecordBuilder } from "./costTracker";
import { getDb } from "../firebase/admin";

// Lazy-loaded auth client
let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return authClient;
}

export type Gemini3Part =
  | { text: string }
  | { fileData: { fileUri: string; mimeType: string } }
  | { inlineData: { data: string; mimeType: string } };

export type Gemini3Content = {
  role: "user" | "model";
  parts: Gemini3Part[];
};

export type Gemini3GenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  topP?: number;
  topK?: number;
  responseSchema?: Record<string, unknown>; // JSON Schema to enforce output format
};

export type Gemini3Request = {
  contents: Gemini3Content[];
  generationConfig?: Gemini3GenerationConfig;
  systemInstruction?: { parts: { text: string }[] };
  cachedContent?: string; // Resource name like "projects/xxx/locations/xxx/cachedContents/xxx"
};

/**
 * Optional cost tracking context for API calls
 */
export type CostTrackingContext = {
  matchId: string;
  step: string;
};

export type Gemini3Response = {
  candidates?: {
    content: {
      role: string;
      parts: { text?: string; thoughtSignature?: string }[];
    };
    finishReason: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number; // Tokens served from cache
  };
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: { category: string; probability: string }[];
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
};

/**
 * Check if a model requires the global endpoint (Gemini 3 models)
 */
export function isGemini3Model(modelId: string): boolean {
  return modelId.startsWith("gemini-3");
}

/**
 * Get the appropriate API endpoint for a model
 */
export function getGeminiEndpoint(projectId: string, modelId: string): string {
  if (isGemini3Model(modelId)) {
    // Gemini 3 models require global endpoint
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}:generateContent`;
  }
  // Other models use regional endpoint
  const location = process.env.GCP_REGION || "us-central1";
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
}

/**
 * Call Gemini API (supports both Gemini 3 global and regional models)
 *
 * @param projectId - GCP project ID
 * @param modelId - Model ID
 * @param request - Request payload
 * @param costContext - Optional context for cost tracking. If provided, costs will be recorded to Firestore.
 */
export async function callGeminiApi(
  projectId: string,
  modelId: string,
  request: Gemini3Request,
  costContext?: CostTrackingContext
): Promise<Gemini3Response> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  if (!accessToken.token) {
    throw new Error("Failed to get access token");
  }

  const endpoint = getGeminiEndpoint(projectId, modelId);

  logger.info("Calling Gemini API", {
    endpoint,
    model: modelId,
    isGemini3: isGemini3Model(modelId),
    usingCache: !!request.cachedContent,
  });

  // P1修正: タイムアウト設定（5分）でAPIハング防止
  const GEMINI_API_TIMEOUT_MS = 300_000; // 5 minutes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError instanceof Error && fetchError.name === 'AbortError') {
      logger.error("Gemini API call timed out", {
        endpoint,
        model: modelId,
        timeoutMs: GEMINI_API_TIMEOUT_MS,
      });
      throw new Error(`Gemini API call timed out after ${GEMINI_API_TIMEOUT_MS}ms`);
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }

  // Get response as text first to handle non-JSON responses
  const responseText = await response.text();

  // Check if response is HTML (error page)
  if (responseText.startsWith("<!DOCTYPE") || responseText.startsWith("<html")) {
    logger.error("Gemini API returned HTML instead of JSON", {
      status: response.status,
      endpoint,
      model: modelId,
      responsePreview: responseText.substring(0, 500),
    });
    throw new Error(`Gemini API returned HTML error page (status ${response.status}). Endpoint: ${endpoint}`);
  }

  // Parse JSON
  let data: Gemini3Response;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    logger.error("Failed to parse Gemini API response as JSON", {
      status: response.status,
      endpoint,
      model: modelId,
      responsePreview: responseText.substring(0, 500),
    });
    throw new Error(`Failed to parse Gemini response: ${responseText.substring(0, 200)}`);
  }

  if (!response.ok) {
    const errorMsg = data.error?.message || JSON.stringify(data);
    logger.error("Gemini API error", {
      status: response.status,
      error: errorMsg,
      model: modelId,
      endpoint,
    });
    throw new Error(`Gemini API error ${response.status}: ${errorMsg}`);
  }

  logger.info("Gemini API call successful", {
    model: modelId,
    candidateCount: data.candidates?.length || 0,
    tokenCount: data.usageMetadata?.totalTokenCount,
    cachedTokens: data.usageMetadata?.cachedContentTokenCount,
  });

  // Record cost if context is provided
  if (costContext && data.usageMetadata) {
    try {
      const db = getDb();
      const tracker = getCostTracker(db);
      const usedCache = !!request.cachedContent;
      const cachedTokens = data.usageMetadata.cachedContentTokenCount || 0;

      const record = createCostRecordBuilder(costContext.matchId, costContext.step);
      record.inputTokens = data.usageMetadata.promptTokenCount || 0;
      record.outputTokens = data.usageMetadata.candidatesTokenCount || 0;
      record.cachedInputTokens = cachedTokens;
      record.usedCache = usedCache;
      if (request.cachedContent) {
        record.cacheId = request.cachedContent;
      }

      await tracker.recordCost(record);
    } catch (costError) {
      // Log but don't fail the request if cost tracking fails
      logger.warn("Failed to record API cost", {
        matchId: costContext.matchId,
        step: costContext.step,
        error: costError instanceof Error ? costError.message : String(costError),
      });
    }
  }

  return data;
}

/**
 * Extract text from Gemini response
 */
export function extractTextFromResponse(response: Gemini3Response): string {
  if (response.error) {
    throw new Error(`Gemini error: ${response.error.message}`);
  }

  if (response.promptFeedback?.blockReason) {
    throw new Error(`Blocked by safety filter: ${response.promptFeedback.blockReason}`);
  }

  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("No candidates in Gemini response");
  }

  // Check if output was truncated due to token limit
  const finishReason = candidates[0].finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Output truncated due to MAX_TOKENS limit - increase maxOutputTokens or reduce output size");
  }

  const parts = candidates[0].content.parts;
  const textParts = parts.filter((p) => p.text).map((p) => p.text);

  if (textParts.length === 0) {
    throw new Error("No text content in Gemini response");
  }

  return textParts.join("");
}

/**
 * Call Gemini API with cached content (Vertex AI Context Caching)
 *
 * When using cached content, the video is already in the cache, so you only
 * need to provide the text prompt. This significantly reduces processing time
 * and token usage.
 *
 * @param projectId - GCP project ID
 * @param modelId - Model ID (e.g., "gemini-3-5-pro-002")
 * @param cachedContentName - Resource name of cached content (e.g., "projects/xxx/locations/xxx/cachedContents/xxx")
 * @param promptText - Text prompt to send (without video, as it's already cached)
 * @param generationConfig - Optional generation config
 * @param costContext - Optional cost tracking context
 * @returns Gemini API response
 */
export async function callGeminiApiWithCache(
  projectId: string,
  modelId: string,
  cachedContentName: string,
  promptText: string,
  generationConfig?: Gemini3GenerationConfig,
  costContext?: CostTrackingContext
): Promise<Gemini3Response> {
  const request: Gemini3Request = {
    cachedContent: cachedContentName,
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }],
      },
    ],
  };

  if (generationConfig) {
    request.generationConfig = generationConfig;
  }

  return callGeminiApi(projectId, modelId, request, costContext);
}

/**
 * Simple wrapper to generate content with Gemini 3
 */
export async function generateContent(options: {
  projectId: string;
  modelId: string;
  prompt: string;
  fileUri?: string;
  mimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: "json" | "text";
  costContext?: CostTrackingContext;
}): Promise<string> {
  const {
    projectId,
    modelId,
    prompt,
    fileUri,
    mimeType = "video/mp4",
    temperature = 0.3,
    maxOutputTokens = 8192,
    responseFormat = "json",
    costContext,
  } = options;

  const parts: Gemini3Part[] = [];

  // Add file if provided
  if (fileUri) {
    parts.push({
      fileData: {
        fileUri,
        mimeType,
      },
    });
  }

  // Add text prompt
  parts.push({ text: prompt });

  const request: Gemini3Request = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: responseFormat === "json" ? "application/json" : "text/plain",
    },
  };

  const response = await callGeminiApi(projectId, modelId, request, costContext);
  return extractTextFromResponse(response);
}
