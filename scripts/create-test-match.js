#!/usr/bin/env node
/**
 * Create a test match document in Firestore using REST API
 */

const MATCH_ID = process.argv[2] || "test-1768071110";
const PROJECT_ID = "soccer-analyzer-483917";
const BUCKET_NAME = "soccer-analyzer-483917-videos";

async function getAccessToken() {
  const { execSync } = require("child_process");
  const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  return token;
}

async function main() {
  const accessToken = await getAccessToken();

  const docData = {
    fields: {
      matchId: { stringValue: MATCH_ID },
      ownerUid: { stringValue: "test-user" },
      title: { stringValue: `Pipeline Test - ${new Date().toISOString()}` },
      video: {
        mapValue: {
          fields: {
            storagePath: { stringValue: `gs://${BUCKET_NAME}/matches/${MATCH_ID}/video.mov` },
            uploadedAt: { stringValue: new Date().toISOString() }
          }
        }
      },
      settings: {
        mapValue: {
          fields: {
            gameFormat: { stringValue: "eleven" },
            processingMode: { stringValue: "quick" }
          }
        }
      },
      analysis: {
        mapValue: {
          fields: {
            status: { stringValue: "queued" }
          }
        }
      }
    }
  };

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/matches?documentId=${MATCH_ID}`;

  console.log(`Creating match document: ${MATCH_ID}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(docData)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Error:", error);
    process.exit(1);
  }

  const result = await response.json();
  console.log("Created:", result.name);
  console.log(`Firestore Console: https://console.cloud.google.com/firestore/data/matches/${MATCH_ID}?project=${PROJECT_ID}`);
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
