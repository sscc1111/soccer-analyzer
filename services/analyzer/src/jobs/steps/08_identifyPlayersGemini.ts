/**
 * Step 08: Identify Players with Gemini (Gemini-first Architecture)
 *
 * Gemini を使用して選手を識別（背番号OCR、チーム分類、役割識別）
 * 既存の K-means チーム分類を置き換え
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { TrackTeamMeta, TrackPlayerMapping, TeamId, GameFormat } from "@soccer/shared";
import { GAME_FORMAT_INFO } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

const PLAYER_ID_VERSION = "v1";

// Response schema validation
const TeamColorsSchema = z.object({
  primaryColor: z.string(),
  secondaryColor: z.string().optional(),
  goalkeeperColor: z.string().optional(),
});

const PlayerSchema = z.object({
  team: z.enum(["home", "away"]),
  jerseyNumber: z.number().nullable(),
  role: z.enum(["player", "goalkeeper"]),
  confidence: z.number().min(0).max(1),
});

const RefereeSchema = z.object({
  role: z.enum(["main_referee", "linesman", "fourth_official"]),
  uniformColor: z.string().optional(),
});

const PlayersResponseSchema = z.object({
  teams: z.object({
    home: TeamColorsSchema,
    away: TeamColorsSchema,
  }),
  players: z.array(PlayerSchema),
  referees: z.array(RefereeSchema).optional(),
});

type PlayersResponse = z.infer<typeof PlayersResponseSchema>;

export type IdentifyPlayersGeminiOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type IdentifyPlayersGeminiResult = {
  matchId: string;
  homePlayerCount: number;
  awayPlayerCount: number;
  refereeCount: number;
  skipped: boolean;
  error?: string;
};

let cachedPrompt: { task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", "player_identification_" + PLAYER_ID_VERSION + ".json");
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

/**
 * Identify players from match video using Gemini
 */
