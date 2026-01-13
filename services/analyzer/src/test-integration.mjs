/**
 * ML検出 + Geminiラベリング 統合テスト
 *
 * 使用方法:
 * GOOGLE_APPLICATION_CREDENTIALS=../../.keys/soccer-analyzer-sa.json \
 * GCP_PROJECT_ID=soccer-analyzer-483917 \
 * node src/test-integration.mjs ../../test-movie.mov
 */

import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VertexAI } from "@google-cloud/vertexai";

const ML_API_URL = process.env.ML_API_URL || "http://localhost:8080";
const VIDEO_PATH = process.argv[2] || "../../test-movie.mov";

async function main() {
  console.log("=== ML + Gemini 統合テスト ===\n");

  // 1. 動画からフレーム抽出
  console.log("1️⃣ 動画からフレーム抽出中...");
  const tmpDir = mkdtempSync(join(tmpdir(), "soccer-test-"));
  const framePath = join(tmpDir, "frame.jpg");

  try {
    // 5秒目のフレームを抽出
    execSync(`ffmpeg -y -ss 5 -i "${VIDEO_PATH}" -frames:v 1 -q:v 2 "${framePath}" 2>/dev/null`);
    console.log(`   ✅ フレーム抽出完了: ${framePath}`);
  } catch (e) {
    console.error("   ❌ FFmpegエラー:", e.message);
    rmSync(tmpDir, { recursive: true });
    process.exit(1);
  }

  // 2. ML API で選手検出
  console.log("\n2️⃣ ML APIで選手検出中...");
  const frameData = readFileSync(framePath);
  const base64Frame = frameData.toString("base64");

  try {
    const mlResponse = await fetch(`${ML_API_URL}/detect/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frameData: base64Frame,
        width: 1920,
        height: 1080,
        confThreshold: 0.3
      })
    });

    if (!mlResponse.ok) {
      throw new Error(`ML API error: ${mlResponse.status}`);
    }

    const mlResult = await mlResponse.json();
    console.log(`   ✅ 検出完了: ${mlResult.detections.length}人の選手を検出`);
    console.log(`   ⏱️ 推論時間: ${mlResult.inferenceTimeMs.toFixed(1)}ms`);

    if (mlResult.detections.length > 0) {
      console.log("   📍 検出例:", JSON.stringify(mlResult.detections[0], null, 2));
    }
  } catch (e) {
    console.error("   ❌ ML APIエラー:", e.message);
    console.log("   ⚠️ ML APIが起動していない可能性があります");
    console.log("   💡 起動方法: cd services/ml-inference && source venv/bin/activate && python src/api.py");
  }

  // 3. Gemini でラベリング
  console.log("\n3️⃣ Geminiでシーンラベリング中...");

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    console.error("   ❌ GCP_PROJECT_ID not set");
    rmSync(tmpDir, { recursive: true });
    process.exit(1);
  }

  try {
    const vertexAI = new VertexAI({ project: projectId, location: "us-central1" });
    const model = vertexAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    });

    const prompt = `このサッカーの画像を分析し、以下のJSON形式で回答してください:
{
  "label": "shot" | "chance" | "setPiece" | "dribble" | "defense" | "other",
  "confidence": 0.0-1.0,
  "title": "シーンの短い説明",
  "summary": "詳細な説明"
}`;

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64Frame } }
        ]
      }]
    });

    const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("   ✅ Gemini応答:");

    try {
      const parsed = JSON.parse(responseText);
      console.log(`   📊 ラベル: ${parsed.label} (信頼度: ${(parsed.confidence * 100).toFixed(0)}%)`);
      console.log(`   📝 タイトル: ${parsed.title}`);
      console.log(`   📋 説明: ${parsed.summary}`);
    } catch {
      console.log("   Raw response:", responseText);
    }

  } catch (e) {
    console.error("   ❌ Geminiエラー:", e.message);
  }

  // クリーンアップ
  rmSync(tmpDir, { recursive: true });
  console.log("\n=== テスト完了 ===");
}

main().catch(console.error);
