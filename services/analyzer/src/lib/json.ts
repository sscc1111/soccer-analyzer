/**
 * JSON utilities for handling Gemini API responses
 */

/**
 * Extract JSON from text that may contain markdown code blocks or extra text.
 * Gemini sometimes returns JSON wrapped in markdown code blocks like ```json {...} ```
 * even when responseMimeType is set to "application/json".
 */
export function extractJson(text: string): string {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object or array
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

/**
 * Parse JSON from text, automatically extracting from markdown if needed.
 * Returns the parsed JSON object or throws an error.
 */
export function parseJsonFromGemini<T = unknown>(text: string): T {
  const extracted = extractJson(text);
  return JSON.parse(extracted) as T;
}