export async function stepIdentifyPlayersGemini(
  options: IdentifyPlayersGeminiOptions
): Promise<IdentifyPlayersGeminiResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "identify_players_gemini" }) : log;

  stepLogger.info("Starting Gemini player identification", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing player data (idempotency)
  const matchSnap = await matchRef.get();
  const existingPlayerData = matchSnap.data()?.geminiPlayerData;
  if (existingPlayerData?.version === version) {
    stepLogger.info("Player identification already done for this version, skipping", { matchId, version });
    return {
      matchId,
      homePlayerCount: existingPlayerData.homePlayerCount || 0,
      awayPlayerCount: existingPlayerData.awayPlayerCount || 0,
      refereeCount: existingPlayerData.refereeCount || 0,
      skipped: true,
    };
  }

  // Get cache info (with fallback to direct file URI)
  const cache = await getValidCacheOrFallback(matchId);

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot identify players", { matchId });
    return {
      matchId,
      homePlayerCount: 0,
      awayPlayerCount: 0,
      refereeCount: 0,
      skipped: true,
      error: "No video file URI available",
    };
  }

  // Get game format from match settings
  const matchData = matchSnap.data();
  const gameFormat: GameFormat = matchData?.settings?.gameFormat || "eleven";
  const formatInfo = GAME_FORMAT_INFO[gameFormat];
  const expectedPlayersPerTeam = formatInfo.players / 2;

  stepLogger.info("Using video for player identification", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
    gameFormat,
    expectedPlayersPerTeam,
  });

  const prompt = await loadPrompt();
  const result = await identifyPlayersWithGemini(cache, prompt, gameFormat, matchId, stepLogger);

  // Group players by team
  const homePlayers = result.players.filter((p) => p.team === "home");
  const awayPlayers = result.players.filter((p) => p.team === "away");

  // Save team colors to match settings
  await matchRef.set({
    settings: {
      teamColors: {
        home: result.teams.home.primaryColor,
        away: result.teams.away.primaryColor,
      },
    },
    geminiPlayerData: {
      version,
      teams: result.teams,
      homePlayerCount: homePlayers.length,
      awayPlayerCount: awayPlayers.length,
      refereeCount: result.referees?.length || 0,
      createdAt: new Date().toISOString(),
    },
  }, { merge: true });

  // Save player data with batch limit handling (max 500 operations per batch)
  const BATCH_LIMIT = 450; // Leave buffer for safety
  const now = new Date().toISOString();

  // Collect all documents to write
  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Create synthetic track IDs for Gemini-identified players
  for (let i = 0; i < result.players.length; i++) {
    const player = result.players[i];
    const trackId = matchId + "_gemini_player_" + i;

    // Save track team meta
    const teamMeta: TrackTeamMeta = {
      trackId,
      teamId: player.team as TeamId,
      teamConfidence: player.confidence,
      dominantColor: player.team === "home"
        ? result.teams.home.primaryColor
        : result.teams.away.primaryColor,
      classificationMethod: "color_clustering", // Gemini uses visual analysis
    };
    allDocs.push({ collection: "trackTeamMetas", id: trackId, data: teamMeta });

    // Save player mapping if jersey number detected
    if (player.jerseyNumber !== null) {
      const mapping: TrackPlayerMapping = {
        trackId,
        playerId: null,
        jerseyNumber: player.jerseyNumber,
        ocrConfidence: player.confidence,
        source: "ocr",
        needsReview: player.confidence < 0.8,
        reviewReason: player.confidence < 0.8 ? "low_confidence" : undefined,
      };
      allDocs.push({ collection: "trackMappings", id: trackId, data: mapping });
    }
  }

  // Save referee data
  if (result.referees) {
    for (let i = 0; i < result.referees.length; i++) {
      const referee = result.referees[i];
      allDocs.push({
        collection: "referees",
        id: "ref_" + i,
        data: {
          refereeId: "ref_" + i,
          role: referee.role,
          uniformColor: referee.uniformColor,
          version,
          createdAt: now,
        },
      });
    }
  }

  // Commit in batches to respect Firestore 500 operation limit
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, allDocs.length);

    for (let i = startIdx; i < endIdx; i++) {
      const doc = allDocs[i];
      batch.set(matchRef.collection(doc.collection).doc(doc.id), doc.data);
    }

    await batch.commit();
  }
  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Player identification complete", {
    matchId,
    homePlayerCount: homePlayers.length,
    awayPlayerCount: awayPlayers.length,
    refereeCount: result.referees?.length || 0,
    homeColor: result.teams.home.primaryColor,
    awayColor: result.teams.away.primaryColor,
  });

  return {
    matchId,
    homePlayerCount: homePlayers.length,
    awayPlayerCount: awayPlayers.length,
    refereeCount: result.referees?.length || 0,
    skipped: false,
  };
}

async function identifyPlayersWithGemini(
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  gameFormat: GameFormat,
  matchId: string,
  log: ILogger
): Promise<PlayersResponse> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Get format-specific information
  const formatInfo = GAME_FORMAT_INFO[gameFormat];
  const expectedPlayersPerTeam = formatInfo.players / 2;

  // Build format context for the prompt
  const formatContext = [
    `\n## 試合フォーマット: ${formatInfo.labelJa}`,
    `- 各チームの選手数: ${expectedPlayersPerTeam}人（GK含む）`,
    `- フィールドプレイヤー: ${formatInfo.outfieldPlayers}人`,
    `- 重要: 各チームから最大${expectedPlayersPerTeam}人の選手のみを識別してください`,
    `- 同じ選手を複数回カウントしないでください`,
  ].join("\n");

  const promptText = [
    prompt.instructions,
    formatContext,
    "",
    "## 出力形式 (JSON)",
    JSON.stringify(prompt.output_schema, null, 2),
    "",
    "Task: " + prompt.task,
    "",
    "Return JSON only.",
  ].join("\n");

  return withRetry(
    async () => {
      const request: Gemini3Request = {
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  fileUri: cache.storageUri || cache.fileUri || "",
                  mimeType: "video/mp4",
                },
              },
              { text: promptText },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      };

      const response = await callGeminiApi(projectId, modelId, request, { matchId, step: "identify_players_gemini" });
      const text = extractTextFromResponse(response);

      const parsed = JSON.parse(text);
      return PlayersResponseSchema.parse(parsed);
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 300000, // 5 minutes
      onRetry: (attempt, error) => {
        log.warn("Retrying player identification", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
