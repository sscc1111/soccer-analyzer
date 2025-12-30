import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROMPT_VERSION } from "@soccer/shared";
import { z } from "zod";
import { downloadToTmp } from "../lib/storage";

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
};

export async function labelClipWithGemini(clip: LabelClipInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const prompt = await loadPrompt();

  const parts: any[] = [
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

  const response = await callGemini(model, apiKey, parts);
  const parsed = parseLabel(response);
  if (parsed.ok) return { result: parsed.data, rawResponse: response };

  const repair = await callGemini(model, apiKey, [
    {
      text: [
        "Fix the following to valid JSON with the required schema.",
        JSON.stringify(prompt.output_schema),
        "Input:",
        response,
      ].join("\n"),
    },
  ]);
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

async function callGemini(model: string, apiKey: string, parts: any[]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const body = (await res.json()) as any;
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response empty");
  return text;
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
