/**
 * ML Client Integration Test
 *
 * Run with: ML_INFERENCE_URL=http://localhost:8080 pnpm --filter @soccer/analyzer test
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  MLClient,
  createYoloPlayerDetector,
  createYoloBallDetector,
  bufferToBase64DataUrl
} from "../index";

const ML_URL = process.env.ML_INFERENCE_URL;

describe.skipIf(!ML_URL)("MLClient", () => {
  let client: MLClient;

  beforeAll(() => {
    client = new MLClient({ baseUrl: ML_URL!, timeoutMs: 30000, maxRetries: 1, retryDelayMs: 100 });
  });

  it("health check returns healthy status", async () => {
    const result = await client.healthCheck();
    expect(result.status).toBe("healthy");
    expect(result.models.detector).toBe(true);
    expect(result.models.tracker).toBe(true);
  });

  it("detects players from test image via request object", async () => {
    // Create a simple test buffer (small size for testing)
    const width = 64;
    const height = 64;
    const buffer = Buffer.alloc(width * height * 3); // RGB black image

    // Convert to base64 like the detector does
    const frameData = bufferToBase64DataUrl(buffer, width, height);

    const response = await client.detectPlayers({
      frameData,
      width,
      height,
      confidenceThreshold: 0.3,
    });

    expect(response).toHaveProperty("detections");
    expect(Array.isArray(response.detections)).toBe(true);
  });
});

describe.skipIf(!ML_URL)("YoloPlayerDetector", () => {
  it("has correct model ID", () => {
    const detector = createYoloPlayerDetector();
    expect(detector.modelId).toBe("yolo-player-v1");
  });

  it("detects players from buffer", async () => {
    const detector = createYoloPlayerDetector({
      confidenceThreshold: 0.3,
    });

    // Small test image
    const width = 64;
    const height = 64;
    const buffer = Buffer.alloc(width * height * 3);

    const detections = await detector.detectPlayers(buffer, width, height);
    expect(Array.isArray(detections)).toBe(true);
  }, 30000);
});

describe.skipIf(!ML_URL)("YoloBallDetector", () => {
  it("has correct model ID", () => {
    const detector = createYoloBallDetector();
    expect(detector.modelId).toBe("yolo-ball-v1");
  });

  it("detects ball from buffer", async () => {
    const detector = createYoloBallDetector({
      confidenceThreshold: 0.3,
    });

    // Small test image
    const width = 64;
    const height = 64;
    const buffer = Buffer.alloc(width * height * 3);

    const detection = await detector.detectBall(buffer, width, height);
    // Ball detection may return null if no ball found
    expect(detection === null || typeof detection === "object").toBe(true);
  }, 30000);
});
