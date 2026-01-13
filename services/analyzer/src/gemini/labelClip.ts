import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROMPT_VERSION } from "@soccer/shared";
import { z } from "zod";
import { downloadToTmp } from "../lib/storage";
import { withRetry } from "../lib/retry";
import { callGeminiApi, extractTextFromResponse, type Gemini3Request, type Gemini3Part } from "./gemini3Client";
import { defaultLogger as logger } from "../lib/logger";

const LabelSchema = z.object({
  label: z.enum(["shot", "chance", "setPiece", "dribble", "defense", "other"]),
  confidence: z.number().min(0).max(1),
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  coachTips: z.array(z.string()).optional().nullable(),
});

type LabelResult = z.infer<typeof LabelSchema>;

type LabelClipInput = {
  clipId: string;
  t0: number;
  t1: number;
  thumbPath?: string;
  matchId?: string;
};

export async function labelClipWithGemini(clip: LabelClipInput) {
  // Validate GCP_PROJECT_ID is set
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const prompt = await loadPrompt();

  const parts: Gemini3Part[] = [
    {
      text: [
        `Task: ${prompt.task}`,
        `Return JSON only. Output schema: ${JSON.stringify(prompt.output_schema)}`,
        `Clip info: id=${clip.clipId}, t0=${clip.t0.toFixed(2)}s, t1=${clip.t1.toFixed(2)}s.`,
      ].join("\n"),
    },
  ];

  if (clip.thumbPath) {
    const localThumb = await downloadToTmp(clip.thumbPath, path.basename(clip.thumbPath));
    const imageBytes = await readFile(localThumb);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBytes.toString("base64"),
      },
    });
  }

  const response = await callGeminiWithRetry(projectId, modelId, parts, clip.matchId);
  const parsed = parseLabel(response);
  if (parsed.ok) return { result: parsed.data, rawResponse: response };

  // Repair attempt if JSON parsing failed
  const repairParts: Gemini3Part[] = [
    {
      text: [
        "Fix the following to valid JSON with the required schema.",
        JSON.stringify(prompt.output_schema),
        "Input:",
        response,
      ].join("\n"),
    },
  ];
  const repair = await callGeminiWithRetry(projectId, modelId, repairParts, clip.matchId);
  const repaired = parseLabel(repair);
  if (!repaired.ok) throw new Error("Gemini response invalid JSON");
  return { result: repaired.data, rawResponse: repair, rawOriginalResponse: response };
}

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", `${PROMPT_VERSION}.json`);
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data) as { task: string; output_schema: Record<string, unknown> };
  return cachedPrompt;
}

let cachedPrompt: { task: string; output_schema: Record<string, unknown> } | null = null;

/**
 * Call Gemini API with retry logic using REST API (supports global endpoint)
 */
async function callGeminiWithRetry(projectId: string, modelId: string, parts: Gemini3Part[], matchId?: string): Promise<string> {
  return withRetry(
    async () => {
      const request: Gemini3Request = {
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      };

      const costContext = matchId ? { matchId, step: "label_clips" } : undefined;
      const response = await callGeminiApi(projectId, modelId, request, costContext);
      const text = extractTextFromResponse(response);
      if (!text) throw new Error("Gemini response empty");
      return text;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 120000, // 2 minutes timeout
      onRetry: (attempt, error, delayMs) => {
        logger.warn("Retrying clip labeling", {
          model: modelId,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

function parseLabel(text: string): { ok: true; data: LabelResult } | { ok: false; error: string } {
  try {
    const json = JSON.parse(text);
    const parsed = LabelSchema.parse(json);
    return { ok: true, data: parsed };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
