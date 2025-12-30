# API Contracts (Draft)

## Cloud Run Analyzer
POST /run
Body: { "matchId": "string" }
Response: { "ok": true, "result": { "matchId": "...", "version": "..." } }

> In production, you may add auth, signed URLs, and step-level endpoints.
