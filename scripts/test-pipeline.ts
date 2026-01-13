/**
 * End-to-end pipeline test script
 * Usage: npx ts-node scripts/test-pipeline.ts <video-path>
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";
import { createReadStream, statSync } from "fs";
import { basename, extname } from "path";

// Configuration
const PROJECT_ID = "soccer-analyzer-483917";
const BUCKET_NAME = "soccer-analyzer-483917-videos";
const CLOUD_RUN_URL = "https://soccer-analyzer-539846821742.us-central1.run.app";

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error("Usage: npx ts-node scripts/test-pipeline.ts <video-path>");
    process.exit(1);
  }

  // Check video file exists
  try {
    const stats = statSync(videoPath);
    console.log(`Video file: ${videoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (e) {
    console.error(`Video file not found: ${videoPath}`);
    process.exit(1);
  }

  // Initialize Firebase Admin using Application Default Credentials
  if (getApps().length === 0) {
    initializeApp({
      projectId: PROJECT_ID,
      storageBucket: BUCKET_NAME,
    });
  }

  const db = getFirestore();
  const storage = getStorage();
  const bucket = storage.bucket();

  // Generate test match ID
  const matchId = `test-${randomUUID().slice(0, 8)}`;
  const ext = extname(videoPath);
  const storagePath = `matches/${matchId}/video${ext}`;

  console.log(`\n=== Pipeline Test ===`);
  console.log(`Match ID: ${matchId}`);
  console.log(`Storage Path: gs://${BUCKET_NAME}/${storagePath}`);

  // Step 1: Upload video to Cloud Storage
  console.log(`\n[1/3] Uploading video to Cloud Storage...`);
  const file = bucket.file(storagePath);

  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: {
        contentType: ext === ".mov" ? "video/quicktime" : "video/mp4",
      },
    });

    stream.on("error", reject);
    stream.on("finish", resolve);

    createReadStream(videoPath).pipe(stream);
  });

  console.log(`   Uploaded: gs://${BUCKET_NAME}/${storagePath}`);

  // Step 2: Create match document in Firestore
  console.log(`\n[2/3] Creating match document in Firestore...`);
  const matchDoc = {
    matchId,
    ownerUid: "test-user",
    title: `Test Match - ${new Date().toISOString()}`,
    date: new Date().toISOString(),
    video: {
      storagePath: `gs://${BUCKET_NAME}/${storagePath}`,
      uploadedAt: new Date().toISOString(),
    },
    settings: {
      gameFormat: "eleven",
      processingMode: "quick",
    },
    analysis: {
      status: "queued",
    },
    createdAt: new Date().toISOString(),
  };

  await db.collection("matches").doc(matchId).set(matchDoc);
  console.log(`   Created: matches/${matchId}`);

  // Step 3: Call Cloud Run endpoint
  console.log(`\n[3/3] Triggering analysis pipeline...`);
  console.log(`   URL: ${CLOUD_RUN_URL}`);

  // Get ID token for authentication
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(CLOUD_RUN_URL);
  const headers = await client.getRequestHeaders();

  const response = await fetch(CLOUD_RUN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ matchId }),
  });

  const result = await response.json();
  console.log(`\n=== Result ===`);
  console.log(`Status: ${response.status}`);
  console.log(JSON.stringify(result, null, 2));

  // Check final analysis status
  console.log(`\n=== Checking Analysis Status ===`);
  const finalDoc = await db.collection("matches").doc(matchId).get();
  const finalData = finalDoc.data();
  console.log(`Analysis Status: ${finalData?.analysis?.status}`);
  if (finalData?.analysis?.errorMessage) {
    console.log(`Error: ${finalData.analysis.errorMessage}`);
  }
  if (finalData?.analysis?.activeVersion) {
    console.log(`Version: ${finalData.analysis.activeVersion}`);
  }

  console.log(`\n=== Done ===`);
  console.log(`Match ID: ${matchId}`);
  console.log(`Firestore: https://console.cloud.google.com/firestore/data/matches/${matchId}?project=${PROJECT_ID}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
